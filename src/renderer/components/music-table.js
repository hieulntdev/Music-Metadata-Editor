import { filteredRecords, isDirty, metadataFor, pagedRecords, state } from '../state/app-state.js';
import { recordStatus } from '../state/record-status.mjs';
import { filenameFor } from '../state/sort-records.mjs';

const COLUMN_WIDTHS_KEY = 'music-metadata-editor.column-widths.v1';
export const COLUMN_DEFINITIONS = Object.freeze([
  { key: 'filename', className: 'filename-cell', minWidth: 120, defaultWidth: 180, alignment: 'left', resizable: true },
  { key: 'title', className: 'title-cell', minWidth: 96, defaultWidth: 144, alignment: 'left', resizable: true },
  { key: 'artist', className: 'artist-cell', minWidth: 88, defaultWidth: 108, alignment: 'left', resizable: true },
  { key: 'album', className: 'album-cell', minWidth: 96, defaultWidth: 151, alignment: 'left', resizable: true },
  { key: 'year', className: 'year-cell', minWidth: 58, defaultWidth: 58, alignment: 'center', resizable: true },
  { key: 'genre', className: 'genre-cell', minWidth: 72, defaultWidth: 86, alignment: 'center', resizable: true },
  { key: 'track', className: 'track-cell', minWidth: 61, defaultWidth: 61, alignment: 'center', resizable: true },
  { key: 'duration', className: 'duration-cell', minWidth: 65, defaultWidth: 65, alignment: 'center', resizable: true },
  { key: 'completed', className: 'completed-cell', minWidth: 72, defaultWidth: 82, alignment: 'center', resizable: true }
]);
const COLUMN_BY_KEY = new Map(COLUMN_DEFINITIONS.map((column) => [column.key, column]));
const SELECT_COLUMN_WIDTH = 40;
const ID_COLUMN_WIDTH = 52;
const MAX_COLUMN_WIDTH = 1200;

