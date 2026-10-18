import { sortRecords } from './sort-records.mjs';
import { recordMatchesStatusFilter } from './record-status.mjs';

export const DEFAULT_SORT = Object.freeze({ column: 'default', direction: 'asc' });
export const DEFAULT_PAGE_SIZE = 50;
export const PAGE_SIZE_OPTIONS = Object.freeze([50, 100, 200]);

export const state = {
  records: [],
  selectedIds: new Set(),
  activeId: null,
  drafts: new Map(),
  artworkOperations: new Map(),
  lyricsById: new Map(),
  batchArtworkOperation: null,
  search: '',
  listFilter: '',
  statusFilter: 'all',
  sort: { ...DEFAULT_SORT },
  currentPage: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  settings: {
    theme: 'light', recursiveImport: true, panelRatio: 0.65, fpcalcPath: '', enableLyricsLookup: true,
    preferSyncedLyrics: true, preserveExistingLyrics: true, exportLrcSidecar: false, requireLyricsReview: true
  },
  outputFolder: '',
  currentJob: null,
  issues: [],
  currentPreview: null,
  isSaving: false,
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
  if (state.drafts.get(fileId) && Object.keys(state.drafts.get(fileId)).length) return true;
  return hasArtworkChange(fileId);
}

export function hasArtworkChange(fileId) {
  const artworkOperation = state.artworkOperations.get(fileId);
  if (!artworkOperation) return false;
  const artwork = getRecord(fileId)?.artwork || [];
  if (artworkOperation.mode === 'remove') return artwork.length > 0;
  if (artworkOperation.mode === 'replace' && artworkOperation.imageHash) {
    return artwork.length !== 1 || artwork[0]?.imageHash !== artworkOperation.imageHash;
  }
  return true;
}

export function setStatusFilter(filter) {
  if (state.statusFilter === filter) return false;
  state.statusFilter = filter;
  state.selectedIds.clear();
  state.activeId = null;
  state.currentPage = 1;
  return true;
}

export function saveSelection() {
  const checkedIds = [...state.selectedIds].filter((fileId) => Boolean(getRecord(fileId)));
  if (checkedIds.length) {
    return { mode: 'batch', fileIds: checkedIds, hasChanges: checkedIds.some((fileId) => isDirty(fileId)) };
  }
  if (state.activeId && getRecord(state.activeId)) {
    return { mode: 'single', fileIds: [state.activeId], hasChanges: isDirty(state.activeId) };
  }
  return { mode: 'none', fileIds: [], hasChanges: false };
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
    if (!recordMatchesStatusFilter(record, state.statusFilter, isDirty(record.fileId))) return false;
    if (!query) return true;
    const metadata = metadataFor(record.fileId);
    return [metadata.title, ...(metadata.artist || []), metadata.album, ...(metadata.genre || []), record.absolutePath]
      .some((value) => String(value || '').toLocaleLowerCase().includes(query));
  });
  return sortRecords(records, state.sort, (record) => metadataFor(record.fileId), (record) => isDirty(record.fileId));
}

export function paginationFor(records = filteredRecords()) {
  const itemCount = records.length;
  const pageSize = PAGE_SIZE_OPTIONS.includes(Number(state.pageSize)) ? Number(state.pageSize) : DEFAULT_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(itemCount / pageSize));
  const currentPage = Math.min(totalPages, Math.max(1, Number.parseInt(state.currentPage, 10) || 1));
  state.pageSize = pageSize;
  state.currentPage = currentPage;
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(itemCount, startIndex + pageSize);
  return { itemCount, pageSize, totalPages, currentPage, startIndex, endIndex };
}

export function pagedRecords(records = filteredRecords()) {
  const page = paginationFor(records);
  return { records: records.slice(page.startIndex, page.endIndex), page };
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
    state.lyricsById.delete(record.fileId);
  }
}
