import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import { TableView } from '@tiptap/extension-table';
import { CellSelection, TableMap, cellAround, isInTable, moveTableColumn, moveTableRow, selectedRect } from '@tiptap/pm/tables';

// Table tools shared by the desktop table menu and the mobile toolbar: moving rows and
// columns, selecting parts of a table, equal widths / heights, and resizing by dragging the
// lines between columns and rows (mouse and touch).

const MIN_COL = 40;
const MIN_ROW = 24;
// How close to a line the mouse / a finger must be to grab it (client px).
const MOUSE_TOL = 4;
const TOUCH_TOL = 10;
const HOLD_MS = 250;

const isCell = (node: PMNode) => node.type.spec.tableRole === 'cell' || node.type.spec.tableRole === 'header_cell';

// ---- commands ----

// 'edge': already the first / last one; 'merged': merged cells span the rows / columns in
// the way (moving would have to split them, so nothing happens).
export type TableMoveResult = 'moved' | 'edge' | 'merged';
export const TABLE_MOVE_MERGED = 'Merged cells are in the way. Split them first (Cell > Split cell).';

// Moves the row / column with the cursor one step; the cursor moves with it.
const moveBy = (editor: Editor, kind: 'row' | 'column', dir: -1 | 1): TableMoveResult => {
  const { state, view } = editor;
  if (!isInTable(state)) return 'edge';
  const rect = selectedRect(state);
  const from = kind === 'row' ? (dir < 0 ? rect.top : rect.bottom - 1) : (dir < 0 ? rect.left : rect.right - 1);
  const to = from + dir;
  if (to < 0 || to >= (kind === 'row' ? rect.map.height : rect.map.width)) return 'edge';
  const command = kind === 'row' ? moveTableRow({ from, to, select: false }) : moveTableColumn({ from, to, select: false });
  const moved = command(state, (tr: Transaction) => {
    const table = tr.doc.nodeAt(rect.tableStart - 1);
    if (table) {
      const map = TableMap.get(table);
      const row = kind === 'row' ? to : Math.min(rect.top, map.height - 1);
      const col = kind === 'column' ? to : Math.min(rect.left, map.width - 1);
      const cellPos = rect.tableStart + map.map[row * map.width + col];
      tr.setSelection(TextSelection.near(tr.doc.resolve(cellPos + 1)));
    }
    view.dispatch(tr.scrollIntoView());
  });
  return moved ? 'moved' : 'merged';
};
export const moveTableRowBy = (editor: Editor, dir: -1 | 1) => moveBy(editor, 'row', dir);
export const moveTableColumnBy = (editor: Editor, dir: -1 | 1) => moveBy(editor, 'column', dir);

export type TablePart = 'row' | 'column' | 'table';

// Selects cells around the cursor as a CellSelection (to format, colour or merge them).
export const selectTablePart = (editor: Editor, kind: TablePart): boolean => {
  const { state } = editor;
  const $cell = cellAround(state.selection.$from);
  if (!$cell) return false;
  let selection: CellSelection;
  if (kind === 'row') selection = CellSelection.rowSelection($cell);
  else if (kind === 'column') selection = CellSelection.colSelection($cell);
  else {
    const rect = selectedRect(state);
    const cells = rect.map.map;
    selection = CellSelection.create(state.doc, rect.tableStart + cells[0], rect.tableStart + cells[cells.length - 1]);
  }
  editor.view.dispatch(state.tr.setSelection(selection));
  return true;
};

// The cell around a document position, if it is in the same table as `anchor`.
export const selectCellRange = (editor: Editor, anchorCellPos: number, headPos: number): boolean => {
  const { state } = editor;
  const $anchor = state.doc.resolve(anchorCellPos);
  const $head = cellAround(state.doc.resolve(headPos));
  if (!$head || !state.doc.nodeAt(anchorCellPos) || !isCell(state.doc.nodeAt(anchorCellPos)!)) return false;
  if ($anchor.node(-1) !== $head.node(-1)) return false;
  editor.view.dispatch(state.tr.setSelection(new CellSelection($anchor, $head)));
  return true;
};

// Position of the cell with the cursor (start of the cell node), or null.
export const currentCellPos = (state: EditorState): number | null => cellAround(state.selection.$from)?.pos ?? null;

const tableOf = (state: EditorState) => {
  if (!isInTable(state)) return null;
  const rect = selectedRect(state);
  return { node: rect.table, pos: rect.tableStart - 1, start: rect.tableStart };
};

