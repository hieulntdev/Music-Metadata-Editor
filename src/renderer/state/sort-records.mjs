import { recordStatus } from './record-status.mjs';

const naturalCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base'
});

const STATUS_ORDER = new Map([
  ['ready', 0],
  ['clean', 0],
  ['dirty', 1],
  ['matched', 2],
  ['reviewed', 3],
  ['applied', 3],
  ['saved', 4],
  ['done', 5],
  ['skipped', 6],
  ['no-match', 6],
  ['conflict', 7],
  ['error', 8],
  ['failed', 8]
]);

function isEmpty(value) {
  return value === null || value === undefined || value === ''
    || (Array.isArray(value) && value.length === 0);
}

function textValue(value) {
  return Array.isArray(value) ? value.join(' ') : String(value);
}

export function filenameFor(record) {
  const parts = String(record?.absolutePath || '').split(/[\\/]/);
  return parts[parts.length - 1] || '';
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function dateValue(value) {
  const text = String(value).trim();
  if (/^\d{4}$/.test(text)) return Date.UTC(Number(text), 0, 1);
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function statusValue(record, dirty) {
  const normalized = recordStatus(record, dirty);
  const status = record?.status && typeof record.status === 'object' ? record.status : {};
  if (normalized.error) return STATUS_ORDER.get('error');
  if (normalized.conflict) return STATUS_ORDER.get('conflict');
  if (status.skipped) return STATUS_ORDER.get('skipped');
  if (status.saved) return STATUS_ORDER.get('saved');
  if (normalized.dirty) return STATUS_ORDER.get('dirty');
  if (normalized.reviewStatus) return STATUS_ORDER.get(normalized.reviewStatus) ?? 0;
  if (normalized.matchStatus) return STATUS_ORDER.get(normalized.matchStatus) ?? 0;
  if (normalized.processingStatus) return STATUS_ORDER.get(normalized.processingStatus) ?? 0;
  return STATUS_ORDER.get('ready');
}

function valueFor(record, metadata, column, dirty) {
  switch (column) {
    case 'filename': return filenameFor(record);
    case 'title': return metadata.title;
    case 'artist': return metadata.artist;
    case 'album': return metadata.album;
    case 'date': return metadata.date;
    case 'genre': return metadata.genre;
    case 'trackNumber': return metadata.trackNumber;
    case 'durationSeconds': return record.durationSeconds;
    case 'completed': return recordStatus(record, dirty).done ? 1 : 0;
    case 'fileSize': return record.fileSize;
    case 'modifiedTime': return record.modifiedTimeNs ?? record.modifiedTime;
    case 'status': return statusValue(record, dirty);
    case 'path': return record.absolutePath;
    default: return metadata[column] ?? record[column];
  }
}

function compareDefault(left, right) {
  const leftTitle = String(left.metadata.title || '').trim();
  const rightTitle = String(right.metadata.title || '').trim();
  const leftUntitled = !leftTitle;
  const rightUntitled = !rightTitle;
  if (leftUntitled !== rightUntitled) return leftUntitled ? -1 : 1;

  if (leftUntitled) {
    const leftDuration = Number(left.record.durationSeconds);
    const rightDuration = Number(right.record.durationSeconds);
    const leftValid = Number.isFinite(leftDuration) && leftDuration > 0;
    const rightValid = Number.isFinite(rightDuration) && rightDuration > 0;
    if (leftValid !== rightValid) return leftValid ? -1 : 1;
    if (leftValid && leftDuration !== rightDuration) return leftDuration - rightDuration;
  } else {
    const titleComparison = naturalCollator.compare(leftTitle, rightTitle);
    if (titleComparison) return titleComparison;
  }

  const filenameComparison = naturalCollator.compare(filenameFor(left.record), filenameFor(right.record));
  return filenameComparison || left.index - right.index;
}

function comparePresentValues(left, right, column) {
  if (['trackNumber', 'durationSeconds', 'fileSize', 'modifiedTime', 'status'].includes(column)) {
    const leftNumber = numberValue(left);
    const rightNumber = numberValue(right);
    if (leftNumber !== null && rightNumber !== null) return leftNumber - rightNumber;
  }
  if (column === 'date') {
    const leftDate = dateValue(left);
    const rightDate = dateValue(right);
    if (leftDate !== null && rightDate !== null) return leftDate - rightDate;
  }
  return naturalCollator.compare(textValue(left), textValue(right));
}

export function sortRecords(records, sort, getMetadata, getDirty = () => false) {
  if (!sort?.column || !['asc', 'desc'].includes(sort.direction)) return records.slice();
  const direction = sort.direction === 'desc' ? -1 : 1;
  return records
    .map((record, index) => ({ record, index, metadata: getMetadata(record) || {} }))
    .sort((left, right) => {
      if (sort.column === 'default') return compareDefault(left, right);
      const leftValue = valueFor(left.record, left.metadata, sort.column, getDirty(left.record));
      const rightValue = valueFor(right.record, right.metadata, sort.column, getDirty(right.record));
      const leftEmpty = isEmpty(leftValue);
      const rightEmpty = isEmpty(rightValue);
      if (leftEmpty || rightEmpty) {
        if (leftEmpty && rightEmpty) return left.index - right.index;
        return leftEmpty ? 1 : -1;
      }
      const comparison = comparePresentValues(leftValue, rightValue, sort.column);
      return comparison === 0 ? left.index - right.index : comparison * direction;
    })
    .map(({ record }) => record);
}
