# Music Metadata Editor

A local-first Electron desktop utility for reviewing and editing audio metadata. It uses a sandboxed HTML/CSS/JavaScript renderer and a long-lived Python/Mutagen worker. MusicBrainz, iTunes, Deezer, optional Discogs, and AcoustID fingerprint results are suggestion sources only; changes reach audio files only through the explicit Preview & Save flow.

## Prerequisites

- Node.js 22 or newer and npm
- Python 3.9 or newer
- macOS or Windows (Linux works for development where Electron is available)
- Optional for fingerprint matching: `fpcalc` from Chromaprint and an AcoustID API key
- Optional for Discogs release suggestions: a Discogs personal access token

## Auto Match

- Select 1–50 tracks with checkboxes, Cmd/Ctrl-click, or Shift-click, then choose **Auto Match**.
- Searches run asynchronously with bounded concurrency. Provider timeouts, rate limits, and unavailable credentials are isolated per provider and per track.
- **Metadata Match Review** keeps a separate Pending, Searching, Matched, No Match, Failed, or Cancelled state for every track. Candidates retain their source provenance and are scored on a 0–100 application match scale.
- Choosing **Apply Current to Draft** or **Apply Reviewed to Draft** updates in-memory drafts only. It never writes an audio file. Use **Preview & Save** and a safe Output Folder to create verified copies.
- MusicBrainz, iTunes, and Deezer metadata search work without credentials. Discogs is reported as unavailable until a token is saved in Settings. AcoustID remains an explicit fingerprint action and requires its own key plus Chromaprint.

### Chromaprint / fingerprint matching

Chromaprint creates the fingerprint locally; AcoustID uses that fingerprint to
identify MusicBrainz recordings. On macOS, install Chromaprint with Homebrew:

```sh
brew install chromaprint
which fpcalc
fpcalc -version
```

The app looks for `fpcalc` in this order: the executable path saved in Settings,
`FPCALC_PATH` or `CHROMAPRINT_FPCALC`, the Electron process `PATH`, and common
system locations (including `/opt/homebrew/bin/fpcalc` and
`/usr/local/bin/fpcalc` on macOS). If automatic detection fails, enter the full
executable path in Settings. An AcoustID API key must also be saved in Settings;
the app checks for it before running `fpcalc` and never includes it in logs.

## Installation

Clone the repository, enter its directory, and install the locked Node.js and
Python dependencies.

On macOS/Linux:

```sh
git clone <repository-url>
cd Music-Metadata-Editor
bash scripts/setup.sh
```

On Windows PowerShell:

```powershell
git clone <repository-url>
cd Music-Metadata-Editor
py -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
npm ci
```

`scripts/setup.sh` creates `.venv`, installs `requirements.txt`, and runs
`npm ci`. The environment and installed dependencies are local artifacts and
are intentionally excluded from Git.

## Environment Setup

No `.env` file or mandatory API credential is required. Application settings,
cache, optional provider credentials, and audit records are stored under
Electron's per-user application-data directory, never in the repository.

The app automatically uses `.venv/bin/python` (or
`.venv\Scripts\python.exe` on Windows). `MUSIC_METADATA_PYTHON` can override
that interpreter path. `FPCALC_PATH` or `CHROMAPRINT_FPCALC` can optionally
point to a Chromaprint executable; the same path can be entered in Settings.

## Run Development

```sh
npm start
```

No packaging or installer step is used.

## Optional Models

This project does not use or download machine-learning models. Fingerprint
matching optionally uses the small system-level Chromaprint `fpcalc` utility;
see the installation commands above. MusicBrainz, iTunes, and Deezer work
without credentials. AcoustID and Discogs credentials can be entered in
Settings when those optional providers are needed.

## Tests

```sh
npm test
npm run test:python
MUSIC_METADATA_SMOKE=1 npm start
```

The smoke command opens Electron briefly, verifies the 1620×928, 1440×900, 1180×780, and 900×650 layouts, exercises scrolling in every metadata tab, checks Metadata Match Review in both themes (including Source order and scroll ownership), checks Jobs statistics and 1,250 virtualized rows, captures each renderer view to the operating-system temporary directory, and exits automatically.

## Safety model

- Scanning, remote matching, and draft edits never write audio files.
- Output Folder is in-memory session state. Every app launch starts with no selection; changing it invalidates stale previews, and it is never restored from Settings or browser storage.
- Save requires a user-selected Output Folder, validates the scanned source size and modification time, and writes only selected fields to an Output copy.
- Every write copies the source to a temporary file inside Output. The app verifies the saved fields/artwork, encoded audio SHA-256, codec, sample rate, bit depth, bitrate, duration, and channels before atomically publishing a new Output file without overwriting anything.
- Audio hashes exclude mutable metadata: FLAC frames, MP3 frame region, MP4 `mdat`, Ogg codec/audio packets, or AIFF sound data are compared as appropriate for the container.
- Source files are read-only inputs: the app never replaces, renames, moves, deletes, or writes metadata to them. A separate backup is therefore unnecessary.
- WAV is intentionally read-only because writable tag behavior varies by application and container.
- Canceling a metadata-save batch stops queued files and allows its current atomic write to finish. Canceling Auto Match also aborts active provider requests and marks queued tracks Cancelled.
- Imported paths are validated in the Electron main process and resolved to previously scanned file IDs before any write.
- Output is canonicalized in both Electron and the worker. It cannot overlap a source/import tree, follow a symlink back into one, contain a processed source, or overwrite an existing destination. Duplicate basenames are reported as conflicts during Preview.

Supported writable families are FLAC, MP3, M4A/ALAC, OGG Vorbis, Opus, and AIFF, subject to the specific file being readable by Mutagen. Unknown/custom tags and unrelated artwork are retained because writes patch named fields instead of replacing the complete tag container.

## Troubleshooting

- If the worker reports that Python is unavailable, rerun the installation
  steps and verify `.venv/bin/python --version` (macOS/Linux) or
  `.venv\Scripts\python.exe --version` (Windows).
- If `npm ci` reports a Node.js engine error, install Node.js 22 or newer and
  retry.
- Fingerprint matching requires both `fpcalc` and an AcoustID API key. Verify
  the executable with `fpcalc -version`, then configure the key in Settings.
- Provider searches need network access. Only AcoustID and Discogs require
  optional credentials; ordinary editing and local metadata reads do not.