// Equal widths = no fixed widths: the table fills the line and splits it evenly.
export const equalColumnWidths = (editor: Editor): boolean => {
  const table = tableOf(editor.state);
  if (!table) return false;
  const tr = editor.state.tr;
  table.node.descendants((node, offset) => {
    if (!isCell(node)) return true;
    if (node.attrs.colwidth) tr.setNodeMarkup(table.start + offset, undefined, { ...node.attrs, colwidth: null });
    return false;
  });
  if (tr.docChanged) editor.view.dispatch(tr);
  return true;
};

// Every row as tall as the tallest one.
export const equalRowHeights = (editor: Editor): boolean => {
  const table = tableOf(editor.state);
  if (!table) return false;
  const rows: { pos: number; node: PMNode; height: number }[] = [];
  table.node.forEach((row, offset) => {
    const dom = editor.view.nodeDOM(table.start + offset) as HTMLElement | null;
    rows.push({ pos: table.start + offset, node: row, height: dom?.offsetHeight ?? 0 });
  });
  const tallest = Math.max(MIN_ROW, ...rows.map((r) => r.height));
  const tr = editor.state.tr;
  for (const r of rows) if (r.node.attrs.height !== tallest) tr.setNodeMarkup(r.pos, undefined, { ...r.node.attrs, height: tallest });
  if (tr.docChanged) editor.view.dispatch(tr);
  return true;
};

// Natural row heights again.
export const resetRowHeights = (editor: Editor): boolean => {
  const table = tableOf(editor.state);
  if (!table) return false;
  const tr = editor.state.tr;
  table.node.forEach((row, offset) => { if (row.attrs.height) tr.setNodeMarkup(table.start + offset, undefined, { ...row.attrs, height: null }); });
  if (tr.docChanged) editor.view.dispatch(tr);
  return true;
};

// ---- dragging the lines ----

interface Hit {
  kind: 'col' | 'row';
  index: number;
  tableEl: HTMLTableElement;
  tablePos: number;
}

const tableAtTarget = (view: EditorView, target: EventTarget | null): { tableEl: HTMLTableElement; tablePos: number; node: PMNode } | null => {
  const el = target instanceof Element ? target : null;
  if (!el || !view.dom.contains(el)) return null;
  const tableEl = (el.closest('table') ?? (el.classList.contains('tableWrapper') ? el.querySelector('table') : null)) as HTMLTableElement | null;
  const firstCell = tableEl?.querySelector('td, th');
  if (!tableEl || !firstCell || !view.dom.contains(tableEl)) return null;
  let $pos;
  try {
    $pos = view.state.doc.resolve(view.posAtDOM(firstCell, 0));
  } catch {
    return null;
  }
  for (let d = $pos.depth; d > 0; d--) {
    if ($pos.node(d).type.spec.tableRole === 'table') return { tableEl, tablePos: $pos.before(d), node: $pos.node(d) };
  }
  return null;
};

// Right edges of the columns and bottom edges of the rows, in client px.
const edges = (view: EditorView, tablePos: number, node: PMNode) => {
  const map = TableMap.get(node);
  const start = tablePos + 1;
  const rights: (number | null)[] = new Array(map.width).fill(null);
  for (const cellPos of new Set(map.map)) {
    const r = map.findCell(cellPos);
    const dom = view.nodeDOM(start + cellPos) as HTMLElement | null;
    if (dom) rights[r.right - 1] = dom.getBoundingClientRect().right;
  }
  const bottoms: number[] = [];
  node.forEach((_row, offset) => {
    const dom = view.nodeDOM(start + offset) as HTMLElement | null;
    bottoms.push(dom ? dom.getBoundingClientRect().bottom : NaN);
  });
  return { map, rights, bottoms };
};

const hitTest = (view: EditorView, target: EventTarget | null, x: number, y: number, tol: number): Hit | null => {
  if (!view.editable) return null;
  const found = tableAtTarget(view, target);
  if (!found) return null;
  const box = found.tableEl.getBoundingClientRect();
  if (x < box.left - tol || x > box.right + tol || y < box.top - tol || y > box.bottom + tol) return null;
  const { rights, bottoms } = edges(view, found.tablePos, found.node);
  let best: Hit | null = null;
  let bestDist = tol + 1;
  rights.forEach((right, index) => {
    if (right === null || y < box.top || y > box.bottom) return;
    const d = Math.abs(x - right);
    if (d < bestDist) { bestDist = d; best = { kind: 'col', index, ...found }; }
  });
  if (best) return best;
  bottoms.forEach((bottom, index) => {
    if (Number.isNaN(bottom) || x < box.left || x > box.right) return;
    const d = Math.abs(y - bottom);
    if (d < bestDist) { bestDist = d; best = { kind: 'row', index, ...found }; }
  });
  return best;
};

