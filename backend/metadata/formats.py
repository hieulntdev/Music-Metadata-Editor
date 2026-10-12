"""Canonical tag adapters for supported Mutagen containers."""

from __future__ import annotations

import base64
import errno
import hashlib
import os
import shutil
import stat
import struct
import tempfile
from pathlib import Path
from typing import Any, Optional

from .integrity import IntegrityError, assert_integrity, integrity_snapshot

try:
    import mutagen
    from mutagen.aiff import AIFF
    from mutagen.flac import FLAC, Picture
    from mutagen.id3 import APIC, COMM, TXXX, UFID, USLT
    from mutagen.mp3 import MP3
    from mutagen.mp4 import MP4, MP4Cover
    from mutagen.oggopus import OggOpus
    from mutagen.oggvorbis import OggVorbis
except ImportError as exc:  # pragma: no cover - exercised through worker startup
    mutagen = None
    MUTAGEN_IMPORT_ERROR = str(exc)
else:
    MUTAGEN_IMPORT_ERROR = None


SUPPORTED_EXTENSIONS = {".flac", ".mp3", ".m4a", ".mp4", ".ogg", ".oga", ".opus", ".aif", ".aiff", ".wav"}
ARRAY_FIELDS = {"artist", "albumArtist", "genre", "composer"}

VORBIS_KEYS = {
    "title": "title", "artist": "artist", "album": "album", "albumArtist": "albumartist",
    "genre": "genre", "date": "date", "trackNumber": "tracknumber", "trackTotal": "tracktotal",
    "discNumber": "discnumber", "discTotal": "disctotal", "composer": "composer", "comment": "comment",
    "lyrics": "lyrics", "musicBrainzRecordingId": "musicbrainz_trackid",
    "musicBrainzReleaseId": "musicbrainz_albumid", "musicBrainzArtistId": "musicbrainz_artistid",
}
ID3_TEXT = {
    "title": "TIT2", "artist": "TPE1", "album": "TALB", "albumArtist": "TPE2", "genre": "TCON",
    "date": "TDRC", "composer": "TCOM",
}
MP4_KEYS = {
    "title": "\xa9nam", "artist": "\xa9ART", "album": "\xa9alb", "albumArtist": "aART",
    "genre": "\xa9gen", "date": "\xa9day", "composer": "\xa9wrt", "comment": "\xa9cmt",
    "lyrics": "\xa9lyr", "musicBrainzRecordingId": "----:com.apple.iTunes:MusicBrainz Track Id",
    "musicBrainzReleaseId": "----:com.apple.iTunes:MusicBrainz Album Id",
    "musicBrainzArtistId": "----:com.apple.iTunes:MusicBrainz Artist Id",
}


class MetadataError(Exception):
    def __init__(self, code: str, message: str, details: Any = None):
        super().__init__(message)
        self.code = code
        self.details = details


def require_mutagen() -> None:
    if mutagen is None:
        raise MetadataError("DEPENDENCY_MISSING", f"Mutagen is unavailable: {MUTAGEN_IMPORT_ERROR}. Run scripts/setup.sh.")


def split_pair(value: Any) -> tuple[str, str]:
    if not value:
        return "", ""
    text = str(value[0] if isinstance(value, list) else value)
    parts = text.split("/", 1)
    return parts[0], parts[1] if len(parts) > 1 else ""


def text_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        return [str(item) for item in value if str(item)]
    if hasattr(value, "text"):
        return [str(item) for item in value.text if str(item)]
    return [str(value)] if str(value) else []


def scalar(value: Any) -> str:
    values = text_list(value)
    return values[0] if values else ""


def file_signature(path: str) -> dict[str, Any]:
    stat = os.stat(path, follow_symlinks=True)
    state = f"{os.path.realpath(path)}\0{stat.st_size}\0{stat.st_mtime_ns}".encode("utf-8", "surrogatepass")
    return {
        "fileSize": stat.st_size,
        "modifiedTime": stat.st_mtime * 1000,
        # String avoids precision loss when the value crosses the JSON/JavaScript boundary.
        "modifiedTimeNs": str(stat.st_mtime_ns),
        "fingerprintOfFileState": hashlib.sha256(state).hexdigest(),
    }


