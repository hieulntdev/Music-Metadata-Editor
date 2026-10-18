'use strict';

const { BATCH_OPERATIONS, MAX_AUTO_MATCH_TRACKS, MAX_BATCH_SAVE_TRACKS, MAX_LYRICS_LENGTH, MAX_TEXT_LENGTH, WRITABLE_FIELDS } = require('./constants');

class AppError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }
}

function object(value, name = 'value') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError('INVALID_REQUEST', `${name} must be an object.`);
  }
  return value;
}

function string(value, name, { max = MAX_TEXT_LENGTH, allowEmpty = true } = {}) {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim())) {
    throw new AppError('INVALID_REQUEST', `${name} is invalid.`);
  }
  return value;
}

function stringArray(value, name, max = 5000) {
  if (!Array.isArray(value) || value.length > max) {
    throw new AppError('INVALID_REQUEST', `${name} must be an array.`);
  }
  return value.map((entry, index) => string(entry, `${name}[${index}]`, { max: 4096, allowEmpty: false }));
}

function fileIds(value) {
  return stringArray(value, 'fileIds').map((id) => string(id, 'fileId', { max: 128, allowEmpty: false }));
}

function autoMatchFileIds(value) {
  const ids = [...new Set(fileIds(value))];
  if (!ids.length) throw new AppError('INVALID_SELECTION', 'Select at least one track for Auto Match.');
  if (ids.length > MAX_AUTO_MATCH_TRACKS) {
    throw new AppError('AUTO_MATCH_LIMIT', `Auto Match supports at most ${MAX_AUTO_MATCH_TRACKS} tracks at a time.`);
  }
  return ids;
}

function batchPreviewItems(value) {
  if (!Array.isArray(value) || !value.length || value.length > MAX_BATCH_SAVE_TRACKS) {
    throw new AppError('BATCH_SAVE_LIMIT', `Batch Preview & Save supports 1-${MAX_BATCH_SAVE_TRACKS} tracks.`);
  }
  const seen = new Set();
  return value.map((raw, index) => {
    const item = object(raw, `items[${index}]`);
    const fileId = string(item.fileId, `items[${index}].fileId`, { max: 128, allowEmpty: false });
    if (seen.has(fileId)) throw new AppError('INVALID_SELECTION', 'A track can appear only once in a batch.');
    seen.add(fileId);
    let artworkOperation = null;
    if (item.artworkOperation !== null && item.artworkOperation !== undefined) {
      const artwork = object(item.artworkOperation, `items[${index}].artworkOperation`);
      if (!['replace', 'remove'].includes(artwork.mode)) throw new AppError('INVALID_REQUEST', 'Invalid artwork operation.');
      artworkOperation = artwork.mode === 'replace'
        ? { mode: 'replace', token: string(artwork.token, 'artwork token', { max: 128, allowEmpty: false }) }
        : { mode: 'remove' };
    }
    return { fileId, patch: metadataPatch(item.patch || {}), artworkOperation };
  });
}

function metadataPatch(value) {
  object(value, 'patch');
  const patch = {};
  for (const [field, raw] of Object.entries(value)) {
    if (!WRITABLE_FIELDS.includes(field)) {
      throw new AppError('UNSUPPORTED_FIELD', `Unsupported metadata field: ${field}`);
    }
    if (raw === null) {
      patch[field] = null;
    } else if (['artist', 'albumArtist', 'genre', 'composer'].includes(field)) {
      patch[field] = Array.isArray(raw)
        ? raw.map((item) => string(item, field, { max: 1000 })).filter(Boolean)
        : [string(raw, field, { max: 1000 })].filter(Boolean);
    } else {
      patch[field] = string(String(raw), field, { max: ['lyrics', 'syncedLyrics'].includes(field) ? MAX_LYRICS_LENGTH : MAX_TEXT_LENGTH });
    }
  }
  return patch;
}

function batchOperations(value) {
  object(value, 'operations');
  const result = {};
  for (const [field, input] of Object.entries(value)) {
    if (!WRITABLE_FIELDS.includes(field)) throw new AppError('UNSUPPORTED_FIELD', `Unsupported metadata field: ${field}`);
    object(input, `operations.${field}`);
    if (!BATCH_OPERATIONS.includes(input.operation)) throw new AppError('INVALID_REQUEST', `Invalid operation for ${field}.`);
    result[field] = {
      operation: input.operation,
      value: input.operation === 'REPLACE' ? metadataPatch({ [field]: input.value })[field] : null
    };
  }
  return result;
}

function publicError(error) {
  return {
    code: error?.code || 'INTERNAL_ERROR',
    message: error?.message || 'An unexpected error occurred.',
    details: error?.details
  };
}

module.exports = { AppError, object, string, stringArray, fileIds, autoMatchFileIds, batchPreviewItems, metadataPatch, batchOperations, publicError };
