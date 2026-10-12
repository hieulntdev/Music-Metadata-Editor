"""Container-aware, metadata-independent audio integrity snapshots.

The digests in this module intentionally exclude mutable tag data.  They are
used as a fail-closed guard around every metadata write, not as a media
transcoder or as a whole-file checksum.
"""

from __future__ import annotations

import hashlib
import os
import struct
from pathlib import Path
from typing import Any, BinaryIO, Iterator


class IntegrityError(Exception):
    """Raised when an audio payload cannot be isolated safely."""


def _hash_regions(path: str, regions: list[tuple[int, int]], domain: bytes) -> str:
    digest = hashlib.sha256(domain)
    with open(path, "rb") as source:
        for offset, length in regions:
            if offset < 0 or length < 0:
                raise IntegrityError("Invalid audio payload boundary.")
            digest.update(struct.pack(">Q", length))
            source.seek(offset)
            remaining = length
            while remaining:
                block = source.read(min(1024 * 1024, remaining))
                if not block:
                    raise IntegrityError("Audio payload ended unexpectedly.")
                digest.update(block)
                remaining -= len(block)
    return digest.hexdigest()


def _synchsafe(value: bytes) -> int:
    if len(value) != 4 or any(byte & 0x80 for byte in value):
        raise IntegrityError("Invalid ID3 size.")
    return (value[0] << 21) | (value[1] << 14) | (value[2] << 7) | value[3]


def _mp3_regions(path: str) -> list[tuple[int, int]]:
    size = os.path.getsize(path)
    start, end = 0, size
    with open(path, "rb") as source:
        header = source.read(10)
        if header.startswith(b"ID3"):
            tag_size = _synchsafe(header[6:10])
            footer_size = 10 if header[5] & 0x10 else 0
            start = 10 + tag_size + footer_size
            if start > end:
                raise IntegrityError("ID3 tag extends beyond the file.")

        if end >= 128:
            source.seek(end - 128)
            if source.read(3) == b"TAG":
                end -= 128

        # APEv2 is commonly placed immediately before ID3v1 (or at EOF).
        if end >= 32:
            source.seek(end - 32)
            footer = source.read(32)
            if footer.startswith(b"APETAGEX"):
                ape_size = int.from_bytes(footer[12:16], "little")
                if ape_size < 32 or ape_size > end - start:
                    raise IntegrityError("Invalid APEv2 size.")
                end -= ape_size

    if start >= end:
        raise IntegrityError("MP3 contains no audio frame payload.")
    return [(start, end - start)]


def _flac_regions(path: str) -> list[tuple[int, int]]:
    size = os.path.getsize(path)
    with open(path, "rb") as source:
        prefix = source.read(10)
        start = 0
        if prefix.startswith(b"ID3"):
            start = 10 + _synchsafe(prefix[6:10]) + (10 if prefix[5] & 0x10 else 0)
        source.seek(start)
        if source.read(4) != b"fLaC":
            raise IntegrityError("FLAC marker is missing.")
        cursor = start + 4
        while True:
            source.seek(cursor)
            block_header = source.read(4)
            if len(block_header) != 4:
                raise IntegrityError("Truncated FLAC metadata block.")
            is_last = bool(block_header[0] & 0x80)
            cursor += 4 + int.from_bytes(block_header[1:4], "big")
            if cursor > size:
                raise IntegrityError("FLAC metadata extends beyond the file.")
            if is_last:
                break
    if cursor >= size:
        raise IntegrityError("FLAC contains no audio frame payload.")
    return [(cursor, size - cursor)]


def _iter_mp4_atoms(source: BinaryIO, end: int) -> Iterator[tuple[bytes, int, int]]:
    cursor = source.tell()
    while cursor < end:
        source.seek(cursor)
        header = source.read(8)
        if len(header) != 8:
            raise IntegrityError("Truncated MP4 atom header.")
        atom_size = int.from_bytes(header[:4], "big")
        atom_type = header[4:8]
        header_size = 8
        if atom_size == 1:
            extended = source.read(8)
            if len(extended) != 8:
                raise IntegrityError("Truncated extended MP4 atom header.")
            atom_size = int.from_bytes(extended, "big")
            header_size = 16
        elif atom_size == 0:
            atom_size = end - cursor
        if atom_size < header_size or cursor + atom_size > end:
            raise IntegrityError("Invalid MP4 atom size.")
        yield atom_type, cursor + header_size, atom_size - header_size
        cursor += atom_size


def _mp4_regions(path: str) -> list[tuple[int, int]]:
    size = os.path.getsize(path)
    with open(path, "rb") as source:
        regions = [(offset, length) for kind, offset, length in _iter_mp4_atoms(source, size) if kind == b"mdat"]
    if not regions or not any(length for _, length in regions):
        raise IntegrityError("MP4/M4A contains no media payload atom.")
    return regions