def classify(audio: Any, extension: str) -> str:
    if extension == ".wav":
        return "WAV"
    if isinstance(audio, FLAC): return "FLAC"
    if isinstance(audio, MP3): return "MP3"
    if isinstance(audio, MP4): return "M4A"
    if isinstance(audio, OggOpus): return "OPUS"
    if isinstance(audio, OggVorbis): return "OGG"
    if isinstance(audio, AIFF): return "AIFF"
    return extension.lstrip(".").upper() or "UNKNOWN"


def technical(audio: Any) -> dict[str, Any]:
    info = getattr(audio, "info", None)
    return {
        "codec": type(info).__name__.replace("Info", "") if info else "Unknown",
        "sampleRate": getattr(info, "sample_rate", None),
        "bitDepth": getattr(info, "bits_per_sample", None),
        "bitRate": getattr(info, "bitrate", None),
        "durationSeconds": round(float(getattr(info, "length", 0) or 0), 3),
        "channels": getattr(info, "channels", None),
    }


def read_vorbis(tags: Any) -> dict[str, Any]:
    result = {}
    for field, key in VORBIS_KEYS.items():
        value = text_list(tags.get(key, []))
        result[field] = value if field in ARRAY_FIELDS else (value[0] if value else "")
    # DATE is the canonical Vorbis field, but older taggers commonly emit YEAR.
    # Treat YEAR as a read alias without rewriting or deleting that original tag.
    if not result["date"]:
        result["date"] = scalar(tags.get("year", []))
    if not result["trackTotal"]:
        result["trackNumber"], result["trackTotal"] = split_pair(tags.get("tracknumber"))
    if not result["discTotal"]:
        result["discNumber"], result["discTotal"] = split_pair(tags.get("discnumber"))
    return result


def read_id3(tags: Any) -> dict[str, Any]:
    result = {field: [] if field in ARRAY_FIELDS else "" for field in VORBIS_KEYS}
    if not tags: return result
    for field, frame_id in ID3_TEXT.items():
        values = text_list(tags.get(frame_id))
        result[field] = values if field in ARRAY_FIELDS else (values[0] if values else "")
    result["trackNumber"], result["trackTotal"] = split_pair(tags.get("TRCK"))
    result["discNumber"], result["discTotal"] = split_pair(tags.get("TPOS"))
    comments = tags.getall("COMM")
    lyrics = tags.getall("USLT")
    primary_comment = next((frame for frame in comments if frame.lang == "eng" and not frame.desc), comments[0] if comments else None)
    primary_lyrics = next((frame for frame in lyrics if frame.lang == "eng" and not frame.desc), lyrics[0] if lyrics else None)
    result["comment"] = scalar(primary_comment) if primary_comment else ""
    result["lyrics"] = getattr(primary_lyrics, "text", "") if primary_lyrics else ""
    for frame in tags.getall("TXXX"):
        key = frame.desc.lower()
        if key == "musicbrainz album id": result["musicBrainzReleaseId"] = scalar(frame)
        elif key == "musicbrainz artist id": result["musicBrainzArtistId"] = scalar(frame)
    for frame in tags.getall("UFID"):
        if frame.owner == "http://musicbrainz.org": result["musicBrainzRecordingId"] = frame.data.decode("utf-8", "replace")
    return result


def decode_mp4_freeform(value: Any) -> str:
    if not value: return ""
    raw = value[0] if isinstance(value, list) else value
    return bytes(raw).decode("utf-8", "replace") if isinstance(raw, (bytes, bytearray)) else str(raw)