// The cell (its position) under a point of the screen, if it is in this editor.
const cellAtPoint = (view: EditorView, x: number, y: number): number | null => {
  const el = document.elementFromPoint(x, y)?.closest('td, th');
  if (!el || !view.dom.contains(el)) return null;
  try {
    return cellAround(view.state.doc.resolve(view.posAtDOM(el, 0)))?.pos ?? null;
  } catch {
    return null;
  }
};

// Cells from `anchor` to `head` (cell positions) as a CellSelection, when in the same table.
const selectCells = (view: EditorView, anchor: number, head: number): boolean => {
  const { doc, selection } = view.state;
  const $anchor = doc.resolve(anchor);
  const $head = doc.resolve(head);
  if ($anchor.node(-1) !== $head.node(-1)) return false;
  if (selection instanceof CellSelection && selection.$anchorCell.pos === anchor && selection.$headCell.pos === head) return true;
  view.dispatch(view.state.tr.setSelection(new CellSelection($anchor, $head)).setMeta(tableResizeKey, true));
  return true;
};

// Tiptap's table view only sets the width of columns that have one; a column that lost its
// width kept the old one on screen until the note was opened again. Rebuilt on every update.
export class FreshColumnsTableView extends TableView {
  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    (this.colgroup as unknown as HTMLElement).replaceChildren();
    return super.update(node);
  }
}

// A drag changes only the picture (the colgroup, which ProseMirror does not manage, and a
// temporary style rule for the row); the document gets one edit when the finger / mouse lets go.
class Drag {
  private sizes: number[] = [];
  private startSize = 0;
  private scale = 1;
  private readonly colStyles: string[] = [];
  private readonly tableStyle: string;
  private styleEl: HTMLStyleElement | null = null;
  // The line being dragged, drawn over the table (outside the editor's DOM).
  private readonly guide = document.createElement('div');
  moved = false;

  constructor(private view: EditorView, private hit: Hit, private startX: number, private startY: number) {
    const { tableEl } = hit;
    this.tableStyle = tableEl.style.cssText;
    this.scale = tableEl.getBoundingClientRect().width / (tableEl.offsetWidth || 1) || 1;
    if (hit.kind === 'col') {
      const node = view.state.doc.nodeAt(hit.tablePos)!;
      const { rights } = edges(view, hit.tablePos, node);
      const left = tableEl.getBoundingClientRect().left;
      const fallback = tableEl.offsetWidth / rights.length;
      this.sizes = rights.map((right, i) => {
        const prev = i === 0 ? left : rights[i - 1];
        return right !== null && prev !== null ? (right - prev) / this.scale : fallback;
      });
      this.startSize = this.sizes[hit.index];
      for (const col of Array.from(this.cols())) this.colStyles.push(col.style.cssText);
    } else {
      const row = tableEl.querySelectorAll(':scope > tbody > tr')[hit.index] as HTMLElement | undefined;
      this.startSize = row?.offsetHeight ?? MIN_ROW;
      tableEl.setAttribute('data-resizing', '');
      this.styleEl = document.createElement('style');
      document.head.append(this.styleEl);
    }
    document.body.classList.add(hit.kind === 'col' ? 'table-resizing-col' : 'table-resizing-row');
    this.guide.className = 'table-resize-guide';
    document.body.append(this.guide);
    this.placeGuide(0);
  }

  private placeGuide(delta: number) {
    const box = this.hit.tableEl.getBoundingClientRect();
    const g = this.guide.style;
    if (this.hit.kind === 'col') Object.assign(g, { left: `${this.startX + delta * this.scale - 1}px`, top: `${box.top}px`, width: '3px', height: `${box.height}px` });
    else Object.assign(g, { top: `${this.startY + delta * this.scale - 1}px`, left: `${box.left}px`, height: '3px', width: `${box.width}px` });
  }

  private cols(): HTMLCollectionOf<HTMLElement> {
    return (this.hit.tableEl.querySelector(':scope > colgroup')?.children ?? document.createElement('colgroup').children) as HTMLCollectionOf<HTMLElement>;
  }