def _iff_regions(path: str, form: bytes, chunk_name: bytes, byteorder: str) -> list[tuple[int, int]]:
    size = os.path.getsize(path)
    with open(path, "rb") as source:
        header = source.read(12)
        if len(header) != 12 or header[:4] != form:
            raise IntegrityError(f"Invalid {form.decode('ascii', 'replace')} container.")
        cursor = 12
        regions = []
        while cursor + 8 <= size:
            source.seek(cursor)
            chunk_header = source.read(8)
            chunk_size = int.from_bytes(chunk_header[4:8], byteorder)
            data_offset = cursor + 8
            if data_offset + chunk_size > size:
                raise IntegrityError("IFF chunk extends beyond the file.")
            if chunk_header[:4] == chunk_name:
                if chunk_name == b"SSND":
                    if chunk_size < 8:
                        raise IntegrityError("AIFF SSND chunk is truncated.")
                    source.seek(data_offset)
                    sound_offset = int.from_bytes(source.read(4), "big")
                    sample_offset = data_offset + 8 + sound_offset
                    sample_length = chunk_size - 8 - sound_offset
                    if sample_length < 0:
                        raise IntegrityError("Invalid AIFF sound-data offset.")
                    regions.append((sample_offset, sample_length))
                else:
                    regions.append((data_offset, chunk_size))
            cursor = data_offset + chunk_size + (chunk_size & 1)
    if not regions:
        raise IntegrityError("Container contains no audio data chunk.")
    return regions


def _ogg_digest(path: str) -> str:
    digest = hashlib.sha256(b"music-metadata-editor:ogg-packets:v1\0")
    streams: dict[int, dict[str, Any]] = {}
    recognized = 0
    with open(path, "rb") as source:
        while True:
            header = source.read(27)
            if not header:
                break
            if len(header) != 27 or header[:4] != b"OggS" or header[4] != 0:
                raise IntegrityError("Invalid or truncated Ogg page.")
            segment_count = header[26]
            lacing = source.read(segment_count)
            if len(lacing) != segment_count:
                raise IntegrityError("Truncated Ogg segment table.")
            body_size = sum(lacing)
            body = source.read(body_size)
            if len(body) != body_size:
                raise IntegrityError("Truncated Ogg page body.")
            serial = int.from_bytes(header[14:18], "little")
            state = streams.setdefault(serial, {"buffer": bytearray(), "kind": None, "index": 0})
            position = 0
            for segment_size in lacing:
                state["buffer"].extend(body[position:position + segment_size])
                position += segment_size
                if segment_size == 255:
                    continue
                packet = bytes(state["buffer"])
                state["buffer"].clear()
                index = state["index"]
                if index == 0:
                    if packet.startswith(b"\x01vorbis"):
                        state["kind"] = "vorbis"
                        recognized += 1
                    elif packet.startswith(b"OpusHead"):
                        state["kind"] = "opus"
                        recognized += 1
                    if state["kind"]:
                        digest.update(state["kind"].encode("ascii") + b"\0")
                kind = state["kind"]
                # Preserve codec initialization and every audio packet, but
                # intentionally omit the one mutable comment packet.
                is_comment = (kind == "vorbis" and index == 1) or (kind == "opus" and index == 1)
                if kind and not is_comment:
                    digest.update(struct.pack(">Q", len(packet)))
                    digest.update(packet)
                state["index"] = index + 1
    if any(state["buffer"] for state in streams.values()):
        raise IntegrityError("Ogg stream ends in a partial packet.")
    if not recognized:
        raise IntegrityError("No Vorbis or Opus logical stream was found.")
    return digest.hexdigest()


def audio_payload_digest(path: str, family: str | None = None) -> tuple[str, str]:
    """Return (SHA-256, method) for immutable encoded audio/media payload."""
    normalized = (family or Path(path).suffix.lstrip(".")).upper()
    if normalized == "FLAC":
        return _hash_regions(path, _flac_regions(path), b"music-metadata-editor:flac-frames:v1\0"), "flac-frames"
    if normalized == "MP3":
        return _hash_regions(path, _mp3_regions(path), b"music-metadata-editor:mp3-frames:v1\0"), "mp3-frames"
    if normalized == "M4A" or normalized == "MP4":
        return _hash_regions(path, _mp4_regions(path), b"music-metadata-editor:mp4-mdat:v1\0"), "mp4-mdat"
    if normalized in {"OGG", "OPUS"}:
        return _ogg_digest(path), "ogg-codec-and-audio-packets"
    if normalized == "AIFF" or normalized in {"AIF", "AIFC"}:
        return _hash_regions(path, _iff_regions(path, b"FORM", b"SSND", "big"), b"music-metadata-editor:aiff-samples:v1\0"), "aiff-sound-data"
    if normalized == "WAV":
        return _hash_regions(path, _iff_regions(path, b"RIFF", b"data", "little"), b"music-metadata-editor:wav-samples:v1\0"), "wav-data"
    raise IntegrityError(f"No audio payload verifier is available for {normalized or 'unknown'}.")


def integrity_snapshot(path: str, family: str, technical: dict[str, Any]) -> dict[str, Any]:
    digest, method = audio_payload_digest(path, family)
    keys = ("codec", "sampleRate", "bitDepth", "bitRate", "durationSeconds", "channels")
    return {
        "sha256": digest,
        "method": method,
        "technical": {key: technical.get(key) for key in keys},
    }


def assert_integrity(before: dict[str, Any], after: dict[str, Any]) -> None:
    if before["method"] != after["method"] or before["sha256"] != after["sha256"]:
        raise IntegrityError("Encoded audio payload changed during metadata writing.")
    if before["technical"] != after["technical"]:
        raise IntegrityError("Audio technical properties changed during metadata writing.")
