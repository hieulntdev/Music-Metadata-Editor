#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

python_command="${PYTHON:-python3}"
if ! command -v "$python_command" >/dev/null 2>&1; then
  echo "Python 3 was not found. Install Python 3.9 or newer and retry." >&2
  exit 1
fi

if [ ! -d .venv ]; then
  "$python_command" -m venv .venv
fi

if [ -x .venv/bin/python ]; then
  venv_python=.venv/bin/python
else
  venv_python=.venv/Scripts/python.exe
fi

"$venv_python" -m pip install -r requirements.txt
npm ci

echo "Setup complete. Run: npm start"
if ! command -v fpcalc >/dev/null 2>&1 \
  && [ ! -x /opt/homebrew/bin/fpcalc ] \
  && [ ! -x /usr/local/bin/fpcalc ]; then
  echo "Optional fingerprint matching dependency not found: fpcalc." >&2
  echo "On macOS install it with: brew install chromaprint" >&2
  echo "Then verify it with: which fpcalc && fpcalc -version" >&2
fi