  move(x: number, y: number) {
    const delta = ((this.hit.kind === 'col' ? x - this.startX : y - this.startY)) / this.scale;
    // A small slip of the hand changes nothing.
    if (!this.moved && Math.abs(delta) < 6) return;
    this.moved = true;
    this.placeGuide(delta);
    if (this.hit.kind === 'col') {
      this.sizes[this.hit.index] = Math.max(MIN_COL, Math.round(this.startSize + delta));
      const cols = this.cols();
      this.sizes.forEach((w, i) => { if (cols[i]) { cols[i].style.minWidth = ''; cols[i].style.width = `${w}px`; } });
      this.hit.tableEl.style.width = `${this.sizes.reduce((a, b) => a + b, 0)}px`;
      this.hit.tableEl.style.minWidth = '';
    } else if (this.styleEl) {
      const height = Math.max(MIN_ROW, Math.round(this.startSize + delta));
      this.sizes = [height];
      this.styleEl.textContent = `table[data-resizing] > tbody > tr:nth-child(${this.hit.index + 1}) { height: ${height}px !important; }`;
    }
  }

  private cleanup() {
    document.body.classList.remove('table-resizing-col', 'table-resizing-row');
    this.styleEl?.remove();
    this.guide.remove();
    this.hit.tableEl.removeAttribute('data-resizing');
  }

  cancel() {
    const cols = this.cols();
    this.colStyles.forEach((css, i) => { if (cols[i]) cols[i].style.cssText = css; });
    this.hit.tableEl.style.cssText = this.tableStyle;
    this.cleanup();
  }

  finish() {
    if (!this.moved) return this.cancel();
    const { state } = this.view;
    const table = state.doc.nodeAt(this.hit.tablePos);
    if (!table || table.type.spec.tableRole !== 'table') return this.cancel();
    const start = this.hit.tablePos + 1;
    const tr = state.tr;
    if (this.hit.kind === 'col') {
      const map = TableMap.get(table);
      for (const cellPos of new Set(map.map)) {
        const r = map.findCell(cellPos);
        const cell = table.nodeAt(cellPos)!;
        const colwidth = this.sizes.slice(r.left, r.right).map((w) => Math.round(w));
        if (JSON.stringify(cell.attrs.colwidth) !== JSON.stringify(colwidth)) tr.setNodeMarkup(start + cellPos, undefined, { ...cell.attrs, colwidth });
      }
    } else {
      let offset = 0;
      table.forEach((_row, rowOffset, index) => { if (index === this.hit.index) offset = rowOffset; });
      const row = table.child(this.hit.index);
      tr.setNodeMarkup(start + offset, undefined, { ...row.attrs, height: this.sizes[0] });
    }
    this.cleanup();
    if (tr.docChanged) this.view.dispatch(tr);
    else this.cancel();
  }
}

const tableResizeKey = new PluginKey('tableResize');