def read_mp4(tags: Any) -> dict[str, Any]:
    result = {field: [] if field in ARRAY_FIELDS else "" for field in VORBIS_KEYS}
    if not tags: return result
    for field, key in MP4_KEYS.items():
        value = tags.get(key, [])
        if key.startswith("----"):
            result[field] = decode_mp4_freeform(value)
        else:
            values = text_list(value)
            result[field] = values if field in ARRAY_FIELDS else (values[0] if values else "")
    track = tags.get("trkn", [(0, 0)])[0]
    disc = tags.get("disk", [(0, 0)])[0]
    result["trackNumber"], result["trackTotal"] = str(track[0] or ""), str(track[1] or "")
    result["discNumber"], result["discTotal"] = str(disc[0] or ""), str(disc[1] or "")
    return result


def image_dimensions(data: bytes) -> tuple[Optional[int], Optional[int]]:
    try:
        if data.startswith(b"\x89PNG") and len(data) >= 24:
            return struct.unpack(">II", data[16:24])
        if data.startswith(b"\xff\xd8"):
            index = 2
            while index + 9 < len(data):
                if data[index] != 0xFF: index += 1; continue
                marker = data[index + 1]
                length = int.from_bytes(data[index + 2:index + 4], "big")
                if marker in range(0xC0, 0xC4):
                    return int.from_bytes(data[index + 7:index + 9], "big"), int.from_bytes(data[index + 5:index + 7], "big")
                index += max(2, length + 2)
    except (ValueError, struct.error):
        pass
    return None, None


def artwork_from_audio(audio: Any, family: str, include_preview: bool) -> list[dict[str, Any]]:
    raw_items: list[tuple[int, str, bytes, str]] = []
    if family == "FLAC":
        raw_items = [(pic.type, pic.mime, pic.data, pic.desc) for pic in audio.pictures]
    elif family in {"MP3", "AIFF"} and audio.tags:
        raw_items = [(pic.type, pic.mime, pic.data, pic.desc) for pic in audio.tags.getall("APIC")]
    elif family == "M4A" and audio.tags:
        for cover in audio.tags.get("covr", []):
            mime = "image/png" if getattr(cover, "imageformat", None) == MP4Cover.FORMAT_PNG else "image/jpeg"
            raw_items.append((3, mime, bytes(cover), "Front cover"))
    elif family in {"OGG", "OPUS"} and audio.tags:
        for encoded in audio.tags.get("metadata_block_picture", []):
            try:
                pic = Picture(base64.b64decode(encoded))
                raw_items.append((pic.type, pic.mime, pic.data, pic.desc))
            except Exception:
                continue
    result = []
    for pic_type, mime, data, description in raw_items:
        width, height = image_dimensions(data)
        item = {
            "type": pic_type, "mime": mime or "application/octet-stream", "dimensions": [width, height],
            "bytesSize": len(data), "imageHash": hashlib.sha256(data).hexdigest(), "description": description or "",
        }
        if include_preview and len(data) <= 15 * 1024 * 1024:
            item["previewDataUrl"] = f"data:{item['mime']};base64,{base64.b64encode(data).decode('ascii')}"
        result.append(item)
    return result


def read_metadata(path: str, include_artwork: bool = True) -> dict[str, Any]:
    require_mutagen()
    real_path = os.path.realpath(path)
    extension = Path(real_path).suffix.lower()
    if extension not in SUPPORTED_EXTENSIONS:
        raise MetadataError("UNSUPPORTED_FORMAT", f"Unsupported audio format: {extension or 'unknown'}")
    try:
        audio = mutagen.File(real_path)
    except Exception as exc:
        raise MetadataError("READ_FAILED", f"Could not read metadata: {exc}") from exc
    if audio is None:
        raise MetadataError("READ_FAILED", "The file is not a recognized audio container.")
    family = classify(audio, extension)
    if family in {"FLAC", "OGG", "OPUS"}: metadata = read_vorbis(audio.tags or {})
    elif family in {"MP3", "AIFF"}: metadata = read_id3(audio.tags)
    elif family == "M4A": metadata = read_mp4(audio.tags)
    else: metadata = {field: [] if field in ARRAY_FIELDS else "" for field in VORBIS_KEYS}
    signature = file_signature(real_path)
    writable = family in {"FLAC", "MP3", "M4A", "OGG", "OPUS", "AIFF"}
    return {
        "absolutePath": real_path, **signature, "format": family, **technical(audio), "metadata": metadata,
        "artwork": artwork_from_audio(audio, family, include_artwork),
        "capabilities": {
            "readTags": True, "writeTags": writable, "embeddedArtwork": writable,
            "supportedFields": list(VORBIS_KEYS) if writable else [],
            "readOnlyReason": "WAV tagging is disabled because interoperable write behavior is not proven." if family == "WAV" else None,
        },
        "status": {"dirty": False, "conflict": False},
    }


