'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { metadataPatch, batchOperations, autoMatchFileIds } = require('../../src/shared/schemas');

test('metadata patch accepts canonical fields and normalizes arrays', () => {
  assert.deepEqual(metadataPatch({ title: 'Track', artist: 'Artist' }), { title: 'Track', artist: ['Artist'] });
});

test('metadata patch rejects unknown fields', () => {
  assert.throws(() => metadataPatch({ arbitrary: 'value' }), { code: 'UNSUPPORTED_FIELD' });
});

test('batch KEEP, REPLACE and CLEAR stay explicit', () => {
  assert.deepEqual(batchOperations({
    title: { operation: 'KEEP' },
    album: { operation: 'REPLACE', value: 'New album' },
    genre: { operation: 'CLEAR' }
  }), {
    title: { operation: 'KEEP', value: null },
    album: { operation: 'REPLACE', value: 'New album' },
    genre: { operation: 'CLEAR', value: null }
  });
});

test('Auto Match accepts 1-50 unique tracks and rejects larger or empty selections', () => {
  assert.equal(autoMatchFileIds(['one']).length, 1);
  assert.equal(autoMatchFileIds(Array.from({ length: 50 }, (_, index) => `track-${index}`)).length, 50);
  assert.equal(autoMatchFileIds(['same', 'same']).length, 1);
  assert.throws(() => autoMatchFileIds([]), { code: 'INVALID_SELECTION' });
  assert.throws(() => autoMatchFileIds(Array.from({ length: 51 }, (_, index) => `track-${index}`)), { code: 'AUTO_MATCH_LIMIT' });
});