// While a line is dragged (or cells are picked by touch) the selection must not follow the
// finger: Android moves the caret along with a held finger, and the note then jumped to where
// the finger was let go. Selection changes coming from the page are dropped until a moment
// after the drag; then the page's caret is put back where the editor's selection is.
const tableResizePlugin = () => {
  let lockedUntil = 0;
  let locked = false;
  const isLocked = () => locked || Date.now() < lockedUntil;
  return new Plugin({
  key: tableResizeKey,
  filterTransaction(tr) {
    return !(isLocked() && tr.selectionSet && !tr.docChanged && !tr.getMeta(tableResizeKey));
  },
  view(view) {
    const dom = view.dom as HTMLElement;
    let drag: Drag | null = null;
    let cursor = '';
    let syncTimer: ReturnType<typeof setTimeout> | undefined;
    const lock = () => {
      locked = true;
      clearTimeout(syncTimer);
    };
    const unlock = () => {
      if (!locked) return;
      locked = false;
      lockedUntil = Date.now() + 350;
      clearTimeout(syncTimer);
      syncTimer = setTimeout(() => {
        // The page's caret (moved by the finger) back to the editor's selection.
        const { selection } = view.state;
        if (selection instanceof CellSelection || !view.hasFocus()) return;
        try {
          const a = view.domAtPos(selection.anchor);
          const h = view.domAtPos(selection.head);
          document.getSelection()?.setBaseAndExtent(a.node, a.offset, h.node, h.offset);
        } catch { /* the DOM changed meanwhile */ }
      }, 380);
    };
    // A long press would also open the text menu.
    const onContextMenu = (e: Event) => { if (locked) e.preventDefault(); };

    // Mouse: the cursor shows where a line can be dragged.
    const onHover = (e: MouseEvent) => {
      if (drag || e.buttons) return;
      const hit = hitTest(view, e.target, e.clientX, e.clientY, MOUSE_TOL);
      const next = hit ? (hit.kind === 'col' ? 'col-resize' : 'row-resize') : '';
      if (next !== cursor) { cursor = next; dom.style.cursor = next; }
    };
    const onMouseMove = (e: MouseEvent) => drag?.move(e.clientX, e.clientY);
    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      drag?.finish();
      drag = null;
      unlock();
    };
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0 || drag) return;
      const hit = hitTest(view, e.target, e.clientX, e.clientY, MOUSE_TOL);
      if (!hit) return;
      e.preventDefault();
      e.stopPropagation();
      lock();
      drag = new Drag(view, hit, e.clientX, e.clientY);
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    };

    // Touch: hold a finger still for a moment (HOLD_MS), then drag. On a line it resizes;
    // inside a cell it selects cells up to the one under the finger (like dragging the mouse
    // across cells). Moving at once scrolls as usual, a plain tap stays a tap.
    let touch: { x: number; y: number; hit: Hit | null; cell: number | null; armed: boolean; selecting: boolean; timer: ReturnType<typeof setTimeout> } | null = null;
    const endTouch = () => {
      if (touch) clearTimeout(touch.timer);
      touch = null;
    };
    const onTouchStart = (e: TouchEvent) => {
      endTouch();
      if (e.touches.length !== 1 || drag || !view.editable) return;
      const t = e.touches[0];
      const hit = hitTest(view, e.target, t.clientX, t.clientY, TOUCH_TOL);
      const cell = hit ? null : cellAtPoint(view, t.clientX, t.clientY);
      if (!hit && cell === null) return;
      const started = { x: t.clientX, y: t.clientY, hit, cell, armed: false, selecting: false, timer: setTimeout(() => {
        if (touch !== started) return;
        started.armed = true;
        try { navigator.vibrate?.(8); } catch { /* not allowed */ }
        // On a line: resizing from now on. In a cell only once the finger moves, so a long
        // press still selects a word there.
        if (started.hit) { lock(); drag = new Drag(view, started.hit, started.x, started.y); }
      }, HOLD_MS) };
      touch = started;
    };
    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!touch || !t) return;
      if (!touch.armed) {
        if (Math.hypot(t.clientX - touch.x, t.clientY - touch.y) > 8) endTouch();
        return;
      }
      if (!e.cancelable) {
        drag?.cancel();
        drag = null;
        endTouch();
        unlock();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      lock();
      if (drag) return drag.move(t.clientX, t.clientY);
      const head = cellAtPoint(view, t.clientX, t.clientY);
      if (touch.cell !== null && head !== null && (head !== touch.cell || touch.selecting)) {
        touch.selecting = selectCells(view, touch.cell, head) || touch.selecting;
      }
    };
    const onTouchEnd = (e: TouchEvent) => {
      const was = touch;
      endTouch();
      unlock();
      if (drag) {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === 'touchcancel') drag.cancel(); else drag.finish();
        drag = null;
      } else if (was?.selecting) {
        // The selection stays; the lifted finger is not a tap.
        e.preventDefault();
        e.stopPropagation();
      }
    };

    dom.addEventListener('contextmenu', onContextMenu, true);
    dom.addEventListener('mousemove', onHover);
    dom.addEventListener('mousedown', onMouseDown, true);
    dom.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
    dom.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
    dom.addEventListener('touchend', onTouchEnd, { capture: true, passive: false });
    dom.addEventListener('touchcancel', onTouchEnd, { capture: true, passive: false });
    return {
      destroy() {
        drag?.cancel();
        clearTimeout(syncTimer);
        dom.removeEventListener('contextmenu', onContextMenu, true);
        dom.removeEventListener('mousemove', onHover);
        dom.removeEventListener('mousedown', onMouseDown, true);
        dom.removeEventListener('touchstart', onTouchStart, true);
        dom.removeEventListener('touchmove', onTouchMove, true);
        dom.removeEventListener('touchend', onTouchEnd, true);
        dom.removeEventListener('touchcancel', onTouchEnd, true);
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      },
    };
  },
  });
};

export const TableResize = Extension.create({
  name: 'tableResize',
  addProseMirrorPlugins() {
    return [tableResizePlugin()];
  },
});