def set_or_delete(tags: Any, key: str, value: Any) -> None:
    if value is None or value == "" or value == []:
        try: del tags[key]
        except KeyError: pass
    else:
        tags[key] = [str(item) for item in value] if isinstance(value, list) else [str(value)]


def write_vorbis(audio: Any, patch: dict[str, Any]) -> None:
    if audio.tags is None: audio.add_tags()
    for field, value in patch.items():
        if field in VORBIS_KEYS: set_or_delete(audio.tags, VORBIS_KEYS[field], value)


def write_id3(audio: Any, patch: dict[str, Any]) -> None:
    from mutagen.id3 import Frames
    if audio.tags is None: audio.add_tags()
    tags = audio.tags
    for field, value in patch.items():
        if field in ID3_TEXT:
            tags.delall(ID3_TEXT[field])
            if value not in (None, "", []): tags.add(Frames[ID3_TEXT[field]](encoding=3, text=value if isinstance(value, list) else [str(value)]))
        elif field in {"trackNumber", "trackTotal"}:
            number = patch.get("trackNumber", split_pair(tags.get("TRCK"))[0])
            total = patch.get("trackTotal", split_pair(tags.get("TRCK"))[1])
            tags.delall("TRCK")
            if number not in (None, "") or total not in (None, ""):
                tags.add(Frames["TRCK"](encoding=3, text=[f"{number or ''}/{total}" if total else str(number or "")]))
        elif field in {"discNumber", "discTotal"}:
            number = patch.get("discNumber", split_pair(tags.get("TPOS"))[0])
            total = patch.get("discTotal", split_pair(tags.get("TPOS"))[1])
            tags.delall("TPOS")
            if number not in (None, "") or total not in (None, ""):
                tags.add(Frames["TPOS"](encoding=3, text=[f"{number or ''}/{total}" if total else str(number or "")]))
        elif field == "comment":
            for frame in list(tags.getall("COMM")):
                if frame.lang == "eng" and not frame.desc: tags.delall(frame.HashKey)
            if value not in (None, ""): tags.add(COMM(encoding=3, lang="eng", desc="", text=[str(value)]))
        elif field == "lyrics":
            for frame in list(tags.getall("USLT")):
                if frame.lang == "eng" and not frame.desc: tags.delall(frame.HashKey)
            if value not in (None, ""): tags.add(USLT(encoding=3, lang="eng", desc="", text=str(value)))
        elif field == "musicBrainzRecordingId":
            for frame in list(tags.getall("UFID")):
                if frame.owner == "http://musicbrainz.org": tags.delall(frame.HashKey)
            if value not in (None, ""): tags.add(UFID(owner="http://musicbrainz.org", data=str(value).encode()))
        elif field in {"musicBrainzReleaseId", "musicBrainzArtistId"}:
            desc = "MusicBrainz Album Id" if field == "musicBrainzReleaseId" else "MusicBrainz Artist Id"
            for frame in list(tags.getall("TXXX")):
                if frame.desc.lower() == desc.lower(): tags.delall(frame.HashKey)
            if value not in (None, ""): tags.add(TXXX(encoding=3, desc=desc, text=[str(value)]))


