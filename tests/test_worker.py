import json
import os
import subprocess
import sys
import tempfile
import unittest
import wave
import hashlib
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class WorkerTests(unittest.TestCase):
    def request(self, action, payload=None):
        process = subprocess.Popen(
            [sys.executable, "-u", str(ROOT / "backend" / "worker.py")],
            cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, env={**os.environ, "MUSIC_METADATA_DB": ""},
        )
        output, errors = process.communicate(json.dumps({"requestId": "test", "action": action, "payload": payload or {}}) + "\n")
        self.assertTrue(output, errors)
        return json.loads(output.splitlines()[-1])

    def test_ping(self):
        response = self.request("ping")
        self.assertTrue(response["ok"])
        self.assertEqual(response["result"]["workerVersion"], "1.0.0")

    def test_generated_wav_is_read_only(self):
        with tempfile.TemporaryDirectory() as folder:
            source_folder = Path(folder) / "source"; source_folder.mkdir()
            output_folder = Path(folder) / "output"; output_folder.mkdir()
            target = source_folder / "fixture.wav"
            with wave.open(str(target), "wb") as audio:
                audio.setnchannels(1); audio.setsampwidth(2); audio.setframerate(8000); audio.writeframes(b"\0\0" * 800)
            original = target.read_bytes()
            response = self.request("read_metadata", {"path": str(target)})
            if response["ok"]:
                self.assertEqual(response["result"]["format"], "WAV")
                self.assertFalse(response["result"]["capabilities"]["writeTags"])
                save_response = self.request("save_metadata", {
                    "path": str(target),
                    "outputPath": str(output_folder / "output.wav"),
                    "outputFolder": str(output_folder),
                    "signature": {
                        "fileSize": response["result"]["fileSize"],
                        "modifiedTimeNs": response["result"]["modifiedTimeNs"],
                    },
                    "patch": {"title": "must stay read-only"},
                })
                self.assertFalse(save_response["ok"])
                self.assertEqual(save_response["error"]["code"], "READ_ONLY")
                self.assertEqual(target.read_bytes(), original)
            else:
                self.assertEqual(response["error"]["code"], "DEPENDENCY_MISSING")

    def test_rename_apply_creates_verified_output_copy_and_keeps_source(self):
        with tempfile.TemporaryDirectory() as folder:
            source_folder = Path(folder) / "source"; source_folder.mkdir()
            output_folder = Path(folder) / "output"; output_folder.mkdir()
            source = source_folder / "track.flac"
            source.write_bytes(b"read-only source bytes")
            before = hashlib.sha256(source.read_bytes()).hexdigest()
            details = source.stat()
            destination = output_folder / "01 - Track.flac"
            response = self.request("rename_apply", {"items": [{
                "from": str(source), "to": str(destination), "outputFolder": str(output_folder),
                "signature": {"fileSize": details.st_size, "modifiedTimeNs": str(details.st_mtime_ns)},
                "collision": False,
            }]})
            self.assertTrue(response["ok"])
            self.assertEqual(destination.read_bytes(), source.read_bytes())
            self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(), before)
            other_folder = Path(folder) / "other-output"; other_folder.mkdir()
            changed = self.request("rename_apply", {"items": [{
                "from": str(source), "to": str(output_folder / "second.flac"), "outputFolder": str(other_folder),
                "signature": {"fileSize": details.st_size, "modifiedTimeNs": str(details.st_mtime_ns)},
                "collision": False,
            }]})
            self.assertFalse(changed["ok"])
            self.assertEqual(changed["error"]["code"], "OUTPUT_FOLDER_CHANGED")


if __name__ == "__main__":
    unittest.main()
