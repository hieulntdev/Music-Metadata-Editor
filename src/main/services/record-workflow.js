'use strict';

function token(value) {
  return typeof value === 'string' ? value.trim().toLocaleLowerCase().replace(/[\s_]+/g, '-') : '';
}

function statusFor(record) {
  if (record?.status && typeof record.status === 'object' && !Array.isArray(record.status)) return record.status;
  return { processingStatus: typeof record?.status === 'string' ? record.status : 'ready' };
}

function beginMatchStatus(record) {
  return {
    ...statusFor(record),
    processingStatus: 'matching',
    matchStatus: 'searching',
    reviewStatus: null,
    matchError: null,
    saveError: null,
    saved: false,
    done: false,
    outputVerified: false
  };
}

function reviewedStatus(record) {
  const status = statusFor(record);
  if (token(status.matchStatus) !== 'matched') {
    const error = new Error('A track can only be reviewed after Auto Match finds a result.');
    error.code = 'MATCH_NOT_READY';
    throw error;
  }
  return {
    ...status,
    processingStatus: 'reviewed',
    reviewStatus: 'reviewed',
    done: false,
    outputVerified: false
  };
}

function savedStatus(record) {
  const status = statusFor(record);
  const done = token(status.matchStatus) === 'matched' && token(status.reviewStatus) === 'reviewed';
  return {
    ...status,
    processingStatus: done ? 'done' : 'saved',
    saved: true,
    done,
    outputVerified: true,
    saveError: null,
    conflict: false,
    conflictError: null,
    ...(done ? { matchError: null } : {})
  };
}

module.exports = { beginMatchStatus, reviewedStatus, savedStatus, statusFor };
