import type { Editor } from '@tiptap/core';
import {
  mdiBrushVariant, mdiClose, mdiEraser, mdiEraserVariant, mdiFormatColorHighlight, mdiFountainPenTip, mdiLeadPencil,
  mdiPaletteOutline, mdiPen,
} from '@mdi/js';
import { EDITOR_COLORS } from '@noted/editor/palette';
import { currentPen, DRAWING_SIZE_RANGE, onDrawingChange, setDrawingActive, setDrawingTool, setPenSettings } from '@noted/editor/drawing';
import { DRAWING_TOOLS, strokeOutline, strokeStyle } from '@noted/editor/drawing-render';
import type { DrawingTool } from '@noted/editor/drawing-render';

// Drawing tools of the phone page (drawing.ts): a floating bar at the bottom while a drawing is
// active (the keyboard is down then, so the formatting toolbar is hidden). Pen kind, the two
// erasers (the S Pen side button uses the one picked last), colour (palette or own) and width
// (slider with a sample stroke). Each pen kind keeps its own colour and width.

type El = HTMLElement;

const SVG_NS = 'http://www.w3.org/2000/svg';

const h = (tag: string, cls: string, text?: string): El => {
  const el = document.createElement(tag);
  el.className = cls;
  if (text) el.textContent = text;
  return el;
};

const icon = (path: string) =>
  `<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="${path}" fill="currentColor"/></svg>`;

const TOOLS: Record<DrawingTool, { label: string; icon: string }> = {
  pen: { label: 'Ballpoint pen', icon: mdiPen },
  fountain: { label: 'Fountain pen', icon: mdiFountainPenTip },
  pencil: { label: 'Pencil', icon: mdiLeadPencil },
  marker: { label: 'Marker', icon: mdiBrushVariant },
  highlighter: { label: 'Highlighter', icon: mdiFormatColorHighlight },
};

const COLORS: { label: string; value: string | null }[] = [
  { label: 'Text colour', value: null },
  ...EDITOR_COLORS.map((c) => ({ label: c.label, value: c.text })),
];

// A wave for the width preview, with the pressure rising like a real stroke.
const SAMPLE = Array.from({ length: 40 }, (_, i) => ({ x: 20 + i * 7, y: 40 + Math.sin(i / 4) * 16, p: 0.3 + 0.6 * Math.sin((i / 39) * Math.PI) }));

const isHex = (value: string | null | undefined): value is string => !!value && /^#[0-9a-f]{6}$/i.test(value);

export interface DrawingBarContext {
  // The custom colour picker sheet of the formatting toolbar.
  pickColor: (title: string, initial: string | undefined, apply: (hex: string) => void) => void;
}

