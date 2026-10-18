'use strict';

function cloneValue(value) {
  return Array.isArray(value) ? [...value] : value;
}

function buildBatchPatch(record, draftPatch, operations, options = {}) {
  const original = record.metadata && typeof record.metadata === 'object' ? record.metadata : {};
  const patch = Object.fromEntries(Object.entries(draftPatch || {}).map(([field, value]) => [field, cloneValue(value)]));
  const effective = { ...original, ...patch };

  for (const [field, operation] of Object.entries(operations || {})) {
    if (operation.operation === 'REPLACE') patch[field] = cloneValue(operation.value);
    else if (operation.operation === 'CLEAR') patch[field] = Array.isArray(effective[field]) ? [] : '';
    if (Object.hasOwn(patch, field)) effective[field] = patch[field];
  }

  if (options.cleanup || options.find) {
    for (const field of ['title', 'album', 'date', 'comment']) {
      let value = String(effective[field] || '');
      if (options.cleanup) value = value.trim().replace(/\s+/g, ' ');
      if (options.find) value = value.split(options.find).join(options.replace || '');
      if (value !== String(original[field] || '')) patch[field] = value;
      else delete patch[field];
      effective[field] = value;
    }
  }

  if (options.sequential) patch.trackNumber = String(options.trackNumber);

  for (const [field, value] of Object.entries(patch)) {
    if (JSON.stringify(original[field]) === JSON.stringify(value)) delete patch[field];
  }
  return patch;
}

function changesForPatch(record, patch) {
  const original = record.metadata && typeof record.metadata === 'object' ? record.metadata : {};
  return Object.entries(patch).map(([field, after]) => ({ field, before: original[field], after }));
}

module.exports = { buildBatchPatch, changesForPatch };
