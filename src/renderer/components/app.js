import { DEFAULT_SORT, state, filteredRecords, getRecord, isDirty, metadataFor, replaceRecord, setDraftField } from '../state/app-state.js';
import { MusicTable } from './music-table.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const table = new MusicTable($('#tableViewport'), $('#tableBody'), selectionChanged, activateTrack);
let selectedMatch = null;
let currentRenamePreview = null;
let previewAction = null;
let logRows = 0;
const reportedJobErrors = new Set();
const reportedJobOutputs = new Set();
const reportedProviderErrors = new Set();
const MAX_AUTO_MATCH_TRACKS = 50;
let matchSort = { column: 'matchScore', direction: 'desc' };

function unwrap(response) {
  if (response?.ok) return response.result;
  const error = new Error(response?.error?.message || 'The operation could not be completed.');
  error.code = response?.error?.code || 'INTERNAL_ERROR';
  error.details = response?.error?.details;
  throw error;
}

function toast(message, type = '') {
  const item = document.createElement('div'); item.className = `toast ${type}`; item.textContent = message;
  $('#toastRegion').append(item); setTimeout(() => item.remove(), 4500);
}

function timestamp() { return new Intl.DateTimeFormat([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date()); }

function log(message, type = '') {
  const viewport = $('#logViewport');
  if (logRows === 0) viewport.replaceChildren();
  const row = document.createElement('p');
  const time = document.createElement('span'); time.className = 'muted'; time.textContent = `[${timestamp()}] `;
  const text = document.createElement('span'); text.textContent = message; if (type === 'error') text.style.color = 'var(--status-danger)';
  row.append(time, text); viewport.append(row); logRows += 1;
  while (viewport.children.length > 500) viewport.firstChild.remove();
  viewport.scrollTop = viewport.scrollHeight;
}

function issue(message, code = 'ERROR') {
  state.issues.push({ message, code }); if (state.issues.length > 200) state.issues.shift();
  renderIssues(); log(`${code}: ${message}`, 'error');
}

function renderOutputFolder() {
  const selected = state.outputFolder || '';
  const pathLabel = $('#outputFolderPath');
  pathLabel.textContent = selected || 'Choose where edited copies will be saved…';
  pathLabel.title = selected;
  pathLabel.classList.toggle('selected', Boolean(selected));
  pathLabel.classList.toggle('muted', !selected);
  $('#outputFolderButton').setAttribute('aria-invalid', String(!selected));
  $('#outputFolderError').hidden = Boolean(selected);
}

function requireOutputFolder() {
  if (state.outputFolder) return true;
  renderOutputFolder();
  const message = 'Choose an Output Folder before previewing or saving.';
  issue(message, 'OUTPUT_NOT_SELECTED');
  toast(message, 'error');
  return false;
}

async function chooseOutputFolder() {
  const result = await guarded(async () => unwrap(await window.musicApp.output.pickFolder()));
  if (!result || result.canceled) return;
  state.outputFolder = result.path;
  state.currentPreview = null; currentRenamePreview = null;
  if ($('#previewDialog').open) $('#previewDialog').close();
  renderOutputFolder();
  log(`Output Folder selected: ${result.path}`);
  toast('Output Folder saved.', 'success');
}

function renderIssues() {
  $('#issueBadge').textContent = `(${state.issues.length})`;
  const list = $('#issueList'); list.replaceChildren();
  if (!state.issues.length) { const p = document.createElement('p'); p.className = 'muted'; p.textContent = 'No issues.'; list.append(p); return; }
  for (const entry of state.issues) { const p = document.createElement('p'); p.textContent = `${entry.code}: ${entry.message}`; list.append(p); }
}

async function guarded(action, pendingMessage) {
  try { if (pendingMessage) log(pendingMessage); return await action(); }
  catch (error) { issue(error.message, error.code); toast(error.message, 'error'); return null; }
}

function renderSummary() {
  const dirty = state.records.filter((record) => isDirty(record.fileId)).length;
  const conflicts = state.records.filter((record) => record.status?.conflict).length;
  const errors = state.records.filter((record) => record.status?.readError || record.status?.saveError).length + state.issues.length;
  $('#allCount').textContent = `(${state.records.length.toLocaleString()})`; $('#dirtyCount').textContent = `(${dirty})`;
  $('#conflictCount').textContent = `(${conflicts})`; $('#errorCount').textContent = `(${errors})`;
  $('#batchSelection').textContent = `(${state.selectedIds.size} tracks selected)`;
  $('#matchButtonLabel').textContent = `Auto Match (${state.selectedIds.size})`;
  $('#batchButton').disabled = state.selectedIds.size < 2; $('#matchButton').disabled = state.selectedIds.size < 1;
  $('#artworkButton').disabled = !state.activeId; $('#saveButton').disabled = !state.activeId || !isDirty(state.activeId);
  $('#previewBatch').disabled = state.selectedIds.size < 2; $('#renameButton').disabled = state.selectedIds.size < 1;
  const visible = filteredRecords();
  const selectedVisible = visible.filter((record) => state.selectedIds.has(record.fileId)).length;
  $('#selectAll').checked = visible.length > 0 && selectedVisible === visible.length;
  $('#selectAll').indeterminate = selectedVisible > 0 && selectedVisible < visible.length;
  table.render();
}

function selectionChanged() { renderSummary(); }

function arrayValue(value) { return Array.isArray(value) ? value.join('; ') : String(value || ''); }
function fromField(field, value) { return ['artist', 'albumArtist', 'genre', 'composer'].includes(field) ? value.split(';').map((item) => item.trim()).filter(Boolean) : value; }

function artworkMarkup(target, artwork, staged) {
  target.replaceChildren();
  const url = staged?.previewDataUrl || artwork?.previewDataUrl;
  if (url) { const img = document.createElement('img'); img.src = url; img.alt = 'Embedded album artwork'; target.append(img); }
  else { const text = document.createElement('span'); text.textContent = staged?.mode === 'remove' ? 'Artwork will be removed' : 'No artwork'; target.append(text); }
}

function fillEditor(record) {
  const metadata = metadataFor(record.fileId); $('#editorEmpty').hidden = true; $('#metadataForm').hidden = false; $('#technicalSummary').hidden = false;
  for (const input of $$('#metadataForm [name]')) {
    const field = input.dataset.mirror || input.name.replace(/_copy$/, '');
    if (Object.hasOwn(metadata, field)) input.value = arrayValue(metadata[field]);
  }
  const op = state.artworkOperations.get(record.fileId);
  artworkMarkup($('#artworkPreview'), record.artwork?.[0], op);
  artworkMarkup($('#largeArtwork'), record.artwork?.[0], op);
  const art = record.artwork?.[0];
  $('#artworkDetails').textContent = op?.mode === 'replace' ? `${op.mime}, ${formatBytes(op.bytesSize)} (pending)` : art ? `${art.mime}, ${formatBytes(art.bytesSize)}${art.dimensions?.[0] ? `, ${art.dimensions[0]}×${art.dimensions[1]}` : ''}` : 'No embedded artwork.';
  const fields = [
    ['Format', record.format], ['Codec', record.codec], ['Sample rate', record.sampleRate ? `${record.sampleRate / 1000} kHz` : 'Unknown'],
    ['Bit depth', record.bitDepth ? `${record.bitDepth}-bit` : 'Unknown'], ['Bit rate', record.bitRate ? `${Math.round(record.bitRate / 1000)} kbps` : 'Unknown'],
    ['Channels', record.channels || 'Unknown'], ['Duration', duration(record.durationSeconds)], ['Size', formatBytes(record.fileSize)], ['File', record.absolutePath],
    ['Write support', record.capabilities?.writeTags ? 'Writable' : record.capabilities?.readOnlyReason || 'Read only']
  ];
  const list = $('#technicalList'); list.replaceChildren();
  for (const [name, value] of fields) { const dt = document.createElement('dt'); dt.textContent = name; const dd = document.createElement('dd'); dd.textContent = String(value); list.append(dt, dd); }
  $('#technicalLine').textContent = `${record.format}  |  ${record.sampleRate ? `${record.sampleRate / 1000} kHz` : 'Unknown'}  |  ${record.bitDepth ? `${record.bitDepth}-bit` : 'Unknown'}  |  ${record.channels || '—'} ch  |  ${duration(record.durationSeconds)}`;
  $('#fileLine').textContent = `File: ${record.absolutePath}  •  Size: ${formatBytes(record.fileSize)}`;
  $('#removeArtwork').disabled = !art && op?.mode !== 'replace'; $('#removeArtworkLarge').disabled = $('#removeArtwork').disabled;
  renderSummary();
}

async function activateTrack(fileId) {
  state.activeId = fileId; const existing = getRecord(fileId); if (!existing) return;
  fillEditor(existing);
  if (!existing.artwork?.some((item) => item.previewDataUrl)) {
    const fresh = await guarded(async () => unwrap(await window.musicApp.metadata.get(fileId)), 'Reading full metadata…');
    if (fresh) { replaceRecord(fresh, false); fillEditor(fresh); table.render(); }
  }
}

function formatBytes(bytes) {
  if (!Number(bytes)) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB']; const power = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / (1024 ** power)).toFixed(power ? 1 : 0)} ${units[power]}`;
}

function duration(seconds) { const value = Math.round(Number(seconds) || 0); return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`; }

async function importSelection(type) {
  const result = await guarded(async () => unwrap(await (type === 'files' ? window.musicApp.library.pickFiles() : window.musicApp.library.pickFolder())));
  if (!result || result.canceled) return;
  setLocked(true);
  const scan = await guarded(async () => unwrap(await window.musicApp.library.scan({ paths: result.paths, recursive: state.settings.recursiveImport })), `Scanning ${result.paths.length} selected location(s)…`);
  setLocked(false);
  if (!scan) return;
  for (const record of scan.records) replaceRecord(record);
  for (const error of scan.errors) issue(`${error.path}: ${error.error.message}`, error.error.code);
  log(`Scan complete: ${scan.records.length} read, ${scan.errors.length} failed.`, scan.errors.length ? 'error' : '');
  toast(`Imported ${scan.records.length} track${scan.records.length === 1 ? '' : 's'}.`, 'success'); renderSummary();
}

function setLocked(locked) {
  for (const button of [$('#importFilesButton'), $('#importFolderButton'), $('#saveButton'), $('#previewBatch')]) button.disabled = locked || (button === $('#saveButton') && (!state.activeId || !isDirty(state.activeId)));
  document.body.setAttribute('aria-busy', String(locked));
}

async function stageArtwork() {
  if (!state.activeId) return;
  const result = await guarded(async () => unwrap(await window.musicApp.artwork.pick())); if (!result || result.canceled) return;
  state.artworkOperations.set(state.activeId, { mode: 'replace', ...result }); fillEditor(getRecord(state.activeId)); toast('Artwork staged. Preview & Save to write it.');
}

async function stageBatchArtwork() {
  const result = await guarded(async () => unwrap(await window.musicApp.artwork.pick())); if (!result || result.canceled) return;
  state.batchArtworkOperation = { mode: 'replace', ...result };
  $('#batchArtworkStatus').textContent = `${result.mime}, ${formatBytes(result.bytesSize)} (REPLACE)`;
  $('#batchPanel').open = true; toast(`Artwork replacement staged for ${state.selectedIds.size} selected tracks.`);
}

function removeBatchArtwork() {
  state.batchArtworkOperation = { mode: 'remove' }; $('#batchArtworkStatus').textContent = 'CLEAR (remove embedded artwork)'; $('#batchPanel').open = true;
}

function removeArtwork() { if (!state.activeId) return; state.artworkOperations.set(state.activeId, { mode: 'remove' }); fillEditor(getRecord(state.activeId)); toast('Artwork removal staged.'); }

async function previewMetadata() {
  if (!state.activeId) return;
  if (!requireOutputFolder()) return;
  const preview = await guarded(async () => unwrap(await window.musicApp.metadata.preview({ fileId: state.activeId, patch: state.drafts.get(state.activeId) || {}, artworkOperation: state.artworkOperations.get(state.activeId) || null })), 'Preparing save preview…');
  if (!preview) return; showPreview(preview, 'metadata');
}

function displayValue(value) { if (Array.isArray(value)) return value.join('; ') || '(empty)'; return value === '' || value === null || value === undefined ? '(empty)' : String(value); }

function showPreview(preview, type) {
  state.currentPreview = preview; previewAction = type;
  const list = $('#changeList'); list.replaceChildren();
  const changes = preview.entries.flatMap((entry) => entry.changes.map((change) => ({ ...change, path: entry.path })));
  const warnings = preview.warnings || [];
  $('#previewSummary').textContent = `${preview.affected ?? preview.entries.filter((entry) => entry.changes.length).length} file(s), ${changes.length} change(s)${preview.conflicts ? `, ${preview.conflicts} conflict(s)` : ''}${warnings.length ? ` • ${warnings.join(' ')}` : ''}.`;
  for (const change of changes.slice(0, 500)) {
    const row = document.createElement('div'); row.className = 'change-row';
    for (const [className, value] of [['', change.field], ['before', displayValue(change.before)], ['', '→'], ['after', displayValue(change.after)]]) {
      const cell = document.createElement(className ? 'span' : className === '' && value === change.field ? 'strong' : 'span'); cell.className = className; cell.textContent = value; if (value === change.field) cell.title = change.path; row.append(cell);
    }
    list.append(row);
  }
  if (!changes.length) { const empty = document.createElement('p'); empty.className = 'empty-state'; empty.textContent = 'There are no actual changes to save.'; list.append(empty); }
  $('#confirmSave').disabled = !changes.length || (type === 'metadata' && (Boolean(preview.conflicts) || warnings.length > 0)); $('#previewDialog').showModal();
}

async function confirmPreview() {
  const preview = state.currentPreview; if (!preview) return;
  $('#confirmSave').disabled = true;
  if (previewAction === 'metadata') {
    const result = await guarded(async () => unwrap(await window.musicApp.metadata.save(preview.previewId)), 'Saving metadata…');
    if (result) {
      if (result.sourceRecord) replaceRecord(result.sourceRecord);
      $('#previewDialog').close(); log(`Saved and verified Output copy: ${result.outputPath}`); toast('Output copy saved and verified. Source unchanged.', 'success');
      if (state.activeId) fillEditor(getRecord(state.activeId)); renderSummary();
    }
  } else {
    const job = await guarded(async () => unwrap(await window.musicApp.batch.save(preview.previewId)), 'Starting batch save…');
    if (job) {
      state.currentJob = job; state.batchArtworkOperation = null; $('#batchArtworkStatus').textContent = 'KEEP (no change)';
      $('#previewDialog').close(); updateJob(job);
    }
  }
  $('#confirmSave').disabled = false;
}

function operations() {
  const result = {};
  for (const [field, prefix] of [['artist', 'Artist'], ['album', 'Album'], ['genre', 'Genre'], ['date', 'Date']]) {
    const mode = $(`#batch${prefix}Mode`).value; result[field] = { operation: mode, value: $(`#batch${prefix}Value`).value };
  }
  return result;
}

