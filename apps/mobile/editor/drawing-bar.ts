import type { Editor } from '@tiptap/core';
import { mdiClose, mdiDotsVertical, mdiPaletteOutline } from '@mdi/js';
import { EDITOR_COLORS } from '@noted/editor/palette';
import {
  currentPen, DRAWING_SIZE_RANGE, DRAWING_TOOL_ITEMS, onDrawingChange, serializeDrawingTools, setDrawingActive, setDrawingTool,
  setPenSettings,
} from '@noted/editor/drawing';
import { DRAWING_TOOLS, strokeOutline, strokeStyle } from '@noted/editor/drawing-render';
import type { DrawingTool } from '@noted/editor/drawing-render';
import { toolbarGroups, toolbarItem } from '@noted/editor/toolbar-items';
import type { ToolbarConfig } from '@noted/editor/toolbar-items';

// Drawing tools of the phone page (drawing.ts): a floating bar at the bottom while a drawing is
// active (the keyboard is down then, so the formatting toolbar is hidden). Its buttons come from
// Settings > Toolbar > Drawing (`mobileDrawing`): the pen kind picker or the kinds themselves,
// the two erasers (the S Pen side button uses the one picked last), colour (palette or own),
// width (slider with a sample stroke); a subgroup opens behind ⋮. Each pen kind keeps its own
// colour and width; the choices are kept by React Native (saveTools).

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

const KIND_OF_ITEM = Object.fromEntries(DRAWING_TOOLS.map((tool) => [DRAWING_TOOL_ITEMS[tool], tool])) as Record<string, DrawingTool>;

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
  // Keeps the tool choices (serializeDrawingTools) for the next start.
  saveTools: (text: string) => void;
}