def write_mp4(audio: Any, patch: dict[str, Any]) -> None:
    if audio.tags is None: audio.add_tags()
    tags = audio.tags
    for field, value in patch.items():
        if field in MP4_KEYS:
            key = MP4_KEYS[field]
            if value in (None, "", []): tags.pop(key, None)
            elif key.startswith("----"): tags[key] = [str(value).encode("utf-8")]
            else: tags[key] = value if isinstance(value, list) else [str(value)]
    if "trackNumber" in patch or "trackTotal" in patch:
        old = tags.get("trkn", [(0, 0)])[0]
        number = patch.get("trackNumber", old[0]) or 0; total = patch.get("trackTotal", old[1]) or 0
        if not number and not total: tags.pop("trkn", None)
        else: tags["trkn"] = [(int(number), int(total))]
    if "discNumber" in patch or "discTotal" in patch:
        old = tags.get("disk", [(0, 0)])[0]
        number = patch.get("discNumber", old[0]) or 0; total = patch.get("discTotal", old[1]) or 0
        if not number and not total: tags.pop("disk", None)
        else: tags["disk"] = [(int(number), int(total))]


def read_image(path: str) -> tuple[bytes, str]:
    data = Path(path).read_bytes()
    if len(data) > 15 * 1024 * 1024: raise MetadataError("ARTWORK_TOO_LARGE", "Artwork must be 15 MB or smaller.")
    if data.startswith(b"\x89PNG\r\n\x1a\n"): mime = "image/png"
    elif data.startswith(b"\xff\xd8\xff"): mime = "image/jpeg"
    else: raise MetadataError("UNSUPPORTED_ARTWORK", "Artwork must be a PNG or JPEG image.")
    return data, mime


def update_artwork(audio: Any, family: str, operation: dict[str, Any]) -> None:
    mode = operation.get("mode")
    if mode == "keep" or not mode: return
    if family == "FLAC":
        audio.clear_pictures()
        if mode == "replace":
            data, mime = read_image(operation["path"]); pic = Picture(); pic.type = 3; pic.mime = mime; pic.desc = "Front cover"; pic.data = data; audio.add_picture(pic)
    elif family in {"MP3", "AIFF"}:
        if audio.tags is None: audio.add_tags()
        audio.tags.delall("APIC")
        if mode == "replace":
            data, mime = read_image(operation["path"]); audio.tags.add(APIC(encoding=3, mime=mime, type=3, desc="Front cover", data=data))
    elif family == "M4A":
        if audio.tags is None: audio.add_tags()
        audio.tags.pop("covr", None)
        if mode == "replace":
            data, mime = read_image(operation["path"]); fmt = MP4Cover.FORMAT_PNG if mime == "image/png" else MP4Cover.FORMAT_JPEG; audio.tags["covr"] = [MP4Cover(data, imageformat=fmt)]
    elif family in {"OGG", "OPUS"}:
        if audio.tags is None: audio.add_tags()
        try: del audio.tags["metadata_block_picture"]
        except KeyError: pass
        if mode == "replace":
            data, mime = read_image(operation["path"]); pic = Picture(); pic.type = 3; pic.mime = mime; pic.desc = "Front cover"; pic.data = data
            audio.tags["metadata_block_picture"] = [base64.b64encode(pic.write()).decode("ascii")]
    else:
        raise MetadataError("UNSUPPORTED_FORMAT", f"Artwork writing is not supported for {family}.")


def _write_metadata_in_place(path: str, patch: dict[str, Any], artwork_operation: Optional[dict[str, Any]]) -> None:
    require_mutagen()
    extension = Path(path).suffix.lower()
    audio = mutagen.File(path)
    if audio is None: raise MetadataError("READ_FAILED", "The file is not a recognized audio container.")
    family = classify(audio, extension)
    if family not in {"FLAC", "MP3", "M4A", "OGG", "OPUS", "AIFF"}:
        raise MetadataError("READ_ONLY", f"{family} is read-only in this application.")
    try:
        if family in {"FLAC", "OGG", "OPUS"}: write_vorbis(audio, patch)
        elif family in {"MP3", "AIFF"}: write_id3(audio, patch)
        else: write_mp4(audio, patch)
        if artwork_operation: update_artwork(audio, family, artwork_operation)
        audio.save()
    except MetadataError: raise
    except Exception as exc:
        raise MetadataError("WRITE_FAILED", f"Could not save metadata: {exc}") from exc