async function previewBatch() {
  if (!requireOutputFolder()) return;
  const preview = await guarded(async () => unwrap(await window.musicApp.batch.preview({
    fileIds: [...state.selectedIds], operations: operations(), cleanup: $('#cleanupStrings').checked,
    find: $('#findText').value, replace: $('#replaceText').value, sequential: $('#sequentialTracks').checked, startTrack: $('#startTrack').value,
    artworkOperation: state.batchArtworkOperation
  })), 'Preparing batch preview…');
  if (preview) showPreview(preview, 'batch');
}

function updateJob(job) {
  state.currentJob = job; $('#jobBadge').textContent = job.state === 'running' ? '(1)' : '(0)';
  const matching = job.type === 'metadata-match';
  $('#savedLabel').textContent = matching ? 'Matched' : 'Saved';
  $('#skippedLabel').textContent = matching ? 'No Match' : 'Skipped';
  $('#conflictLabel').textContent = matching ? 'Cancelled' : 'Conflict';
  $('#jobTitle').textContent = job.state === 'running' || job.state === 'queued'
    ? matching ? 'Searching metadata…' : job.type === 'batch-save' ? 'Saving metadata…' : 'Working…'
    : job.state[0].toUpperCase() + job.state.slice(1);
  $('#jobBadge').textContent = ['queued', 'running'].includes(job.state) ? '(1)' : '(0)';
  $('#jobProgress').value = job.percent || 0; $('#jobProgressText').textContent = `Processed ${job.processed} / ${job.total} (${job.percent || 0}%)`;
  $('#jobCurrent').textContent = job.currentFile ? `Current file: ${job.currentFile}` : job.state === 'completed' ? 'Operation finished.' : 'No active file.';
  const elapsed = Math.max(0, Math.round(((job.finishedAt || Date.now()) - job.startedAt) / 1000)); $('#jobTiming').textContent = `Elapsed: ${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;
  $('#savedCount').textContent = matching ? job.matched || 0 : job.saved;
  $('#skippedCount').textContent = matching ? job.noMatch || 0 : job.skipped;
  $('#failedCount').textContent = job.failed; $('#jobConflictCount').textContent = matching ? job.cancelled || 0 : job.conflict;
  $('#cancelJob').disabled = !['queued', 'running'].includes(job.state);
  if (matching) syncMatchJob(job);
  if (job.state === 'completed' || job.state === 'canceled') {
    log(matching
      ? `Auto Match ${job.state}: ${job.matched || 0} matched, ${job.noMatch || 0} without a match, ${job.failed || 0} failed, ${job.cancelled || 0} cancelled.`
      : `Batch ${job.state}: ${job.saved} saved, ${job.failed} failed, ${job.conflict} conflict.`);
  }
  if (job.state === 'completed' || job.state === 'canceled') {
    for (const error of job.errors || []) {
      const key = `${job.id}:${error.path}:${error.code}`;
      if (!reportedJobErrors.has(key)) { reportedJobErrors.add(key); issue(`${error.path}: ${error.message}`, error.code); }
    }
  }
  for (const result of Object.values(job.results || {})) {
    if (!result?.outputPath) continue;
    const key = `${job.id}:${result.outputPath}`;
    if (!reportedJobOutputs.has(key)) {
      reportedJobOutputs.add(key);
      log(`Saved and verified Output copy: ${result.outputPath}`);
    }
  }
}

function validateMatchSelection() {
  const count = state.selectedIds.size;
  if (count >= 1 && count <= MAX_AUTO_MATCH_TRACKS) return true;
  const message = count > MAX_AUTO_MATCH_TRACKS
    ? `Auto Match supports at most ${MAX_AUTO_MATCH_TRACKS} tracks. ${count} are currently selected.`
    : 'Select at least one track before starting Auto Match.';
  issue(message, count > MAX_AUTO_MATCH_TRACKS ? 'AUTO_MATCH_LIMIT' : 'INVALID_SELECTION');
  toast(message, 'error');
  return false;
}

function createMatchReview(fileIds) {
  const activeFileId = fileIds.includes(state.activeId) ? state.activeId : fileIds[0];
  state.matchReview = {
    jobId: null, fileIds, activeFileId, job: null, providers: [],
    results: new Map(), selections: new Map(), applied: new Set(),
    statuses: Object.fromEntries(fileIds.map((id) => [id, 'pending']))
  };
  state.activeId = activeFileId;
  selectedMatch = null;
}

async function openMatchReview() {
  if (!validateMatchSelection()) return;
  const selected = [...state.selectedIds];
  const current = state.matchReview;
  const sameSelection = current && current.fileIds.length === selected.length && current.fileIds.every((id) => state.selectedIds.has(id));
  if (current?.job && ['queued', 'running'].includes(current.job.state)) {
    if (!sameSelection) toast('An Auto Match batch is already running. Cancel it in Jobs before starting another.', 'error');
    renderMatchReview();
    if (!$('#matchDialog').open) $('#matchDialog').showModal();
    return;
  }
  if (sameSelection && current.job) {
    renderMatchReview();
    if (!$('#matchDialog').open) $('#matchDialog').showModal();
    return;
  }
  createMatchReview(selected);
  renderMatchReview();
  $('#matchDialog').showModal();
  await startMatchBatch();
}

async function searchMatches() {
  if (!validateMatchSelection()) return;
  if (state.matchReview?.job && ['queued', 'running'].includes(state.matchReview.job.state)) {
    toast('This Auto Match batch is still running. Cancel it in Jobs before retrying.', 'error');
    return;
  }
  createMatchReview([...state.selectedIds]);
  renderMatchReview();
  await startMatchBatch();
}

async function startMatchBatch() {
  const review = state.matchReview;
  if (!review) return;
  $('#searchMatches').disabled = true;
  const job = await guarded(async () => unwrap(await window.musicApp.match.startBatch(review.fileIds)), `Starting Auto Match for ${review.fileIds.length} track(s)…`);
  $('#searchMatches').disabled = false;
  if (!job) return;
  review.jobId = job.id; review.job = job; review.providers = job.providers || [];
  state.currentJob = job;
  for (const provider of review.providers.filter((item) => !item.available)) {
    const key = `${job.id}:provider:${provider.providerId}`;
    if (!reportedProviderErrors.has(key)) {
      reportedProviderErrors.add(key);
      log(`${provider.displayName} unavailable: ${provider.reason}`, 'error');
    }
  }
  updateJob(job);
}

function syncMatchJob(job) {
  const review = state.matchReview;
  if (!review || (review.jobId && review.jobId !== job.id)) return;
  review.jobId = job.id; review.job = job; review.providers = job.providers || review.providers;
  for (const [fileId, status] of Object.entries(job.itemStatuses || {})) review.statuses[fileId] = status;
  for (const [fileId, result] of Object.entries(job.results || {})) {
    review.results.set(fileId, result);
    for (const error of result.providerErrors || []) {
      const key = `${job.id}:${fileId}:${error.providerId}:${error.code}`;
      if (!reportedProviderErrors.has(key)) {
        reportedProviderErrors.add(key);
        issue(`${error.source} failed for ${metadataFor(fileId).title || 'untitled track'}: ${error.message}`, error.code);
      }
    }
  }
  renderMatchReview();
}

function renderProviderStatus() {
  const container = $('#providerStatus'); container.replaceChildren();
  const providers = state.matchReview?.providers || [];
  if (!providers.length) { container.textContent = 'Provider availability will appear when the batch starts.'; return; }
  for (const provider of providers) {
    const chip = document.createElement('span'); chip.className = `provider-chip${provider.available ? '' : ' unavailable'}`;
    chip.textContent = `${provider.displayName}: ${provider.available ? provider.mode === 'fingerprint' ? 'Fingerprint only' : 'Available' : 'Unavailable'}`;
    chip.title = provider.reason || '';
    container.append(chip);
  }
}

function renderMatchReview() {
  const review = state.matchReview;
  if (!review) return;
  const job = review.job;
  $('#matchProgressText').textContent = `Processed ${job?.processed || 0} / ${job?.total || review.fileIds.length}`;
  $('#matchReviewedText').textContent = `Reviewed ${review.selections.size} / ${review.fileIds.length}`;
  renderProviderStatus();
  const tracks = $('#matchTrackList'); tracks.replaceChildren();
  for (const fileId of review.fileIds) {
    const metadata = metadataFor(fileId);
    const button = document.createElement('button'); button.type = 'button'; button.className = `match-track${review.activeFileId === fileId ? ' selected' : ''}`;
    const name = document.createElement('span'); name.className = 'match-track-name'; name.textContent = metadata.title || getRecord(fileId)?.absolutePath?.split(/[\\/]/).pop() || 'Untitled track';
    const status = document.createElement('span'); status.className = 'match-track-status';
    const rawStatus = review.applied.has(fileId) ? 'applied' : review.selections.has(fileId) ? 'reviewed' : review.statuses[fileId] || 'pending';
    status.textContent = ({ pending: 'Pending', searching: 'Searching', matched: 'Matched', 'no-match': 'No Match', failed: 'Failed', cancelled: 'Cancelled', applied: 'Applied', reviewed: 'Reviewed' })[rawStatus] || rawStatus;
    button.append(name, status);
    button.addEventListener('click', () => { review.activeFileId = fileId; state.activeId = fileId; activateTrack(fileId); renderMatchReview(); });
    tracks.append(button);
  }
  renderCandidates();
  $('#applyReviewedMatches').disabled = review.selections.size === 0;
}

function sortedCandidates(candidates) {
  const direction = matchSort.direction === 'asc' ? 1 : -1;
  return [...candidates].sort((left, right) => {
    const a = matchSort.column === 'matchScore' ? Number(left.matchScore) : String(left.source || '');
    const b = matchSort.column === 'matchScore' ? Number(right.matchScore) : String(right.source || '');
    return (typeof a === 'number' ? a - b : a.localeCompare(b, undefined, { sensitivity: 'base' })) * direction;
  });
}

function renderCandidates(emptyMessage) {
  const review = state.matchReview; const list = $('#candidateList'); list.replaceChildren();
  if (!review) return;
  const fileId = review.activeFileId; const result = review.results.get(fileId);
  const candidates = sortedCandidates(result?.candidates || []);
  const chosen = review.selections.get(fileId);
  selectedMatch = chosen?.candidate || null;
  $('#applyMatch').disabled = !chosen;
  if (!candidates.length) {
    const empty = document.createElement('p'); empty.className = 'empty-state';
    const status = review.statuses[fileId];
    empty.textContent = emptyMessage || (['pending', 'searching'].includes(status)
      ? `${status === 'pending' ? 'Waiting to search' : 'Searching providers'}…`
      : status === 'failed' ? 'This track failed. See Issues for details.' : 'No plausible match was found. The draft is unchanged.');
    list.append(empty); renderMatchComparison(); return;
  }
  for (const candidate of candidates) {
    const label = document.createElement('label');
    const isChosen = chosen?.candidate?.sourceId === candidate.sourceId && chosen?.candidate?.source === candidate.source;
    label.className = `candidate${isChosen ? ' selected' : ''}`; label.setAttribute('role', 'row');
    const radio = document.createElement('input'); radio.type = 'radio'; radio.name = `candidate-${fileId}`; radio.checked = isChosen; radio.setAttribute('aria-label', `Select ${candidate.title || 'candidate'} from ${candidate.source}`);
    const selectionCell = document.createElement('span'); selectionCell.className = 'candidate-select'; selectionCell.setAttribute('role', 'cell'); selectionCell.append(radio);
    const values = [
      [candidate.title || '—', ''],
      [(candidate.artist || []).join('; ') || '—', ''],
      [candidate.album || '—', ''],
      [candidate.matchScore ?? '—', 'score'],
      [candidate.source || '—', 'source']
    ];
    label.append(selectionCell);
    for (const [value, className] of values) { const cell = document.createElement('span'); cell.className = className; cell.setAttribute('role', 'cell'); cell.textContent = value; cell.title = String(value); label.append(cell); }
    label.addEventListener('change', () => {
      const fields = new Set(candidateFields(candidate).map(([field]) => field));
      review.selections.set(fileId, { candidate, fields }); selectedMatch = candidate; renderMatchReview();
    });
    list.append(label);
  }
  renderMatchComparison();
}

function candidateFields(candidate) {
  const fields = [];
  const add = (field, label, value) => {
    if (value !== null && value !== undefined && value !== '' && (!Array.isArray(value) || value.length)) fields.push([field, label, value]);
  };
  add('title', 'Title', candidate.title);
  add('artist', 'Artist', candidate.artist);
  add('album', 'Album', candidate.album);
  add('date', 'Date', candidate.releaseDate);
  add('trackNumber', 'Track', candidate.trackNumber === null ? null : String(candidate.trackNumber));
  add('discNumber', 'Disc', candidate.discNumber === null ? null : String(candidate.discNumber));
  add('genre', 'Genre', candidate.genre ? [candidate.genre] : null);
  add('musicBrainzRecordingId', 'Recording ID', candidate.musicBrainzRecordingId);
  add('musicBrainzReleaseId', 'Release ID', candidate.releaseId);
  if (candidate.releaseId && candidate.artworkUrl?.startsWith('https://coverartarchive.org/')) add('artwork', 'Artwork', 'Cover Art Archive');
  return fields;
}

function renderMatchComparison() {
  const review = state.matchReview; const container = $('#matchComparison'); container.replaceChildren();
  const fileId = review?.activeFileId; const selection = fileId ? review.selections.get(fileId) : null;
  if (!selection) { const empty = document.createElement('p'); empty.className = 'empty-state'; empty.textContent = 'Select a candidate to compare current and proposed metadata.'; container.append(empty); return; }
  const header = document.createElement('div'); header.className = 'comparison-header';
  for (const text of ['', 'Field', 'Current', 'Proposed']) { const span = document.createElement('span'); span.textContent = text; header.append(span); }
  container.append(header);
  const current = metadataFor(fileId);
  for (const [field, label, value] of candidateFields(selection.candidate)) {
    const row = document.createElement('div'); row.className = 'comparison-row';
    const check = document.createElement('input'); check.type = 'checkbox'; check.checked = selection.fields.has(field); check.setAttribute('aria-label', `Apply ${label}`);
    check.addEventListener('change', () => check.checked ? selection.fields.add(field) : selection.fields.delete(field));
    const fieldName = document.createElement('span'); fieldName.textContent = label;
    const before = document.createElement('span'); before.className = 'current-value'; before.textContent = field === 'artwork' ? `${getRecord(fileId)?.artwork?.length || 0} embedded image(s)` : displayValue(current[field]); before.title = before.textContent;
    const after = document.createElement('span'); after.textContent = displayValue(value); after.title = after.textContent;
    row.append(check, fieldName, before, after); container.append(row);
  }
}

async function applySelection(fileId, selection) {
  for (const [field, _label, value] of candidateFields(selection.candidate)) {
    if (!selection.fields.has(field) || field === 'artwork') continue;
    setDraftField(fileId, field, value);
  }
  if (selection.fields.has('artwork') && selection.candidate.releaseId) {
    const cover = await guarded(async () => unwrap(await window.musicApp.match.coverUrl(selection.candidate.releaseId)));
    if (cover?.url) {
      const staged = await guarded(async () => unwrap(await window.musicApp.artwork.stageRemote(cover.url)), 'Downloading reviewed Cover Art Archive suggestion…');
      if (staged) state.artworkOperations.set(fileId, { mode: 'replace', ...staged });
    }
  }
  state.matchReview.applied.add(fileId);
}

async function applyMatch() {
  const review = state.matchReview; const fileId = review?.activeFileId; const selection = review?.selections.get(fileId);
  if (!fileId || !selection) return;
  await applySelection(fileId, selection);
  if (state.activeId === fileId) fillEditor(getRecord(fileId));
  renderSummary(); renderMatchReview(); toast('Reviewed metadata applied to this track draft.');
}

async function applyReviewedMatches() {
  const review = state.matchReview; if (!review?.selections.size) return;
  $('#applyReviewedMatches').disabled = true;
  for (const [fileId, selection] of review.selections) await applySelection(fileId, selection);
  if (state.activeId && getRecord(state.activeId)) fillEditor(getRecord(state.activeId));
  renderSummary(); renderMatchReview();
  toast(`Applied ${review.selections.size} reviewed match(es) to drafts. Preview & Save remains required.`, 'success');
}

async function fingerprintMatch() {
  const fileId = state.matchReview?.activeFileId || state.activeId;
  if (!fileId) return;
  const button = $('#fingerprintMatch');
  if (button.disabled) return;
  const originalLabel = button.textContent;
  button.disabled = true; button.setAttribute('aria-busy', 'true'); button.textContent = 'Matching…';
  const loading = document.createElement('p'); loading.className = 'empty-state'; loading.textContent = 'Generating fingerprint and querying AcoustID…';
  $('#candidateList').replaceChildren(loading);
  try {
    const result = await guarded(async () => unwrap(await window.musicApp.match.fingerprint(fileId)), 'Generating Chromaprint fingerprint…');
    if (!result) return;
    const candidates = result.candidates || [];
    if (state.matchReview) {
      const existing = state.matchReview.results.get(fileId) || { fileId, candidates: [], providerErrors: [] };
      const identities = new Set(existing.candidates.map((item) => `${item.source}:${item.sourceId}`));
      for (const candidate of candidates) if (!identities.has(`${candidate.source}:${candidate.sourceId}`)) existing.candidates.push(candidate);
      existing.candidates.sort((left, right) => right.matchScore - left.matchScore);
      state.matchReview.results.set(fileId, existing);
      if (existing.candidates.length) state.matchReview.statuses[fileId] = 'matched';
      renderMatchReview();
    } else renderCandidates('No fingerprint match found. Your metadata draft is unchanged.');
    log(candidates.length ? `Fingerprint lookup returned ${candidates.length} recording candidate(s).` : 'No fingerprint match found.');
  } finally {
    button.disabled = false; button.removeAttribute('aria-busy'); button.textContent = originalLabel;
  }
}

async function generateRename() {
  if (!requireOutputFolder()) return;
  const preview = await guarded(async () => unwrap(await window.musicApp.rename.preview({ fileIds: [...state.selectedIds], template: $('#renameTemplate').value })), 'Generating rename preview…');
  if (!preview) return; currentRenamePreview = preview; const list = $('#renameList'); list.replaceChildren();
  for (const item of preview.entries) {
    const row = document.createElement('div'); row.className = `rename-row${item.collision ? ' conflict' : ''}`;
    const from = document.createElement('span'); from.textContent = item.from.split(/[\\/]/).pop(); const arrow = document.createElement('span'); arrow.textContent = '→'; const to = document.createElement('span'); to.textContent = item.to.split(/[\\/]/).pop(); row.append(from, arrow, to); list.append(row);
  }
  $('#applyRename').disabled = preview.blocked || !preview.entries.some((item) => item.changed);
}

async function applyRename() {
  if (!currentRenamePreview) return;
  const result = await guarded(async () => unwrap(await window.musicApp.rename.apply(currentRenamePreview.previewId)), 'Creating renamed Output copies…');
  if (result) { $('#renameDialog').close(); log(`Created ${result.renamed.length} renamed Output copy/copies.`); toast('Renamed copies created. Sources unchanged.', 'success'); }
}

async function reloadLibrary() {
  const records = await guarded(async () => unwrap(await window.musicApp.library.list())); if (!records) return;
  state.records = records.filter((record) => !state.hiddenRecordIds.has(record.fileId));
  state.selectedIds.clear(); state.activeId = null; $('#metadataForm').hidden = true; $('#editorEmpty').hidden = false; $('#technicalSummary').hidden = true; renderSummary();
}

function applyTheme(theme, persist = true) {
  document.documentElement.dataset.theme = theme; state.settings.theme = theme;
  const actionLabel = theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode';
  $('#themeButton').setAttribute('aria-label', actionLabel); $('#themeButton').title = actionLabel;
  if (persist) window.musicApp.settings.set({ theme }).then((response) => { try { unwrap(response); } catch (error) { issue(error.message, error.code); } });
}

function renderSortHeaders() {
  for (const header of $$('.sort-header')) {
    const active = header.dataset.sort === state.sort.column;
    const direction = active ? state.sort.direction : null;
    header.setAttribute('aria-sort', direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none');
    header.querySelector('.sort-indicator').textContent = direction === 'asc' ? '↑' : direction === 'desc' ? '↓' : '';
  }
}

function resetJobDisplay() {
  $('#jobBadge').textContent = '(0)'; $('#jobTitle').textContent = 'Ready'; $('#jobProgress').value = 0;
  $('#jobProgressText').textContent = '0 / 0 tracks'; $('#jobCurrent').textContent = 'No active operation.'; $('#jobTiming').textContent = '';
  $('#savedLabel').textContent = 'Saved'; $('#skippedLabel').textContent = 'Skipped'; $('#conflictLabel').textContent = 'Conflict';
  $('#savedCount').textContent = '0'; $('#skippedCount').textContent = '0'; $('#failedCount').textContent = '0'; $('#jobConflictCount').textContent = '0';
  $('#cancelJob').disabled = true;
}

function clearLogDisplay() {
  const empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = 'No activity yet.';
  $('#logViewport').replaceChildren(empty); logRows = 0;
}

function resetTransientControls() {
  $('#globalSearch').value = ''; $('#listFilter').value = '';
  $$('.chip').forEach((chip) => chip.classList.toggle('selected', chip.dataset.filter === 'all'));
  $$('.tab').forEach((tab) => tab.classList.toggle('selected', tab.dataset.tab === 'basic'));
  $$('.tab-page').forEach((page) => page.classList.toggle('selected', page.dataset.page === 'basic'));
  $$('.activity-tab').forEach((tab) => tab.classList.toggle('selected', tab.dataset.activity === 'jobs'));
  $$('.activity-page').forEach((page) => page.classList.toggle('selected', page.dataset.activityPage === 'jobs'));
  $('#metadataForm').reset(); $('#metadataForm').hidden = true; $('#editorEmpty').hidden = false; $('#technicalSummary').hidden = true;
  $('#batchPanel').open = false; $('#batchArtworkStatus').textContent = 'KEEP (no change)';
  for (const name of ['Artist', 'Album', 'Genre', 'Date']) {
    $(`#batch${name}Mode`).value = 'KEEP'; $(`#batch${name}Value`).value = ''; $(`#batch${name}Value`).disabled = true;
  }
  $('#cleanupStrings').checked = false; $('#findText').value = ''; $('#replaceText').value = ''; $('#sequentialTracks').checked = false; $('#startTrack').value = '1';
  $('#editorScroll').scrollTop = 0; table.viewport.scrollTop = 0; table.viewport.scrollLeft = 0;
}