function duration(seconds) {
  if (!seconds) return '—';
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

export class MusicTable {
  constructor(viewport, body, onSelection, onActivate) {
    this.viewport = viewport;
    this.body = body;
    this.onSelection = onSelection;
    this.onActivate = onActivate;
    this.overscan = 8;
    this.selectionAnchorId = null;
    this.columnWidths = this.loadColumnWidths();
    this.applyColumnWidths();
    this.setupColumnResizing();
    viewport.addEventListener('scroll', () => this.renderRows());
    new ResizeObserver(() => this.renderRows()).observe(viewport);
  }

  loadColumnWidths() {
    try {
      const saved = JSON.parse(localStorage.getItem(COLUMN_WIDTHS_KEY) || '{}');
      return Object.fromEntries(Object.entries(saved).filter(([column, width]) => (
        COLUMN_BY_KEY.get(column)?.resizable
        && Number.isFinite(width)
        && width >= COLUMN_BY_KEY.get(column).minWidth
        && width <= MAX_COLUMN_WIDTH
      )));
    } catch {
      return {};
    }
  }

  applyColumnWidths() {
    for (const [column, width] of Object.entries(this.columnWidths)) {
      this.viewport.style.setProperty(`--column-${column}`, `${width}px`);
    }
    this.updateContentWidth();
  }

  updateContentWidth() {
    const width = COLUMN_DEFINITIONS
      .reduce((total, column) => total + (this.columnWidths[column.key] || column.defaultWidth), SELECT_COLUMN_WIDTH + ID_COLUMN_WIDTH);
    this.viewport.style.setProperty('--table-content-width', `${width}px`);
  }

  saveColumnWidths() {
    try { localStorage.setItem(COLUMN_WIDTHS_KEY, JSON.stringify(this.columnWidths)); } catch { /* Local persistence is optional. */ }
  }

  setupColumnResizing() {
    for (const handle of this.viewport.querySelectorAll('.column-resizer')) {
      const column = handle.dataset.column;
      const definition = COLUMN_BY_KEY.get(column);
      if (!definition?.resizable) continue;
      const header = handle.parentElement;
      let drag = null;
      const finish = () => {
        if (!drag) return;
        drag = null;
        handle.classList.remove('dragging');
        document.body.classList.remove('resizing-column');
        this.saveColumnWidths();
      };
      handle.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        drag = { pointerId: event.pointerId, startX: event.clientX, startWidth: header.getBoundingClientRect().width };
        handle.classList.add('dragging');
        document.body.classList.add('resizing-column');
        handle.setPointerCapture(event.pointerId);
      });
      handle.addEventListener('pointermove', (event) => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        const width = Math.min(MAX_COLUMN_WIDTH, Math.max(definition.minWidth, Math.round(drag.startWidth + event.clientX - drag.startX)));
        this.columnWidths[column] = width;
        this.viewport.style.setProperty(`--column-${column}`, `${width}px`);
        this.updateContentWidth();
      });
      handle.addEventListener('pointerup', (event) => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
        finish();
      });
      handle.addEventListener('pointercancel', finish);
      handle.addEventListener('lostpointercapture', finish);
      handle.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); });
    }
  }

  render() {
    const derived = pagedRecords(filteredRecords());
    this.records = derived.records;
    this.recordOffset = derived.page.startIndex;
    const rowHeight = this.rowHeight();
    this.body.style.height = this.records.length ? `${this.records.length * rowHeight}px` : '';
    this.renderRows();
  }

  rowHeight() {
    return Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--height-table-row')) || 32;
  }

  renderRows() {
    if (!this.records) this.records = filteredRecords();
    const rowHeight = this.rowHeight();
    const headerHeight = rowHeight;
    const scrollTop = Math.max(0, this.viewport.scrollTop - headerHeight);
    const start = Math.max(0, Math.floor(scrollTop / rowHeight) - this.overscan);
    const count = Math.ceil(this.viewport.clientHeight / rowHeight) + this.overscan * 2;
    const end = Math.min(this.records.length, start + count);
    this.body.replaceChildren();
    if (!this.records.length) {
      const empty = document.createElement('div'); empty.className = 'empty-state';
      empty.textContent = state.records.length ? 'No tracks match the current filters.' : 'Import audio files or a folder to begin.';
      this.body.append(empty); return;
    }
    const fragment = document.createDocumentFragment();
    for (let index = start; index < end; index += 1) fragment.append(this.row(this.records[index], index, rowHeight));
    this.body.append(fragment);
  }

  row(record, index, rowHeight) {
    const metadata = metadataFor(record.fileId);
    const row = document.createElement('div');
    row.className = `table-row${state.selectedIds.has(record.fileId) ? ' selected' : ''}`;
    row.role = 'row'; row.dataset.id = record.fileId; row.style.top = `${index * rowHeight}px`;
    row.setAttribute('aria-selected', String(state.selectedIds.has(record.fileId)));
    const selectCell = document.createElement('div'); selectCell.className = 'cell select-cell'; selectCell.role = 'cell';
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = state.selectedIds.has(record.fileId); checkbox.setAttribute('aria-label', `Select ${metadata.title || 'track'}`);
    checkbox.addEventListener('click', (event) => {
      event.stopPropagation();
      if (event.shiftKey && this.selectionAnchorId) this.selectRange(record.fileId, checkbox.checked);
      else this.toggle(record.fileId, checkbox.checked);
    });
    selectCell.append(checkbox); row.append(selectCell);
    const idCell = document.createElement('div'); idCell.className = 'cell id-cell'; idCell.role = 'cell'; idCell.textContent = String(this.recordOffset + index + 1); row.append(idCell);
    const values = {
      filename: filenameFor(record) || '—', title: metadata.title || '(Untitled)', artist: (metadata.artist || []).join('; ') || '—',
      album: metadata.album || '—', year: metadata.date || '—', genre: (metadata.genre || []).join('; ') || '—',
      track: metadata.trackNumber ? `${metadata.trackNumber}${metadata.trackTotal ? `/${metadata.trackTotal}` : ''}` : '—',
      duration: duration(record.durationSeconds)
    };
    for (const definition of COLUMN_DEFINITIONS) {
      const cell = document.createElement('div');
      cell.className = `cell ${definition.className} align-${definition.alignment}`; cell.role = 'cell';
      if (definition.key === 'completed') {
        const done = recordStatus(record, isDirty(record.fileId)).done;
        const indicator = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        indicator.setAttribute('viewBox', '0 0 24 24'); indicator.setAttribute('aria-hidden', 'true');
        indicator.setAttribute('class', `completed-indicator${done ? ' done' : ''}`);
        indicator.innerHTML = done
          ? '<circle cx="12" cy="12" r="9"></circle><path d="m8 12 2.5 2.5L16 9"></path>'
          : '<circle cx="12" cy="12" r="9"></circle><path d="M9 12h6"></path>';
        cell.setAttribute('aria-label', done ? 'Completed' : 'Not completed');
        cell.title = done ? `Completed${record.lastOutputPath ? ` — ${record.lastOutputPath}` : ''}` : 'Not completed';
        cell.append(indicator);
      } else {
        const value = values[definition.key]; cell.textContent = value; cell.title = value;
      }
      row.append(cell);
    }
    row.addEventListener('click', () => {
      state.activeId = record.fileId;
      this.onActivate(record.fileId);
      this.renderRows();
    });
    row.addEventListener('dblclick', () => this.onActivate(record.fileId));
    return row;
  }

  toggle(fileId, selected) {
    if (selected) state.selectedIds.add(fileId); else state.selectedIds.delete(fileId);
    this.selectionAnchorId = fileId;
    this.onSelection(); this.renderRows();
  }

  selectRange(fileId, selected, replace = false) {
    const start = this.records.findIndex((record) => record.fileId === this.selectionAnchorId);
    const end = this.records.findIndex((record) => record.fileId === fileId);
    if (start < 0 || end < 0) { this.toggle(fileId, selected); return; }
    if (replace) state.selectedIds.clear();
    const [from, to] = start <= end ? [start, end] : [end, start];
    for (let index = from; index <= to; index += 1) {
      if (selected) state.selectedIds.add(this.records[index].fileId);
      else state.selectedIds.delete(this.records[index].fileId);
    }
    this.onSelection(); this.renderRows();
  }

  resetSelectionAnchor() { this.selectionAnchorId = null; }
}
