import type { Editor } from '@tiptap/core';
import { NodeSelection, Selection, TextSelection } from '@tiptap/pm/state';
import katex from 'katex';
import {
  mdiPlus, mdiFormatBold, mdiFormatItalic, mdiFormatUnderline, mdiDotsVertical, mdiMinus, mdiChevronDown, mdiChevronUp, mdiChevronRight,
  mdiArrowLeft, mdiFormatListBulleted, mdiFormatListNumbered, mdiFormatListCheckbox, mdiNoteTextOutline, mdiLinkPlus, mdiFormatAlignLeft,
  mdiFormatAlignCenter, mdiFormatAlignRight, mdiViewColumnOutline, mdiArrowExpandVertical, mdiFormatAlignJustify, mdiFormatIndentDecrease,
  mdiFormatIndentIncrease, mdiFormatStrikethrough, mdiCodeTags, mdiFormatSubscript, mdiFormatSuperscript, mdiMarker, mdiFormatColorText,
  mdiFunctionVariant, mdiPin, mdiPinOutline, mdiInvertColorsOff, mdiClose, mdiTable, mdiVectorLink, mdiOpenInNew, mdiLinkVariantOff,
  mdiContentCopy, mdiPencilOutline, mdiBookOutline, mdiPound, mdiCheck, mdiTabPlus, mdiLanguageMarkdownOutline, mdiTextBoxOutline,
  mdiFilePdfBox, mdiShareVariantOutline, mdiTableCog, mdiTableEdit, mdiPaletteOutline, mdiEyeOutline, mdiDownload, mdiImageSizeSelectLarge
} from '@mdi/js';
import {
  moveTableRowBy, moveTableColumnBy, selectTablePart, equalColumnWidths, equalRowHeights, resetRowHeights, TABLE_MOVE_MERGED,
} from '@noted/editor/table-tools';
import type { TableMoveResult } from '@noted/editor/table-tools';
import { insertImageFromUrl } from '@noted/editor/blob-image';
import { toolbarGroups, toolbarItem, CELL_TOOLBAR_ITEMS } from '@noted/editor/toolbar-items';
import type { ToolbarConfig } from '@noted/editor/toolbar-items';
import { slashItems, HEADING_ICONS } from '@noted/editor/slash-items';
import type { SlashItem } from '@noted/editor/slash';
import { activate, searchNav } from '@noted/editor/slash-nav';
import type { NavModel } from '@noted/editor/slash-nav';
import { insertTableAt } from '@noted/editor/table-actions';
import { CellSelection } from '@tiptap/pm/tables';
import {
  selectedImage, imageElementAt, currentImageAlign, setImageAlign, currentImageSideBySide, setImageSideBySide, matchImageRowHeights, imageRowAt, imageSize, setImageWidth, downloadSelectedImage,
} from '@noted/editor/image-tools';
import { openImageViewer } from '@noted/editor/image-viewer';
import { EDITOR_COLORS, hexToHsv, hsvToHex } from '@noted/editor/palette';
import type { Hsv } from '@noted/editor/palette';
import { EDITOR_FONT_SIZES } from '@noted/editor/font-sizes';
import { EDITOR_FONTS } from '@noted/editor/fonts';
import { searchNotes } from '@noted/editor/note-search';
import { normalizeLinkUrl } from '@noted/editor/link-utils';
import { commitMathEdit, requestMathEdit } from '@noted/editor/math';
import type { MathEditRequest } from '@noted/editor/math';
import { commitReminderEdit, getReminderTimes } from '@noted/editor/reminder';
import type { ReminderEditRequest } from '@noted/editor/reminder';
import { renderReminderPicker } from '@noted/editor/reminder-picker';

// Formatting toolbar above the keyboard (mobile WebView, plain DOM), modelled on Notesnook:
//   main row:  +  B I U  ⋮ | − 16px + | Paragraph ▾ | Font ▾ | lists | note link, link,
//              alignment, outdent, indent
//   ⋮ card:    S, code, sub, sup, highlighter ^, text colour ^, math | pin (keep it open)
// Sheets (insert menu, sizes, headings, ...) slide up above the bar. Buttons cancel mousedown,
// which on Android keeps the focus (and the keyboard) in the editor while scrolling still works.

export interface ToolbarContext {
  // Titles of all notes (id -> title) and the open note's id, for the note link picker.
  titles: () => Record<string, string>;
  places: () => Record<string, string>;
  archived: () => Set<string>;
  currentNoteId: () => string | null;
  // Font of the whole note (like the desktop toolbar).
  noteFont: () => 'sans' | 'serif' | 'mono';
  setNoteFont: (font: 'sans' | 'serif' | 'mono') => void;
  // Notebook / tags of this note and the catalog of names (React Native creates entries).
  catalog: () => { notebooks: { id: string; name: string }[]; tags: { id: string; name: string }[] };
  noteNotebooks: () => string[];
  noteTags: () => string[];
  toggleNotebook: (id: string) => void;
  toggleTag: (id: string) => void;
  createEntry: (kind: 'notebooks' | 'tags', name: string) => Promise<{ id: string; name: string } | null>;
  // A new note with this title (in this note's notebooks), made by React Native; its id.
  createNote: (title: string) => Promise<string | null>;
  // External link actions done by React Native.
  openUrl: (href: string) => void;
  copy: (text: string) => void;
  // Note links: open in a new tab, or next to this note (split view).
  openNote: (id: string) => void;
  // "/linkto": a link to this note goes at the end of note `id` (React Native changes it).
  linkFrom: (id: string, title: string) => void;
  openSplit: (id: string, side: SplitSide) => void;
  // Export of the note (React Native saves / shares the file).
  exportNote: (format: 'markdown' | 'text' | 'pdf', share: boolean) => void;
  // The keyboard is about to come up (focus given by code): React Native makes room for it
  // at once, so Chromium does not first push the text up under it.
  expectKeyboard: () => void;
}

export type SplitSide = 'left' | 'right' | 'top' | 'bottom';

// Split view icon: a square with a dashed middle line, the new note's half filled.
export const splitIcon = (side: SplitSide, size = 22): string => {
  const half = { left: 'x="3" y="3" width="9" height="18"', right: 'x="12" y="3" width="9" height="18"', top: 'x="3" y="3" width="18" height="9"', bottom: 'x="3" y="12" width="18" height="9"' }[side];
  const line = side === 'left' || side === 'right' ? 'x1="12" y1="3" x2="12" y2="21"' : 'x1="3" y1="12" x2="21" y2="12"';
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><rect ${half} fill="currentColor" opacity="0.85"/>`
    + `<line ${line} stroke="currentColor" stroke-width="1.6" stroke-dasharray="2.2 1.8"/>`
    + `<rect x="3" y="3" width="18" height="18" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;
};

type El = HTMLElement;

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
};

