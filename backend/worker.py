#!/usr/bin/env python3
"""Long-lived JSON Lines metadata worker. Stdout is protocol-only."""

from __future__ import annotations

import hashlib
import atexit
import json
import os
import socket
import shutil
import signal
import sqlite3
import subprocess
import sys
import tempfile
import traceback
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Optional

from metadata.formats import (
    MetadataError, SUPPORTED_EXTENSIONS, file_signature, read_metadata,
    staged_artwork, write_metadata,
)

WORKER_VERSION = "1.0.0"
DB_PATH = os.environ.get("MUSIC_METADATA_DB")
db: Optional[sqlite3.Connection] = None


def cleanup() -> None:
    global db
    if db is not None:
        db.close()
        db = None


def handle_termination(_signum: int, _frame: Any) -> None:
    cleanup()
    raise SystemExit(0)


atexit.register(cleanup)
for termination_signal in (signal.SIGINT, signal.SIGTERM):
    signal.signal(termination_signal, handle_termination)


def respond(message: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(message, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def diagnostic(message: str) -> None:
    sys.stderr.write(message.rstrip() + "\n")
    sys.stderr.flush()


def database() -> Optional[sqlite3.Connection]:
    global db
    if not DB_PATH:
        return None
    if db is None:
        Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(DB_PATH)
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)")
        db.execute("""CREATE TABLE IF NOT EXISTS library_cache (
            path TEXT PRIMARY KEY, file_size INTEGER NOT NULL, modified_ns INTEGER NOT NULL,
            record_json TEXT NOT NULL, scanned_at TEXT NOT NULL
        )""")
        db.execute("""CREATE TABLE IF NOT EXISTS audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, action TEXT NOT NULL,
            path_hash TEXT, fields TEXT, result TEXT NOT NULL, error_code TEXT
        )""")
        db.execute("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (1, datetime('now'))")
        db.commit()
    return db


def cache_record(record: dict[str, Any]) -> None:
    conn = database()
    if conn is None: return
    conn.execute(
        "INSERT OR REPLACE INTO library_cache(path,file_size,modified_ns,record_json,scanned_at) VALUES(?,?,?,?,datetime('now'))",
        (record["absolutePath"], record["fileSize"], record["modifiedTimeNs"], json.dumps(record, ensure_ascii=False)),
    )
    conn.commit()


def audit(action: str, path: str, fields: list[str], result: str, error_code: Optional[str] = None) -> None:
    conn = database()
    if conn is None: return
    path_hash = hashlib.sha256(os.path.realpath(path).encode("utf-8", "surrogatepass")).hexdigest()
    conn.execute(
        "INSERT INTO audit_log(created_at,action,path_hash,fields,result,error_code) VALUES(datetime('now'),?,?,?,?,?)",
        (action, path_hash, json.dumps(fields), result, error_code),
    )
    conn.commit()


def stable_id(path: str) -> str:
    return hashlib.sha256(os.path.realpath(path).encode("utf-8", "surrogatepass")).hexdigest()[:24]


def validate_regular_file(path: str, allowed_roots: Optional[list[str]] = None) -> str:
    if not isinstance(path, str) or "\x00" in path:
        raise MetadataError("INVALID_PATH", "The file path is invalid.")
    real_path = os.path.realpath(path)
    if allowed_roots:
        roots = [os.path.realpath(root) for root in allowed_roots]
        if not any(os.path.commonpath([real_path, root]) == root for root in roots):
            raise MetadataError("INVALID_PATH", "The file is outside the selected import location.")
    if not os.path.isfile(real_path):
        raise MetadataError("FILE_NOT_FOUND", "The file no longer exists or is not a regular file.")
    return real_path


def validate_output_destination(source_path: str, output_path: Any, expected_folder: Any) -> str:
    if not isinstance(output_path, str) or not output_path or not isinstance(expected_folder, str) or not expected_folder:
        raise MetadataError("OUTPUT_NOT_SELECTED", "Choose an Output Folder before saving.")
    output_parent = os.path.realpath(os.path.dirname(os.path.abspath(output_path)))
    expected_real = os.path.realpath(expected_folder)
    if output_parent != expected_real:
        raise MetadataError("OUTPUT_FOLDER_CHANGED", "The Output Folder changed after preview. Choose it again.")
    if not os.path.isdir(output_parent):
        raise MetadataError("OUTPUT_NOT_FOUND", "The Output Folder no longer exists.")
    if not os.access(output_parent, os.W_OK):
        raise MetadataError("OUTPUT_NOT_WRITABLE", "The Output Folder is not writable.")
    source_folder = os.path.dirname(os.path.realpath(source_path))
    try:
        overlaps = (
            os.path.commonpath([output_parent, source_folder]) == output_parent
            or os.path.commonpath([output_parent, source_folder]) == source_folder
        )
    except ValueError:
        overlaps = False  # Different Windows drives cannot overlap.
    if overlaps:
        raise MetadataError("OUTPUT_OVERLAPS_SOURCE", "Output Folder must be separate from the source location.")
    destination = os.path.join(output_parent, os.path.basename(output_path))
    if os.path.lexists(destination):
        raise MetadataError("OUTPUT_EXISTS", "The Output file already exists and was not overwritten.")
    return destination


def discover(paths: list[str], recursive: bool) -> list[str]:
    found: dict[str, str] = {}
    for raw_path in paths:
        real_path = os.path.realpath(raw_path)
        if os.path.isfile(real_path):
            if Path(real_path).suffix.lower() in SUPPORTED_EXTENSIONS: found[os.path.normcase(real_path)] = real_path
            continue
        if not os.path.isdir(real_path): continue
        iterator = os.walk(real_path, followlinks=False) if recursive else [(real_path, [], os.listdir(real_path))]
        for root, dirs, files in iterator:
            dirs[:] = [entry for entry in dirs if not os.path.islink(os.path.join(root, entry))]
            for name in files:
                candidate = os.path.realpath(os.path.join(root, name))
                if Path(candidate).suffix.lower() in SUPPORTED_EXTENSIONS and os.path.isfile(candidate):
                    found[os.path.normcase(candidate)] = candidate
    return sorted(found.values(), key=str.casefold)


def scan(payload: dict[str, Any]) -> dict[str, Any]:
    paths = payload.get("paths") or []
    if not isinstance(paths, list) or not all(isinstance(item, str) for item in paths):
        raise MetadataError("INVALID_REQUEST", "paths must be a list of selected locations.")
    files = discover(paths, bool(payload.get("recursive", True)))
    records, errors = [], []
    for index, path in enumerate(files):
        try:
            record = read_metadata(path, include_artwork=False)
            record["fileId"] = stable_id(path)
            cache_record(record)
            records.append(record)
        except Exception as exc:
            errors.append({"path": path, "error": error_object(exc)})
        respond({"event": "scan-progress", "processed": index + 1, "total": len(files), "path": path})
    return {"records": records, "errors": errors, "discovered": len(files)}


def preview_changes(payload: dict[str, Any]) -> dict[str, Any]:
    path = validate_regular_file(payload.get("path", ""))
    current = file_signature(path)
    expected = payload.get("signature") or {}
    conflict = expected.get("fileSize") != current["fileSize"] or str(expected.get("modifiedTimeNs")) != current["modifiedTimeNs"]
    record = read_metadata(path, include_artwork=False)
    patch = payload.get("patch")
    if patch is None:
        patch = {}
    elif not isinstance(patch, dict):
        raise MetadataError("INVALID_REQUEST", "patch must be an object.")
    artwork_operation = payload.get("artworkOperation")
    if artwork_operation is not None and not isinstance(artwork_operation, dict):
        raise MetadataError("INVALID_REQUEST", "artworkOperation must be an object or null.")
    changes = []
    for field, after in patch.items():
        before = record["metadata"].get(field, "")
        if before != after:
            changes.append({"field": field, "before": before, "after": after})
    if artwork_operation and artwork_operation.get("mode") in {"replace", "remove"}:
        changes.append({"field": "artwork", "before": f"{len(record['artwork'])} embedded image(s)", "after": artwork_operation["mode"]})
    return {"path": path, "changes": changes, "conflict": conflict, "writable": record["capabilities"]["writeTags"], "readOnlyReason": record["capabilities"].get("readOnlyReason")}


def save(payload: dict[str, Any]) -> dict[str, Any]:
    path = validate_regular_file(payload.get("path", ""))
    output_path = validate_output_destination(path, payload.get("outputPath"), payload.get("outputFolder"))
    signature = file_signature(path)
    expected = payload.get("signature") or {}
    if signature["fileSize"] != expected.get("fileSize") or signature["modifiedTimeNs"] != str(expected.get("modifiedTimeNs")):
        audit("save", path, list((payload.get("patch") or {}).keys()), "conflict", "FILE_CHANGED")
        raise MetadataError("FILE_CHANGED", "The file changed after it was scanned. Re-read it before saving.")
    patch = payload.get("patch") or {}
    artwork_operation = payload.get("artworkOperation")
    try:
        # Close the gap between the initial conflict check and the
        # copy writer's own in-flight identity check.
        current = file_signature(path)
        if current["fileSize"] != expected.get("fileSize") or current["modifiedTimeNs"] != str(expected.get("modifiedTimeNs")):
            raise MetadataError("FILE_CHANGED", "The file changed while the save was being prepared. Re-read it before saving.")
        record = write_metadata(path, output_path, patch, artwork_operation)
        record["fileId"] = stable_id(output_path)
        for field, expected_value in patch.items():
            if record["metadata"].get(field) != expected_value:
                raise MetadataError("VERIFY_FAILED", f"Saved field did not read back correctly: {field}")
        audit("save", path, list(patch), "saved")
        return {"record": record, "outputPath": output_path}
    except Exception as exc:
        audit("save", path, list(patch), "failed", getattr(exc, "code", "WRITE_FAILED"))
        raise


INVALID_FILENAME = '<>:"/\\|?*\x00'


def sanitize_filename(value: str) -> str:
    cleaned = "".join("_" if char in INVALID_FILENAME or ord(char) < 32 else char for char in value)
    cleaned = cleaned.strip().rstrip(".")
    return cleaned[:240] or "Untitled"


def render_template(template: str, metadata: dict[str, Any]) -> str:
    values = dict(metadata)
    values["artist"] = ", ".join(values.get("artist") or [])
    values["albumArtist"] = ", ".join(values.get("albumArtist") or [])
    result = template
    import re
    for token in re.findall(r"\{([A-Za-z]+)(?::(\d+))?\}", template):
        field, width = token
        value = str(values.get(field, "") or "")
        if width and value.isdigit(): value = value.zfill(int(width))
        result = result.replace("{" + field + (":" + width if width else "") + "}", value)
    if "{" in result or "}" in result: raise MetadataError("INVALID_TEMPLATE", "Rename template contains an unknown token.")
    return sanitize_filename(result)


def rename_preview(payload: dict[str, Any]) -> dict[str, Any]:
    template = payload.get("template", "")
    items, destinations = [], set()
    for entry in payload.get("files", []):
        path = validate_regular_file(entry["path"])
        new_name = render_template(template, entry.get("metadata") or {}) + Path(path).suffix
        destination = os.path.join(os.path.dirname(path), new_name)
        destination_key = new_name.casefold()
        collision = destination_key in destinations
        destinations.add(destination_key)
        items.append({
            "fileId": entry["fileId"], "from": path, "to": destination,
            "signature": entry.get("signature") or {}, "collision": collision,
            "changed": path != destination,
        })
    return {"items": items, "blocked": any(item["collision"] for item in items)}


def rename_apply(payload: dict[str, Any]) -> dict[str, Any]:
    items = payload.get("items") or []
    if any(item.get("collision") for item in items): raise MetadataError("RENAME_COLLISION", "Rename preview contains a collision.")
    completed: list[tuple[str, str]] = []
    try:
        for item in items:
            source = validate_regular_file(item["from"])
            expected = item.get("signature") or {}
            current = file_signature(source)
            if current["fileSize"] != expected.get("fileSize") or current["modifiedTimeNs"] != str(expected.get("modifiedTimeNs")):
                raise MetadataError("FILE_CHANGED", "A source file changed after the rename preview.")
            destination = validate_output_destination(source, item.get("to"), item.get("outputFolder"))
            output_parent = os.path.dirname(destination)
            descriptor, temporary_path = tempfile.mkstemp(prefix=f".{Path(destination).name}.copy-", suffix=Path(destination).suffix, dir=output_parent)
            os.close(descriptor)
            try:
                shutil.copy2(source, temporary_path)
                with open(temporary_path, "rb") as candidate_file: os.fsync(candidate_file.fileno())
                if _file_digest(source) != _file_digest(temporary_path):
                    raise MetadataError("COPY_VERIFY_FAILED", "The renamed copy did not match its source.")
                latest = file_signature(source)
                if latest != current: raise MetadataError("FILE_CHANGED", "A source file changed while it was being copied.")
                try: os.link(temporary_path, destination)
                except FileExistsError as exc: raise MetadataError("OUTPUT_EXISTS", "A renamed Output file already exists.") from exc
                try: os.unlink(temporary_path)
                except OSError:
                    try: os.unlink(destination)
                    except OSError: pass
                    raise
                temporary_path = ""
                completed.append((source, destination))
            finally:
                if temporary_path:
                    try: os.unlink(temporary_path)
                    except FileNotFoundError: pass
        return {"renamed": [{"from": source, "to": destination, "fileId": stable_id(destination)} for source, destination in completed]}
    except Exception:
        for _source, destination in reversed(completed):
            try:
                os.unlink(destination)
            except OSError: diagnostic(f"Output copy rollback failed for {destination}")
        raise


def _file_digest(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def common_fpcalc_paths() -> list[str]:
    if sys.platform == "darwin":
        return ["/opt/homebrew/bin/fpcalc", "/usr/local/bin/fpcalc", "/usr/bin/fpcalc"]
    if os.name == "nt":
        candidates = []
        for variable in ("ProgramFiles", "ProgramFiles(x86)"):
            root = os.environ.get(variable)
            if root:
                candidates.append(os.path.join(root, "Chromaprint", "fpcalc.exe"))
        user_profile = os.environ.get("USERPROFILE")
        if user_profile:
            candidates.append(os.path.join(user_profile, "scoop", "shims", "fpcalc.exe"))
        chocolatey = os.environ.get("ChocolateyInstall")
        if chocolatey:
            candidates.append(os.path.join(chocolatey, "bin", "fpcalc.exe"))
        return candidates
    return ["/usr/local/bin/fpcalc", "/usr/bin/fpcalc", "/snap/bin/fpcalc"]


def _executable_file(candidate: Any) -> Optional[str]:
    if not isinstance(candidate, str) or not candidate.strip() or "\x00" in candidate:
        return None
    expanded = os.path.abspath(os.path.expanduser(candidate.strip()))
    if os.path.isfile(expanded) and os.access(expanded, os.X_OK):
        return os.path.realpath(expanded)
    return None


def resolve_fpcalc(configured_path: Any = None) -> str:
    """Resolve fpcalc without relying on the often-minimal Electron PATH."""
    candidates = [configured_path]
    candidates.extend(os.environ.get(name) for name in ("FPCALC_PATH", "CHROMAPRINT_FPCALC"))
    path_match = shutil.which("fpcalc")
    if path_match:
        candidates.append(path_match)
    candidates.extend(common_fpcalc_paths())
    for candidate in candidates:
        resolved = _executable_file(candidate)
        if resolved:
            return resolved
    raise MetadataError(
        "DEPENDENCY_MISSING",
        "Chromaprint fpcalc was not found. Install it with 'brew install chromaprint' on macOS, "
        "or set the fpcalc executable path in Settings.",
    )


def fingerprint(payload: dict[str, Any]) -> dict[str, Any]:
    path = validate_regular_file(payload.get("path", ""))
    binary = resolve_fpcalc(payload.get("configuredPath"))
    try:
        result = subprocess.run([binary, "-json", path], capture_output=True, text=True, timeout=120, check=True)
        output = json.loads(result.stdout)
    except subprocess.TimeoutExpired as exc:
        raise MetadataError("FINGERPRINT_TIMEOUT", "Fingerprint generation timed out after 120 seconds.") from exc
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or exc.stdout or "unknown fpcalc error").strip()[:500]
        raise MetadataError("FINGERPRINT_FAILED", f"fpcalc could not process this audio file: {detail}") from exc
    except (OSError, UnicodeError) as exc:
        raise MetadataError("FINGERPRINT_FAILED", f"fpcalc could not be started: {exc}") from exc
    except (json.JSONDecodeError, TypeError) as exc:
        raise MetadataError("FINGERPRINT_INVALID", "fpcalc returned invalid JSON output.") from exc
    duration = output.get("duration") if isinstance(output, dict) else None
    fingerprint_value = output.get("fingerprint") if isinstance(output, dict) else None
    if not isinstance(duration, (int, float)) or duration <= 0 or not isinstance(fingerprint_value, str) or not fingerprint_value:
        raise MetadataError("FINGERPRINT_INVALID", "fpcalc did not return a valid duration and fingerprint.")
    return {"duration": int(round(duration)), "fingerprint": fingerprint_value, "executable": binary}


def acoustid(payload: dict[str, Any]) -> dict[str, Any]:
    api_key = payload.get("apiKey")
    if not api_key: raise MetadataError("API_KEY_MISSING", "Add an AcoustID API key in Settings first.")
    duration = payload.get("duration")
    fingerprint_value = payload.get("fingerprint")
    if not isinstance(duration, (int, float)) or duration <= 0 or not isinstance(fingerprint_value, str) or not fingerprint_value:
        raise MetadataError("FINGERPRINT_INVALID", "A valid fingerprint and duration are required for AcoustID lookup.")
    # POST keeps the API key out of URLs, proxy logs, and exception messages.
    params = urllib.parse.urlencode({"client": api_key, "meta": "recordings+releasegroups+compress", "duration": int(round(duration)), "fingerprint": fingerprint_value}).encode("ascii")
    request = urllib.request.Request(
        "https://api.acoustid.org/v2/lookup", data=params, method="POST",
        headers={"User-Agent": "MusicMetadataEditor/1.0", "Content-Type": "application/x-www-form-urlencoded"},
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            result = json.load(response)
    except urllib.error.HTTPError as exc:
        if exc.code == 429:
            raise MetadataError("RATE_LIMITED", "AcoustID rate limit reached. Wait and try again.") from exc
        if exc.code in {401, 403}:
            raise MetadataError("API_KEY_INVALID", "AcoustID rejected the configured API key.") from exc
        raise MetadataError("NETWORK_ERROR", f"AcoustID returned HTTP {exc.code}.") from exc
    except (TimeoutError, socket.timeout) as exc:
        raise MetadataError("NETWORK_TIMEOUT", "AcoustID lookup timed out.") from exc
    except urllib.error.URLError as exc:
        if isinstance(exc.reason, (TimeoutError, socket.timeout)):
            raise MetadataError("NETWORK_TIMEOUT", "AcoustID lookup timed out.") from exc
        raise MetadataError("NETWORK_ERROR", f"AcoustID lookup failed: {exc.reason}") from exc
    except (json.JSONDecodeError, UnicodeError, ValueError) as exc:
        raise MetadataError("SERVICE_RESPONSE_INVALID", "AcoustID returned an invalid response.") from exc
    if not isinstance(result, dict):
        raise MetadataError("SERVICE_RESPONSE_INVALID", "AcoustID returned an invalid response.")
    if result.get("status") != "ok":
        error = result.get("error") if isinstance(result.get("error"), dict) else {}
        message = error.get("message") if isinstance(error.get("message"), str) else "AcoustID rejected the lookup request."
        raise MetadataError("ACOUSTID_ERROR", message)
    if not isinstance(result.get("results", []), list):
        raise MetadataError("SERVICE_RESPONSE_INVALID", "AcoustID returned invalid match results.")
    return result


def error_object(exc: Exception) -> dict[str, Any]:
    return {"code": getattr(exc, "code", "INTERNAL_ERROR"), "message": str(exc), "details": getattr(exc, "details", None)}


ACTIONS = {
    "scan": scan,
    "read_metadata": lambda payload: {**read_metadata(validate_regular_file(payload.get("path", "")), True), "fileId": stable_id(payload["path"])},
    "preview_changes": preview_changes,
    "save_metadata": save,
    "stage_artwork": lambda payload: staged_artwork(validate_regular_file(payload.get("path", ""))),
    "rename_preview": rename_preview,
    "rename_apply": rename_apply,
    "fingerprint": fingerprint,
    "acoustid": acoustid,
}


def main() -> None:
    database()
    for line in sys.stdin:
        try:
            message = json.loads(line)
            request_id = message.get("requestId")
            action = message.get("action")
            payload = message.get("payload") or {}
            if action == "ping": result = {"workerVersion": WORKER_VERSION, "mutagenAvailable": _mutagen_available()}
            elif action == "shutdown":
                respond({"requestId": request_id, "ok": True, "result": {"stopped": True}}); break
            elif action in ACTIONS: result = ACTIONS[action](payload)
            else: raise MetadataError("UNKNOWN_ACTION", f"Unknown worker action: {action}")
            respond({"requestId": request_id, "ok": True, "result": result})
        except json.JSONDecodeError:
            diagnostic("Ignored malformed JSON request.")
        except Exception as exc:
            request_id = locals().get("request_id")
            if isinstance(exc, MetadataError):
                diagnostic(f"Worker error [{exc.code}]: {exc}")
            else:
                diagnostic("Unexpected worker error:\n" + traceback.format_exc())
            respond({"requestId": request_id, "ok": False, "error": error_object(exc)})
    cleanup()


def _mutagen_available() -> bool:
    try:
        from metadata.formats import mutagen
        return mutagen is not None
    except Exception:
        return False


if __name__ == "__main__":
    main()