def _verify_written_fields(record: dict[str, Any], patch: dict[str, Any]) -> None:
    for field, expected_value in patch.items():
        if record["metadata"].get(field) != expected_value:
            raise MetadataError("VERIFY_FAILED", f"Saved field did not read back correctly: {field}")


def _verify_written_artwork(record: dict[str, Any], operation: Optional[dict[str, Any]]) -> None:
    if not operation or operation.get("mode") in {None, "keep"}:
        return
    artwork = record.get("artwork") or []
    if operation.get("mode") == "remove":
        if artwork:
            raise MetadataError("VERIFY_FAILED", "Embedded artwork was not removed correctly.")
        return
    if operation.get("mode") == "replace":
        expected_data, _ = read_image(operation["path"])
        expected_hash = hashlib.sha256(expected_data).hexdigest()
        if len(artwork) != 1 or artwork[0].get("imageHash") != expected_hash:
            raise MetadataError("VERIFY_FAILED", "Embedded artwork did not read back correctly.")


def _flac_preservation_snapshot(path: str) -> tuple[dict[str, tuple[str, ...]], tuple[str, ...]]:
    """Capture every FLAC comment and picture, including fields the UI does not manage."""
    audio = FLAC(path)
    tags = {
        str(key).casefold(): tuple(str(value) for value in values)
        for key, values in (audio.tags or {}).items()
    }
    pictures = tuple(hashlib.sha256(picture.write()).hexdigest() for picture in audio.pictures)
    return tags, pictures


def _verify_flac_preservation(
    source_path: str,
    candidate_path: str,
    patch: dict[str, Any],
    artwork_operation: Optional[dict[str, Any]],
) -> None:
    before_tags, before_pictures = _flac_preservation_snapshot(source_path)
    after_tags, after_pictures = _flac_preservation_snapshot(candidate_path)
    changed_keys = {
        VORBIS_KEYS[field].casefold()
        for field in patch
        if field in VORBIS_KEYS
    }
    for key, values in before_tags.items():
        if key not in changed_keys and after_tags.get(key) != values:
            raise MetadataError("VERIFY_FAILED", f"An untouched FLAC metadata field changed: {key}")
    if not artwork_operation or artwork_operation.get("mode") in {None, "keep"}:
        if after_pictures != before_pictures:
            raise MetadataError("VERIFY_FAILED", "Untouched FLAC artwork changed during metadata writing.")


def _publish_without_overwrite(temporary_path: str, output_path: str) -> None:
    """Atomically publish a same-filesystem temporary file without replacing anything."""
    published = False
    try:
        os.link(temporary_path, output_path)
        published = True
        os.unlink(temporary_path)
    except FileExistsError as exc:
        raise MetadataError("OUTPUT_EXISTS", "The Output file already exists and was not overwritten.") from exc
    except OSError as exc:
        if published:
            try: os.unlink(output_path)
            except OSError: pass
        if exc.errno == errno.ENOSPC:
            raise MetadataError("OUTPUT_NO_SPACE", "There is not enough free space in the Output Folder.") from exc
        raise MetadataError("PUBLISH_FAILED", f"Could not publish the completed Output file: {exc}") from exc


