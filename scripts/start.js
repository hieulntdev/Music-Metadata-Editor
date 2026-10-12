'use strict';

const { spawn } = require('node:child_process');
const electron = require('electron');

const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, ['.', ...process.argv.slice(2)], {
  cwd: process.cwd(),
  env: environment,
  stdio: 'inherit',
  windowsHide: false
});

child.on('error', (error) => {
  console.error(`Could not start Electron: ${error.message}`);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { if (!child.killed) child.kill(signal); });
}
