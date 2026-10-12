'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const configured = process.env.MUSIC_METADATA_PYTHON || process.env.PYTHON;
const command = configured || path.join(
  projectRoot,
  '.venv',
  process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'
);

if (command.includes(path.sep) && !fs.existsSync(command)) {
  console.error('Python environment not found. Run the installation steps in README.md first.');
  process.exit(1);
}

const prefix = path.basename(command).toLowerCase() === 'py' ? ['-3'] : [];
const result = spawnSync(command, [
  ...prefix,
  '-m', 'unittest', 'discover',
  '-s', 'tests',
  '-p', 'test_*.py'
], {
  cwd: projectRoot,
  env: process.env,
  stdio: 'inherit',
  windowsHide: true
});

if (result.error) {
  console.error(`Could not run Python tests: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