// Icon paths are constants from @mdi/js, never user data.
const svg = (path: string, size = 22) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><path d="${path}" fill="currentColor"/></svg>`;

// Items the insert sheet cannot offer on the phone yet (they need file access / downloads).
const UNAVAILABLE_ON_MOBILE = new Set<string>([]);
const unavailable = (item: SlashItem) => item.title.split(' › ').some((part) => UNAVAILABLE_ON_MOBILE.has(part));


const ALIGN_ICONS = { left: mdiFormatAlignLeft, center: mdiFormatAlignCenter, right: mdiFormatAlignRight, justify: mdiFormatAlignJustify } as const;
// List styles drawn like the slash menu tiles: markers next to text bars.
const BULLETS: { style: string; label: string; markers: string[] }[] = [
  { style: 'disc', label: 'Disc', markers: ['•', '•', '•'] },
  { style: 'circle', label: 'Circle', markers: ['◦', '◦', '◦'] },
  { style: 'square', label: 'Square', markers: ['▪', '▪', '▪'] },
  { style: 'square-open', label: 'Open square', markers: ['▫', '▫', '▫'] },
  { style: 'outline', label: 'Outline', markers: ['▾', '  ▸', '▸'] },
];
const NUMBERS: { style: string; label: string; markers: string[] }[] = [
  { style: 'decimal', label: '1, 2, 3', markers: ['1.', '2.', '3.'] },
  { style: 'upper-alpha', label: 'A, B, C', markers: ['A.', 'B.', 'C.'] },
  { style: 'lower-alpha', label: 'a, b, c', markers: ['a.', 'b.', 'c.'] },
  { style: 'upper-roman', label: 'I, II, III', markers: ['I.', 'II.', 'III.'] },
  { style: 'lower-roman', label: 'i, ii, iii', markers: ['i.', 'ii.', 'iii.'] },
  { style: 'lower-greek', label: 'α, β, γ', markers: ['α.', 'β.', 'γ.'] },
];
const BASE_FONT_PX = 16;
const TABLE_COLS = 10;
const TABLE_ROWS = 6;
const PIN_KEY = 'noted_toolbar_pinned';

const TABLE_PIN_KEY = 'noted_table_row_pinned';
// The pinned table subgroup (its index in Settings > Toolbar > Table).
const readTablePinned = (): number | null => {
  try {
    const v = localStorage.getItem(TABLE_PIN_KEY);
    return v && /^\d+$/.test(v) ? Number(v) : null;
  } catch {
    return null;
  }
};
const writeTablePinned = (value: number | null) => {
  try { localStorage.setItem(TABLE_PIN_KEY, value === null ? '' : String(value)); } catch { /* not available in this WebView */ }
};
const readPinned = (): boolean => {
  try { return localStorage.getItem(PIN_KEY) === '1'; } catch { return false; }
};
const writePinned = (value: boolean) => {
  try { localStorage.setItem(PIN_KEY, value ? '1' : '0'); } catch { /* not available in this WebView */ }
};

export function createToolbar(editor: Editor, ctx: ToolbarContext) {
  const root = h('div', 'tb');
  const sheet = h('div', 'tb-sheet');
  const float = h('div', 'tb-float');
  const colorRow = h('div', 'tb-float tb-colors');
  const alignRow = h('div', 'tb-float tb-align');
  // Table rows (shown while the cursor is in a table, like Notesnook): table and cell options.
  // The open table subgroup's buttons (Settings > Toolbar > Table).
  const tableRow = h('div', 'tb-float');
  // The selected image: preview, download, alignment, size (like the desktop image menu).
  const imageRow = h('div', 'tb-float');
  let tableOpen: number | null = null;
  // Shown while the cursor is inside a link: address, open, edit, remove, copy.
  const linkBar = h('div', 'tb-float tb-linkbar');
  // Results of "/" typed in the text (the insert menu, searched).
  const slashPanel = h('div', 'tb-float tb-slash');
  const main = h('div', 'tb-main');
  root.append(sheet, slashPanel, linkBar, colorRow, float, alignRow, tableRow, imageRow, main);
  document.body.appendChild(root);
  // Long press on a note link: open it in a new tab or next to this note.
  const noteLinkBar = h('div', 'tb-float tb-notelink');
  document.body.appendChild(noteLinkBar);
  noteLinkBar.addEventListener('mousedown', (e) => e.preventDefault());

  // Inputs inside sheets may take focus; everything else keeps it in the editor.
  root.addEventListener('mousedown', (e) => {
    if (!(e.target as El).closest('input, textarea')) e.preventDefault();
  });

  const refreshers: (() => void)[] = [];
  // ProseMirror's own scrolling does not know about the keyboard: centerCaret scrolls instead.
  const chain = () => editor.chain().focus(undefined, { scrollIntoView: false });

  const button = (icon: string, title: string, action: () => void, isActive?: () => boolean, cls = '', size = 22): HTMLButtonElement => {
    const b = h('button', `tb-btn ${cls}`.trim());
    b.type = 'button';
    b.title = title;
    b.setAttribute('aria-label', title);
    b.innerHTML = svg(icon, size);
    b.addEventListener('click', (e) => {
      e.preventDefault();
      action();
    });
    if (isActive) refreshers.push(() => b.classList.toggle('active', isActive()));
    return b;
  };
  const textButton = (title: string, label: () => string, action: () => void, cls = ''): HTMLButtonElement => {
    const b = h('button', `tb-btn tb-text ${cls}`.trim());
    b.type = 'button';
    b.title = title;
    b.addEventListener('click', (e) => { e.preventDefault(); action(); });
    const render = () => { b.innerHTML = ''; b.append(label()); b.insertAdjacentHTML('beforeend', svg(mdiChevronDown, 16)); };
    refreshers.push(render);
    render();
    return b;
  };
  const sep = () => h('span', 'tb-sep');

  // An image or a file card picked by a tap: no keyboard, but the bar (with the image row)
  // stays at the bottom of the page.
  const atomWithoutKeyboard = () => (editor.view.dom as HTMLElement).inputMode === 'none' && editor.isFocused;

  // ---- sheets ----
  let openSheet: string | null = null;
  // The editor had the cursor when the sheet opened: closing the sheet (or picking something)
  // puts the cursor back where it was and brings the keyboard back.
  let returnToEditor = false;
  let returnToTitle: HTMLElement | null = null;
  // The keyboard was up when the sheet opened (sheets other than "+" keep it up).
  let keyboardWasUp = false;
  // The open sheet is the insert menu, which keeps the keyboard down.
  let sheetHidesKeyboard = false;
  const blurSheetInput = () => {
    const active = document.activeElement as El | null;
    if (active && sheet.contains(active) && active.matches('input, textarea')) active.blur();
  };
  const closeSheet = (restore = true) => {
    const back = restore && returnToEditor && openSheet !== null;
    const title = restore && openSheet !== null ? returnToTitle : null;
    openSheet = null;
    returnToEditor = false;
    returnToTitle = null;
    root.classList.remove('inserting', 'no-bar');
    sheet.replaceChildren();
    sheet.classList.remove('open');
    sheetHidesKeyboard = false;
    if (title) {
      title.focus({ preventScroll: true });
      return;
    }
    if (back) {
      // No scrolling now: with the keyboard coming back the text would first jump to where
      // it is visible without it. Centring follows when the keyboard is up (onViewport).
      if (!keyboardUp()) ctx.expectKeyboard();
      holdScroll();
      editor.commands.focus(undefined, { scrollIntoView: false });
      if (keyboardUp()) centerCaretSoon();
      return;
    }
    // Closed without going back to the text: with the editor not focused, the bar goes too.
    setTimeout(() => {
      if (!openSheet && !editor.isFocused && !root.contains(document.activeElement)) show(false);
    }, 0);
  };
  // The insert menu ("+", and everything opened from it) hides the keyboard until an input in
  // it is tapped; the other sheets keep the keyboard and sit above it. A sheet never grows
  // taller than the space left above the bar.
  // `hideBar`: the toolbar row goes away too while the sheet is open (a sheet with its own
  // buttons at the bottom, like the reminder picker).
  const showSheet = (name: string, title: string, build: (body: El) => void, onBack?: () => void, opts: { hideKeyboard?: boolean; hideBar?: boolean } = {}) => {
    if (openSheet === null) {
      returnToEditor = editor.isFocused;
      // Typing in the title counts too: the sheet's search field takes the keys then.
      const title = document.activeElement?.id === 'title' ? document.activeElement as HTMLElement : null;
      returnToTitle = title;
      keyboardWasUp = editor.isFocused || !!title;
    }
    openSheet = name;
    hideSlash();
    if (opts.hideKeyboard) {
      keyboardWasUp = false;
      if (editor.isFocused) (editor.view.dom as HTMLElement).blur();
      // The editor keeps its selection (in its own state); the painted one would show through.
      window.getSelection()?.removeAllRanges();
    }
    sheet.replaceChildren();
    sheetHidesKeyboard = !!opts.hideKeyboard;
    root.classList.toggle('inserting', sheetHidesKeyboard);
    root.classList.toggle('no-bar', !!opts.hideBar);
    const head = h('div', 'tb-sheet-head');
    if (onBack) head.append(button(mdiArrowLeft, 'Back', onBack, undefined, 'tb-small'));
    head.append(h('div', 'tb-sheet-title', title), button(mdiClose, 'Close', () => closeSheet(), undefined, 'tb-small'));
    const body = h('div', 'tb-sheet-body');
    sheet.append(h('div', 'tb-handle'), head, body);
    build(body);
    sheet.classList.add('open');
    show(true);
    place();
  };
  // A search field gets the focus right away when the keyboard is up anyway.
  const focusIfTyping = (input: HTMLInputElement | HTMLTextAreaElement) => {
    if (keyboardWasUp) setTimeout(() => input.focus(), 30);
  };
  // Typing in a sheet brings the keyboard: keep the sheet's main button above it.
  const revealSheetAction = () => {
    if (!sheet.contains(document.activeElement)) return;
    const target = sheet.querySelector('.tb-primary') ?? sheet.querySelector('.tb-actions');
    (target as El | null)?.scrollIntoView({ block: 'nearest' });
  };
  sheet.addEventListener('focusin', (e) => {
    if (!(e.target as El).matches('input, textarea')) return;
    setTimeout(revealSheetAction, 300);
    setTimeout(revealSheetAction, 600);
  });
  // Tapping an input that already has the focus (after the keyboard was hidden with Back).
  sheet.addEventListener('click', (e) => {
    if ((e.target as El).matches('input, textarea')) setTimeout(revealSheetAction, 450);
  });

  const toggleSheet = (name: string, title: string, build: (body: El) => void) => {
    if (openSheet === name) closeSheet();
    else showSheet(name, title, build);
  };

  const row = (label: string, run: () => void, opts: { icon?: string; chevron?: boolean; active?: boolean; style?: Partial<CSSStyleDeclaration>; sub?: string } = {}) => {
    const b = h('button', 'tb-row');
    b.type = 'button';
    if (opts.icon) b.insertAdjacentHTML('beforeend', svg(opts.icon, 22));
    const text = h('span', 'tb-row-label', label);
    if (opts.style) Object.assign(text.style, opts.style);
    if (opts.sub) {
      // A second, smaller line (where a note is).
      const box = h('span', 'tb-row-label tb-row-two');
      text.className = 'tb-row-main';
      box.append(text, h('span', 'tb-row-sub', opts.sub));
      b.append(box);
    } else b.append(text);
    if (opts.chevron) b.insertAdjacentHTML('beforeend', svg(mdiChevronRight, 22));
    if (opts.active) b.classList.add('active');
    b.addEventListener('click', (e) => { e.preventDefault(); run(); });
    return b;
  };

  // A style as a small picture: markers next to text bars.
  const tile = (markers: string[], label: string, run: () => void, active = false) => {
    const b = h('button', `tb-tile${active ? ' active' : ''}`);
    b.type = 'button';
    b.title = label;
    for (const marker of markers) {
      const line = h('div', 'tb-tile-line');
      line.append(h('span', 'tb-tile-marker', marker), h('span', 'tb-tile-bar'));
      b.append(line);
    }
    b.addEventListener('click', (e) => { e.preventDefault(); run(); });
    return b;
  };

  // Runs an action of a sheet: back into the editor (the keyboard returns), then the result is
  // scrolled to the middle of what stays visible above the keyboard and the toolbar.
  const runInEditor = (action: () => void) => {
    closeSheet();
    action();
    if (keyboardUp()) centerCaretSoon();
  };
  const insertItems = (items: SlashItem[]) => items.filter((i) => !unavailable(i));

  // ---- insert sheet ("+"): the slash menu tree ----
  const at = () => ({ from: editor.state.selection.from, to: editor.state.selection.from });
  const insertSheet = (items: SlashItem[], title: string, parents: { items: SlashItem[]; title: string; tiles?: boolean }[] = [], tiles = false) => {
    const back = parents.length ? () => { const p = parents[parents.length - 1]; insertSheet(p.items, p.title, parents.slice(0, -1), p.tiles); } : undefined;
    showSheet('insert', title, (body) => {
      if (tiles) {
        const grid = h('div', 'tb-tiles');
        for (const item of items) {
          const markers = item.preview?.kind === 'markers' ? item.preview.markers : [item.title];
          grid.append(tile(markers, item.title, () => runInEditor(() => item.command?.({ editor, range: at() }))));
        }
        body.append(grid);
        return;
      }
      for (const item of insertItems(items)) {
        const preview = item.preview;
        const icon = item.icon;
        const label = preview?.kind === 'markers' ? `${preview.markers.join('  ')}   ${item.title}`
          : preview?.kind === 'icon' && !icon ? `${preview.icon}   ${item.title}` : item.title;
        body.append(row(label, () => {
          const sub = item.submenu;
          const path = [...parents, { items, title, tiles }];
          if (sub?.kind === 'table') return tableSheet(() => insertSheet(items, title, parents, tiles));
          if (sub) return insertSheet(sub.items, item.title, path, sub.kind === 'tiles');
          if (item.title === 'Link to note') return noteLinkSheet();
          runInEditor(() => item.command?.({ editor, range: at() }));
        }, { icon, chevron: !!item.submenu }));
      }
    }, back, { hideKeyboard: true });
  };

  const tableSheet = (onBack: () => void, hideKeyboard = true) => {
    showSheet('insert', 'Insert a table', (body) => {
      let cols = 0;
      let rows = 0;
      const grid = h('div', 'tb-table-grid');
      const cells: El[] = [];
      const colsInput = h('input', 'tb-input');
      const rowsInput = h('input', 'tb-input');
      const insert = h('button', 'tb-primary', 'Please set a table size');
      const update = () => {
        cells.forEach((cell, i) => cell.classList.toggle('on', i % TABLE_COLS < cols && Math.floor(i / TABLE_COLS) < rows));
        colsInput.value = String(cols);
        rowsInput.value = String(rows);
        insert.textContent = cols && rows ? `Insert ${cols} × ${rows} table` : 'Please set a table size';
        insert.disabled = !(cols && rows);
      };
      for (let i = 0; i < TABLE_COLS * TABLE_ROWS; i++) {
        const cell = h('div', 'tb-cell');
        // A size field keeps the focus after Back hid the keyboard; tapping the grid must not
        // bring the keyboard back.
        cell.addEventListener('mousedown', () => blurSheetInput());
        cell.addEventListener('click', () => { cols = (i % TABLE_COLS) + 1; rows = Math.floor(i / TABLE_COLS) + 1; update(); });
        cells.push(cell);
        grid.append(cell);
      }
      const field = (input: HTMLInputElement, unit: string, set: (n: number) => void) => {
        input.inputMode = 'numeric';
        input.addEventListener('input', () => { set(Math.max(0, Math.min(50, parseInt(input.value, 10) || 0))); update(); });
        const wrap = h('label', 'tb-field');
        wrap.append(input, h('span', '', unit));
        return wrap;
      };
      const fields = h('div', 'tb-fields');
      fields.append(field(colsInput, 'columns', (n) => { cols = n; }), field(rowsInput, 'rows', (n) => { rows = n; }));
      insert.addEventListener('click', () => {
        if (!cols || !rows) return;
        runInEditor(() => insertTableAt(editor, at(), cols, rows));
      });
      body.append(grid, fields, insert);
      update();
    }, onBack, { hideKeyboard });
  };

  // ---- format sheets ----
  const fontSize = () => editor.getAttributes('textStyle').fontSize as string | undefined;
  const px = () => (fontSize() ? parseInt(fontSize()!, 10) : BASE_FONT_PX);
  const setPx = (value: number) => chain().setFontSize(`${Math.max(6, Math.min(96, Math.round(value)))}px`).run();

  const sizeSheet = () => toggleSheet('size', 'Font size', (body) => {
    const input = h('input', 'tb-input tb-size-input');
    input.inputMode = 'numeric';
    input.value = String(px());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); const n = parseInt(input.value, 10); if (n) setPx(n); closeSheet(); }
    });
    const apply = h('button', 'tb-primary', 'Apply');
    apply.addEventListener('click', () => { const n = parseInt(input.value, 10); if (n) setPx(n); closeSheet(); });
    const top = h('div', 'tb-fields');
    top.append(input, apply);
    const chips = h('div', 'tb-chips');
    const chip = (label: string, active: boolean, run: () => void) => {
      const c = h('button', `tb-chip${active ? ' active' : ''}`, label);
      c.addEventListener('click', () => { run(); closeSheet(); });
      return c;
    };
    chips.append(chip('Default', !fontSize(), () => chain().unsetFontSize().run()));
    for (const size of EDITOR_FONT_SIZES) chips.append(chip(String(size), fontSize() === `${size}px`, () => setPx(size)));
    body.append(top, chips);
  });

  const paragraphSheet = () => toggleSheet('type', 'Text type', (body) => {
    body.append(row('Paragraph', () => runInEditor(() => chain().setParagraph().run()), { active: editor.isActive('paragraph') }));
    ([1, 2, 3, 4, 5, 6] as const).forEach((level) => {
      body.append(row(`Heading ${level}`, () => runInEditor(() => chain().setHeading({ level }).run()), {
        icon: HEADING_ICONS[level - 1], active: editor.isActive('heading', { level }),
        style: { fontSize: `${[22, 20, 18, 17, 16, 14][level - 1]}px`, fontWeight: '700' },
      }));
    });
  });

  // Font of the selected text when something is selected, otherwise of the whole note.
  const selectionFont = () => EDITOR_FONTS.find((f) => f.css === editor.getAttributes('textStyle').fontFamily)?.name ?? null;
  const fontSheet = () => {
    const forSelection = !editor.state.selection.empty;
    const current = forSelection ? selectionFont() : ctx.noteFont();
    toggleSheet('font', forSelection ? 'Font of the selected text' : 'Font of this note', (body) => {
      if (forSelection) body.append(row('Same as the note', () => runInEditor(() => chain().unsetTextFont().run()), { active: current === null }));
      for (const f of EDITOR_FONTS) {
        body.append(row(f.label, () => runInEditor(() => (forSelection ? chain().setTextFont(f.name).run() : ctx.setNoteFont(f.name))), {
          active: current === f.name, style: { fontFamily: f.css },
        }));
      }
    });
  };

  const listStyleSheet = (kind: 'bullet' | 'number') => toggleSheet(`list-${kind}`, kind === 'bullet' ? 'Bullet style' : 'Numbering style', (body) => {
    const attrs = editor.getAttributes(kind === 'bullet' ? 'bulletList' : 'orderedList');
    const current = kind === 'bullet' ? (attrs.outline ? 'outline' : attrs.bulletStyle ?? 'disc') : attrs.numberStyle ?? 'decimal';
    const inList = editor.isActive(kind === 'bullet' ? 'bulletList' : 'orderedList');
    const grid = h('div', 'tb-tiles');
    for (const option of kind === 'bullet' ? BULLETS : NUMBERS) {
      grid.append(tile(option.markers, option.label, () => runInEditor(() => {
        const c = chain();
        if (kind === 'bullet') {
          if (!editor.isActive('bulletList')) c.toggleBulletList();
          if (option.style === 'outline') c.updateAttributes('bulletList', { outline: true });
          else c.updateAttributes('bulletList', { bulletStyle: option.style === 'disc' ? null : option.style, outline: false });
        } else {
          if (!editor.isActive('orderedList')) c.toggleOrderedList();
          c.updateAttributes('orderedList', { numberStyle: option.style === 'decimal' ? null : option.style });
        }
        c.run();
      }), inList && current === option.style));
    }
    body.append(grid);
  });

  const currentAlign = () => (['center', 'right', 'justify'] as const).find((k) => editor.isActive({ textAlign: k })) ?? 'left';

  // Note picker: 'link' inserts a note link ("[["), 'goto' opens the note ("/goto"),
  // 'linkto' puts a link to this note at the end of the picked one ("/linkto").
  const NOTE_SHEET_TITLES = { link: 'Link to note', goto: 'Go to note', linkto: 'Add a link to this note in…' };
  const noteLinkSheet = (mode: 'link' | 'goto' | 'linkto' = 'link') => showSheet('notelink', NOTE_SHEET_TITLES[mode], (body) => {
    const input = h('input', 'tb-input');
    input.placeholder = 'Search notes';
    const list = h('div', 'tb-list');
    const picked = (id: string, title: string) => {
      if (mode === 'link') return runInEditor(() => chain().insertNoteLink(id).run());
      closeSheet();
      if (mode === 'goto') ctx.openNote(id);
      else ctx.linkFrom(id, title);
    };
    const render = () => {
      const archived = ctx.archived();
      const notes = Object.entries(ctx.titles()).map(([id, title]) => ({ id, title, archived: archived.has(id) }));
      const results = searchNotes(notes, input.value, ctx.currentNoteId(), 30);
      const places = ctx.places();
      list.replaceChildren(...results.map((note) => row(note.title, () => picked(note.id, note.title), { icon: mdiNoteTextOutline, sub: places[note.id] })));
      // A title no note has yet: create that note (in this note's notebooks) and link it.
      const title = input.value.trim();
      if (title && mode !== 'goto') {
        const taken = notes.some((n) => n.title.trim().toLowerCase() === title.toLowerCase());
        list.append(row(`${taken ? 'Create another note' : 'Create note'} "${title}"`, () => {
          ctx.createNote(title).then((id) => { if (id) picked(id, title); }, () => {});
        }, { icon: mdiPlus }));
      }
      if (results.length === 0 && !title) list.append(h('div', 'tb-hint', 'No other notes yet'));
    };
    input.addEventListener('input', render);
    body.append(input, list);
    render();
    focusIfTyping(input);
  });

  // "Insert link": link text (the selection, if any) and the address.
  const linkSheet = () => {
    if (editor.state.selection.empty && editor.isActive('link')) editor.commands.extendMarkRange('link');
    showSheet('link', 'Insert link', (body) => {
      const { from, to, empty } = editor.state.selection;
      const selected = editor.state.doc.textBetween(from, to, ' ');
      const text = h('input', 'tb-input');
      text.placeholder = 'Link text';
      text.value = selected;
      const url = h('input', 'tb-input');
      url.placeholder = 'https://example.com/';
      url.inputMode = 'url';
      url.value = (editor.getAttributes('link').href as string | undefined) ?? '';
      const apply = () => {
        const href = normalizeLinkUrl(url.value);
        if (!href) { url.classList.add('invalid'); return; }
        const label = text.value.trim();
        runInEditor(() => {
          if (!empty && (!label || label === selected)) chain().extendMarkRange('link').setLink({ href }).run();
          else chain().insertContent({ type: 'text', text: label || url.value.trim(), marks: [{ type: 'link', attrs: { href } }] }).run();
        });
      };
      url.addEventListener('input', () => url.classList.remove('invalid'));
      for (const input of [text, url]) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } });
      const actions = h('div', 'tb-fields tb-end');
      if (editor.isActive('link')) {
        const remove = h('button', 'tb-secondary danger', 'Remove');
        remove.addEventListener('click', () => runInEditor(() => chain().extendMarkRange('link').unsetLink().run()));
        actions.append(remove);
      }
      const ok = h('button', 'tb-primary', 'Insert');
      ok.addEventListener('click', apply);
      actions.append(ok);
      body.append(h('div', 'tb-label', 'Link text'), text, h('div', 'tb-label', 'URL'), url, actions);
      focusIfTyping(selected ? url : text);
    });
  };

  // Notebooks or tags of this note (several of each). The sheet stays open while ticking them;
  // typing a new name creates it.
  const catalogSheet = (kind: 'notebooks' | 'tags') => showSheet(`catalog-${kind}`, kind === 'notebooks' ? 'Notebooks' : 'Tags', (body) => {
    const input = h('input', 'tb-input');
    input.placeholder = kind === 'notebooks' ? 'Search or create a notebook' : 'Search or create a tag';
    const list = h('div', 'tb-list');
    const fold = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/ł/g, 'l').trim();
    const toggle = (id: string) => (kind === 'notebooks' ? ctx.toggleNotebook(id) : ctx.toggleTag(id));
    const render = () => {
      const entries = kind === 'notebooks' ? ctx.catalog().notebooks : ctx.catalog().tags;
      const q = fold(input.value.replace(/^#/, ''));
      const selected = kind === 'notebooks' ? ctx.noteNotebooks() : ctx.noteTags();
      const matches = entries.filter((e) => fold(e.name).includes(q));
      list.replaceChildren(...matches.map((e) => {
        const on = selected.includes(e.id);
        return row(kind === 'tags' ? `#${e.name}` : e.name, () => { toggle(e.id); render(); }, {
          icon: on ? mdiCheck : kind === 'notebooks' ? mdiBookOutline : mdiPound, active: on,
        });
      }));
      if (q && !entries.some((e) => fold(e.name) === q)) {
        list.append(row(`Create “${input.value.replace(/^#/, '').trim()}”`, async () => {
          const entry = await ctx.createEntry(kind, input.value.replace(/^#/, '').trim());
          if (!entry) return;
          toggle(entry.id);
          input.value = '';
          render();
        }, { icon: mdiPlus }));
      }
      if (!list.childElementCount) list.append(h('div', 'tb-hint', 'Type a name to create one'));
    };
    input.addEventListener('input', render);
    body.append(input, list);
    render();
    focusIfTyping(input);
  });

  const renderLinkBar = () => {
    const href = editor.isFocused && editor.state.selection.empty && editor.isActive('link')
      ? (editor.getAttributes('link').href as string | undefined) : undefined;
    linkBar.classList.toggle('open', !!href && !openSheet);
    if (!href || linkBar.dataset.href === href) return;
    linkBar.dataset.href = href;
    const label = h('button', 'tb-link-url', href);
    label.addEventListener('click', () => ctx.openUrl(href));
    linkBar.replaceChildren(
      label,
      button(mdiOpenInNew, 'Open link', () => ctx.openUrl(href)),
      button(mdiPencilOutline, 'Edit link', () => linkSheet()),
      button(mdiLinkVariantOff, 'Remove link', () => chain().extendMarkRange('link').unsetLink().run()),
      button(mdiContentCopy, 'Copy link', () => ctx.copy(href)),
    );
  };

  // Slash / insert menu "Image from URL": React Native downloads it (no CORS limits there).
  const imageUrlSheet = (pos: number) => showSheet('imageurl', 'Image from URL', (body) => {
    const url = h('input', 'tb-input');
    url.placeholder = 'https://example.com/picture.jpg';
    url.inputMode = 'url';
    const ok = h('button', 'tb-primary', 'Insert image');
    const apply = () => {
      const href = normalizeLinkUrl(url.value);
      if (!href || !/^https?:/i.test(href)) { url.classList.add('invalid'); return; }
      ok.disabled = true;
      ok.textContent = 'Downloading…';
      closeSheet();
      insertImageFromUrl(editor, href, pos);
    };
    url.addEventListener('input', () => url.classList.remove('invalid'));
    url.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } });
    ok.addEventListener('click', apply);
    body.append(h('div', 'tb-label', 'Address of the image'), url, ok);
    setTimeout(() => url.focus(), 50);
  });
  editor.storage.image.requestUrl = imageUrlSheet;

  // "/export" (and the note menu): Markdown, plain text or PDF.
  const exportSheet = () => showSheet('export', 'Export note', (body) => {
    body.append(
      h('div', 'tb-hint', 'Saves the note into your download folder (Settings › Editor › Files). Markdown with images or files becomes a .zip with an attachments folder.'),
      row('Markdown (.md)', () => { closeSheet(); ctx.exportNote('markdown', false); }, { icon: mdiLanguageMarkdownOutline }),
      row('Plain text (.txt)', () => { closeSheet(); ctx.exportNote('text', false); }, { icon: mdiTextBoxOutline }),
      row('PDF', () => { closeSheet(); ctx.exportNote('pdf', false); }, { icon: mdiFilePdfBox }),
      h('div', 'tb-hint', 'Or send it with the share menu:'),
      row('Share as Markdown', () => { closeSheet(); ctx.exportNote('markdown', true); }, { icon: mdiShareVariantOutline }),
      row('Share as plain text', () => { closeSheet(); ctx.exportNote('text', true); }, { icon: mdiShareVariantOutline }),
      row('Share as PDF', () => { closeSheet(); ctx.exportNote('pdf', true); }, { icon: mdiShareVariantOutline }),
    );
  });

  // LaTeX editor for new or tapped formulas (registered as onEditMath).
  const openMathEditor = (request: MathEditRequest) => {
    showSheet('math', request.kind === 'inline' ? 'Inline math' : 'Math block', (body) => {
      const area = h('textarea', 'tb-input tb-math');
      area.value = request.mode === 'edit' ? request.latex : '';
      area.placeholder = request.kind === 'inline' ? 'LaTeX, e.g. E = mc^2' : 'LaTeX, e.g. \\sum_{i=1}^{n} x_i';
      const preview = h('div', 'tb-preview');
      const render = () => {
        if (!area.value.trim()) return preview.replaceChildren(h('span', 'tb-hint', 'Preview'));
        try {
          preview.innerHTML = katex.renderToString(area.value, { displayMode: request.kind === 'block', throwOnError: true });
        } catch (err) {
          preview.replaceChildren(h('span', 'tb-error', err instanceof Error ? err.message.replace(/^KaTeX parse error: /, '') : String(err)));
        }
      };
      area.addEventListener('input', render);
      const actions = h('div', 'tb-fields');
      const save = h('button', 'tb-primary', 'Save');
      save.addEventListener('click', () => { const value = area.value; closeSheet(); commitMathEdit(editor, request, value); });
      actions.append(save);
      if (request.mode === 'edit') {
        const del = h('button', 'tb-secondary danger', 'Delete');
        del.addEventListener('click', () => { closeSheet(); commitMathEdit(editor, request, ''); });
        actions.append(del);
      }
      body.append(area, preview, actions);
      render();
      setTimeout(() => area.focus(), 50);
    });
  };

  // Reminder picker for "/reminder" and tapped chips (registered as onEditReminder). The
  // keyboard stays down until the time field is tapped.
  const openReminderPicker = (request: ReminderEditRequest) => {
    showSheet('reminder', request.mode === 'edit' ? 'Reminder' : 'New reminder', (body) => {
      renderReminderPicker(body, {
        initial: request.mode === 'edit' ? request.attrs : undefined,
        times: getReminderTimes(editor),
        touch: true,
        onCommit: (commit) => { closeSheet(); commitReminderEdit(editor, request, commit); },
        onCancel: () => closeSheet(),
      });
    }, undefined, { hideKeyboard: true, hideBar: true });
  };

  // ---- ⋮ card and colours ----
  let floatOpen = readPinned();
  let pinned = floatOpen;
  let colorKind: 'text' | 'highlight' | 'cell' | null = null;
  const cellColor = () => (editor.getAttributes('tableCell').background ?? editor.getAttributes('tableHeader').background) as string | undefined;
  let lastText: string = EDITOR_COLORS[0].text;
  let lastHighlight: string = EDITOR_COLORS[2].background;

  const showColors = (kind: 'text' | 'highlight' | 'cell') => {
    colorKind = colorKind === kind ? null : kind;
    colorRow.replaceChildren();
    if (!colorKind) return refresh();
    colorRow.append(button(mdiInvertColorsOff, 'No colour', () => {
      if (kind === 'text') chain().unsetColor().run();
      else if (kind === 'cell') chain().setCellAttribute('background', null).run();
      else chain().unsetHighlight().run();
      colorKind = null; refresh();
    }, undefined, 'tb-swatch-none'));
    for (const c of EDITOR_COLORS) {
      const swatch = h('button', 'tb-swatch');
      swatch.type = 'button';
      swatch.title = c.label;
      swatch.style.backgroundColor = kind === 'text' ? c.text : c.background;
      swatch.addEventListener('click', () => {
        if (kind === 'text') { lastText = c.text; chain().setColor(c.text).run(); }
        else if (kind === 'cell') chain().setCellAttribute('background', c.background).run();
        else { lastHighlight = c.background; chain().setHighlight({ color: c.background }).run(); }
        colorKind = null;
        refresh();
      });
      colorRow.append(swatch);
    }
    const current = (kind === 'text' ? editor.getAttributes('textStyle').color : kind === 'cell' ? cellColor() : editor.getAttributes('highlight').color) as string | undefined;
    const pickerTitle = kind === 'text' ? 'Text colour' : kind === 'cell' ? 'Cell background' : 'Highlight colour';
    colorRow.append(customSwatch(current, () => colorPickerSheet(pickerTitle, current, (hex) => {
      if (kind === 'text') { lastText = hex; chain().setColor(hex).run(); }
      else if (kind === 'cell') chain().setCellAttribute('background', hex).run();
      else { lastHighlight = hex; chain().setHighlight({ color: hex }).run(); }
      colorKind = null;
    })));
    colorRow.append(button(mdiClose, 'Close', () => { colorKind = null; refresh(); }));
    refresh();
  };

  // Own colour (plain hex): a swatch showing it, or a palette icon; opens the picker sheet.
  const customSwatch = (current: string | undefined, open: () => void) => {
    const own = current && /^#[0-9a-f]{6}$/i.test(current) ? current : null;
    const b = button(mdiPaletteOutline, 'Custom colour', open, undefined, own ? 'tb-swatch' : 'tb-swatch-none');
    if (own) { b.innerHTML = ''; b.style.backgroundColor = own; b.style.outline = '2px solid currentColor'; }
    return b;
  };
  // Saturation / brightness square, hue bar and a hex field, like the desktop picker.
  const colorPickerSheet = (title: string, initial: string | undefined, apply: (hex: string) => void) => {
    showSheet('color', title, (body) => {
      let hsv: Hsv = (initial && hexToHsv(initial)) || { h: 210, s: 0.6, v: 0.9 };
      const square = h('div', 'tb-sv');
      const knob = h('div', 'tb-sv-knob');
      square.append(knob);
      const hue = h('div', 'tb-hue');
      const hueKnob = h('div', 'tb-hue-knob');
      hue.append(hueKnob);
      const preview = h('div', 'tb-color-preview');
      const input = h('input', 'tb-input') as HTMLInputElement;
      input.setAttribute('autocapitalize', 'off');
      input.spellcheck = false;
      const ok = h('button', 'tb-primary', 'Apply') as HTMLButtonElement;
      ok.type = 'button';
      const clamp = (n: number) => Math.min(1, Math.max(0, n));
      const paint = (fromInput = false) => {
        square.style.backgroundColor = `hsl(${hsv.h}, 100%, 50%)`;
        knob.style.left = `${hsv.s * 100}%`;
        knob.style.top = `${(1 - hsv.v) * 100}%`;
        hueKnob.style.left = `${(hsv.h / 360) * 100}%`;
        const hex = hsvToHex(hsv);
        preview.style.backgroundColor = hex;
        if (!fromInput) { input.value = hex; input.classList.remove('invalid'); }
      };
      const track = (el: El, onPoint: (x: number, y: number, r: DOMRect) => void) => {
        el.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          el.setPointerCapture(e.pointerId);
          const at = (ev: PointerEvent) => onPoint(ev.clientX, ev.clientY, el.getBoundingClientRect());
          at(e);
          const up = () => { el.removeEventListener('pointermove', at); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); };
          el.addEventListener('pointermove', at);
          el.addEventListener('pointerup', up);
          el.addEventListener('pointercancel', up);
        });
      };
      track(square, (x, y, r) => { hsv = { ...hsv, s: clamp((x - r.left) / r.width), v: 1 - clamp((y - r.top) / r.height) }; paint(); });
      track(hue, (x, _y, r) => { hsv = { ...hsv, h: clamp((x - r.left) / r.width) * 359.9 }; paint(); });
      input.addEventListener('input', () => {
        const next = hexToHsv(input.value);
        input.classList.toggle('invalid', !next);
        if (next) { hsv = next; paint(true); }
      });
      ok.addEventListener('click', (e) => {
        e.preventDefault();
        const hex = hsvToHex(hsv);
        closeSheet();
        apply(hex);
        refresh();
      });
      const fields = h('div', 'tb-fields');
      fields.append(preview, input);
      body.append(square, hue, fields, ok);
      paint();
    }, undefined, { hideKeyboard: true });
  };

  const colorText = button(mdiFormatColorText, 'Text colour', () => chain().setColor(lastText).run(), () => !!editor.getAttributes('textStyle').color);
  refreshers.push(() => { colorText.style.color = (editor.getAttributes('textStyle').color as string | undefined) ?? ''; });
  // Pinned: the card stays open (also next time). Tapping the pin again unpins and closes it.
  const pinButton = button(mdiPinOutline, 'Keep this row open', () => {
    pinned = !pinned;
    if (!pinned) { floatOpen = false; colorKind = null; }
    writePinned(pinned);
    refresh();
  }, () => pinned, 'tb-pin');
  refreshers.push(() => { pinButton.innerHTML = svg(pinned ? mdiPin : mdiPinOutline); });

  // ---- main row ----
  const sizeLabel = h('button', 'tb-btn tb-text tb-size');
  sizeLabel.type = 'button';
  sizeLabel.title = 'Font size';
  sizeLabel.addEventListener('click', (e) => { e.preventDefault(); sizeSheet(); });
  refreshers.push(() => { sizeLabel.textContent = `${px()}px`; });

  const level = () => ([1, 2, 3, 4, 5, 6] as const).find((l) => editor.isActive('heading', { level: l }));
  // Alignment: a small floating row like the ⋮ card.
  let alignOpen = false;
  alignRow.append(...(['left', 'center', 'right', 'justify'] as const).map((k) => button(ALIGN_ICONS[k], `Align ${k}`, () => {
    if (k === 'left') chain().unsetTextAlign().run(); else chain().setTextAlign(k).run();
    alignOpen = false;
    refresh();
  }, () => currentAlign() === k)));
  const alignButton = button(mdiFormatAlignLeft, 'Alignment', () => { alignOpen = !alignOpen; refresh(); }, () => alignOpen);
  refreshers.push(() => { alignButton.innerHTML = svg(ALIGN_ICONS[currentAlign()]); });

  // ---- image (an image is selected) ----
  const imageSizeSheet = () => showSheet('imagesize', 'Image properties', (body) => {
    const size = imageSize(editor);
    const width = h('input', 'tb-input') as HTMLInputElement;
    const height = h('input', 'tb-input') as HTMLInputElement;
    for (const [input, value, label] of [[width, size?.width, 'width'], [height, size?.height, 'height']] as const) {
      input.type = 'number';
      input.inputMode = 'numeric';
      input.placeholder = label;
      input.value = value ? String(value) : '';
    }
    const ratio = size?.ratio || 1;
    width.addEventListener('input', () => { const n = parseInt(width.value, 10); if (n > 0) height.value = String(Math.round(n * ratio)); });
    height.addEventListener('input', () => { const n = parseInt(height.value, 10); if (n > 0) width.value = String(Math.round(n / ratio)); });
    const fields = h('div', 'tb-fields');
    const labelled = (input: HTMLInputElement, text: string) => { const f = h('label', 'tb-field'); f.append(input, h('span', 'tb-hint', text)); return f; };
    fields.append(labelled(width, 'width'), labelled(height, 'height'));
    const apply = h('button', 'tb-primary', 'Apply') as HTMLButtonElement;
    apply.type = 'button';
    apply.addEventListener('click', (e) => {
      e.preventDefault();
      const n = parseInt(width.value, 10);
      closeSheet();
      if (n > 0) setImageWidth(editor, n);
    });
    const original = h('button', 'tb-secondary', 'Original size') as HTMLButtonElement;
    original.type = 'button';
    original.addEventListener('click', (e) => { e.preventDefault(); closeSheet(); setImageWidth(editor, null); });
    const actions = h('div', 'tb-fields');
    actions.append(original);
    body.append(fields, actions, apply);
  });
  // Same height for the whole row (only while the picked image shares a row).
  const sameHeight = button(mdiArrowExpandVertical, 'Same height for the row', () => { matchImageRowHeights(editor); refresh(); });
  imageRow.append(
    button(mdiEyeOutline, 'Preview', () => {
      const image = selectedImage(editor);
      const img = image ? imageElementAt(editor, image.pos) : null;
      if (img?.src) openImageViewer(img.src, { alt: image?.node.attrs.alt ?? '', onDownload: () => downloadSelectedImage(editor) });
    }),
    button(mdiDownload, 'Download', () => downloadSelectedImage(editor)),
    sep(),
    button(mdiFormatAlignLeft, 'Align left', () => { setImageAlign(editor, 'left'); refresh(); }, () => currentImageAlign(editor) === 'left'),
    button(mdiFormatAlignCenter, 'Align center', () => { setImageAlign(editor, 'center'); refresh(); }, () => currentImageAlign(editor) === 'center'),
    button(mdiFormatAlignRight, 'Align right', () => { setImageAlign(editor, 'right'); refresh(); }, () => currentImageAlign(editor) === 'right'),
    button(mdiViewColumnOutline, 'Side by side', () => { setImageSideBySide(editor, !currentImageSideBySide(editor)); refresh(); }, () => currentImageSideBySide(editor)),
    sameHeight,
    sep(),
    button(mdiImageSizeSelectLarge, 'Image size', imageSizeSheet),
  );

  // ---- table (the cursor in a table) ----
  // Settings > Toolbar > Table decides the buttons: they go at the start of the main row, a
  // subgroup is a "Table" / "Cell" button whose buttons sit in a row above (pinnable like the
  // ⋮ card). Cells are selected by holding a finger in a cell and dragging (table-tools.ts).
  type TableItem = [icon: string, label: string, run: () => unknown];
  const tablePartSheet = (name: string, title: string, items: TableItem[]) => toggleSheet(name, title, (body) => {
    for (const [icon, label, run] of items) body.append(row(label, () => { closeSheet(); run(); refresh(); }, { icon }));
  });
  // A short message above the toolbar (e.g. why a row could not move).
  const toastEl = h('div', 'tb-toast');
  document.body.append(toastEl);
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  const toast = (text: string) => {
    toastEl.textContent = text;
    toastEl.style.bottom = `${(root.getBoundingClientRect().height || 60) + 12}px`;
    toastEl.classList.add('open');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('open'), 3500);
  };
  const moved = (result: TableMoveResult) => { if (result === 'merged') toast(TABLE_MOVE_MERGED); };
  const TABLE_RUN: Record<string, () => unknown> = {
    colLeft: () => chain().addColumnBefore().run(),
    colRight: () => chain().addColumnAfter().run(),
    rowAbove: () => chain().addRowBefore().run(),
    rowBelow: () => chain().addRowAfter().run(),
    deleteColumn: () => chain().deleteColumn().run(),
    deleteRow: () => chain().deleteRow().run(),
    deleteTable: () => { chain().deleteTable().run(); tableOpen = null; },
    moveColumnLeft: () => moved(moveTableColumnBy(editor, -1)),
    moveColumnRight: () => moved(moveTableColumnBy(editor, 1)),
    moveRowUp: () => moved(moveTableRowBy(editor, -1)),
    moveRowDown: () => moved(moveTableRowBy(editor, 1)),
    equalWidths: () => equalColumnWidths(editor),
    equalHeights: () => equalRowHeights(editor),
    naturalHeights: () => resetRowHeights(editor),
    headerRow: () => chain().toggleHeaderRow().run(),
    selectColumn: () => selectTablePart(editor, 'column'),
    selectRow: () => selectTablePart(editor, 'row'),
    selectTable: () => selectTablePart(editor, 'table'),
    mergeCells: () => chain().mergeCells().run(),
    splitCell: () => chain().splitCell().run(),
  };
  const sheetItems = (ids: string[]): TableItem[] => ids.map((id) => {
    const item = toolbarItem(id)!;
    return [item.icon, item.label, TABLE_RUN[id]];
  });
  const columnSheet = () => tablePartSheet('column', 'Column properties',
    sheetItems(['colLeft', 'colRight', 'moveColumnLeft', 'moveColumnRight', 'equalWidths', 'selectColumn', 'deleteColumn']));
  const rowSheet = () => tablePartSheet('row', 'Row properties',
    sheetItems(['rowAbove', 'rowBelow', 'moveRowUp', 'moveRowDown', 'equalHeights', 'naturalHeights', 'headerRow', 'selectRow', 'deleteRow']));
  // Background swatches in a row; on the main row one button opens them (like the text colour).
  const cellSwatches = (): El[] => {
    const none = button(mdiInvertColorsOff, 'No background', () => { chain().setCellAttribute('background', null).run(); refresh(); }, () => !cellColor(), 'tb-swatch-none');
    const swatches = EDITOR_COLORS.map((c) => {
      const swatch = h('button', 'tb-swatch');
      swatch.type = 'button';
      swatch.title = `${c.label} background`;
      swatch.style.backgroundColor = c.background;
      swatch.addEventListener('mousedown', (e) => e.preventDefault());
      swatch.addEventListener('click', () => { chain().setCellAttribute('background', c.background).run(); refresh(); });
      refreshers.push(() => { swatch.style.outline = cellColor() === c.background ? '2px solid currentColor' : ''; });
      return swatch;
    });
    // Rebuilt on refresh: it shows the cell's own colour.
    const customSlot = h('span', '');
    customSlot.style.display = 'contents';
    refreshers.push(() => {
      if (!tableRow.contains(customSlot)) return;
      customSlot.replaceChildren(customSwatch(cellColor(), () => colorPickerSheet('Cell background', cellColor(), (hex) => { chain().setCellAttribute('background', hex).run(); })));
    });
    return [none, ...swatches, customSlot];
  };
  const tablePart = (id: string, inRow: boolean): El[] => {
    const item = toolbarItem(id);
    if (!item) return [];
    if (id === 'cellColor') return inRow ? cellSwatches() : [button(item.icon, 'Cell background', () => showColors('cell'), () => colorKind === 'cell')];
    if (id === 'columnProps') return [button(item.icon, item.label, columnSheet, () => openSheet === 'column')];
    if (id === 'rowProps') return [button(item.icon, item.label, rowSheet, () => openSheet === 'row')];
    const run = TABLE_RUN[id];
    if (!run) return [];
    return [button(item.icon, item.label, () => { run(); refresh(); }, undefined, id.startsWith('delete') ? 'danger' : '')];
  };

  let tablePinned = readTablePinned();
  let tableSubgroups: El[][] = [];
  let tableCellGroup = -1;
  let tableMain: El[] = [];
  let tableRefreshers: (() => void)[] = [];
  let tableRowShows: number | null = null;
  const tableShown = () => {
    const shown = tableOpen ?? tablePinned;
    return shown !== null && shown < tableSubgroups.length ? shown : null;
  };
  const tableToggle = (index: number) => () => {
    // Open (or pinned open) closes it, and unpins it like the ⋮ card.
    if (tableShown() === index) {
      tableOpen = null;
      if (tablePinned === index) { tablePinned = null; writeTablePinned(null); }
    } else tableOpen = index;
    refresh();
  };
  const tablePin = (index: number) => {
    const b = button(mdiPinOutline, 'Keep this row open', () => {
      tablePinned = tablePinned === index ? null : index;
      if (tablePinned === null) tableOpen = null;
      writeTablePinned(tablePinned);
      refresh();
    }, () => tablePinned === index, 'tb-pin');
    refreshers.push(() => { b.innerHTML = svg(tablePinned === index ? mdiPin : mdiPinOutline); });
    return b;
  };
  // Builds the table buttons from the config (refreshers of the old ones are dropped).
  const buildTableToolbar = (config: ToolbarConfig | null) => {
    const before = refreshers.length;
    const groups = toolbarGroups('mobileTable', config);
    tableSubgroups = [];
    tableCellGroup = -1;
    tableMain = groups.flatMap((group, gi) => [
      ...(gi > 0 ? [sep()] : []),
      ...group.flatMap((part) => {
        if (typeof part === 'string') return tablePart(part, false);
        const index = tableSubgroups.length;
        const cells = part.every((id) => CELL_TOOLBAR_ITEMS.has(id));
        if (tableCellGroup < 0 && part.includes('mergeCells')) tableCellGroup = index;
        tableSubgroups.push([...part.flatMap((id) => tablePart(id, true)), sep(), tablePin(index)]);
        return [button(cells ? mdiTableEdit : mdiTableCog, cells ? 'Cell' : 'Table', tableToggle(index), () => tableShown() === index)];
      }),
    ]);
    if (tableMain.length) tableMain.push(sep());
    tableRefreshers = refreshers.splice(before);
    tableRowShows = null;
  };
  refreshers.push(() => {
    const inTable = editor.isActive('table');
    for (const el of tableMain) el.style.display = inTable ? '' : 'none';
    if (inTable) for (const r of tableRefreshers) r();
  });
  // Cells selected by dragging: the row with "Merge cells" opens by itself.
  editor.on('selectionUpdate', () => {
    if (editor.state.selection instanceof CellSelection && tableCellGroup >= 0 && tableShown() !== tableCellGroup) { tableOpen = tableCellGroup; refresh(); }
  });

  // Every main-row button (group) by its id; Settings > Toolbar decides which show and in
  // what order (setToolbarConfig).
  const parts: Record<string, El[]> = {
    insert: [button(mdiPlus, 'Insert', () => (openSheet === 'insert' ? closeSheet() : insertSheet(slashItems, 'Choose a block to insert')), undefined, 'tb-plus')],
    outdent: [button(mdiFormatIndentDecrease, 'Outdent', () => chain().outdentContent().run())],
    indent: [button(mdiFormatIndentIncrease, 'Indent', () => chain().indentContent().run())],
    bold: [button(mdiFormatBold, 'Bold', () => chain().toggleBold().run(), () => editor.isActive('bold'))],
    italic: [button(mdiFormatItalic, 'Italic', () => chain().toggleItalic().run(), () => editor.isActive('italic'))],
    underline: [button(mdiFormatUnderline, 'Underline', () => chain().toggleUnderline().run(), () => editor.isActive('underline'))],
    strike: [button(mdiFormatStrikethrough, 'Strikethrough', () => chain().toggleStrike().run(), () => editor.isActive('strike'))],
    code: [button(mdiCodeTags, 'Inline code', () => chain().toggleCode().run(), () => editor.isActive('code'))],
    subscript: [button(mdiFormatSubscript, 'Subscript', () => chain().toggleSubscript().run(), () => editor.isActive('subscript'))],
    superscript: [button(mdiFormatSuperscript, 'Superscript', () => chain().toggleSuperscript().run(), () => editor.isActive('superscript'))],
    highlight: [
      button(mdiMarker, 'Highlight', () => chain().setHighlight({ color: lastHighlight }).run(), () => editor.isActive('highlight')),
      button(mdiChevronUp, 'Highlight colours', () => showColors('highlight'), () => colorKind === 'highlight', 'tb-caret', 18),
    ],
    textColor: [colorText, button(mdiChevronUp, 'Text colours', () => showColors('text'), () => colorKind === 'text', 'tb-caret', 18)],
    math: [button(mdiFunctionVariant, 'Inline math', () => requestMathEdit(editor, { mode: 'insert', kind: 'inline', pos: editor.state.selection.from }))],
    fontSize: [button(mdiMinus, 'Smaller text', () => setPx(px() - 1)), sizeLabel, button(mdiPlus, 'Bigger text', () => setPx(px() + 1))],
    headings: [textButton('Text type', () => (level() ? `Heading ${level()}` : 'Paragraph'), paragraphSheet)],
    font: [textButton('Font', () => EDITOR_FONTS.find((f) => f.name === (editor.state.selection.empty ? ctx.noteFont() : selectionFont() ?? ctx.noteFont()))?.label ?? 'Sans', fontSheet)],
    bullets: [
      button(mdiFormatListBulleted, 'Bullet list', () => chain().toggleBulletList().run(), () => editor.isActive('bulletList')),
      button(mdiChevronUp, 'Bullet styles', () => listStyleSheet('bullet'), undefined, 'tb-caret', 18),
    ],
    numbers: [
      button(mdiFormatListNumbered, 'Numbered list', () => chain().toggleOrderedList().run(), () => editor.isActive('orderedList')),
      button(mdiChevronUp, 'Numbering styles', () => listStyleSheet('number'), undefined, 'tb-caret', 18),
    ],
    tasks: [button(mdiFormatListCheckbox, 'Task list', () => chain().toggleTaskList().run(), () => editor.isActive('taskList'))],
    noteLink: [button(mdiVectorLink, 'Link to note', () => (openSheet === 'notelink' ? closeSheet() : noteLinkSheet()))],
    link: [button(mdiLinkPlus, 'Insert link', () => (openSheet === 'link' ? closeSheet() : linkSheet()), () => editor.isActive('link'))],
    align: [alignButton],
  };
  // A subgroup is a ⋮ button; its buttons sit in the floating card (one card open at a time).
  let floatGroup: string[] = [];
  const openFloat = (items: string[]) => {
    floatGroup = items;
    float.replaceChildren(...items.flatMap((id) => parts[id] ?? []), sep(), pinButton);
  };
  const moreButton = (items: string[]) => button(mdiDotsVertical, 'More formatting', () => {
    // Open (with these buttons) or closed; closing also unpins.
    const open = (floatOpen || pinned) && floatGroup === items;
    if (!open) openFloat(items);
    floatOpen = !open;
    if (open) { pinned = false; writePinned(false); colorKind = null; }
    refresh();
  }, () => (floatOpen || pinned) && floatGroup === items);
  let tableConfig: ToolbarConfig | null = null;
  const setToolbarConfig = (config: ToolbarConfig | null, table: ToolbarConfig | null = tableConfig) => {
    tableConfig = table;
    buildTableToolbar(table);
    const groups = toolbarGroups('mobile', config);
    const subgroups = groups.flatMap((g) => g.filter((p): p is string[] => Array.isArray(p)));
    const buttons = groups.flatMap((group, gi) => [
      ...(gi > 0 ? [sep()] : []),
      ...group.flatMap((part) => (typeof part === 'string' ? parts[part] ?? [] : [moreButton(part)])),
    ]);
    // The table buttons right after "+" (or first).
    const at = buttons[0] === parts.insert?.[0] ? 1 : 0;
    buttons.splice(at, 0, ...tableMain);
    main.replaceChildren(...buttons);
    // The card (pinned open since last time) shows the first subgroup.
    if (subgroups.length) openFloat(subgroups[0]);
    else { float.replaceChildren(); floatOpen = false; pinned = false; }
    refresh();
  };
  setToolbarConfig(null);

  // ---- "/" typed in the text: the insert menu, searched as you type ----
  // The parts of @tiptap/suggestion's props used here.
  type SlashProps = { query: string; range: { from: number; to: number } };
  let slashProps: SlashProps | null = null;
  // Submenus opened inside the panel (for the query they were opened with).
  let slashNav: { query: string; model: NavModel } | null = null;
  function hideSlash() {
    slashProps = null;
    slashNav = null;
    slashPanel.classList.remove('open');
    slashPanel.replaceChildren();
  }
  const backToInsert = () => insertSheet(slashItems, 'Choose a block to insert', [], false);
  const slashModel = (props: SlashProps): NavModel =>
    (slashNav && slashNav.query === props.query ? slashNav.model : searchNav(slashItems, props.query));
  // Submenus open inside the panel; the table picker and the note link picker are sheets. The
  // keyboard stays up all the time (the panel's buttons do not take the focus).
  const pickSlash = (item: SlashItem, range: { from: number; to: number }) => {
    const sub = item.submenu;
    if (slashProps && sub && sub.kind !== 'table') {
      slashNav = { query: slashProps.query, model: activate(slashModel(slashProps), item).model };
      return renderSlash();
    }
    hideSlash();
    if (sub || item.title.endsWith('Link to note')) {
      chain().deleteRange(range).run();
      if (sub?.kind === 'table') return tableSheet(backToInsert, false);
      return noteLinkSheet();
    }
    item.command?.({ editor, range });
    centerCaretSoon();
  };
  const renderSlash = () => {
    const props = slashProps;
    if (!props || openSheet) return hideSlashPanelOnly();
    const model = slashModel(props);
    const level = model[model.length - 1];
    const range = props.range;
    const rows: El[] = [];
    if (model.length > 1 && slashNav) {
      rows.push(row('Back', () => {
        if (!slashNav) return;
        slashNav = { query: slashNav.query, model: slashNav.model.slice(0, -1) };
        renderSlash();
      }, { icon: mdiArrowLeft }));
    }
    if (level.kind === 'table') {
      rows.push(row('Table', () => pickSlash({ title: 'Table', submenu: { kind: 'table' } }, range), { icon: mdiTable, chevron: true }));
    } else if (level.kind === 'tiles') {
      const grid = h('div', 'tb-tiles');
      for (const item of level.items) {
        const markers = item.preview?.kind === 'markers' ? item.preview.markers : [item.title];
        grid.append(tile(markers, item.title, () => pickSlash(item, range)));
      }
      rows.push(grid);
    } else {
      level.items.forEach((item, i) => {
        if (unavailable(item)) return;
        if (level.divider === i && rows.length) rows.push(h('div', 'tb-divider'));
        const label = !item.icon && item.preview?.kind === 'icon' ? `${item.preview.icon}   ${item.title}` : item.title;
        rows.push(row(label, () => pickSlash(item, range), { icon: item.icon, chevron: !!item.submenu }));
      });
    }
    if (!rows.length) return hideSlashPanelOnly();
    slashPanel.replaceChildren(...rows);
    slashPanel.classList.add('open');
    place();
  };
  // No match: the panel goes away but typing on can still match again.
  function hideSlashPanelOnly() {
    slashPanel.classList.remove('open');
    slashPanel.replaceChildren();
  }
  const slashRenderer = {
    onStart: (props: SlashProps) => { slashProps = props; renderSlash(); },
    onUpdate: (props: SlashProps) => { slashProps = props; renderSlash(); },
    onExit: () => hideSlash(),
    onKeyDown: ({ event }: { event: KeyboardEvent }) => {
      if (event.key !== 'Escape' || !slashProps) return false;
      hideSlash();
      return true;
    },
  };

  // ---- long press on a note link: new tab or split view ----
  let notePress: ReturnType<typeof setTimeout> | null = null;
  let suppressNoteClick = false;
  function placeNoteLinkBar() {
    noteLinkBar.style.bottom = `${bottomInset() + (root.classList.contains('visible') ? root.offsetHeight : 0) + 6}px`;
  }
  function hideNoteLinkBar() {
    noteLinkBar.classList.remove('open');
  }
  const SPLIT_LABELS: Record<SplitSide, string> = { left: 'Open on the left', right: 'Open on the right', top: 'Open above', bottom: 'Open below' };
  const showNoteLinkBar = (id: string) => {
    const title = h('div', 'tb-link-url tb-notelink-title', ctx.titles()[id] ?? 'Missing note');
    const splits = (['left', 'right', 'top', 'bottom'] as const).map((side) => {
      const b = button(mdiClose, SPLIT_LABELS[side], () => { hideNoteLinkBar(); ctx.openSplit(id, side); });
      b.innerHTML = splitIcon(side);
      return b;
    });
    noteLinkBar.replaceChildren(
      title,
      button(mdiTabPlus, 'Open in new tab', () => { hideNoteLinkBar(); ctx.openNote(id); }),
      ...splits,
      button(mdiClose, 'Close', hideNoteLinkBar),
    );
    noteLinkBar.classList.add('open');
    placeNoteLinkBar();
  };
  const cancelNotePress = () => {
    if (notePress) clearTimeout(notePress);
    notePress = null;
  };
  document.addEventListener('pointerdown', (e) => {
    cancelNotePress();
    const id = (e.target as El).closest?.('[data-note-link]')?.getAttribute('data-note-id');
    if (!id) return;
    suppressNoteClick = false;
    notePress = setTimeout(() => { suppressNoteClick = true; showNoteLinkBar(id); }, 450);
  }, true);
  document.addEventListener('pointerup', cancelNotePress, true);
  document.addEventListener('pointercancel', cancelNotePress, true);
  // The tap that ends a long press must not also open the note (main.ts opens it on click).
  document.addEventListener('click', (e) => {
    if (!suppressNoteClick || !(e.target as El).closest?.('[data-note-link]')) return;
    suppressNoteClick = false;
    e.preventDefault();
    e.stopPropagation();
  }, true);
  document.addEventListener('contextmenu', (e) => {
    if ((e.target as El).closest?.('[data-note-link]')) e.preventDefault();
  }, true);

  // ---- visibility and position ----
  function refresh() {
    float.classList.toggle('open', floatOpen || pinned);
    colorRow.classList.toggle('open', colorKind !== null);
    alignRow.classList.toggle('open', alignOpen);
    const picked = selectedImage(editor);
    imageRow.classList.toggle('open', !!picked && !openSheet);
    sameHeight.style.display = picked && imageRowAt(editor.state.doc, picked.pos).length > 1 ? '' : 'none';
    const inTable = editor.isActive('table');
    if (!inTable) tableOpen = null;
    const shown = inTable ? tableShown() : null;
    if (shown !== tableRowShows) {
      tableRowShows = shown;
      tableRow.replaceChildren(...(shown === null ? [] : tableSubgroups[shown]));
    }
    tableRow.classList.toggle('open', shown !== null);
    if (colorKind === 'cell' && !inTable) colorKind = null;
    renderLinkBar();
    for (const r of refreshers) r();
  }

  // Tapping the text closes what is open (except a pinned ⋮ card); so does any main-row
  // button that is not itself the opener of a sheet or row.
  const closePanels = () => {
    if (openSheet) closeSheet(false);
    hideNoteLinkBar();
    alignOpen = false;
    tableOpen = null;
    colorKind = null;
    if (!pinned) floatOpen = false;
    refresh();
  };
  editor.view.dom.addEventListener('pointerdown', closePanels);
  // A touch anywhere else on the page (the title, the empty page, …) closes an open sheet too;
  // only the bars themselves and the chips (which open sheets) keep it.
  document.addEventListener('pointerdown', (e) => {
    const target = e.target as El;
    if (!openSheet || root.contains(target) || editor.view.dom.contains(target) || target.closest?.('#chips, .niv, .history-view')) return;
    closeSheet(false);
  }, true);
  const OPENERS = new Set(['Insert', 'More formatting', 'Font size', 'Text type', 'Font', 'Bullet styles', 'Numbering styles', 'Link to note', 'Insert link', 'Alignment', 'Highlight colours', 'Text colours', 'Table', 'Cell', 'Cell background', 'Column properties', 'Row properties']);
  main.addEventListener('click', (e) => {
    const b = (e.target as El).closest('button');
    if (!b || OPENERS.has(b.title)) return;
    if (openSheet) closeSheet(false);
    alignOpen = false;
    tableOpen = null;
    colorKind = null;
    if (!pinned) floatOpen = false;
  }, true);

  // Shown while the editor (or an input of a sheet) has focus.
  function show(visible: boolean) {
    root.classList.toggle('visible', visible);
    padBottom();
    if (!visible) {
      openSheet = null;
      sheetHidesKeyboard = false;
      root.classList.remove('inserting', 'no-bar');
      sheet.replaceChildren();
      sheet.classList.remove('open');
      colorKind = null;
      alignOpen = false;
      tableOpen = null;
      floatOpen = pinned;
      refresh();
    }
  }

  // ---- keyboard, position and typewriter scrolling ----
  // React Native makes the WebView end where the keyboard starts and reports whether the
  // keyboard is up (setKeyboard). `keyboardInset` stays for the case where the WebView is still
  // covered. When Chromium itself shrinks the visual viewport for the keyboard, the viewport
  // also pans inside the page while scrolling, and fixed elements belong to the page, so the
  // bar must follow the viewport's real bottom.
  const viewport = window.visualViewport;
  let keyboardInset = 0;
  let keyboardShown = false;
  const viewportShrunk = () => !!viewport && window.innerHeight - viewport.height > 80;
  // Always measured from the visual viewport's real bottom: even a small difference (it pans
  // up while scrolling up) would otherwise put the bar under the keyboard.
  const bottomInset = () => {
    const gap = viewport ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0;
    return viewportShrunk() ? gap : gap + keyboardInset;
  };
  const keyboardUp = () => keyboardShown || viewportShrunk() || keyboardInset > 80;
  // Visible part of the page (layout viewport coordinates) above the keyboard and the bar.
  const visibleArea = () => {
    const top = viewport ? viewport.offsetTop : 0;
    const bottom = window.innerHeight - bottomInset() - (root.classList.contains('visible') ? root.offsetHeight : 0);
    return { top, bottom: Math.max(top + 80, bottom) };
  };
  function place() {
    // A transient tiny viewport (mid-resize) would put the bar near the top for a frame.
    if (viewport && viewport.height < 200) return;
    const inset = bottomInset();
    if (inset > window.innerHeight * 0.6) return;
    const bottom = `${inset}px`;
    if (root.style.bottom !== bottom) root.style.bottom = bottom;
    // Heights from the page's height above the keyboard only, not from the viewport's scroll
    // position (it changes while the note scrolls: the "/" list grew and shrank, flickering).
    const visible = (viewport ? viewport.height : window.innerHeight) - (viewportShrunk() ? 0 : keyboardInset);
    // The sheet uses what is left above the rows (minus a margin), never more.
    const rows = root.offsetHeight - (sheet.classList.contains('open') ? sheet.offsetHeight : 0) - (slashPanel.classList.contains('open') ? slashPanel.offsetHeight + 8 : 0);
    const setMax = (el: HTMLElement, px: number) => {
      const value = `${Math.round(px)}px`;
      if (Math.abs((parseFloat(el.style.maxHeight) || 0) - px) > 4) el.style.maxHeight = value;
    };
    // Without the toolbar row (the reminder picker) the sheet may take nearly the whole screen.
    const sheetShare = root.classList.contains('no-bar') ? 0.92 : 0.75;
    setMax(sheet, Math.max(160, Math.min(visible * sheetShare, visible - rows - 16)));
    setMax(slashPanel, Math.max(120, Math.min(visible * 0.45, visible - rows - 16)));
    placeNoteLinkBar();
  }
  // Extra space below the note lets even its last line reach the middle of the screen. It
  // only grows: removing it when the bar hides would make the page jump (e.g. the other half
  // of a split view when the focus moves to this one).
  let padding = 0;
  function padBottom() {
    const area = visibleArea();
    const needed = Math.round((area.bottom - area.top) / 2 + root.offsetHeight + bottomInset());
    if (needed <= padding) return;
    padding = needed;
    document.body.style.paddingBottom = `${padding}px`;
  }
  // The cursor line is only kept visible: when it would be under the bar (or above the top)
  // the page moves just enough, at once. No centring and no gliding: Chromium itself already
  // scrolls the caret into view when the keyboard comes, and a second animation fought it.
  const MARGIN = 12;
  let centerFrame = 0;
  // Kept for the callers (a tap below the note); nothing special any more.
  let alignBottomOnce = false;
  const centerCaret = (_force = false) => {
    cancelAnimationFrame(centerFrame);
    centerFrame = requestAnimationFrame(() => {
      alignBottomOnce = false;
      if (!editor.isFocused || openSheet || !editor.state.selection.empty) return;
      const { head } = editor.state.selection;
      const caret = editor.view.coordsAtPos(Math.min(head, editor.state.doc.content.size));
      const area = visibleArea();
      // While the page is being resized (keyboard coming) the viewport is briefly tiny: wait.
      if (area.bottom - area.top < 160 || (viewport && viewport.height < 200)) return;
      if (caret.bottom > area.bottom - MARGIN) {
        releaseHold();
        window.scrollBy({ top: caret.bottom - (area.bottom - MARGIN), behavior: 'instant' as ScrollBehavior });
      } else if (caret.top < area.top + MARGIN) {
        releaseHold();
        window.scrollBy({ top: caret.top - (area.top + MARGIN), behavior: 'instant' as ScrollBehavior });
      }
    });
  };
  function centerCaretSoon() {
    setTimeout(() => centerCaret(), 60);
    setTimeout(() => centerCaret(), 400);
  }
  editor.on('selectionUpdate', () => centerCaret());
  editor.on('update', () => centerCaret());
  // Focus coming back with the keyboard: the keyboard's arrival (onViewport) centres the line.
  editor.on('focus', () => { if (keyboardUp()) centerCaretSoon(); });

  // Making a selection: dragging a handle to the top or the bottom edge scrolls the text, the
  // longer (and the deeper into the edge) the faster, like on any web page. The handles are
  // native, so the selection's moving end (its head) tells where the finger is.
  const SELECT_EDGE = 56;
  let selectFrame = 0;
  let selectSince = 0;
  const selectionScroll = () => {
    cancelAnimationFrame(selectFrame);
    const sel = editor.state.selection;
    if (sel.empty || !editor.isFocused) { selectSince = 0; return; }
    const caret = editor.view.coordsAtPos(Math.min(sel.head, editor.state.doc.content.size));
    const area = visibleArea();
    const depth = caret.bottom > area.bottom - SELECT_EDGE ? caret.bottom - (area.bottom - SELECT_EDGE)
      : caret.top < area.top + SELECT_EDGE ? -((area.top + SELECT_EDGE) - caret.top) : 0;
    if (!depth) { selectSince = 0; return; }
    const now = performance.now();
    if (!selectSince) selectSince = now;
    // Starts slowly (a few lines), speeds up the longer the handle stays at the edge.
    const elapsed = now - selectSince;
    const speed = Math.min(36, 2 + elapsed / 60 + Math.min(Math.abs(depth), SELECT_EDGE) / 8);
    window.scrollBy({ top: Math.sign(depth) * speed, behavior: 'auto' });
    selectFrame = requestAnimationFrame(selectionScroll);
  };
  editor.on('selectionUpdate', () => { if (!editor.state.selection.empty) selectionScroll(); });

  // Android's Back hides the keyboard without moving the focus: the bar (and a sheet that
  // was typed in) go away with it. In the insert menu only its input lets go of the focus,
  // so tapping the menu does not bring the keyboard back.
  let wasUp = false;
  let hideCheck: ReturnType<typeof setTimeout> | null = null;
  const watchKeyboard = () => {
    const up = keyboardUp();
    if (up) {
      wasUp = true;
      if (hideCheck) clearTimeout(hideCheck);
      hideCheck = null;
      return;
    }
    if (!wasUp || hideCheck) return;
    // A moment later: moving the focus between two notes (split view) may flash it.
    hideCheck = setTimeout(() => {
      hideCheck = null;
      if (keyboardUp()) return;
      wasUp = false;
      if (sheetHidesKeyboard) return blurSheetInput();
      if (openSheet) closeSheet(false);
      blurSheetInput();
      if (atomWithoutKeyboard()) return show(true);
      if (editor.isFocused) (editor.view.dom as HTMLElement).blur();
      show(false);
    }, 250);
  };
  // After the size settled (resize events come in a burst while the keyboard arrives).
  let viewportTimer: ReturnType<typeof setTimeout> | undefined;
  // The keyboard is coming and the page is about to shrink: the bar waits until that resize
  // settled (30 ms after it, 120 ms at most), otherwise half-done frames showed it near the top.
  let revealTimer: ReturnType<typeof setTimeout> | undefined;
  let awaitingResize = false;
  const reveal = () => {
    awaitingResize = false;
    clearTimeout(revealTimer);
    place();
    root.style.opacity = '';
  };
  const hideUntilResized = () => {
    awaitingResize = true;
    // Opacity, not visibility: a hidden element loses the focus, and a sheet's input that was
    // just tapped (the reason the keyboard is coming) lost it and the keyboard went away again.
    root.style.opacity = '0';
    clearTimeout(revealTimer);
    revealTimer = setTimeout(reveal, 120);
  };
  const onViewport = () => {
    place();
    padBottom();
    clearTimeout(viewportTimer);
    // The first settled size after the keyboard came also shows the bar again.
    viewportTimer = setTimeout(() => { if (awaitingResize) reveal(); else place(); centerCaret(); }, awaitingResize ? 30 : 120);
    revealSheetAction();
    watchKeyboard();
    // React Native reported the keyboard gone: the bar goes at once (no wait for the resize).
  };
  viewport?.addEventListener('resize', onViewport);
  viewport?.addEventListener('scroll', place);
  window.addEventListener('scroll', place, { passive: true });
  window.addEventListener('resize', onViewport);
  let keyboardGoneTimer: ReturnType<typeof setTimeout> | undefined;
  const setKeyboard = (inset: number, shown?: boolean) => {
    keyboardInset = Math.max(0, inset);
    const wasShown = keyboardShown;
    keyboardShown = shown ?? keyboardInset > 80;
    if (keyboardShown && !wasShown) {
      hideUntilResized();
      // The editor had the focus without a keyboard: the bar comes with the keyboard.
      if (editor.isFocused) show(true);
    }
    clearTimeout(keyboardGoneTimer);
    if (wasShown && !keyboardShown && !sheetHidesKeyboard && !viewportShrunk()) {
      // A moment later and only if it stayed away: moving the focus from the text to a sheet's
      // field restarts the keyboard (hide, then show at once), which closed the sheet.
      keyboardGoneTimer = setTimeout(() => {
        if (keyboardShown || viewportShrunk()) return;
        wasUp = false;
        if (openSheet) closeSheet(false);
        blurSheetInput();
        if (atomWithoutKeyboard()) show(true);
        else {
          if (editor.isFocused) (editor.view.dom as HTMLElement).blur();
          show(false);
        }
      }, 250);
    }
    onViewport();
    // Once more after the layout settled (the page may be resized right after the event).
    setTimeout(onViewport, 120);
  };

  // When the focus comes back to the editor by code (a sheet closed, the note menu closed),
  // Chromium scrolls the editor element into view as the keyboard appears, which jumped to the
  // top of the note and back. For a moment such jumps are undone; our own centring is not.
  let hold: { y: number; until: number } | null = null;
  let touching = false;
  const holdScroll = (ms = 900) => { hold = { y: window.scrollY, until: performance.now() + ms }; };
  window.addEventListener('scroll', () => {
    if (!hold || touching) return;
    if (performance.now() > hold.until) { hold = null; return; }
    if (Math.abs(window.scrollY - hold.y) > 40) window.scrollTo(0, hold.y);
  }, { passive: true });
  const releaseHold = () => { hold = null; };

  // Taps on the page are handled here instead of by Chromium. Its tap opens Android's
  // spelling suggestions box on underlined words (cannot be styled: black on black in Expo
  // Go) and, on the empty page below the note, scrolled the note up. Only short, still taps;
  // long presses (selection), drags (scrolling) and taps on links, checkboxes, note links,
  // images, formulas, tables, the title and the bars keep the native handling.
  const belowContent = (y: number) => {
    const last = editor.view.dom.lastElementChild;
    return !!last && y > last.getBoundingClientRect().bottom + 8;
  };
  const NATIVE_TAP = 'a, input, textarea, label, button, select, img, .image-node, [data-note-link], [data-type="inline-math"], .outline-toggle, '
    + '[data-type="block-math"], .tableWrapper, .attachment-card, .tb, .tb-notelink, .find-bar, .history-view, #chips, #title, #wordcount';
  // A tap on an image or a file card selects it without the keyboard (it pushed the image off
  // screen); a tap on the text brings the keyboard back.
  const NO_KEYBOARD_TAP = '.image-node, .attachment-card';
  // Moving an image (hold, then drag) is image-drag.ts in the shared editor.
  const editorDom = editor.view.dom as HTMLElement;
  // Only a tap counts (a finger scrolling over an image must not hide the keyboard).
  let imageTap: { x: number; y: number } | null = null;
  document.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    imageTap = t && (e.target as El).closest?.(NO_KEYBOARD_TAP) ? { x: t.clientX, y: t.clientY } : null;
    if (!imageTap && editorDom.contains(e.target as Node) && editorDom.inputMode === 'none') editorDom.inputMode = '';
  }, { passive: true, capture: true });
  document.addEventListener('touchmove', (e) => {
    const t = e.touches[0];
    if (imageTap && t && Math.hypot(t.clientX - imageTap.x, t.clientY - imageTap.y) > 8) imageTap = null;
  }, { passive: true, capture: true });
  document.addEventListener('touchend', () => {
    if (imageTap && editorDom.inputMode !== 'none') editorDom.inputMode = 'none';
    imageTap = null;
  }, { passive: true, capture: true });
  editor.on('selectionUpdate', () => {
    if (editorDom.inputMode === 'none' && !(editor.state.selection instanceof NodeSelection)) editorDom.inputMode = '';
    // The image's / file's own buttons live in the bar: it shows without a keyboard too.
    else if (atomWithoutKeyboard() && editor.isFocused) show(true);
  });
  let tap: { x: number; y: number; at: number } | null = null;
  document.addEventListener('touchstart', (e) => {
    touching = true;
    const t = e.touches[0];
    const target = e.target as El;
    tap = e.touches.length === 1 && editor.isEditable && !openSheet && !target.closest(NATIVE_TAP) ? { x: t.clientX, y: t.clientY, at: Date.now() } : null;
  }, { passive: true, capture: true });
  document.addEventListener('touchmove', (e) => {
    const t = e.touches[0];
    if (tap && Math.hypot(t.clientX - tap.x, t.clientY - tap.y) > 8) tap = null;
  }, { passive: true, capture: true });
  document.addEventListener('touchcancel', () => { touching = false; tap = null; }, { capture: true });
  document.addEventListener('touchend', (e) => {
    touching = e.touches.length > 0;
    const start = tap;
    tap = null;
    if (!start || Date.now() - start.at > 350 || openSheet) return;
    const t = e.changedTouches[0];
    const inEditor = editor.view.dom.contains(e.target as Node);
    // The empty page (beside or below the note): nothing moves. Unfocused, it starts typing
    // at the end of the note.
    if (!inEditor || belowContent(t.clientY)) {
      e.preventDefault();
      if (!editor.isFocused) {
        closePanels();
        alignBottomOnce = true;
        focusAt(null);
      }
      return;
    }
    const hit = editor.view.posAtCoords({ left: t.clientX, top: t.clientY });
    if (!hit) return;
    // A second tap on the same spot selects the word.
    const now = Date.now();
    const double = lastTap && now - lastTap.at < 400 && Math.hypot(t.clientX - lastTap.x, t.clientY - lastTap.y) < 30;
    lastTap = double ? null : { x: t.clientX, y: t.clientY, at: now };
    if (double) {
      e.preventDefault();
      closePanels();
      selectWordAt(hit.pos);
      return;
    }
    // While typing, Chromium handles the tap itself: it moves the caret and shows Android's
    // spelling suggestions for an underlined word (taking the tap away hid them).
    if (editor.isFocused) {
      closePanels();
      return;
    }
    e.preventDefault();
    closePanels();
    focusAt(hit.pos);
  }, { passive: false, capture: true });
  let lastTap: { x: number; y: number; at: number } | null = null;
  // The word (letters, digits, ' and -) at `pos`; no word there = just the caret.
  function selectWordAt(pos: number) {
    const $pos = editor.state.doc.resolve(Math.min(pos, editor.state.doc.content.size));
    const parent = $pos.parent;
    if (!parent.isTextblock) return focusAt(pos);
    // One character per inline node, so offsets in the text are offsets in the block.
    const text = parent.textBetween(0, parent.content.size, undefined, '\ufffc');
    const word = /[\p{L}\p{N}_'’-]/u;
    let from = $pos.parentOffset;
    let to = from;
    while (from > 0 && word.test(text[from - 1])) from--;
    while (to < text.length && word.test(text[to])) to++;
    if (from === to) return focusAt(pos);
    if (!editor.isFocused) {
      if (!keyboardUp()) ctx.expectKeyboard();
      (editor.view.dom as HTMLElement).focus({ preventScroll: true });
    }
    const start = $pos.start();
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, start + from, start + to)));
  }
  // Focus taken right inside the tap (synchronously, not a frame later), so Android brings up
  // the keyboard and connects it to the editor; `pos` null = the end of the note.
  function focusAt(pos: number | null) {
    if (!editor.isFocused) {
      if (!keyboardUp()) ctx.expectKeyboard();
      // No holdScroll here: a tap is the user's own, Chromium may bring the line into view.
      (editor.view.dom as HTMLElement).focus({ preventScroll: true });
    }
    const { doc } = editor.state;
    const selection = pos === null ? Selection.atEnd(doc) : TextSelection.near(doc.resolve(Math.min(pos, doc.content.size)));
    editor.view.dispatch(editor.state.tr.setSelection(selection));
  }
  // Mouse events (no touch screen, or the synthesized ones after a native tap): taps on the
  // empty page keep the focus.
  document.addEventListener('mousedown', (e) => {
    const target = e.target as El;
    if (!editor.isFocused) return;
    if (target === editor.view.dom && belowContent(e.clientY)) return e.preventDefault();
    if (target.closest('.ProseMirror, input, textarea, button, a, select, label, [contenteditable], .tb, .tb-notelink, .find-bar')) return;
    e.preventDefault();
  }, true);

  // The bar belongs to the keyboard: focus alone (e.g. the note given the focus when it opens)
  // does not show it; the keyboard coming up does (setKeyboard).
  editor.on('focus', () => { if (keyboardUp() || openSheet || atomWithoutKeyboard()) show(true); });
  editor.on('blur', () => {
    // A short delay: focus may move into a sheet input, or come back at once (Android's
    // spelling suggestions popup takes it for a moment).
    setTimeout(() => {
      if (!openSheet && !editor.isFocused && !root.contains(document.activeElement)) show(false);
    }, 300);
  });
  editor.on('transaction', refresh);
  new ResizeObserver(() => padBottom()).observe(root);
  refresh();

  // Back to the text by code (note menu closed): no jump while the keyboard comes back.
  const refocus = () => {
    if (!keyboardUp()) ctx.expectKeyboard();
    holdScroll();
    editor.commands.focus(undefined, { scrollIntoView: false });
  };

  // Android Back: closes an open sheet first (the insert menu keeps the keyboard down, so Back
  // reaches the app instead of the keyboard). True when something was closed.
  const back = (): boolean => {
    if (openSheet) {
      closeSheet();
      return true;
    }
    // An image / file picked without the keyboard: Back lets it go (the bar goes too).
    if (atomWithoutKeyboard()) {
      (editor.view.dom as HTMLElement).blur();
      show(false);
      return true;
    }
    return false;
  };

  return { openMathEditor, openReminderPicker, openCatalog: catalogSheet, openExport: exportSheet, openNotePicker: (mode: 'goto' | 'linkto') => noteLinkSheet(mode), setKeyboard, refocus, setToolbarConfig, slash: slashRenderer, back };
}
