import { filteredRecords, metadataFor, state } from '../state/app-state.js';

const COLUMN_WIDTHS_KEY = 'music-metadata-editor.column-widths.v1';
const COLUMN_MIN_WIDTHS = { title: 96, artist: 88, album: 96, year: 58, genre: 72, track: 61, duration: 65 };
const COLUMN_DEFAULT_WIDTHS = { title: 144, artist: 108, album: 151, year: 58, genre: 86, track: 61, duration: 65 };
const SELECT_COLUMN_WIDTH = 40;
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
        Object.hasOwn(COLUMN_MIN_WIDTHS, column)
        && Number.isFinite(width)
        && width >= COLUMN_MIN_WIDTHS[column]
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
    const width = Object.entries(COLUMN_DEFAULT_WIDTHS)
      .reduce((total, [column, defaultWidth]) => total + (this.columnWidths[column] || defaultWidth), SELECT_COLUMN_WIDTH);
    this.viewport.style.setProperty('--table-content-width', `${width}px`);
  }

  saveColumnWidths() {
    try { localStorage.setItem(COLUMN_WIDTHS_KEY, JSON.stringify(this.columnWidths)); } catch { /* Local persistence is optional. */ }
  }

  setupColumnResizing() {
    for (const handle of this.viewport.querySelectorAll('.column-resizer')) {
      const column = handle.dataset.column;
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
        const width = Math.min(MAX_COLUMN_WIDTH, Math.max(COLUMN_MIN_WIDTHS[column], Math.round(drag.startWidth + event.clientX - drag.startX)));
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
    this.records = filteredRecords();
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
    const values = [
      ['title-cell', metadata.title || '(Untitled)'], ['artist-cell', (metadata.artist || []).join('; ') || '—'],
      ['album-cell', metadata.album || '—'], ['year-cell', metadata.date || '—'], ['genre-cell', (metadata.genre || []).join('; ') || '—'],
      ['track-cell', metadata.trackNumber ? `${metadata.trackNumber}${metadata.trackTotal ? `/${metadata.trackTotal}` : ''}` : '—'],
      ['duration-cell', duration(record.durationSeconds)]
    ];
    for (const [className, value] of values) {
      const cell = document.createElement('div'); cell.className = `cell ${className}`; cell.role = 'cell'; cell.textContent = value; cell.title = value; row.append(cell);
    }
    row.addEventListener('click', (event) => {
      if (event.shiftKey && this.selectionAnchorId) this.selectRange(record.fileId, true, !(event.metaKey || event.ctrlKey));
      else if (event.metaKey || event.ctrlKey) this.toggle(record.fileId, !state.selectedIds.has(record.fileId));
      else {
        state.activeId = record.fileId;
        if (!state.selectedIds.has(record.fileId)) { state.selectedIds.clear(); state.selectedIds.add(record.fileId); this.onSelection(); }
        this.selectionAnchorId = record.fileId;
        this.onActivate(record.fileId);
      }
      this.renderRows();
    });
    row.addEventListener('dblclick', () => this.onActivate(record.fileId));
    return row;
  }

  toggle(fileId, selected) {
    if (selected) state.selectedIds.add(fileId); else state.selectedIds.delete(fileId);
    this.selectionAnchorId = fileId;
    if (selected) state.activeId = fileId;
    this.onSelection(); this.renderRows();
    if (selected) this.onActivate(fileId);
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
    state.activeId = fileId;
    this.onSelection(); this.renderRows(); this.onActivate(fileId);
  }
}
