'use strict';

const { EventEmitter } = require('node:events');
const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const readline = require('node:readline');

class PythonBridge extends EventEmitter {
  constructor({ appRoot, databasePath, timeout = 30000 }) {
    super();
    this.appRoot = appRoot;
    this.databasePath = databasePath;
    this.timeout = timeout;
    this.pending = new Map();
    this.sequence = 0;
    this.process = null;
    this.ready = false;
    this.stopping = false;
  }

  static candidates(appRoot) {
    const configured = process.env.MUSIC_METADATA_PYTHON || process.env.PYTHON;
    return [
      configured,
      path.join(appRoot, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'),
      process.platform === 'win32' ? 'py' : 'python3',
      'python'
    ].filter(Boolean);
  }

  resolvePython() {
    for (const command of PythonBridge.candidates(this.appRoot)) {
      if (command.includes(path.sep) && !fs.existsSync(command)) continue;
      const probeArgs = path.basename(command).toLowerCase() === 'py' ? ['-3', '--version'] : ['--version'];
      const result = spawnSync(command, probeArgs, { encoding: 'utf8', timeout: 3000, windowsHide: true });
      if (!result.error && result.status === 0) return { command, prefix: probeArgs[0] === '-3' ? ['-3'] : [] };
    }
    const error = new Error('Python 3 was not found. Run scripts/setup.sh or install Python 3.9+.');
    error.code = 'WORKER_UNAVAILABLE';
    throw error;
  }

  async start() {
    if (this.process && this.ready) return;
    this.stopping = false;
    const python = this.resolvePython();
    const workerPath = path.join(this.appRoot, 'backend', 'worker.py');
    this.process = spawn(python.command, [...python.prefix, '-u', workerPath], {
      cwd: this.appRoot,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, MUSIC_METADATA_DB: this.databasePath }
    });
    this.process.stderr.setEncoding('utf8');
    this.process.stderr.on('data', (chunk) => this.emit('diagnostic', chunk.trim()));
    this.process.once('error', (error) => this.failAll('WORKER_UNAVAILABLE', error.message));
    this.process.once('exit', (code, signal) => {
      this.ready = false;
      this.process = null;
      if (!this.stopping) this.failAll('WORKER_UNAVAILABLE', `Metadata worker stopped (${signal || code}).`);
    });

    const lines = readline.createInterface({ input: this.process.stdout, crlfDelay: Infinity });
    lines.on('line', (line) => this.handleLine(line));
    const result = await this.request('ping', {}, 10000, true);
    if (!result?.workerVersion) throw Object.assign(new Error('Metadata worker handshake failed.'), { code: 'WORKER_UNAVAILABLE' });
    this.ready = true;
    return result;
  }

  handleLine(line) {
    let message;
    try { message = JSON.parse(line); } catch {
      this.emit('diagnostic', 'Ignored malformed worker response.');
      return;
    }
    if (message.event) {
      this.emit('event', message);
      return;
    }
    const pending = this.pending.get(message.requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.requestId);
    if (message.ok) pending.resolve(message.result);
    else pending.reject(Object.assign(new Error(message.error?.message || 'Worker request failed.'), message.error || {}));
  }

  request(action, payload = {}, timeout = this.timeout, allowStarting = false) {
    if (!this.process || (!this.ready && !allowStarting)) {
      return Promise.reject(Object.assign(new Error('Metadata worker is unavailable.'), { code: 'WORKER_UNAVAILABLE' }));
    }
    const requestId = `req-${Date.now()}-${++this.sequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(Object.assign(new Error(`Worker request timed out: ${action}`), { code: 'WORKER_TIMEOUT' }));
      }, timeout);
      this.pending.set(requestId, { resolve, reject, timer });
      this.process.stdin.write(`${JSON.stringify({ requestId, action, payload })}\n`, (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(Object.assign(error, { code: 'WORKER_UNAVAILABLE' }));
      });
    });
  }

  failAll(code, message) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(Object.assign(new Error(message), { code }));
    }
    this.pending.clear();
  }

  async stop() {
    this.stopping = true;
    if (!this.process) return;
    try { await this.request('shutdown', {}, 1000); } catch { /* process may already be gone */ }
    if (this.process) this.process.kill();
    this.process = null;
    this.ready = false;
  }
}

module.exports = { PythonBridge };
