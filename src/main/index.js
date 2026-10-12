'use strict';

const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { PythonBridge } = require('./workers/python-bridge');
const { JobManager } = require('./jobs/job-manager');
const { MusicBrainzService, candidatesFromAcoustId } = require('./services/musicbrainz.service');
const { MetadataMatchService, normalizeCandidate, calculateMatchScore } = require('./services/metadata-match.service');
const { validateTemplate } = require('./services/rename.service');
const { OutputFolderSession, planOutputEntries, validateOutputFolder } = require('./services/output.service');
const { AUDIO_EXTENSIONS, MAX_ARTWORK_BYTES, AUTO_MATCH_CONCURRENCY } = require('../shared/constants');
const { AppError, object, string, stringArray, fileIds, autoMatchFileIds, metadataPatch, batchOperations, publicError } = require('../shared/schemas');

const appRoot = path.resolve(__dirname, '..', '..');
const library = new Map();
const importedRoots = new Set();
const stagedArtwork = new Map();
const previews = new Map();
const outputFolderSession = new OutputFolderSession();
const jobs = new JobManager();
const musicBrainz = new MusicBrainzService();
const metadataMatcher = new MetadataMatchService({ musicBrainz, getSettings: readSettings });
let worker;
let mainWindow;
let workerStatus = { ready: false, message: 'Starting metadata worker…' };

function settingsPath() { return path.join(app.getPath('userData'), 'settings.json'); }
function defaults() { return { theme: 'light', recursiveImport: true, panelRatio: 0.65, acoustIdApiKey: '', discogsToken: '', fpcalcPath: '' }; }

function readSettings() {
  try {
    const { outputFolder: _legacyOutputFolder, ...persisted } = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    return { ...defaults(), ...persisted };
  } catch { return defaults(); }
}

function writeSettings(patch) {
  const current = readSettings();
  const allowed = {};
  if (patch.theme === 'light' || patch.theme === 'dark') allowed.theme = patch.theme;
  if (typeof patch.recursiveImport === 'boolean') allowed.recursiveImport = patch.recursiveImport;
  if (Number.isFinite(patch.panelRatio)) allowed.panelRatio = Math.min(0.75, Math.max(0.45, patch.panelRatio));
  if (typeof patch.acoustIdApiKey === 'string' && patch.acoustIdApiKey.length <= 200) allowed.acoustIdApiKey = patch.acoustIdApiKey.trim();
  if (typeof patch.discogsToken === 'string' && patch.discogsToken.length <= 500) allowed.discogsToken = patch.discogsToken.trim();
  if (Object.hasOwn(patch, 'fpcalcPath')) allowed.fpcalcPath = string(patch.fpcalcPath, 'fpcalcPath', { max: 4096 }).trim();
  const next = { ...current, ...allowed };
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2), { mode: 0o600 });
  try { fs.chmodSync(settingsPath(), 0o600); } catch { /* Windows permissions differ */ }
  return {
    ...next,
    acoustIdApiKey: next.acoustIdApiKey ? '••••••••' : '',
    discogsToken: next.discogsToken ? '••••••••' : ''
  };
}

