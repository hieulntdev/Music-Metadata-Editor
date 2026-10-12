const naturalCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base'
});

const STATUS_ORDER = new Map([
  ['ready', 0],
  ['clean', 0],
  ['dirty', 1],
  ['saved', 2],
  ['skipped', 3],
  ['conflict', 4],
  ['error', 5],
  ['failed', 5]
]);

function isEmpty(value) {
  return value === null || value === undefined || value === ''
    || (Array.isArray(value) && value.length === 0);
}

function textValue(value) {
  return Array.isArray(value) ? value.join(' ') : String(value);
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

function statusValue(record) {
  const status = record.status;
  if (typeof status === 'string') return STATUS_ORDER.get(status.toLocaleLowerCase()) ?? 0;
  if (status?.readError || status?.saveError || status?.failed) return STATUS_ORDER.get('error');
  if (status?.conflict) return STATUS_ORDER.get('conflict');
  if (status?.skipped) return STATUS_ORDER.get('skipped');
  if (status?.saved) return STATUS_ORDER.get('saved');
  if (status?.dirty) return STATUS_ORDER.get('dirty');
  return STATUS_ORDER.get('ready');
}

function valueFor(record, metadata, column) {
  switch (column) {
    case 'title': return metadata.title;
    case 'artist': return metadata.artist;
    case 'album': return metadata.album;
    case 'date': return metadata.date;
    case 'genre': return metadata.genre;
    case 'trackNumber': return metadata.trackNumber;
    case 'durationSeconds': return record.durationSeconds;
    case 'fileSize': return record.fileSize;
    case 'modifiedTime': return record.modifiedTimeNs ?? record.modifiedTime;
    case 'status': return statusValue(record);
    case 'path': return record.absolutePath;
    default: return metadata[column] ?? record[column];
  }
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

export function sortRecords(records, sort, getMetadata) {
  if (!sort?.column || !['asc', 'desc'].includes(sort.direction)) return records.slice();
  const direction = sort.direction === 'desc' ? -1 : 1;
  return records
    .map((record, index) => ({ record, index, metadata: getMetadata(record) || {} }))
    .sort((left, right) => {
      const leftValue = valueFor(left.record, left.metadata, sort.column);
      const rightValue = valueFor(right.record, right.metadata, sort.column);
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
