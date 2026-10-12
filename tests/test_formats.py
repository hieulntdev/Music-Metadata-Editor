import base64
import errno
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

try:
    import metadata.formats as formats
    from metadata.formats import MetadataError, read_metadata, write_metadata
    from metadata.integrity import IntegrityError, audio_payload_digest
    from mutagen.flac import FLAC, Picture
    from mutagen.id3 import COMM, USLT
    from mutagen.mp3 import MP3
    from worker import preview_changes, save as worker_save
except Exception:
    formats = None
    read_metadata = write_metadata = preview_changes = worker_save = audio_payload_digest = None


PNG_1X1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


def full_digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


@unittest.skipUnless(shutil.which("ffmpeg") and read_metadata, "ffmpeg and Mutagen are required")
class FormatRegressionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.encoders = subprocess.run(
            ["ffmpeg", "-hide_banner", "-encoders"], check=True, capture_output=True, text=True
        ).stdout

    def require_encoder(self, encoder):
        if not any(line.split()[1:2] == [encoder] for line in self.encoders.splitlines()):
            self.skipTest(f"ffmpeg encoder {encoder} is unavailable")

    def generate(self, target, codec, extra=None, duration=0.3):
        self.require_encoder(codec)
        subprocess.run([
            "ffmpeg", "-v", "error", "-f", "lavfi", "-i", f"sine=frequency=440:duration={duration}",
            "-c:a", codec, *(extra or []), "-y", str(target)
        ], check=True)

    def decoded_hash(self, target):
        result = subprocess.run([
            "ffmpeg", "-v", "error", "-i", str(target), "-map", "0:a:0",
            "-f", "s16le", "-acodec", "pcm_s16le", "-"
        ], check=True, capture_output=True)
        return hashlib.sha256(result.stdout).hexdigest()

    def ffprobe(self, target):
        return json.loads(subprocess.run([
            "ffprobe", "-v", "error", "-show_format", "-show_streams", "-of", "json", str(target)
        ], check=True, capture_output=True, text=True).stdout)

    def output_path(self, folder, source, name=None):
        output = Path(folder) / "output"
        output.mkdir(exist_ok=True)
        return output / (name or Path(source).name)

    def assert_patch_preserves_audio(self, extension, codec, expected_format, extra=None):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "source" / f"fixture{extension}"
            source.parent.mkdir()
            self.generate(source, codec, extra)
            output = self.output_path(folder, source)
            original = read_metadata(str(source))
            source_full_hash = full_digest(source)
            before_payload = audio_payload_digest(str(source), expected_format)
            before_pcm = self.decoded_hash(source)
            technical_keys = ("codec", "sampleRate", "bitDepth", "bitRate", "durationSeconds", "channels")
            before_technical = {key: original[key] for key in technical_keys}

            write_metadata(str(source), str(output), {
                "title": "Synthetic fixture", "artist": ["Test Artist"], "date": "2026-10-11"
            })

            after = read_metadata(str(output))
            self.assertEqual(after["metadata"]["title"], "Synthetic fixture")
            self.assertEqual(after["metadata"]["artist"], ["Test Artist"])
            self.assertEqual(after["metadata"]["date"], "2026-10-11")
            self.assertEqual(source_full_hash, full_digest(source))
            self.assertEqual(before_payload, audio_payload_digest(str(output), expected_format))
            self.assertEqual(before_pcm, self.decoded_hash(output))
            self.assertEqual(before_technical, {key: after[key] for key in technical_keys})

    def test_writable_formats_create_verified_copies_without_touching_sources(self):
        cases = [
            (".flac", "flac", "FLAC", []), (".mp3", "libmp3lame", "MP3", []),
            (".m4a", "alac", "M4A", []), (".m4a", "aac", "M4A", []),
            (".mp4", "aac", "M4A", []),
            (".ogg", "vorbis", "OGG", ["-strict", "experimental", "-ac", "2"]),
            (".opus", "libopus", "OPUS", []), (".aiff", "pcm_s16be", "AIFF", []),
        ]
        for extension, codec, family, extra in cases:
            with self.subTest(extension=extension, codec=codec):
                self.assert_patch_preserves_audio(extension, codec, family, extra)

    def test_every_canonical_field_and_repeated_saves_preserve_flac_frames(self):
        values = {
            "title": "Title", "artist": ["Artist", "Guest"], "album": "Album",
            "albumArtist": ["Album Artist"], "genre": ["Rock", "Indie"], "date": "2026-10-11",
            "trackNumber": "2", "trackTotal": "12", "discNumber": "1", "discTotal": "2",
            "composer": ["Composer"], "comment": "Comment", "lyrics": "Lyrics",
            "musicBrainzRecordingId": "recording-id", "musicBrainzReleaseId": "release-id",
            "musicBrainzArtistId": "artist-id",
        }
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "source" / "source.flac"; source.parent.mkdir()
            self.generate(source, "flac")
            source_hash = full_digest(source)
            original_audio = audio_payload_digest(str(source), "FLAC")
            for index, (field, value) in enumerate(values.items()):
                output = self.output_path(folder, source, f"field-{index}.flac")
                write_metadata(str(source), str(output), {field: value})
                self.assertEqual(read_metadata(str(output))["metadata"][field], value)
                self.assertEqual(audio_payload_digest(str(output), "FLAC"), original_audio)
            first = self.output_path(folder, source, "all-fields.flac")
            second = self.output_path(folder, source, "repeated.flac")
            write_metadata(str(source), str(first), values)
            write_metadata(str(source), str(second), values)
            self.assertEqual(audio_payload_digest(str(second), "FLAC"), original_audio)
            self.assertEqual(full_digest(source), source_hash)

    def test_unknown_tags_and_unmanaged_artwork_survive_copy(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "source" / "source.flac"; source.parent.mkdir()
            self.generate(source, "flac")
            audio = FLAC(str(source))
            audio["X-CUSTOM-PRIVATE-TAG"] = ["keep me"]
            for picture_type, description in ((3, "front"), (4, "back")):
                picture = Picture(); picture.type = picture_type; picture.mime = "image/png"; picture.desc = description; picture.data = PNG_1X1
                audio.add_picture(picture)
            audio.save()
            source_hash = full_digest(source)
            output = self.output_path(folder, source)
            write_metadata(str(source), str(output), {"title": "Pictures remain"})
            updated = FLAC(str(output))
            self.assertEqual(updated["X-CUSTOM-PRIVATE-TAG"], ["keep me"])
            self.assertEqual({picture.desc for picture in updated.pictures}, {"front", "back"})
            self.assertEqual(full_digest(source), source_hash)

    def test_flac_add_album_and_year_preserves_existing_metadata_and_external_readability(self):
        if not shutil.which("ffprobe"):
            self.skipTest("ffprobe is required for independent metadata verification")
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "source" / "bai hat goc.flac"; source.parent.mkdir()
            self.generate(source, "flac")
            audio = FLAC(str(source))
            audio["TITLE"] = ["Bài hát gốc"]
            audio["ARTIST"] = ["Nghệ sĩ Việt"]
            audio["X-CUSTOM-PRIVATE-TAG"] = ["giữ nguyên", "second value"]
            audio["EMPTY-OPTIONAL"] = [""]
            picture = Picture(); picture.type = 3; picture.mime = "image/png"; picture.desc = "front"; picture.data = PNG_1X1
            audio.add_picture(picture)
            audio.save()

            original_hash = full_digest(source)
            original_stat = source.stat()
            original_payload = audio_payload_digest(str(source), "FLAC")
            original_probe = self.ffprobe(source)
            output = self.output_path(folder, source)

            write_metadata(str(source), str(output), {"album": "Tuyển tập", "date": "2026"})

            updated = FLAC(str(output))
            self.assertEqual(updated["TITLE"], ["Bài hát gốc"])
            self.assertEqual(updated["ARTIST"], ["Nghệ sĩ Việt"])
            self.assertEqual(updated["ALBUM"], ["Tuyển tập"])
            self.assertEqual(updated["DATE"], ["2026"])
            self.assertEqual(updated["X-CUSTOM-PRIVATE-TAG"], ["giữ nguyên", "second value"])
            self.assertEqual(updated["EMPTY-OPTIONAL"], [""])
            self.assertEqual(len(updated.pictures), 1)
            self.assertEqual(updated.pictures[0].data, PNG_1X1)

            # ffprobe is independent of the Mutagen writer used by the app.
            output_probe = self.ffprobe(output)
            tags = {key.casefold(): value for key, value in output_probe["format"].get("tags", {}).items()}
            self.assertEqual(tags["title"], "Bài hát gốc")
            self.assertEqual(tags["artist"], "Nghệ sĩ Việt")
            self.assertEqual(tags["album"], "Tuyển tập")
            self.assertEqual(tags["date"], "2026")
            technical_keys = ("codec_name", "sample_rate", "channels", "bits_per_raw_sample")
            original_stream = next(stream for stream in original_probe["streams"] if stream.get("codec_type") == "audio")
            output_stream = next(stream for stream in output_probe["streams"] if stream.get("codec_type") == "audio")
            self.assertEqual(
                {key: original_stream.get(key) for key in technical_keys},
                {key: output_stream.get(key) for key in technical_keys},
            )
            self.assertEqual(full_digest(source), original_hash)
            self.assertEqual(source.stat().st_size, original_stat.st_size)
            self.assertEqual(source.stat().st_mtime_ns, original_stat.st_mtime_ns)
            self.assertEqual(audio_payload_digest(str(output), "FLAC"), original_payload)

    def test_flac_year_alias_is_read_without_destroying_the_original_comment(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "source" / "legacy-year.flac"; source.parent.mkdir()
            self.generate(source, "flac")
            audio = FLAC(str(source)); audio["YEAR"] = ["1999"]; audio.save()
            self.assertEqual(read_metadata(str(source))["metadata"]["date"], "1999")
            output = self.output_path(folder, source)
            write_metadata(str(source), str(output), {"album": "Archive"})
            self.assertEqual(FLAC(str(output))["YEAR"], ["1999"])

    def test_id3_unmanaged_comment_and_lyrics_survive_copy(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "source" / "source.mp3"; source.parent.mkdir()
            self.generate(source, "libmp3lame")
            audio = MP3(str(source))
            if audio.tags is None: audio.add_tags()
            audio.tags.add(COMM(encoding=3, lang="fra", desc="review", text=["conserver"]))
            audio.tags.add(USLT(encoding=3, lang="fra", desc="alternate", text="paroles"))
            audio.save()
            output = self.output_path(folder, source)
            write_metadata(str(source), str(output), {"comment": "primary", "lyrics": "main lyrics"})
            updated = MP3(str(output)).tags
            self.assertTrue(any(frame.lang == "fra" and frame.desc == "review" for frame in updated.getall("COMM")))
            self.assertTrue(any(frame.lang == "fra" and frame.desc == "alternate" for frame in updated.getall("USLT")))

    def test_artwork_replace_and_remove_preserve_every_writable_family(self):
        with tempfile.TemporaryDirectory() as folder:
            artwork = Path(folder) / "cover.png"
            artwork.write_bytes(PNG_1X1)
            cases = [
                (".flac", "flac", "FLAC", []), (".mp3", "libmp3lame", "MP3", []),
                (".m4a", "alac", "M4A", []),
                (".ogg", "vorbis", "OGG", ["-strict", "experimental", "-ac", "2"]),
                (".opus", "libopus", "OPUS", []), (".aiff", "pcm_s16be", "AIFF", []),
            ]
            for index, (extension, codec, family, extra) in enumerate(cases):
                with self.subTest(family=family):
                    source = Path(folder) / f"source-{index}" / f"source{extension}"; source.parent.mkdir()
                    self.generate(source, codec, extra)
                    formats._write_metadata_in_place(str(source), {}, {"mode": "replace", "path": str(artwork)})
                    before = audio_payload_digest(str(source), family)
                    replaced_path = self.output_path(folder, source, f"replaced-{index}{extension}")
                    replaced = write_metadata(str(source), str(replaced_path), {}, {"mode": "replace", "path": str(artwork)})
                    self.assertEqual(len(replaced["artwork"]), 1)
                    removed_path = self.output_path(folder, source, f"removed-{index}{extension}")
                    removed = write_metadata(str(source), str(removed_path), {}, {"mode": "remove"})
                    self.assertEqual(removed["artwork"], [])
                    self.assertEqual(audio_payload_digest(str(removed_path), family), before)

    def test_failures_leave_source_and_output_untouched_and_clean_temporary_files(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "source" / "source.flac"; source.parent.mkdir()
            self.generate(source, "flac")
            source_hash = full_digest(source)
            output = self.output_path(folder, source)

            with mock.patch.object(formats, "_write_metadata_in_place", side_effect=MetadataError("WRITE_FAILED", "injected interruption")):
                with self.assertRaisesRegex(MetadataError, "injected interruption"):
                    write_metadata(str(source), str(output), {"title": "must not commit"})
            self.assertFalse(output.exists())
            self.assertFalse(list(output.parent.glob(".*.metadata-*")))
            self.assertEqual(full_digest(source), source_hash)

            with mock.patch.object(formats, "assert_integrity", side_effect=IntegrityError("injected mismatch")):
                with self.assertRaises(MetadataError) as caught:
                    write_metadata(str(source), str(output), {"title": "must not commit"})
            self.assertEqual(caught.exception.code, "AUDIO_INTEGRITY_FAILED")
            self.assertFalse(output.exists())
            self.assertEqual(full_digest(source), source_hash)

            with mock.patch.object(
                formats, "_verify_flac_preservation",
                side_effect=MetadataError("VERIFY_FAILED", "injected metadata loss"),
            ):
                with self.assertRaises(MetadataError) as caught:
                    write_metadata(str(source), str(output), {"album": "must not commit"})
            self.assertEqual(caught.exception.code, "VERIFY_FAILED")
            self.assertFalse(output.exists())
            self.assertEqual(full_digest(source), source_hash)

            with mock.patch.object(formats.shutil, "copy2", side_effect=OSError("injected copy failure")):
                with self.assertRaises(MetadataError) as caught:
                    write_metadata(str(source), str(output), {"title": "must not commit"})
            self.assertEqual(caught.exception.code, "COPY_FAILED")
            self.assertFalse(output.exists())
            self.assertEqual(full_digest(source), source_hash)

            with mock.patch.object(formats.shutil, "copy2", side_effect=OSError(errno.ENOSPC, "no space")):
                with self.assertRaises(MetadataError) as caught:
                    write_metadata(str(source), str(output), {"title": "must not commit"})
            self.assertEqual(caught.exception.code, "OUTPUT_NO_SPACE")

    def test_invalid_audio_is_rejected_without_output(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "source" / "invalid.flac"; source.parent.mkdir()
            source.write_bytes(b"not an audio file")
            output = self.output_path(folder, source)
            with self.assertRaises(MetadataError) as caught:
                write_metadata(str(source), str(output), {"title": "blocked"})
            self.assertEqual(caught.exception.code, "READ_FAILED")
            self.assertFalse(output.exists())

    def test_existing_output_is_never_overwritten(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "source" / "source.flac"; source.parent.mkdir()
            self.generate(source, "flac")
            output = self.output_path(folder, source)
            output.write_bytes(b"pre-existing")
            with self.assertRaises(MetadataError) as caught:
                write_metadata(str(source), str(output), {"title": "blocked"})
            self.assertEqual(caught.exception.code, "OUTPUT_EXISTS")
            self.assertEqual(output.read_bytes(), b"pre-existing")
            with self.assertRaises(MetadataError) as overlap:
                write_metadata(str(source), str(source.parent / "another.flac"), {"title": "blocked"})
            self.assertEqual(overlap.exception.code, "OUTPUT_OVERLAPS_SOURCE")

    @unittest.skipIf(os.name == "nt", "POSIX mode-bit behavior differs on Windows")
    def test_read_only_source_can_be_copied_without_modification(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "source" / "source.flac"; source.parent.mkdir()
            self.generate(source, "flac")
            source_hash = full_digest(source)
            source.chmod(0o444)
            try:
                output = self.output_path(folder, source)
                write_metadata(str(source), str(output), {"title": "copied"})
                self.assertEqual(read_metadata(str(output))["metadata"]["title"], "copied")
                self.assertEqual(full_digest(source), source_hash)
            finally:
                source.chmod(0o644)

    def test_batch_and_parallel_writes_preserve_every_source(self):
        with tempfile.TemporaryDirectory() as folder:
            sources = []
            for index in range(6):
                source = Path(folder) / "source" / f"batch-{index}.flac"
                source.parent.mkdir(exist_ok=True)
                self.generate(source, "flac")
                sources.append(source)
            source_hashes = {source: full_digest(source) for source in sources}
            outputs = Path(folder) / "output"; outputs.mkdir()

            def save_one(source):
                return write_metadata(str(source), str(outputs / source.name), {"album": "Concurrent"})

            with ThreadPoolExecutor(max_workers=4) as executor:
                for future in [executor.submit(save_one, source) for source in sources]: future.result()
            for source in sources:
                self.assertEqual(full_digest(source), source_hashes[source])
                self.assertEqual(read_metadata(str(outputs / source.name))["metadata"]["album"], "Concurrent")

    def test_worker_save_requires_output_and_accepts_lossless_signature(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "source" / "source.flac"
            source.parent.mkdir()
            self.generate(source, "flac")
            record = read_metadata(str(source))
            payload = {
                "path": str(source),
                "signature": {"fileSize": record["fileSize"], "modifiedTimeNs": record["modifiedTimeNs"]},
                "patch": {"title": "Worker round trip"},
            }
            with self.assertRaises(MetadataError) as caught:
                worker_save(payload)
            self.assertEqual(caught.exception.code, "OUTPUT_NOT_SELECTED")
            output = self.output_path(folder, source)
            result = worker_save({**payload, "outputPath": str(output), "outputFolder": str(output.parent)})
            self.assertEqual(result["record"]["metadata"]["title"], "Worker round trip")
            self.assertEqual(result["outputPath"], os.path.realpath(output))

    def test_untagged_audio_previews_and_saves_new_metadata_without_touching_source(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "source" / "no metadata.flac"
            source.parent.mkdir()
            self.generate(source, "flac")
            audio = FLAC(str(source))
            audio.clear()
            audio.clear_pictures()
            audio.save()
            original = read_metadata(str(source))
            self.assertGreater(original["durationSeconds"], 0)
            self.assertEqual(original["metadata"]["title"], "")
            self.assertEqual(original["metadata"]["artist"], [])
            source_hash = full_digest(source)
            source_audio_hash = audio_payload_digest(str(source), "FLAC")
            signature = {"fileSize": original["fileSize"], "modifiedTimeNs": original["modifiedTimeNs"]}
            patch = {
                "title": "New title", "artist": ["New artist"], "album": "New album",
                "date": "2026", "genre": ["Electronic"],
            }

            preview = preview_changes({
                "path": str(source), "signature": signature, "patch": patch,
                "artworkOperation": None,
            })
            self.assertFalse(preview["conflict"])
            self.assertEqual({change["field"] for change in preview["changes"]}, set(patch))
            self.assertTrue(all(change["before"] in ("", []) for change in preview["changes"]))

            output = self.output_path(folder, source)
            result = worker_save({
                "path": str(source), "outputPath": str(output), "outputFolder": str(output.parent),
                "signature": signature, "patch": patch, "artworkOperation": None,
            })
            for field, value in patch.items():
                self.assertEqual(result["record"]["metadata"][field], value)
            self.assertEqual(result["record"]["artwork"], [])
            self.assertEqual(full_digest(source), source_hash)
            self.assertEqual(audio_payload_digest(str(output), "FLAC"), source_audio_hash)


if __name__ == "__main__":
    unittest.main()