function safeSettings() {
  const current = readSettings();
  return {
    ...current,
    acoustIdApiKey: current.acoustIdApiKey ? '••••••••' : '',
    discogsToken: current.discogsToken ? '••••••••' : ''
  };
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function createWindow() {
  const theme = readSettings().theme;
  mainWindow = new BrowserWindow({
    width: 1180, height: 780, minWidth: 900, minHeight: 650, show: false,
    backgroundColor: theme === 'dark' ? '#1d1d1f' : '#f5f5f7',
    title: 'Music Metadata Editor', autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(appRoot, 'src', 'preload', 'index.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      devTools: !app.isPackaged
    }
  });
  mainWindow.removeMenu();
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('did-fail-load', (_event, code, description) => {
    console.error(`Renderer failed to load (${code}): ${description}`);
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error(`Renderer process stopped: ${details.reason}`);
  });
  mainWindow.webContents.on('console-message', (_event, details) => {
    if (details.level === 'error') console.error(`Renderer: ${details.message}`);
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL()) event.preventDefault();
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.once('did-finish-load', () => {
    if (!mainWindow.isVisible()) mainWindow.show();
    if (process.env.MUSIC_METADATA_SMOKE === '1') {
      setTimeout(() => runLayoutSmokeTest().catch((error) => {
        console.error(`LAYOUT_SMOKE_ERROR ${error.stack || error.message}`);
        app.exit(1);
      }), 500);
    }
  });
  mainWindow.loadFile(path.join(appRoot, 'src', 'renderer', 'index.html'));
}

async function runLayoutSmokeTest() {
  await mainWindow.webContents.executeJavaScript(`(async () => {
    const { state } = await import('./state/app-state.js');
    state.records = [{
      fileId: 'layout-smoke-track', absolutePath: '/synthetic/layout-smoke.flac', format: 'FLAC', codec: 'FLAC',
      sampleRate: 44100, bitDepth: 24, bitRate: 900000, channels: 2, durationSeconds: 245, fileSize: 32000000,
      metadata: {
        title: 'Layout smoke track', artist: ['Test artist'], album: 'Test album', albumArtist: ['Test artist'],
        genre: ['Alternative'], date: '2026', trackNumber: '1', trackTotal: '12', discNumber: '1', discTotal: '1',
        comment: 'Editor scrolling test', composer: ['Test composer'], lyrics: 'A long lyrics field used to exercise the metadata editor scroll region.',
        musicBrainzRecordingId: 'recording-id', musicBrainzReleaseId: 'release-id'
      },
      artwork: [{ mime: 'image/gif', bytesSize: 43, dimensions: [1, 1], previewDataUrl: 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=' }],
      capabilities: { writeTags: true }, status: {}
    }];
    const search = document.getElementById('globalSearch');
    search.value = '';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    document.querySelector('.table-row')?.click();
    document.getElementById('batchPanel').open = true;
    for (const id of ['savedCount', 'skippedCount', 'failedCount', 'jobConflictCount']) document.getElementById(id).textContent = '123456';
  })()`);
  const results = [];
  for (const [width, height] of [[1620, 928], [1440, 900], [1180, 780], [900, 650]]) {
    mainWindow.setSize(width, height);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const layout = await mainWindow.webContents.executeJavaScript(`(async () => {
      const ids = ['importFilesButton', 'saveButton', 'tableViewport', 'editorPanel', 'activityPanel'];
      const boxes = Object.fromEntries(ids.map((id) => {
        const box = document.getElementById(id).getBoundingClientRect();
        return [id, { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height }];
      }));
      const counters = [...document.querySelectorAll('.result-counters > div')].map((element) => {
        const box = element.getBoundingClientRect();
        return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
      });
      const overlaps = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5
        && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
      const counterOverlap = counters.some((box, index) => counters.slice(index + 1).some((other) => overlaps(box, other)));
      const editor = document.getElementById('editorPanel');
      const editorScroll = document.getElementById('editorScroll');
      const tabs = document.getElementById('editorTabs');
      const tabScroll = [];
      for (const button of document.querySelectorAll('.tab')) {
        button.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
        editorScroll.scrollTop = editorScroll.scrollHeight;
        await new Promise((resolve) => setTimeout(resolve, 0));
        const maxScroll = Math.max(0, editorScroll.scrollHeight - editorScroll.clientHeight);
        const scrollBox = editorScroll.getBoundingClientRect();
        const lastBox = document.getElementById('batchPanel').getBoundingClientRect();
        tabScroll.push({
          tab: button.dataset.tab,
          clientHeight: editorScroll.clientHeight,
          scrollHeight: editorScroll.scrollHeight,
          reachesEnd: Math.abs(editorScroll.scrollTop - maxScroll) <= 1,
          lastControlVisible: maxScroll === 0 || lastBox.bottom <= scrollBox.bottom + 1
        });
      }
      const editorBox = editor.getBoundingClientRect();
      const tabsBox = tabs.getBoundingClientRect();
      const scrollBox = editorScroll.getBoundingClientRect();
      return {
        viewport: [innerWidth, innerHeight],
        scroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        zeroSizedCriticalRegion: Object.values(boxes).some((box) => box.width < 1 || box.height < 1),
        outOfHorizontalBounds: Object.values(boxes).some((box) => box.left < -1 || box.right > innerWidth + 1),
        overlappingCriticalRegions: boxes.activityPanel.top < boxes.editorPanel.bottom - 1 && boxes.activityPanel.bottom > boxes.editorPanel.top + 1,
        counterOverlap,
        editorTabsPinned: tabsBox.top >= editorBox.top - 1 && tabsBox.bottom <= scrollBox.top + 1,
        removedUiAbsent: !document.getElementById('librarySummary') && !document.getElementById('standardDensity')
          && !document.getElementById('compactDensity') && !document.querySelector('.status-cell'),
        tabScroll,
        boxes
      };
    })()`);
    const image = await mainWindow.webContents.capturePage();
    const screenshotPath = path.join(app.getPath('temp'), `music-metadata-layout-${width}x${height}.png`);
    fs.writeFileSync(screenshotPath, image.toPNG());
    results.push({ requested: [width, height], ...layout, screenshotPath });
  }
  // Exercise modal layout at the minimum supported window size after the wide-layout passes above.
  mainWindow.setSize(900, 650);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const interactions = await mainWindow.webContents.executeJavaScript(`(async () => {
    const root = document.documentElement;
    const themeButton = document.getElementById('themeButton');
    const originalTheme = root.dataset.theme;
    const glyphMatches = (theme) => {
      const sunVisible = getComputedStyle(document.querySelector('.sun-icon')).display !== 'none';
      const moonVisible = getComputedStyle(document.querySelector('.moon-icon')).display !== 'none';
      return theme === 'dark' ? sunVisible && !moonVisible : moonVisible && !sunVisible;
    };
    themeButton.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const switchedTheme = root.dataset.theme !== originalTheme && glyphMatches(root.dataset.theme);
    themeButton.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const restoredTheme = root.dataset.theme === originalTheme && glyphMatches(originalTheme);

    const viewport = document.getElementById('tableViewport');
    const originalTitleWidth = viewport.style.getPropertyValue('--column-title');
    const originalContentWidth = viewport.style.getPropertyValue('--table-content-width');
    viewport.style.setProperty('--column-title', '1200px');
    viewport.style.setProperty('--table-content-width', '1769px');
    await new Promise((resolve) => setTimeout(resolve, 0));
    viewport.scrollLeft = viewport.scrollWidth;
    await new Promise((resolve) => setTimeout(resolve, 0));
    const viewportBox = viewport.getBoundingClientRect();
    const finalColumnBox = document.querySelector('.table-header .duration-cell').getBoundingClientRect();
    const headerBox = document.querySelector('.table-header').getBoundingClientRect();
    const rowBox = document.querySelector('.table-row').getBoundingClientRect();
    const horizontalGrid = {
      hasScrollRange: viewport.scrollWidth > viewport.clientWidth,
      reachesFinalColumn: finalColumnBox.left >= viewportBox.left - 1 && finalColumnBox.right <= viewportBox.right + 1,
      rowCoversHeader: Math.abs(rowBox.width - headerBox.width) <= 1
    };
    if (originalTitleWidth) viewport.style.setProperty('--column-title', originalTitleWidth); else viewport.style.removeProperty('--column-title');
    if (originalContentWidth) viewport.style.setProperty('--table-content-width', originalContentWidth); else viewport.style.removeProperty('--table-content-width');
    viewport.scrollLeft = 0;

    const matchDialog = document.getElementById('matchDialog');
    const { state } = await import('./state/app-state.js');
    const longAlbum = 'A deliberately long album title used to verify that candidate metadata stays inside its own column and is truncated with an ellipsis';
    const primaryCandidate = {
      sourceId: 'smoke-primary', source: 'MusicBrainz', title: 'Layout smoke track', artist: ['Test artist'], album: longAlbum,
      matchScore: 99, releaseDate: '2026', trackNumber: 1, discNumber: 1, genre: 'Alternative',
      musicBrainzRecordingId: 'recording-id', releaseId: null, artworkUrl: null
    };
    const alternateCandidate = {
      sourceId: 'smoke-alternate', source: 'Deezer', title: 'Alternate smoke title', artist: ['Another artist'], album: null,
      matchScore: 85, releaseDate: null, trackNumber: null, discNumber: null, genre: null,
      musicBrainzRecordingId: null, releaseId: null, artworkUrl: null
    };
    state.selectedIds.clear(); state.selectedIds.add('layout-smoke-track');
    state.matchReview = {
      jobId: 'layout-smoke-job', fileIds: ['layout-smoke-track'], activeFileId: 'layout-smoke-track',
      job: { id: 'layout-smoke-job', state: 'completed', processed: 1, total: 1 },
      providers: [{ providerId: 'musicbrainz', displayName: 'MusicBrainz', available: true, mode: 'text' }],
      results: new Map([['layout-smoke-track', { fileId: 'layout-smoke-track', candidates: [primaryCandidate], providerErrors: [] }]]),
      selections: new Map([['layout-smoke-track', { candidate: primaryCandidate, fields: new Set(['title', 'artist', 'album']) }]]),
      applied: new Set(), statuses: { 'layout-smoke-track': 'matched' }
    };
    document.getElementById('matchButton').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const singleCandidateRendered = matchDialog.querySelectorAll('.candidate').length === 1;
    state.matchReview.results.get('layout-smoke-track').candidates.push(alternateCandidate);
    const scoreSort = matchDialog.querySelector('[data-match-sort="matchScore"]');
    scoreSort.click(); scoreSort.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const matchBox = matchDialog.getBoundingClientRect();
    const candidateTable = matchDialog.querySelector('.candidate-table');
    const headings = [...matchDialog.querySelectorAll('.candidate-header > *')].map((item) => item.textContent.trim().split(/\\s+/)[0]);
    const candidateRows = [...matchDialog.querySelectorAll('.candidate')];
    const headerCells = [...matchDialog.querySelectorAll('.candidate-header > *')];
    const firstCells = [...candidateRows[0].querySelectorAll(':scope > [role="cell"]')];
    const columnAligned = firstCells.every((cell, index) => {
      const cellBox = cell.getBoundingClientRect(); const headingBox = headerCells[index].getBoundingClientRect();
      return Math.abs(cellBox.left - headingBox.left) <= 1 && Math.abs(cellBox.right - headingBox.right) <= 1;
    });
    const candidateRadios = candidateRows.map((row) => row.querySelector('input[type="radio"]'));
    const radioIsBounded = candidateRadios.every((radio) => {
      const radioBox = radio.getBoundingClientRect(); const cellBox = radio.closest('.candidate-select').getBoundingClientRect();
      return radioBox.width <= 18 && radioBox.height <= 18 && radioBox.left >= cellBox.left && radioBox.right <= cellBox.right
        && radioBox.top >= cellBox.top && radioBox.bottom <= cellBox.bottom;
    });
    const radioDoesNotOverlapData = candidateRows.every((row) => {
      const radioBox = row.querySelector('input[type="radio"]').getBoundingClientRect();
      return [...row.querySelectorAll(':scope > [role="cell"]:not(.candidate-select)')].every((cell) => {
        const box = cell.getBoundingClientRect();
        return Math.min(radioBox.right, box.right) - Math.max(radioBox.left, box.left) <= 0
          || Math.min(radioBox.bottom, box.bottom) - Math.max(radioBox.top, box.top) <= 0;
      });
    });
    const albumCell = firstCells[3];
    const longAlbumEllipsized = albumCell.scrollWidth > albumCell.clientWidth && getComputedStyle(albumCell).textOverflow === 'ellipsis';
    const missingAlbumPlaceholder = candidateRows[1].querySelectorAll(':scope > [role="cell"]')[3].textContent === '—';
    const uniformRowHeight = candidateRows.every((row) => Math.abs(row.getBoundingClientRect().height - candidateRows[0].getBoundingClientRect().height) <= 1);
    const initialSelectionCorrect = candidateRadios[0].checked && candidateRows[0].classList.contains('selected') && !candidateRadios[1].checked;
    candidateRadios[1].click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const updatedRows = [...matchDialog.querySelectorAll('.candidate')];
    const selectionSwitches = updatedRows[1].querySelector('input[type="radio"]').checked && updatedRows[1].classList.contains('selected')
      && state.matchReview.selections.get('layout-smoke-track').candidate.sourceId === 'smoke-alternate';
    document.getElementById('applyMatch').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const applyUpdatesDraft = state.drafts.get('layout-smoke-track')?.title === 'Alternate smoke title';
    const originalSurface = getComputedStyle(matchDialog).backgroundColor;
    themeButton.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const alternateSurface = getComputedStyle(matchDialog).backgroundColor;
    themeButton.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const matchReview = {
      fitsViewport: matchBox.left >= 0 && matchBox.right <= innerWidth && matchBox.top >= 0 && matchBox.bottom <= innerHeight,
      sourceAfterScore: headings.at(-2) === 'Score' && headings.at(-1) === 'Source',
      candidateScrollOwned: getComputedStyle(candidateTable).overflowX === 'auto' && getComputedStyle(candidateTable).overflowY === 'auto',
      singleCandidateRendered,
      multipleCandidatesRendered: candidateRows.length === 2,
      columnsAligned: columnAligned,
      radiosBounded: radioIsBounded,
      radiosDoNotOverlapData: radioDoesNotOverlapData,
      rowsUniform: uniformRowHeight,
      longAlbumEllipsized,
      missingAlbumPlaceholder,
      initialSelectionCorrect,
      selectionSwitches,
      applyUpdatesDraft,
      themeAdapted: originalSurface !== alternateSurface,
      themeRestored: root.dataset.theme === originalTheme
    };
    matchDialog.close();

    document.getElementById('clearButton').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const clear = {
      recordsEmpty: state.records.length === 0 && !document.querySelector('.table-row'),
      selectionEmpty: state.selectedIds.size === 0 && state.activeId === null,
      filtersReset: state.search === '' && state.listFilter === '' && state.statusFilter === 'all',
      jobsReset: document.getElementById('jobTitle').textContent === 'Ready' && document.getElementById('jobBadge').textContent === '(0)',
      logsReset: document.getElementById('logViewport').textContent.trim() === 'No activity yet.',
      issuesReset: state.issues.length === 0 && document.getElementById('issueBadge').textContent === '(0)',
      themePreserved: root.dataset.theme === originalTheme
    };
    return { switchedTheme, restoredTheme, horizontalGrid, matchReview, clear };
  })()`);
  const virtualization = await mainWindow.webContents.executeJavaScript(`(async () => {
    const { state } = await import('./state/app-state.js');
    const started = performance.now();
    state.records = Array.from({ length: 1250 }, (_, index) => ({
      fileId: 'smoke-' + index, absolutePath: '/synthetic/' + index + '.flac', format: 'FLAC',
      durationSeconds: 180, metadata: { title: 'Track ' + index, artist: ['Artist'], album: 'Album', genre: ['Genre'], date: '2026', trackNumber: String(index + 1), trackTotal: '1250' },
      artwork: [], capabilities: { writeTags: true }, status: {}
    }));
    const input = document.getElementById('globalSearch'); input.value = 'Track'; input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const result = { elapsedMs: Math.round((performance.now() - started) * 10) / 10, total: state.records.length, renderedRows: document.querySelectorAll('.table-row').length };
    state.records = []; input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true }));
    return result;
  })()`);
  const failed = results.some((result) => result.horizontalOverflow || result.zeroSizedCriticalRegion || result.outOfHorizontalBounds
      || result.overlappingCriticalRegions || result.counterOverlap || !result.editorTabsPinned || !result.removedUiAbsent
      || result.tabScroll.some((tab) => !tab.reachesEnd || !tab.lastControlVisible))
    || !interactions.switchedTheme || !interactions.restoredTheme
    || Object.values(interactions.horizontalGrid).some((value) => !value)
    || Object.values(interactions.matchReview).some((value) => !value)
    || Object.values(interactions.clear).some((value) => !value)
    || virtualization.total !== 1250 || virtualization.renderedRows >= 100;
  console.log(`LAYOUT_SMOKE ${JSON.stringify({ passed: !failed, results, interactions, virtualization })}`);
  app.exit(failed ? 1 : 0);
}

function handle(channel, callback) {
  ipcMain.handle(channel, async (event, payload) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Untrusted renderer.' } };
    try { return { ok: true, result: await callback(payload) }; }
    catch (error) { return { ok: false, error: publicError(error) }; }
  });
}

function recordFor(id) {
  const record = library.get(id);
  if (!record) throw new AppError('FILE_NOT_FOUND', 'This track is no longer in the current library.');
  return record;
}

function signature(record) { return { fileSize: record.fileSize, modifiedTimeNs: record.modifiedTimeNs }; }

function publicRecord(record, includeArtwork = true) {
  if (includeArtwork) return record;
  return { ...record, artwork: (record.artwork || []).map(({ previewDataUrl, ...item }) => item) };
}

function savePreview(type, entries, extra = {}) {
  const previewId = crypto.randomUUID();
  const preview = { previewId, type, entries, createdAt: Date.now(), ...extra };
  previews.set(previewId, preview);
  setTimeout(() => previews.delete(previewId), 10 * 60 * 1000).unref();
  return preview;
}

function getPreview(previewId, type) {
  const preview = previews.get(string(previewId, 'previewId', { max: 64, allowEmpty: false }));
  if (!preview || preview.type !== type || Date.now() - preview.createdAt > 10 * 60 * 1000) {
    throw new AppError('PREVIEW_EXPIRED', 'This preview expired. Review the changes again before saving.');
  }
  return preview;
}

async function markSourceSaved(fileId, outputPath) {
  const source = recordFor(fileId);
  const record = {
    ...source,
    lastOutputPath: outputPath,
    status: { ...(source.status || {}), saved: true, conflict: false, saveError: null }
  };
  library.set(fileId, record);
  send('library:record-updated', record);
  return record;
}

function registerIpc() {
  handle('app:status', async () => ({
    worker: workerStatus,
    settings: safeSettings(),
    outputFolder: outputFolderSession.current,
    count: library.size
  }));
  handle('settings:get', async () => safeSettings());
  handle('settings:set', async (payload) => writeSettings(object(payload, 'settings')));

  handle('output:pick-folder', async () => {
    const current = outputFolderSession.current;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose Output Folder',
      defaultPath: current && fs.existsSync(current) ? current : undefined,
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled) return { canceled: true, path: current };
    const outputFolder = outputFolderSession.select(
      result.filePaths[0],
      [...library.values()].map((record) => record.absolutePath),
      [...importedRoots]
    );
    previews.clear();
    return { canceled: false, path: outputFolder };
  });

  handle('library:pick-files', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Import audio files', properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Audio files', extensions: AUDIO_EXTENSIONS.map((value) => value.slice(1)) }]
    });
    if (result.canceled) return { canceled: true, paths: [] };
    result.filePaths.forEach((file) => importedRoots.add(path.dirname(path.resolve(file))));
    return { canceled: false, paths: result.filePaths };
  });
  handle('library:pick-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Import music folder', properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled) return { canceled: true, paths: [] };
    result.filePaths.forEach((folder) => importedRoots.add(path.resolve(folder)));
    return { canceled: false, paths: result.filePaths };
  });
  handle('library:scan', async (payload) => {
    object(payload, 'scan request');
    const paths = stringArray(payload.paths, 'paths', 2000).map((entry) => path.resolve(entry));
    for (const selected of paths) {
      const allowed = [...importedRoots].some((root) => selected === root || path.dirname(selected) === root || selected.startsWith(`${root}${path.sep}`));
      if (!allowed) throw new AppError('INVALID_PATH', 'Scan paths must come from the native import dialog.');
    }
    const result = await worker.request('scan', { paths, recursive: payload.recursive !== false }, 10 * 60 * 1000);
    for (const record of result.records) library.set(record.fileId, record);
    return { ...result, records: result.records.map((record) => publicRecord(record, false)) };
  });
  handle('library:list', async () => [...library.values()].map((record) => publicRecord(record, false)));
  handle('metadata:get', async (payload) => {
    const id = string(object(payload).fileId, 'fileId', { max: 128, allowEmpty: false });
    const record = recordFor(id);
    const fresh = await worker.request('read_metadata', { path: record.absolutePath });
    library.set(id, fresh);
    return fresh;
  });
  handle('metadata:preview', async (payload) => {
    const request = object(payload, 'preview request');
    const record = recordFor(string(request.fileId, 'fileId', { max: 128, allowEmpty: false }));
    const patch = metadataPatch(request.patch || {});
    let artworkOperation = request.artworkOperation || null;
    if (artworkOperation?.mode === 'replace') {
      const staged = stagedArtwork.get(artworkOperation.token);
      if (!staged) throw new AppError('ARTWORK_EXPIRED', 'Choose the artwork file again.');
      artworkOperation = { mode: 'replace', path: staged.path };
    } else if (artworkOperation?.mode === 'remove') artworkOperation = { mode: 'remove' };
    else artworkOperation = null;
    const result = await worker.request('preview_changes', { path: record.absolutePath, signature: signature(record), patch, artworkOperation });
    let entries = [{ fileId: record.fileId, path: record.absolutePath, signature: signature(record), patch, artworkOperation, changes: result.changes, conflict: result.conflict }];
    entries = planOutputEntries(entries, outputFolderSession.current, [...importedRoots]);
    return savePreview('metadata', entries, {
      conflicts: entries[0].conflict ? 1 : 0,
      warnings: result.writable ? [] : [result.readOnlyReason],
      outputFolder: entries[0].outputFolder
    });
  });
  handle('metadata:save', async (payload) => {
    const preview = getPreview(object(payload).previewId, 'metadata');
    const entry = preview.entries[0];
    if (!entry.changes.length) return { unchanged: true };
    if (entry.outputConflict) throw new AppError(entry.outputConflict, entry.outputConflict === 'OUTPUT_EXISTS' ? 'The Output file already exists.' : 'Multiple source files map to the same Output name.');
    validateOutputFolder(entry.outputFolder, [entry.path], [...importedRoots]);
    const result = await worker.request('save_metadata', entry, 120000);
    previews.delete(preview.previewId);
    return {
      sourceRecord: await markSourceSaved(entry.fileId, result.outputPath),
      outputRecord: result.record,
      outputPath: result.outputPath
    };
  });

  handle('batch:preview', async (payload) => {
    const request = object(payload, 'batch preview');
    const ids = fileIds(request.fileIds);
    const operations = batchOperations(request.operations || {});
    const cleanup = request.cleanup === true;
    const find = typeof request.find === 'string' ? request.find : '';
    const replace = typeof request.replace === 'string' ? request.replace : '';
    const sequential = request.sequential === true;
    let artworkOperation = null;
    if (request.artworkOperation?.mode === 'replace') {
      const staged = stagedArtwork.get(request.artworkOperation.token);
      if (!staged) throw new AppError('ARTWORK_EXPIRED', 'Choose the batch artwork file again.');
      artworkOperation = { mode: 'replace', path: staged.path };
    } else if (request.artworkOperation?.mode === 'remove') artworkOperation = { mode: 'remove' };
    const entries = [];
    let index = Number(request.startTrack || 1);
    for (const id of ids) {
      const record = recordFor(id); const patch = {};
      for (const [field, operation] of Object.entries(operations)) {
        if (operation.operation === 'REPLACE') patch[field] = operation.value;
        else if (operation.operation === 'CLEAR') patch[field] = Array.isArray(record.metadata[field]) ? [] : '';
      }
      if (cleanup || find) {
        for (const field of ['title', 'album', 'date', 'comment']) {
          if (Object.hasOwn(patch, field)) continue;
          let value = String(record.metadata[field] || '');
          if (cleanup) value = value.trim().replace(/\s+/g, ' ');
          if (find) value = value.split(find).join(replace);
          if (value !== record.metadata[field]) patch[field] = value;
        }
      }
      if (sequential) patch.trackNumber = String(index++);
      const changes = Object.entries(patch).filter(([field, value]) => JSON.stringify(record.metadata[field]) !== JSON.stringify(value)).map(([field, after]) => ({ field, before: record.metadata[field], after }));
      if (artworkOperation) changes.push({ field: 'artwork', before: `${record.artwork?.length || 0} embedded image(s)`, after: artworkOperation.mode });
      let conflict = false;
      try {
        const current = fs.statSync(record.absolutePath, { bigint: true });
        conflict = current.size !== BigInt(record.fileSize) || current.mtimeNs !== BigInt(record.modifiedTimeNs);
      } catch { conflict = true; }
      entries.push({ fileId: id, path: record.absolutePath, signature: signature(record), patch, artworkOperation, changes, conflict, writable: record.capabilities?.writeTags !== false });
    }
    const planned = planOutputEntries(entries, outputFolderSession.current, [...importedRoots]);
    const readOnly = planned.filter((entry) => !entry.writable && entry.changes.length).length;
    const conflicts = planned.filter((entry) => entry.conflict && entry.changes.length).length;
    const warnings = [];
    if (readOnly) warnings.push(`${readOnly} read-only file(s) will fail.`);
    if (conflicts) warnings.push(`${conflicts} source or Output name conflict(s) will be reported without overwriting files.`);
    return savePreview('batch', planned, {
      affected: planned.filter((entry) => entry.changes.length).length,
      operations, conflicts, warnings, outputFolder: planned[0]?.outputFolder || validateOutputFolder(outputFolderSession.current, [], [...importedRoots])
    });
  });
  handle('batch:save', async (payload) => {
    const preview = getPreview(object(payload).previewId, 'batch');
    const actionable = preview.entries.filter((entry) => entry.changes.length);
    const job = jobs.create('batch-save', actionable, async (entry) => {
      if (entry.outputConflict) throw new AppError(entry.outputConflict, entry.outputConflict === 'OUTPUT_EXISTS' ? 'The Output file already exists.' : 'Multiple source files map to the same Output name.');
      validateOutputFolder(entry.outputFolder, [entry.path], [...importedRoots]);
      const result = await worker.request('save_metadata', entry, 120000);
      await markSourceSaved(entry.fileId, result.outputPath);
      return { status: 'saved', result: { outputPath: result.outputPath } };
    });
    previews.delete(preview.previewId);
    return job;
  });

  handle('artwork:pick', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Choose cover artwork', properties: ['openFile'], filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png'] }] });
    if (result.canceled) return { canceled: true };
    const selected = result.filePaths[0];
    const details = await worker.request('stage_artwork', { path: selected });
    const token = crypto.randomUUID();
    stagedArtwork.set(token, { path: selected, createdAt: Date.now() });
    return { canceled: false, token, ...details };
  });
  handle('artwork:stage-remote', async (payload) => {
    const url = string(object(payload).url, 'url', { max: 500, allowEmpty: false });
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'coverartarchive.org') throw new AppError('INVALID_URL', 'Only Cover Art Archive suggestions can be staged.');
    const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20000), headers: { 'User-Agent': musicBrainz.userAgent } });
    if (!response.ok) throw new AppError('NETWORK_ERROR', `Artwork download failed (HTTP ${response.status}).`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_ARTWORK_BYTES) throw new AppError('ARTWORK_TOO_LARGE', 'Artwork must be 15 MB or smaller.');
    const contentType = response.headers.get('content-type') || '';
    const extension = contentType.includes('png') ? '.png' : '.jpg';
    const target = path.join(app.getPath('temp'), `music-metadata-art-${crypto.randomUUID()}${extension}`);
    fs.writeFileSync(target, bytes, { mode: 0o600 });
    const details = await worker.request('stage_artwork', { path: target });
    const token = crypto.randomUUID(); stagedArtwork.set(token, { path: target, createdAt: Date.now(), temporary: true });
    return { token, ...details };
  });

  handle('rename:preview', async (payload) => {
    const request = object(payload); const ids = fileIds(request.fileIds); const template = validateTemplate(request.template);
    const files = ids.map((id) => { const record = recordFor(id); return { fileId: id, path: record.absolutePath, signature: signature(record), metadata: record.metadata }; });
    const outputFolder = validateOutputFolder(outputFolderSession.current, files.map((item) => item.path), [...importedRoots]);
    const result = await worker.request('rename_preview', { template, files });
    const planned = planOutputEntries(
      result.items.map((item) => ({ ...item, path: item.from })),
      outputFolder,
      [...importedRoots],
      (item) => path.basename(item.to)
    ).map((item) => ({ ...item, to: item.outputPath, changed: true, collision: Boolean(item.collision || item.outputConflict) }));
    return savePreview('rename', planned, { blocked: planned.some((item) => item.collision), template, outputFolder });
  });
  handle('rename:apply', async (payload) => {
    const preview = getPreview(object(payload).previewId, 'rename');
    if (preview.blocked) throw new AppError('RENAME_COLLISION', 'Resolve rename collisions before applying.');
    for (const entry of preview.entries) validateOutputFolder(entry.outputFolder, [entry.from], [...importedRoots]);
    const result = await worker.request('rename_apply', { items: preview.entries });
    previews.delete(preview.previewId); return result;
  });

  handle('match:search', async (payload) => {
    const request = object(payload); const record = recordFor(string(request.fileId, 'fileId', { max: 128, allowEmpty: false }));
    const result = await metadataMatcher.searchTrack(record);
    return { ...result, coverArtBase: 'https://coverartarchive.org', noMatch: result.candidates.length === 0 };
  });
  handle('match:batch-start', async (payload) => {
    const request = object(payload, 'match batch');
    const ids = autoMatchFileIds(request.fileIds);
    const records = ids.map(recordFor);
    const providers = metadataMatcher.providerStatuses();
    return jobs.create('metadata-match', records, async (record, _job, context) => {
      const result = await metadataMatcher.searchTrack(record, context);
      const allProvidersFailed = result.providerCount > 0 && result.providerErrors.length === result.providerCount;
      const status = result.candidates.length ? 'matched' : allProvidersFailed ? 'failed' : 'noMatch';
      return { status, result: { ...result, status: status === 'noMatch' ? 'no-match' : status } };
    }, {
      concurrency: AUTO_MATCH_CONCURRENCY,
      publicData: { providers }
    });
  });
  handle('match:fingerprint', async (payload) => {
    const request = object(payload); const record = recordFor(string(request.fileId, 'fileId', { max: 128, allowEmpty: false }));
    const settings = readSettings();
    const key = settings.acoustIdApiKey;
    if (!key) throw new AppError('API_KEY_MISSING', 'Add an AcoustID API key in Settings before using fingerprint matching.');
    const fp = await worker.request('fingerprint', { path: record.absolutePath, configuredPath: settings.fpcalcPath }, 130000);
    const matches = await worker.request('acoustid', { ...fp, apiKey: key }, 30000);
    const fingerprintProvider = { displayName: 'AcoustID / MusicBrainz' };
    const candidates = candidatesFromAcoustId(matches).map((candidate) => {
      const normalized = normalizeCandidate({
        sourceId: candidate.id,
        title: candidate.title,
        artist: candidate.artist,
        album: candidate.album,
        releaseDate: candidate.date,
        releaseId: candidate.releaseId,
        musicBrainzRecordingId: candidate.id,
        providerConfidence: candidate.score / 100
      }, record.fileId, fingerprintProvider);
      normalized.matchScore = calculateMatchScore(record, normalized, { fingerprintConfidence: candidate.score / 100 });
      return normalized;
    });
    return { ...matches, candidates, fingerprintGenerated: true, noMatch: candidates.length === 0 };
  });
  handle('match:cover-url', async (payload) => ({ url: musicBrainz.coverArtUrl(string(object(payload).releaseId, 'releaseId', { max: 64 })) }));

  handle('jobs:cancel', async (payload) => ({ canceled: jobs.cancel(string(object(payload).jobId, 'jobId', { max: 64, allowEmpty: false })) }));
  handle('system:open-path', async (payload) => {
    const record = recordFor(string(object(payload).fileId, 'fileId', { max: 128, allowEmpty: false }));
    shell.showItemInFolder(record.absolutePath); return { opened: true };
  });
}

app.whenReady().then(async () => {
  app.setName('Music Metadata Editor');
  createWindow();
  registerIpc();
  jobs.on('progress', (progress) => send('jobs:progress', progress));
  worker = new PythonBridge({ appRoot, databasePath: path.join(app.getPath('userData'), 'library.sqlite3') });
  worker.on('event', (event) => send('worker:event', event));
  worker.on('diagnostic', (message) => send('worker:diagnostic', { message }));
  try {
    const handshake = await worker.start();
    workerStatus = handshake.mutagenAvailable
      ? { ready: true, message: 'Metadata worker ready.' }
      : { ready: false, message: 'Mutagen is missing. Run bash scripts/setup.sh.' };
  } catch (error) {
    workerStatus = { ready: false, message: error.message, code: error.code };
  }
  send('worker:status', workerStatus);
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { if (worker) worker.stop(); });
