'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { PythonBridge } = require('../../src/main/workers/python-bridge');

test('python worker completes a JSONL handshake', async (context) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'metadata-worker-'));
  const bridge = new PythonBridge({ appRoot: path.resolve(__dirname, '../..'), databasePath: path.join(folder, 'test.sqlite3') });
  context.after(async () => { await bridge.stop(); fs.rmSync(folder, { recursive: true, force: true }); });
  const result = await bridge.start();
  assert.equal(result.workerVersion, '1.0.0');
  assert.equal(typeof result.mutagenAvailable, 'boolean');
});