function clearSessionDisplay() {
  for (const record of state.records) state.hiddenRecordIds.add(record.fileId);
  state.records = []; state.selectedIds.clear(); state.activeId = null; state.drafts.clear(); state.artworkOperations.clear();
  state.batchArtworkOperation = null; state.search = ''; state.listFilter = ''; state.statusFilter = 'all'; state.sort = { ...DEFAULT_SORT };
  state.issues = []; state.currentPreview = null; state.selectedCandidate = null;
  state.matchReview = null;
  if (!['queued', 'running'].includes(state.currentJob?.state)) state.currentJob = null;
  selectedMatch = null; currentRenamePreview = null; previewAction = null;
  resetTransientControls(); resetJobDisplay(); clearLogDisplay(); renderIssues(); renderSortHeaders(); renderSummary();
  toast('Current session display cleared. Files and saved metadata were not changed.');
}

function applyPanelRatio(ratio) {
  if (window.innerWidth <= 1040) return;
  $('.library-panel').style.flexBasis = `${ratio * 100}%`;
  $('#editorPanel').style.flexBasis = `${(1 - ratio) * 100}%`;
}

function setupSplitter() {
  const splitter = $('#splitter'); const workspace = $('#workspace');
  applyPanelRatio(state.settings.panelRatio);
  let dragging = false;
  splitter.addEventListener('pointerdown', (event) => { dragging = true; splitter.classList.add('dragging'); splitter.setPointerCapture(event.pointerId); });
  splitter.addEventListener('pointermove', (event) => { if (!dragging) return; const box = workspace.getBoundingClientRect(); state.settings.panelRatio = Math.min(.75, Math.max(.45, (event.clientX - box.left) / box.width)); applyPanelRatio(state.settings.panelRatio); });
  splitter.addEventListener('pointerup', () => { dragging = false; splitter.classList.remove('dragging'); window.musicApp.settings.set({ panelRatio: state.settings.panelRatio }); });
  splitter.addEventListener('keydown', (event) => { if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return; event.preventDefault(); state.settings.panelRatio += event.key === 'ArrowRight' ? .02 : -.02; state.settings.panelRatio = Math.min(.75, Math.max(.45, state.settings.panelRatio)); applyPanelRatio(state.settings.panelRatio); window.musicApp.settings.set({ panelRatio: state.settings.panelRatio }); });
}

