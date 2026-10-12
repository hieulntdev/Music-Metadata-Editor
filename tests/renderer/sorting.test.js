'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const sortingModule = import(pathToFileURL(path.resolve(__dirname, '../../src/renderer/state/sort-records.mjs')));

function record(id, metadata = {}, extra = {}) {
  return { fileId: id, metadata, ...extra };
}

async function ids(records, sort) {
  const { sortRecords } = await sortingModule;
  return sortRecords(records, sort, (item) => item.metadata).map((item) => item.fileId);
}

test('text sorting is case-insensitive, natural, reversible, and non-mutating', async () => {
  const records = [record('ten', { title: 'Track 10' }), record('two', { title: 'track 2' }), record('one', { title: 'TRACK 1' })];
  assert.deepEqual(await ids(records, { column: 'title', direction: 'asc' }), ['one', 'two', 'ten']);
  assert.deepEqual(await ids(records, { column: 'title', direction: 'desc' }), ['ten', 'two', 'one']);
  assert.deepEqual(records.map((item) => item.fileId), ['ten', 'two', 'one']);
});

test('numeric, date, duration, file-size, and status columns use typed comparisons', async () => {
  const records = [
    record('large', { trackNumber: '10', date: '2024-02-03' }, { durationSeconds: 120, fileSize: 1024, status: { conflict: true } }),
    record('small', { trackNumber: '2', date: '2023' }, { durationSeconds: 9, fileSize: 80, status: {} }),
    record('error', { trackNumber: '3', date: '2025-01-01' }, { durationSeconds: 60, fileSize: 512, status: { readError: true } })
  ];
  assert.deepEqual(await ids(records, { column: 'trackNumber', direction: 'asc' }), ['small', 'error', 'large']);
  assert.deepEqual(await ids(records, { column: 'date', direction: 'asc' }), ['small', 'large', 'error']);
  assert.deepEqual(await ids(records, { column: 'durationSeconds', direction: 'desc' }), ['large', 'error', 'small']);
  assert.deepEqual(await ids(records, { column: 'fileSize', direction: 'asc' }), ['small', 'error', 'large']);
  assert.deepEqual(await ids(records, { column: 'status', direction: 'asc' }), ['small', 'large', 'error']);
});

test('empty values stay last and equal values retain their input order', async () => {
  const records = [record('first', { album: 'Same' }), record('empty', { album: '' }), record('second', { album: 'same' })];
  assert.deepEqual(await ids(records, { column: 'album', direction: 'asc' }), ['first', 'second', 'empty']);
  assert.deepEqual(await ids(records, { column: 'album', direction: 'desc' }), ['first', 'second', 'empty']);
});
