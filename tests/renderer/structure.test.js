'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');

test('renderer contains the mockup-driven structural regions', () => {
  const html = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8');
  for (const id of ['importFilesButton', 'clearButton', 'outputFolderButton', 'outputFolderPath', 'filterChips', 'tableViewport', 'editorPanel', 'batchPanel', 'activityPanel', 'previewDialog']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});

test('output folder is session state and is never restored from persistent settings', () => {
  const main = fs.readFileSync(path.join(root, 'src/main/index.js'), 'utf8');
  const state = fs.readFileSync(path.join(root, 'src/renderer/state/app-state.js'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'src/renderer/components/app.js'), 'utf8');
  assert.match(main, /const outputFolderSession = new OutputFolderSession\(\)/);
  assert.match(main, /outputFolder:\s*outputFolderSession\.current/);
  assert.match(main, /const \{ outputFolder: _legacyOutputFolder, \.\.\.persisted \}/);
  assert.doesNotMatch(main, /writeSettings\(\{ outputFolder/);
  assert.match(state, /outputFolder:\s*''/);
  assert.match(app, /state\.outputFolder = status\.outputFolder \|\| ''/);
  assert.doesNotMatch(app, /state\.settings\.outputFolder/);
});

test('all visible metadata columns expose real sorting controls and indicators', () => {
  const html = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'src/renderer/components/app.js'), 'utf8');
  for (const column of ['title', 'artist', 'album', 'date', 'genre', 'trackNumber', 'durationSeconds']) {
    assert.match(html, new RegExp(`class="cell [^"]*sort-header[^"]*" data-sort="${column}"`));
  }
  assert.match(html, /class="sort-indicator"/);
  assert.match(app, /direction:\s*state\.sort\.column === column/);
  assert.match(app, /renderSortHeaders\(\)/);
});

test('grid overflow, expanded activity, theme glyphs, and session clear have regression coverage', () => {
  const html = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8');
  const layout = fs.readFileSync(path.join(root, 'src/renderer/styles/layout.css'), 'utf8');
  const components = fs.readFileSync(path.join(root, 'src/renderer/styles/components.css'), 'utf8');
  const table = fs.readFileSync(path.join(root, 'src/renderer/components/music-table.js'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'src/renderer/components/app.js'), 'utf8');
  assert.match(layout, /\.activity-content\s*\{\s*height:\s*152px/);
  assert.match(components, /min-width:\s*var\(--table-content-width/);
  assert.match(table, /updateContentWidth\(\)/);
  assert.match(html, /class="theme-icon moon-icon"/);
  assert.match(html, /class="theme-icon sun-icon"/);
  assert.match(components, /data-theme="dark"[^}]*\.sun-icon/);
  assert.match(app, /function clearSessionDisplay\(\)/);
  assert.match(app, /state\.hiddenRecordIds\.add/);
});

test('removed controls and the spacer column are absent', () => {
  const html = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8');
  const table = fs.readFileSync(path.join(root, 'src/renderer/components/music-table.js'), 'utf8');
  for (const id of ['librarySummary', 'standardDensity', 'compactDensity', 'sortSelect']) {
    assert.doesNotMatch(html, new RegExp(`id="${id}"`));
  }
  assert.doesNotMatch(html, /class="brand-group"/);
  assert.doesNotMatch(html, /class="sort-control"/);
  assert.doesNotMatch(html, /class="cell status-cell"/);
  assert.doesNotMatch(table, /statusCell/);
});

test('metadata columns expose persistent resize handles', () => {
  const html = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8');
  const table = fs.readFileSync(path.join(root, 'src/renderer/components/music-table.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'src/renderer/styles/components.css'), 'utf8');
  for (const column of ['title', 'artist', 'album', 'year', 'genre', 'track', 'duration']) {
    assert.match(html, new RegExp(`class="column-resizer" data-column="${column}"`));
    assert.match(table, new RegExp(`${column}:\\s*\\d+`));
    assert.match(css, new RegExp(`--column-${column}`));
  }
  assert.match(table, /setPointerCapture/);
  assert.match(table, /localStorage\.setItem\(COLUMN_WIDTHS_KEY/);
});

test('compact tokens and editor scroll ownership are explicit', () => {
  const tokens = fs.readFileSync(path.join(root, 'src/renderer/styles/tokens.css'), 'utf8');
  const layout = fs.readFileSync(path.join(root, 'src/renderer/styles/layout.css'), 'utf8');
  assert.match(tokens, /--height-control:\s*40px/);
  assert.match(tokens, /--height-table-row:\s*32px/);
  assert.match(layout, /\.editor-scroll\s*\{[^}]*flex:\s*1 1 0[^}]*min-height:\s*0[^}]*overflow-y:\s*auto/s);
  assert.match(layout, /#metadataForm\s*\{[^}]*flex:\s*0 0 auto[^}]*min-height:\s*min-content/s);
  assert.match(layout, /\.result-counters\s*\{[^}]*repeat\(4,\s*minmax\(65px,\s*1fr\)\)/s);
});

test('responsive stylesheet defines minimum and narrow desktop behavior', () => {
  const css = fs.readFileSync(path.join(root, 'src/renderer/styles/layout.css'), 'utf8');
  assert.match(css, /min-width:\s*min\(900px,\s*100%\)/);
  assert.match(css, /min-height:\s*650px/);
  assert.match(css, /@media \(max-width: 1040px\)/);
  assert.match(css, /@media \(max-height: 700px\)/);
});

test('fingerprint matching exposes configuration and prevents duplicate requests', () => {
  const html = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'src/renderer/components/app.js'), 'utf8');
  assert.match(html, /id="fpcalcPath"/);
  assert.match(html, /brew install chromaprint/);
  assert.match(app, /button\.disabled = true/);
  assert.match(app, /button\.disabled = false/);
  assert.match(app, /No fingerprint match found/);
});

test('batch metadata review names providers and places Source immediately after Score', () => {
  const html = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'src/renderer/components/app.js'), 'utf8');
  assert.match(html, /<h2>Metadata Match Review<\/h2>/);
  assert.doesNotMatch(html, /<h2>MusicBrainz Match Review<\/h2>/);
  assert.match(html, /data-match-sort="matchScore"[\s\S]*data-match-sort="source"/);
  assert.match(html, /id="matchTrackList"/);
  assert.match(html, /id="applyReviewedMatches"/);
  assert.match(app, /MAX_AUTO_MATCH_TRACKS\s*=\s*50/);
  assert.match(app, /Processed \$\{job\?\.processed \|\| 0\} \/ \$\{job\?\.total \|\| review\.fileIds\.length\}/);
});

test('metadata candidate selection has a dedicated bounded grid column', () => {
  const html = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'src/renderer/components/app.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'src/renderer/styles/components.css'), 'utf8');
  assert.match(html, /class="candidate-select-header"[^>]*aria-label="Select candidate"/);
  assert.match(app, /selectionCell\.className = 'candidate-select'/);
  assert.match(app, /selectionCell\.append\(radio\)/);
  assert.match(css, /\.candidate-header, \.candidate\s*\{[^}]*grid-template-columns:\s*40px/s);
  assert.match(css, /input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\):not\(\[type="search"\]\)/);
  assert.match(css, /input\[type="checkbox"\], input\[type="radio"\]\s*\{[^}]*width:\s*var\(--size-checkbox\)[^}]*height:\s*var\(--size-checkbox\)/s);
  assert.doesNotMatch(css, /\.candidate\s*>\s*input\s*\{[^}]*position:\s*absolute/s);
});
