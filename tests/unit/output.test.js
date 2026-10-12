'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { OutputFolderSession, planOutputEntries, validateOutputFolder } = require('../../src/main/services/output.service');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metadata-output-'));
  const source = path.join(root, 'source');
  const output = path.join(root, 'output');
  fs.mkdirSync(source); fs.mkdirSync(output);
  const file = path.join(source, 'track.flac');
  fs.writeFileSync(file, 'source');
  return { root, source, output, file };
}

test('output is required and must not overlap a source tree through canonical paths', (context) => {
  const item = fixture();
  context.after(() => fs.rmSync(item.root, { recursive: true, force: true }));
  assert.throws(() => validateOutputFolder('', [item.file]), { code: 'OUTPUT_NOT_SELECTED' });
  assert.throws(() => validateOutputFolder(item.source, [item.file]), { code: 'OUTPUT_OVERLAPS_SOURCE' });
  const nested = path.join(item.source, 'nested'); fs.mkdirSync(nested);
  assert.throws(() => validateOutputFolder(nested, [item.file]), { code: 'OUTPUT_OVERLAPS_SOURCE' });
  assert.equal(validateOutputFolder(item.output, [item.file]), fs.realpathSync.native(item.output));
});

test('a symlink back into the source tree is rejected', (context) => {
  const item = fixture();
  context.after(() => fs.rmSync(item.root, { recursive: true, force: true }));
  const link = path.join(item.root, 'output-link');
  fs.symlinkSync(item.source, link, 'dir');
  assert.throws(() => validateOutputFolder(link, [item.file]), { code: 'OUTPUT_OVERLAPS_SOURCE' });
});

test('planning detects existing outputs and duplicate basenames before saving', (context) => {
  const item = fixture();
  context.after(() => fs.rmSync(item.root, { recursive: true, force: true }));
  const otherSource = path.join(item.root, 'other-source'); fs.mkdirSync(otherSource);
  const duplicate = path.join(otherSource, 'track.flac'); fs.writeFileSync(duplicate, 'other');
  let planned = planOutputEntries([{ path: item.file }, { path: duplicate }], item.output);
  assert.equal(planned[0].outputConflict, 'DUPLICATE_OUTPUT');
  assert.equal(planned[1].outputConflict, 'DUPLICATE_OUTPUT');
  fs.writeFileSync(path.join(item.output, 'track.flac'), 'existing');
  planned = planOutputEntries([{ path: item.file }], item.output);
  assert.equal(planned[0].outputConflict, 'OUTPUT_EXISTS');
});

test('output folder is session-only, can change repeatedly, and cancel semantics keep the current value', (context) => {
  const item = fixture();
  const second = path.join(item.root, 'output-b'); fs.mkdirSync(second);
  context.after(() => fs.rmSync(item.root, { recursive: true, force: true }));

  const session = new OutputFolderSession();
  assert.equal(session.current, '');
  assert.equal(session.select(item.output, [item.file]), fs.realpathSync.native(item.output));
  assert.equal(session.select(second, [item.file]), fs.realpathSync.native(second));

  // A cancelled native picker never calls select(), so the in-memory authority is unchanged.
  assert.equal(session.current, fs.realpathSync.native(second));
  assert.equal(new OutputFolderSession().current, '', 'a new app session must not restore any previous path');
});

test('each planned job snapshots the folder selected when that job is created', (context) => {
  const item = fixture();
  const second = path.join(item.root, 'output-b'); fs.mkdirSync(second);
  context.after(() => fs.rmSync(item.root, { recursive: true, force: true }));
  const session = new OutputFolderSession();

  session.select(item.output, [item.file]);
  const first = planOutputEntries([{ path: item.file }], session.current);
  session.select(second, [item.file]);
  const next = planOutputEntries([{ path: item.file }], session.current);

  assert.equal(first[0].outputFolder, fs.realpathSync.native(item.output));
  assert.equal(next[0].outputFolder, fs.realpathSync.native(second));
  assert.equal(next[0].outputPath, path.join(fs.realpathSync.native(second), 'track.flac'));
});