export const createDrawingBar = (editor: Editor, ctx: DrawingBarContext) => {
  const root = h('div', 'db');
  const toolsRow = h('div', 'tb-float');
  const colorsRow = h('div', 'tb-float db-colors');
  const widthRow = h('div', 'tb-float db-width');
  const bar = h('div', 'tb-float db-bar');
  root.append(toolsRow, colorsRow, widthRow, bar);
  document.body.appendChild(root);
  // The bar never takes the focus (the editor stays blurred, the keyboard down); the slider
  // needs its own pointer handling.
  root.addEventListener('mousedown', (e) => {
    if (!(e.target as El).closest('input')) e.preventDefault();
  });
  let openRow: 'tools' | 'colors' | 'width' | null = null;
  const toggleRow = (row: typeof openRow) => {
    openRow = openRow === row ? null : row;
    refresh();
  };

  const refreshers: (() => void)[] = [];
  const button = (path: string, title: string, run: () => void, isActive?: () => boolean, cls = 'tb-btn'): HTMLButtonElement => {
    const b = h('button', cls) as HTMLButtonElement;
    b.type = 'button';
    b.title = title;
    b.setAttribute('aria-label', title);
    b.innerHTML = icon(path);
    b.addEventListener('click', (e) => {
      e.preventDefault();
      run();
    });
    if (isActive) refreshers.push(() => b.classList.toggle('active', isActive()));
    return b;
  };
  const state = () => editor.storage.drawing.current;
  const colorCss = (value: string | null) => value ?? 'var(--text-main)';

  // ---- pen kinds ----
  for (const tool of DRAWING_TOOLS) {
    toolsRow.append(button(TOOLS[tool].icon, TOOLS[tool].label, () => {
      openRow = null;
      setDrawingTool(editor, { tool, mode: 'pen' });
    }, () => state().tool === tool));
  }
  // The pen button: back to drawing when erasing, the pen kinds when already drawing.
  const penButton = button(TOOLS.pen.icon, 'Pen', () => {
    if (state().mode !== 'pen') {
      setDrawingTool(editor, { mode: 'pen' });
      return;
    }
    toggleRow('tools');
  }, () => state().mode === 'pen');
  refreshers.push(() => {
    penButton.innerHTML = icon(TOOLS[state().tool].icon);
    penButton.title = TOOLS[state().tool].label;
  });

  // ---- colours ----
  for (const c of COLORS) {
    const swatch = h('button', 'tb-swatch') as HTMLButtonElement;
    swatch.type = 'button';
    swatch.title = c.label;
    swatch.style.background = colorCss(c.value);
    swatch.addEventListener('click', (e) => {
      e.preventDefault();
      openRow = null;
      setPenSettings(editor, { color: c.value });
    });
    refreshers.push(() => swatch.classList.toggle('db-picked', currentPen(editor).color === c.value));
    colorsRow.append(swatch);
  }
  // Own colour: shows it once picked, opens the picker (like the text colours).
  const custom = button(mdiPaletteOutline, 'Custom colour', () => {
    const now = currentPen(editor).color;
    openRow = null;
    refresh();
    ctx.pickColor('Pen colour', isHex(now) ? now : undefined, (hex) => setPenSettings(editor, { color: hex }));
  }, undefined, 'tb-btn tb-swatch-none');
  refreshers.push(() => {
    const own = currentPen(editor).color;
    if (isHex(own)) {
      custom.innerHTML = '';
      custom.className = 'tb-btn tb-swatch db-picked';
      custom.style.background = own;
    } else {
      custom.innerHTML = icon(mdiPaletteOutline);
      custom.className = 'tb-btn tb-swatch-none';
      custom.style.background = '';
    }
  });
  colorsRow.append(custom);

  const colorButton = h('button', 'tb-btn') as HTMLButtonElement;
  colorButton.type = 'button';
  colorButton.title = 'Colour';
  const colorDot = h('span', 'db-dot');
  colorButton.append(colorDot);
  colorButton.addEventListener('click', (e) => {
    e.preventDefault();
    toggleRow('colors');
  });
  refreshers.push(() => { colorDot.style.background = colorCss(currentPen(editor).color); });

  // ---- width: slider and a sample stroke drawn with the current pen ----
  const preview = document.createElementNS(SVG_NS, 'svg');
  preview.setAttribute('class', 'db-preview');
  preview.setAttribute('viewBox', '0 0 320 80');
  const sample = document.createElementNS(SVG_NS, 'path');
  preview.append(sample);
  const slider = h('input', 'db-slider') as HTMLInputElement;
  slider.type = 'range';
  slider.step = '0.5';
  const widthLabel = h('span', 'db-width-label');
  slider.addEventListener('input', () => setPenSettings(editor, { size: Number(slider.value) }));
  widthRow.append(preview, slider, widthLabel);
  refreshers.push(() => {
    const pen = currentPen(editor);
    const [min, max] = DRAWING_SIZE_RANGE[state().tool];
    slider.min = String(min);
    slider.max = String(max);
    if (document.activeElement !== slider) slider.value = String(pen.size);
    widthLabel.textContent = String(pen.size);
    // The preview shows the width as it looks in a note (drawing units at the page's scale).
    const scale = Math.max(1, Math.min(4, 1000 / Math.max(1, document.documentElement.clientWidth)));
    sample.setAttribute('d', strokeOutline(SAMPLE, pen.size / scale, state().tool));
    sample.setAttribute('style', strokeStyle({ color: pen.color, tool: state().tool }));
    preview.style.color = 'var(--text-main)';
  });

  const widthButton = h('button', 'tb-btn') as HTMLButtonElement;
  widthButton.type = 'button';
  widthButton.title = 'Width';
  const widthIcon = document.createElementNS(SVG_NS, 'svg');
  widthIcon.setAttribute('viewBox', '0 0 24 24');
  widthIcon.setAttribute('width', '24');
  widthIcon.setAttribute('height', '24');
  const widthLine = document.createElementNS(SVG_NS, 'line');
  widthLine.setAttribute('x1', '3');
  widthLine.setAttribute('y1', '12');
  widthLine.setAttribute('x2', '21');
  widthLine.setAttribute('y2', '12');
  widthLine.setAttribute('stroke-linecap', 'round');
  widthIcon.append(widthLine);
  widthButton.append(widthIcon);
  widthButton.addEventListener('click', (e) => {
    e.preventDefault();
    toggleRow('width');
  });
  refreshers.push(() => {
    const pen = currentPen(editor);
    const [min, max] = DRAWING_SIZE_RANGE[state().tool];
    widthLine.setAttribute('stroke-width', String(1.5 + ((pen.size - min) / (max - min)) * 9));
    widthLine.setAttribute('stroke', colorCss(pen.color));
  });

  const sep = () => h('span', 'tb-sep');
  bar.append(
    penButton,
    button(mdiEraser, 'Eraser: whole strokes', () => { openRow = null; setDrawingTool(editor, { mode: 'eraser', eraser: 'stroke' }); },
      () => state().mode === 'eraser' && state().eraser === 'stroke'),
    button(mdiEraserVariant, 'Eraser: touched part', () => { openRow = null; setDrawingTool(editor, { mode: 'eraser', eraser: 'part' }); },
      () => state().mode === 'eraser' && state().eraser === 'part'),
    sep(),
    colorButton,
    widthButton,
    sep(),
    button(mdiClose, 'Close drawing tools', () => setDrawingActive(editor, false)),
  );

  function refresh() {
    const open = editor.storage.drawing.active && editor.isEditable;
    if (!open) openRow = null;
    root.classList.toggle('open', open);
    bar.classList.toggle('open', open);
    toolsRow.classList.toggle('open', open && openRow === 'tools');
    colorsRow.classList.toggle('open', open && openRow === 'colors');
    widthRow.classList.toggle('open', open && openRow === 'width');
    for (const r of refreshers) r();
  }
  onDrawingChange(editor, refresh);
  refresh();
  return { refresh };
};