function bindEvents() {
  $('#importFilesButton').addEventListener('click', () => importSelection('files')); $('#importFolderButton').addEventListener('click', () => importSelection('folder'));
  $('#clearButton').addEventListener('click', clearSessionDisplay);
  $('#globalSearch').addEventListener('input', (event) => { state.search = event.target.value; table.render(); }); $('#listFilter').addEventListener('input', (event) => { state.listFilter = event.target.value; table.render(); });
  $('#filterChips').addEventListener('click', (event) => { const chip = event.target.closest('.chip'); if (!chip) return; $$('.chip').forEach((item) => item.classList.remove('selected')); chip.classList.add('selected'); state.statusFilter = chip.dataset.filter; table.render(); });
  $$('.sort-header').forEach((button) => button.addEventListener('click', (event) => {
    if (event.target.closest('.column-resizer')) return;
    const column = button.dataset.sort;
    state.sort = { column, direction: state.sort.column === column && state.sort.direction === 'asc' ? 'desc' : 'asc' };
    renderSortHeaders(); table.render();
  }));
  $('#selectAll').addEventListener('change', (event) => { filteredRecords().forEach((record) => event.target.checked ? state.selectedIds.add(record.fileId) : state.selectedIds.delete(record.fileId)); renderSummary(); });
  $('#themeButton').addEventListener('click', () => applyTheme(state.settings.theme === 'light' ? 'dark' : 'light'));
  $('#outputFolderButton').addEventListener('click', chooseOutputFolder);
  $('#settingsButton').addEventListener('click', () => { $('#recursiveSetting').checked = state.settings.recursiveImport; $('#acoustIdKey').value = ''; $('#discogsToken').value = ''; $('#fpcalcPath').value = state.settings.fpcalcPath || ''; $('#settingsDialog').showModal(); });
  $('#saveSettings').addEventListener('click', saveSettings); $('#saveButton').addEventListener('click', previewMetadata);
  $('#artworkButton').addEventListener('click', () => state.selectedIds.size > 1 ? stageBatchArtwork() : stageArtwork()); $('#replaceArtwork').addEventListener('click', stageArtwork); $('#replaceArtworkLarge').addEventListener('click', stageArtwork); $('#removeArtwork').addEventListener('click', removeArtwork); $('#removeArtworkLarge').addEventListener('click', removeArtwork);
  $('#batchButton').addEventListener('click', () => { $('#batchPanel').open = true; $('#batchPanel').scrollIntoView({ block: 'nearest' }); });
  ['Artist', 'Album', 'Genre', 'Date'].forEach((name) => $(`#batch${name}Mode`).addEventListener('change', (event) => { const input = $(`#batch${name}Value`); input.disabled = event.target.value !== 'REPLACE'; input.placeholder = event.target.value === 'CLEAR' ? '(will clear field)' : ''; }));
  $('#batchArtworkReplace').addEventListener('click', stageBatchArtwork); $('#batchArtworkRemove').addEventListener('click', removeBatchArtwork);
  $('#previewBatch').addEventListener('click', previewBatch); $('#confirmSave').addEventListener('click', confirmPreview);
  $('#cancelJob').addEventListener('click', async () => { if (state.currentJob) await guarded(async () => unwrap(await window.musicApp.jobs.cancel(state.currentJob.id))); });
  $('#matchButton').addEventListener('click', openMatchReview); $('#searchMatches').addEventListener('click', searchMatches); $('#fingerprintMatch').addEventListener('click', fingerprintMatch); $('#applyMatch').addEventListener('click', applyMatch); $('#applyReviewedMatches').addEventListener('click', applyReviewedMatches);
  $$('.match-sort').forEach((button) => button.addEventListener('click', () => {
    const column = button.dataset.matchSort;
    matchSort = { column, direction: matchSort.column === column && matchSort.direction === 'desc' ? 'asc' : 'desc' };
    for (const item of $$('.match-sort')) {
      const active = item.dataset.matchSort === column;
      item.querySelector('span').textContent = active ? matchSort.direction === 'asc' ? '↑' : '↓' : '';
      item.setAttribute('aria-sort', active ? matchSort.direction === 'asc' ? 'ascending' : 'descending' : 'none');
    }
    renderCandidates();
  }));
  $('#matchDialog').addEventListener('close', () => {
    if (state.matchReview?.job && ['queued', 'running'].includes(state.matchReview.job.state)) log('Metadata Match Review closed; Auto Match continues in Jobs and can be cancelled there.');
  });
  $('#renameButton').addEventListener('click', () => $('#renameDialog').showModal()); $('#generateRename').addEventListener('click', generateRename); $('#applyRename').addEventListener('click', applyRename);
  $('#revealButton').addEventListener('click', () => state.activeId && window.musicApp.system.openPath(state.activeId));
  $('#copyTechnical').addEventListener('click', async () => { try { await navigator.clipboard.writeText(`${$('#technicalLine').textContent}\n${$('#fileLine').textContent}`); toast('Technical information copied.'); } catch { toast('Clipboard access is unavailable.', 'error'); } });
  $('#clearLogs').addEventListener('click', () => { clearLogDisplay(); toast('Activity log cleared.'); });
  $('#collapseActivity').addEventListener('click', () => $('#activityPanel').classList.toggle('collapsed'));
  $$('.activity-tab').forEach((button) => button.addEventListener('click', () => { $$('.activity-tab').forEach((item) => item.classList.toggle('selected', item === button)); $$('.activity-page').forEach((page) => page.classList.toggle('selected', page.dataset.activityPage === button.dataset.activity)); }));
  $$('.tab').forEach((button) => button.addEventListener('click', () => {
    $$('.tab').forEach((item) => item.classList.toggle('selected', item === button));
    $$('.tab-page').forEach((page) => page.classList.toggle('selected', page.dataset.page === button.dataset.tab));
    $('#editorScroll').scrollTop = 0;
  }));
  $('#metadataForm').addEventListener('input', (event) => {
    const input = event.target.closest('[name]'); if (!input || !state.activeId) return;
    const field = input.dataset.mirror || input.name.replace(/_copy$/, ''); setDraftField(state.activeId, field, fromField(field, input.value));
    for (const mirror of $$(`[data-mirror="${field}"], [name="${field}"]`)) if (mirror !== input) mirror.value = input.value;
    renderSummary();
  });
  setupSplitter();
}

