const ERROR_TOKENS = new Set(['error', 'failed', 'failure']);
const CONFLICT_TOKENS = new Set(['conflict']);

export function normalizeStatusToken(value) {
  if (typeof value !== 'string') return '';
  const token = value.trim().toLocaleLowerCase().replace(/[\s_]+/g, '-');
  if (token === 'errors') return 'error';
  if (token === 'conflicts') return 'conflict';
  if (token === 'nomatch') return 'no-match';
  return token;
}

function statusObject(record) {
  return record?.status && typeof record.status === 'object' && !Array.isArray(record.status)
    ? record.status
    : {};
}

function hasValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') return Object.keys(value).length > 0;
  return value !== null && value !== undefined && value !== false && value !== '';
}

export function recordStatus(record, dirty = false) {
  const status = statusObject(record);
  const processingStatus = normalizeStatusToken(
    typeof record?.status === 'string'
      ? record.status
      : status.processingStatus ?? status.processing ?? status.state ?? status.value ?? status.status
  );
  const matchStatus = normalizeStatusToken(record?.matchStatus ?? status.matchStatus ?? status.match?.status);
  const reviewStatus = normalizeStatusToken(record?.reviewStatus ?? status.reviewStatus ?? status.review?.status);
  const error = [status.readError, status.saveError, status.matchError, status.error, status.errors, status.failed, record?.error]
    .some(hasValue)
    || ERROR_TOKENS.has(processingStatus)
    || ERROR_TOKENS.has(matchStatus);
  const conflict = Boolean(status.conflict || status.conflicts || record?.conflict)
    || CONFLICT_TOKENS.has(processingStatus)
    || CONFLICT_TOKENS.has(matchStatus);
  const done = (Boolean(status.done || record?.done) || processingStatus === 'done')
    && status.saved === true
    && status.outputVerified === true
    && matchStatus === 'matched'
    && reviewStatus === 'reviewed';

  return {
    processingStatus,
    matchStatus,
    reviewStatus,
    dirty: Boolean(dirty),
    error,
    conflict,
    done
  };
}

export function recordMatchesStatusFilter(record, filter, dirty = false) {
  const normalizedFilter = normalizeStatusToken(filter);
  const status = recordStatus(record, dirty);
  if (!normalizedFilter || normalizedFilter === 'all') return !status.done;
  if (normalizedFilter === 'done') return status.done;
  if (normalizedFilter === 'dirty') return !status.done && status.dirty;
  if (normalizedFilter === 'error') return !status.done && status.error;
  if (normalizedFilter === 'conflict') return !status.done && status.conflict;
  return normalizedFilter === status.processingStatus
    || normalizedFilter === status.matchStatus
    || normalizedFilter === status.reviewStatus;
}