def write_metadata(
    source_path: str,
    output_path: str,
    patch: dict[str, Any],
    artwork_operation: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """Copy a source, patch the copy, verify it, and publish only to Output."""
    require_mutagen()
    real_path = os.path.realpath(source_path)
    source_stat = os.stat(real_path)
    if not stat.S_ISREG(source_stat.st_mode):
        raise MetadataError("INVALID_PATH", "The audio path is not a regular file.")

    output_parent = os.path.realpath(os.path.dirname(os.path.abspath(output_path)))
    destination = os.path.join(output_parent, os.path.basename(output_path))
    if not os.path.isdir(output_parent):
        raise MetadataError("OUTPUT_NOT_FOUND", "The Output Folder does not exist.")
    source_parent = os.path.dirname(real_path)
    try:
        overlaps = (
            os.path.commonpath([output_parent, source_parent]) == output_parent
            or os.path.commonpath([output_parent, source_parent]) == source_parent
        )
    except ValueError:
        overlaps = False
    if overlaps:
        raise MetadataError("OUTPUT_OVERLAPS_SOURCE", "Output Folder must be separate from the source location.")
    if os.path.splitext(destination)[1].lower() != os.path.splitext(real_path)[1].lower():
        raise MetadataError("INVALID_OUTPUT_PATH", "Output must keep the source file extension.")
    if os.path.lexists(destination):
        raise MetadataError("OUTPUT_EXISTS", "The Output file already exists and was not overwritten.")

    original = read_metadata(real_path, include_artwork=False)
    family = original["format"]
    if family not in {"FLAC", "MP3", "M4A", "OGG", "OPUS", "AIFF"}:
        raise MetadataError("READ_ONLY", f"{family} is read-only in this application.")
    try:
        before = integrity_snapshot(real_path, family, original)
    except IntegrityError as exc:
        raise MetadataError("INTEGRITY_CHECK_UNAVAILABLE", f"Could not isolate the original audio payload: {exc}") from exc

    temporary_path = None
    try:
        descriptor, temporary_path = tempfile.mkstemp(
            prefix=f".{Path(real_path).name}.metadata-", suffix=Path(real_path).suffix,
            dir=output_parent,
        )
        os.close(descriptor)
        try:
            shutil.copy2(real_path, temporary_path)
            os.chmod(temporary_path, source_stat.st_mode | stat.S_IWUSR)
        except OSError as exc:
            if exc.errno == errno.ENOSPC:
                raise MetadataError("OUTPUT_NO_SPACE", "There is not enough free space in the Output Folder.") from exc
            raise MetadataError("COPY_FAILED", f"Could not copy the source file to Output: {exc}") from exc
        _write_metadata_in_place(temporary_path, patch, artwork_operation)
        candidate = read_metadata(temporary_path, include_artwork=True)
        _verify_written_fields(candidate, patch)
        _verify_written_artwork(candidate, artwork_operation)
        if family == "FLAC":
            _verify_flac_preservation(real_path, temporary_path, patch, artwork_operation)
        try:
            after = integrity_snapshot(temporary_path, family, candidate)
            assert_integrity(before, after)
        except IntegrityError as exc:
            raise MetadataError("AUDIO_INTEGRITY_FAILED", str(exc)) from exc

        with open(temporary_path, "rb") as candidate_file:
            os.fsync(candidate_file.fileno())
        current_stat = os.stat(real_path)
        original_identity = (source_stat.st_dev, source_stat.st_ino, source_stat.st_size, source_stat.st_mtime_ns)
        current_identity = (current_stat.st_dev, current_stat.st_ino, current_stat.st_size, current_stat.st_mtime_ns)
        if current_identity != original_identity:
            raise MetadataError("FILE_CHANGED", "The file changed while metadata was being prepared. Re-read it before saving.")
        _publish_without_overwrite(temporary_path, destination)
        temporary_path = None
        try:
            directory_fd = os.open(output_parent, os.O_RDONLY)
            try: os.fsync(directory_fd)
            finally: os.close(directory_fd)
        except OSError:
            pass  # Directory fsync is unavailable on some supported platforms.
        candidate["absolutePath"] = destination
        candidate.update(file_signature(destination))
        return candidate
    except MetadataError:
        raise
    except OSError as exc:
        code = "OUTPUT_NO_SPACE" if exc.errno == errno.ENOSPC else "WRITE_FAILED"
        raise MetadataError(code, f"Could not create the Output file: {exc}") from exc
    finally:
        if temporary_path:
            try: os.unlink(temporary_path)
            except FileNotFoundError: pass


def staged_artwork(path: str) -> dict[str, Any]:
    data, mime = read_image(path)
    width, height = image_dimensions(data)
    return {
        "mime": mime, "bytesSize": len(data), "dimensions": [width, height],
        "previewDataUrl": f"data:{mime};base64,{base64.b64encode(data).decode('ascii')}",
    }
