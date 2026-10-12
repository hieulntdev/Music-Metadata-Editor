import { sortRecords } from './sort-records.mjs';

export const DEFAULT_SORT = Object.freeze({ column: 'artist', direction: 'asc' });

export const state = {
  records: [],
  selectedIds: new Set(),
  activeId: null,
  drafts: new Map(),
  artworkOperations: new Map(),
  batchArtworkOperation: null,
  search: '',
  listFilter: '',
  statusFilter: 'all',
  sort: { ...DEFAULT_SORT },
  settings: { theme: 'light', recursiveImport: true, panelRatio: 0.65, fpcalcPath: '' },
  outputFolder: '',
  currentJob: null,
  issues: [],
  currentPreview: null,
  selectedCandidate: null,
  matchReview: null,
  hiddenRecordIds: new Set()
};

export function getRecord(fileId) { return state.records.find((record) => record.fileId === fileId); }

export function metadataFor(fileId) {
  const record = getRecord(fileId);
  return { ...(record?.metadata || {}), ...(state.drafts.get(fileId) || {}) };
}

export function isDirty(fileId) {
  return Boolean(state.drafts.get(fileId) && Object.keys(state.drafts.get(fileId)).length) || state.artworkOperations.has(fileId);
}

export function setDraftField(fileId, field, value) {
  const record = getRecord(fileId);
  if (!record) return;
  const draft = { ...(state.drafts.get(fileId) || {}) };
  const originalMetadata = record.metadata && typeof record.metadata === 'object' ? record.metadata : {};
  const original = originalMetadata[field];
  if (JSON.stringify(original) === JSON.stringify(value)) delete draft[field];
  else draft[field] = value;
  if (Object.keys(draft).length) state.drafts.set(fileId, draft);
  else state.drafts.delete(fileId);
}

export function filteredRecords() {
  const query = `${state.search} ${state.listFilter}`.trim().toLocaleLowerCase();
  const records = state.records.filter((record) => {
    const status = record.status || {};
    if (state.statusFilter === 'dirty' && !isDirty(record.fileId)) return false;
    if (state.statusFilter === 'conflict' && !status.conflict) return false;
    if (state.statusFilter === 'error' && !status.readError && !status.saveError) return false;
    if (!query) return true;
    const metadata = metadataFor(record.fileId);
    return [metadata.title, ...(metadata.artist || []), metadata.album, ...(metadata.genre || []), record.absolutePath]
      .some((value) => String(value || '').toLocaleLowerCase().includes(query));
  });
  return sortRecords(records, state.sort, (record) => metadataFor(record.fileId));
}

export function replaceRecord(record, clearDraft = true, reveal = true) {
  if (reveal) state.hiddenRecordIds.delete(record.fileId);
  if (state.hiddenRecordIds.has(record.fileId)) return;
  const index = state.records.findIndex((item) => item.fileId === record.fileId);
  if (index >= 0) state.records.splice(index, 1, record);
  else state.records.push(record);
  if (clearDraft) {
    state.drafts.delete(record.fileId);
    state.artworkOperations.delete(record.fileId);
  }
}
