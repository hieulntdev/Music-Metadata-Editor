'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateTemplate } = require('../../src/main/services/rename.service');

test('rename template accepts documented fields', () => {
  assert.equal(validateTemplate('{trackNumber:02} - {artist} - {title}'), '{trackNumber:02} - {artist} - {title}');
});

test('rename template rejects unknown fields', () => {
  assert.throws(() => validateTemplate('{shell}'), { code: 'INVALID_TEMPLATE' });
});