async function saveSettings() {
  const patch = { recursiveImport: $('#recursiveSetting').checked, fpcalcPath: $('#fpcalcPath').value };
  if ($('#acoustIdKey').value) patch.acoustIdApiKey = $('#acoustIdKey').value;
  if ($('#discogsToken').value) patch.discogsToken = $('#discogsToken').value;
  const settings = await guarded(async () => unwrap(await window.musicApp.settings.set(patch))); if (!settings) return;
  state.settings = { ...state.settings, ...settings }; $('#settingsDialog').close(); toast('Settings saved.', 'success');
}

async function initialize() {
  bindEvents(); renderSortHeaders(); renderIssues(); renderOutputFolder();
  const status = await guarded(async () => unwrap(await window.musicApp.app.status()));
  if (status) { state.settings = status.settings; state.outputFolder = status.outputFolder || ''; renderOutputFolder(); applyTheme(status.settings.theme, false); applyPanelRatio(status.settings.panelRatio); if (!status.worker.ready && status.worker.code) issue(status.worker.message, status.worker.code); else log(status.worker.message); }
  await reloadLibrary();
  window.musicApp.jobs.onProgress(updateJob);
  window.musicApp.library.onRecordUpdated((record) => { replaceRecord(record, true, false); renderSummary(); if (state.activeId === record.fileId && getRecord(record.fileId)) fillEditor(record); });
  window.musicApp.library.onRefresh(reloadLibrary);
  window.musicApp.events.onWorkerStatus((workerStatus) => { if (workerStatus.ready) log(workerStatus.message); else issue(workerStatus.message, workerStatus.code || 'WORKER_UNAVAILABLE'); });
  window.musicApp.events.onWorkerEvent((event) => { if (event.event === 'scan-progress') { $('#jobTitle').textContent = 'Scanning library…'; $('#jobProgress').value = event.total ? event.processed / event.total * 100 : 0; $('#jobProgressText').textContent = `${event.processed} / ${event.total} tracks`; $('#jobCurrent').textContent = event.path; } });
  window.musicApp.events.onDiagnostic((entry) => { if (entry.message) log(entry.message); });
}

initialize();