export const createDrawingBar = (editor: Editor, ctx: DrawingBarContext) => {
  const root = h('div', 'db');
  // Rows above the bar: the pen kinds, colours, width, or a subgroup's buttons.
  const row = h('div', 'tb-float');
  const bar = h('div', 'tb-float db-bar');
  root.append(row, bar);
  document.body.appendChild(root);
  // The bar never takes the focus (the editor stays blurred, the keyboard down); the slider
  // needs its own pointer handling.
  root.addEventListener('mousedown', (e) => {
    if (!(e.target as El).closest('input')) e.preventDefault();
  });
  let config: ToolbarConfig | null = null;
  let openRow: string | null = null;
  const toggleRow = (name: string) => {
    openRow = openRow === name ? null : name;
    refresh();
  };

  // Rebuilt with the bar (the config changes); `refresh` updates the states in place.
  let refreshers: (() => void)[] = [];
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
  const pickKind = (tool: DrawingTool) => {
    openRow = null;
    setDrawingTool(editor, { tool, mode: 'pen' });
  };
  const erase = (eraser: 'stroke' | 'part') => {
    openRow = null;
    setDrawingTool(editor, { mode: 'eraser', eraser });
  };

  // ---- the rows (built when opened) ----
  const kindsRow = () => DRAWING_TOOLS.map((tool) => {
    const def = toolbarItem(DRAWING_TOOL_ITEMS[tool])!;
    return button(def.icon, def.label, () => pickKind(tool), () => state().tool === tool);
  });

  const colorsRow = () => {
    const out: El[] = COLORS.map((c) => {
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
      return swatch;
    });
    // Own colour: shows it once picked, opens the picker (like the text colours).
    const own = currentPen(editor).color;
    const custom = button(mdiPaletteOutline, 'Custom colour', () => {
      const now = currentPen(editor).color;
      openRow = null;
      refresh();
      ctx.pickColor('Pen colour', isHex(now) ? now : undefined, (hex) => setPenSettings(editor, { color: hex }));
    }, undefined, isHex(own) ? 'tb-btn tb-swatch db-picked' : 'tb-btn tb-swatch-none');
    if (isHex(own)) {
      custom.innerHTML = '';
      custom.style.background = own;
    }
    out.push(custom);
    return out;
  };

  const widthRow = () => {
    const preview = document.createElementNS(SVG_NS, 'svg');
    preview.setAttribute('class', 'db-preview');
    preview.setAttribute('viewBox', '0 0 320 80');
    const sample = document.createElementNS(SVG_NS, 'path');
    preview.append(sample);
    const slider = h('input', 'db-slider') as HTMLInputElement;
    slider.type = 'range';
    slider.step = '0.5';
    const label = h('span', 'db-width-label');
    slider.addEventListener('input', () => setPenSettings(editor, { size: Number(slider.value) }));
    refreshers.push(() => {
      const pen = currentPen(editor);
      const [min, max] = DRAWING_SIZE_RANGE[state().tool];
      slider.min = String(min);
      slider.max = String(max);
      if (document.activeElement !== slider) slider.value = String(pen.size);
      label.textContent = String(pen.size);
      // The width as it looks in a note (drawing units at the page's scale).
      const scale = Math.max(1, Math.min(4, 1000 / Math.max(1, document.documentElement.clientWidth)));
      sample.setAttribute('d', strokeOutline(SAMPLE, pen.size / scale, state().tool));
      sample.setAttribute('style', strokeStyle({ color: pen.color, tool: state().tool }));
      preview.style.color = 'var(--text-main)';
    });
    return [preview, slider, label];
  };

  // ---- the bar's buttons ----
  const colorButton = () => {
    const b = h('button', 'tb-btn') as HTMLButtonElement;
    b.type = 'button';
    b.title = 'Colour';
    const dot = h('span', 'db-dot');
    b.append(dot);
    b.addEventListener('click', (e) => { e.preventDefault(); toggleRow('drawColor'); });
    refreshers.push(() => {
      dot.style.background = colorCss(currentPen(editor).color);
      b.classList.toggle('active', openRow === 'drawColor');
    });
    return b;
  };
  const widthButton = () => {
    const b = h('button', 'tb-btn') as HTMLButtonElement;
    b.type = 'button';
    b.title = 'Width';
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '24');
    svg.setAttribute('height', '24');
    const line = document.createElementNS(SVG_NS, 'line');
    for (const [k, v] of [['x1', '3'], ['y1', '12'], ['x2', '21'], ['y2', '12'], ['stroke-linecap', 'round']]) line.setAttribute(k, v);
    svg.append(line);
    b.append(svg);
    b.addEventListener('click', (e) => { e.preventDefault(); toggleRow('drawWidth'); });
    refreshers.push(() => {
      const pen = currentPen(editor);
      const [min, max] = DRAWING_SIZE_RANGE[state().tool];
      line.setAttribute('stroke-width', String(1.5 + ((pen.size - min) / Math.max(1, max - min)) * 9));
      line.setAttribute('stroke', colorCss(pen.color));
      b.classList.toggle('active', openRow === 'drawWidth');
    });
    return b;
  };
  // The pen kind picker: back to drawing when erasing, the kinds when already drawing.
  const kindButton = () => {
    const b = button(toolbarItem('drawTool')!.icon, 'Pen kind', () => {
      if (state().mode !== 'pen') {
        setDrawingTool(editor, { mode: 'pen' });
        return;
      }
      toggleRow('drawTool');
    }, () => state().mode === 'pen');
    refreshers.push(() => {
      const def = toolbarItem(DRAWING_TOOL_ITEMS[state().tool])!;
      b.innerHTML = icon(def.icon);
      b.title = def.label;
    });
    return b;
  };
  const itemButton = (id: string): El | null => {
    if (id === 'drawTool') return kindButton();
    if (id === 'drawColor') return colorButton();
    if (id === 'drawWidth') return widthButton();
    const def = toolbarItem(id);
    if (!def) return null;
    const kind = KIND_OF_ITEM[id];
    if (kind) return button(def.icon, def.label, () => pickKind(kind), () => state().mode === 'pen' && state().tool === kind);
    if (id === 'eraseStroke') return button(def.icon, def.label, () => erase('stroke'), () => state().mode === 'eraser' && state().eraser === 'stroke');
    if (id === 'erasePart') return button(def.icon, def.label, () => erase('part'), () => state().mode === 'eraser' && state().eraser === 'part');
    if (id === 'drawUndo') return button(def.icon, def.label, () => editor.commands.undo());
    if (id === 'drawRedo') return button(def.icon, def.label, () => editor.commands.redo());
    return null;
  };

  const subgroups = new Map<string, string[]>();
  const build = () => {
    refreshers = [];
    subgroups.clear();
    const out: El[] = [];
    toolbarGroups('mobileDrawing', config).forEach((group, gi) => {
      if (gi > 0) out.push(h('span', 'tb-sep'));
      group.forEach((part, pi) => {
        if (!Array.isArray(part)) {
          const b = itemButton(part);
          if (b) out.push(b);
          return;
        }
        const key = `sub:${gi}:${pi}`;
        subgroups.set(key, part);
        out.push(button(mdiDotsVertical, 'More drawing tools', () => toggleRow(key), () => openRow === key));
      });
    });
    out.push(h('span', 'tb-sep'), button(mdiClose, 'Close drawing tools', () => setDrawingActive(editor, false)));
    bar.replaceChildren(...out);
    buildRow();
  };
  // The open row's content (rebuilt when another row opens).
  let builtRow: string | null = null;
  let rowRefreshers: (() => void)[] = [];
  const buildRow = () => {
    builtRow = openRow;
    const barRefreshers = refreshers;
    refreshers = [];
    const sub = openRow ? subgroups.get(openRow) : undefined;
    const content = openRow === 'drawTool' ? kindsRow()
      : openRow === 'drawColor' ? colorsRow()
      : openRow === 'drawWidth' ? widthRow()
      : sub ? sub.map(itemButton).filter((b): b is El => !!b)
      : [];
    row.classList.toggle('db-colors', openRow === 'drawColor');
    row.classList.toggle('db-width', openRow === 'drawWidth');
    row.replaceChildren(...content);
    rowRefreshers = refreshers;
    refreshers = barRefreshers;
  };

  function refresh() {
    const open = editor.storage.drawing.active && editor.isEditable;
    if (!open) openRow = null;
    if (builtRow !== openRow) buildRow();
    root.classList.toggle('open', open);
    bar.classList.toggle('open', open);
    row.classList.toggle('open', open && openRow !== null);
    for (const r of refreshers) r();
    for (const r of rowRefreshers) r();
  }

  // The choices go to React Native a moment after the last change.
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  onDrawingChange(editor, () => {
    refresh();
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => ctx.saveTools(serializeDrawingTools(state())), 400);
  });

  build();
  refresh();
  return {
    refresh,
    setConfig: (next: ToolbarConfig | null) => {
      if (JSON.stringify(next) === JSON.stringify(config)) return;
      config = next;
      openRow = null;
      build();
      refresh();
    },
  };
};
