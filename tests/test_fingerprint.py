import io
import json
import os
import stat
import sys
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from metadata.formats import MetadataError
import worker


class _Response:
    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return io.BytesIO(json.dumps(self.payload).encode("utf-8"))

    def __exit__(self, *_args):
        return False


class FingerprintTests(unittest.TestCase):
    def executable(self, folder, name="fpcalc"):
        target = Path(folder) / name
        target.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
        target.chmod(target.stat().st_mode | stat.S_IXUSR)
        return str(target)

    def test_configured_fpcalc_path_takes_priority(self):
        with tempfile.TemporaryDirectory() as folder:
            configured = self.executable(folder, "configured fpcalc")
            path_binary = self.executable(folder, "path-fpcalc")
            with mock.patch.object(worker.shutil, "which", return_value=path_binary):
                self.assertEqual(worker.resolve_fpcalc(configured), os.path.realpath(configured))

    def test_fpcalc_on_path_is_detected(self):
        with tempfile.TemporaryDirectory() as folder:
            executable = self.executable(folder)
            with mock.patch.object(worker.shutil, "which", return_value=executable):
                self.assertEqual(worker.resolve_fpcalc(), os.path.realpath(executable))

    def test_common_homebrew_path_is_used_when_electron_path_cannot_see_it(self):
        with tempfile.TemporaryDirectory() as folder:
            executable = self.executable(folder)
            with mock.patch.object(worker.shutil, "which", return_value=None), \
                    mock.patch.object(worker, "common_fpcalc_paths", return_value=[executable]):
                self.assertEqual(worker.resolve_fpcalc(), os.path.realpath(executable))

    def test_missing_fpcalc_has_actionable_dependency_error(self):
        with mock.patch.object(worker.shutil, "which", return_value=None), \
                mock.patch.object(worker, "common_fpcalc_paths", return_value=[]), \
                mock.patch.dict(worker.os.environ, {"FPCALC_PATH": "", "CHROMAPRINT_FPCALC": ""}):
            with self.assertRaises(MetadataError) as caught:
                worker.resolve_fpcalc()
        self.assertEqual(caught.exception.code, "DEPENDENCY_MISSING")
        self.assertIn("brew install chromaprint", str(caught.exception))

    def test_fingerprint_handles_unicode_space_path_and_validates_output(self):
        with tempfile.TemporaryDirectory() as folder:
            audio = Path(folder) / "bài hát có khoảng trắng.flac"
            audio.write_bytes(b"fixture")
            completed = mock.Mock(stdout=json.dumps({"duration": 42.4, "fingerprint": "AQAD-test"}), stderr="")
            with mock.patch.object(worker, "resolve_fpcalc", return_value="/safe/fpcalc"), \
                    mock.patch.object(worker.subprocess, "run", return_value=completed) as run:
                result = worker.fingerprint({"path": str(audio)})
            self.assertEqual(result["duration"], 42)
            self.assertEqual(result["fingerprint"], "AQAD-test")
            run.assert_called_once_with(
                ["/safe/fpcalc", "-json", os.path.realpath(audio)],
                capture_output=True, text=True, timeout=120, check=True,
            )

    def test_fingerprint_timeout_has_specific_error(self):
        with tempfile.TemporaryDirectory() as folder:
            audio = Path(folder) / "track.flac"; audio.write_bytes(b"fixture")
            with mock.patch.object(worker, "resolve_fpcalc", return_value="/safe/fpcalc"), \
                    mock.patch.object(worker.subprocess, "run", side_effect=worker.subprocess.TimeoutExpired("fpcalc", 120)):
                with self.assertRaises(MetadataError) as caught:
                    worker.fingerprint({"path": str(audio)})
            self.assertEqual(caught.exception.code, "FINGERPRINT_TIMEOUT")

    def test_acoustid_requires_key_without_sending_request(self):
        with mock.patch.object(worker.urllib.request, "urlopen") as request:
            with self.assertRaises(MetadataError) as caught:
                worker.acoustid({"duration": 42, "fingerprint": "AQAD-test"})
        self.assertEqual(caught.exception.code, "API_KEY_MISSING")
        request.assert_not_called()

    def test_acoustid_posts_fingerprint_and_preserves_multiple_results(self):
        payload = {"status": "ok", "results": [{"score": .9, "recordings": [{"id": "one"}]}, {"score": .8, "recordings": [{"id": "two"}]}]}
        with mock.patch.object(worker.urllib.request, "urlopen", return_value=_Response(payload)) as urlopen:
            result = worker.acoustid({"apiKey": "secret-key", "duration": 42, "fingerprint": "AQAD-test"})
        self.assertEqual(len(result["results"]), 2)
        request = urlopen.call_args.args[0]
        self.assertEqual(request.full_url, "https://api.acoustid.org/v2/lookup")
        self.assertNotIn("secret-key", request.full_url)
        self.assertIn(b"fingerprint=AQAD-test", request.data)

    def test_acoustid_rate_limit_is_distinct(self):
        error = urllib.error.HTTPError("https://api.acoustid.org/v2/lookup", 429, "rate", {}, None)
        with mock.patch.object(worker.urllib.request, "urlopen", side_effect=error):
            with self.assertRaises(MetadataError) as caught:
                worker.acoustid({"apiKey": "secret-key", "duration": 42, "fingerprint": "AQAD-test"})
        self.assertEqual(caught.exception.code, "RATE_LIMITED")


if __name__ == "__main__":
    unittest.main()
