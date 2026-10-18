import { Extension, Node } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import type { Editor } from '@tiptap/core';
import { Fragment } from '@tiptap/pm/model';
import type { Node as PmNode } from '@tiptap/pm/model';
import { decodePoints, DRAWING_WIDTH, encodePoints } from './drawing-codec';
import type { StrokePoint } from './drawing-codec';
import {
  DEFAULT_DRAWING_HEIGHT, DEFAULT_PEN_SIZE, DEFAULT_TOOL_SIZES, DRAWING_TOOLS, drawingSize, isDrawingTool, strokeData, strokeOutline, strokePath, strokeStyle,
} from './drawing-render';
import type { DrawingStrokeData, DrawingTool } from './drawing-render';
import { boxNear, eraserPath, eraseStrokePart, pointsBox, strokeHit } from './drawing-erase';
import { belowCut, lineShape, recognizeShape, spansSides } from './drawing-shapes';
import { cornerScale, duplicateOffset, lassoTakes, moveStroke, NO_MOVE, pasteOffset, strokesBox } from './drawing-lasso';
import type { StrokeMove } from './drawing-lasso';
import { mdiContentCopy, mdiContentCut, mdiContentDuplicate, mdiContentPaste, mdiDeleteOutline, mdiPaletteOutline, mdiClose } from '@mdi/js';
import { EDITOR_COLORS } from './palette';
import type { ShapeKind } from './drawing-shapes';
import type { Box, EraserMode } from './drawing-erase';

// Hand drawing block. The strokes are child nodes (drawingStroke) of the block, so they live in
// the note body like any other content: two devices drawing at once merge, Yjs undo covers
// them, locked notes seal them with the body, copy / paste and history carry them. Coordinates
// are drawing units (x 0..DRAWING_WIDTH, see drawing-codec.ts), so a drawing scales with the
// note width and looks the same on every device. `height` is the minimum height in the same
// units; the block grows below its lowest stroke.
//
// A drawing wider than the note (a long formula) scrolls sideways inside the block.
//
// Input: a pen (S Pen, tablet) or the mouse draws or erases (the tool in storage, or the pen's
// eraser: the phone passes the S Pen side button held at the start of a contact as one, see
// apps/mobile/plugins/with-stylus.js), a finger scrolls the note (or the block sideways) and a
// tap with it puts the keyboard away. Platforms show their drawing tools while a drawing is
// active (onDrawingChange).

const SVG_NS = 'http://www.w3.org/2000/svg';
// Space kept beyond the strokes while editing, to write further down / right.
const EDIT_ROOM = { x: 250, y: 160 };
// Widest drawing (drawing units), against runaway strokes.
const MAX_WIDTH = DRAWING_WIDTH * 20;
// A stroke ending this close to the visible right edge (share of the visible width) scrolls
// the block on, by SCROLL_STEP of the visible width.
const SCROLL_EDGE = 0.18;
const SCROLL_STEP = 0.5;
// Points closer than this (drawing units) to the previous one are dropped.
const MIN_POINT_DISTANCE = 0.4;
// The S Pen reports about 0.5 at full force; scaled so a firm stroke reaches 1.
const PEN_PRESSURE_MAX = 0.5;
const MOUSE_PRESSURE = 0.5;
// Eraser radius in drawing units.
const ERASER_RADIUS = 16;
// The pen held still this long at the end of a stroke: the stroke becomes a shape, or a cut
// when it runs from side to side. Still = within HOLD_PX screen pixels.
const HOLD_MS = 550;
const HOLD_PX = 6;
// Grid paper cell sizes (drawing units): the width slider's range and the default.
export const DRAWING_GRID_RANGE: [number, number] = [20, 160];
const DEFAULT_GRID = 50;
// A press that ends within this many screen pixels is a tap.
const TAP_PX = 4;
// Space above the strokes of the lower part after a cut.
const CUT_MARGIN = 24;
let gridIds = 0;

// Width range of the width slider (drawing units).
export const DRAWING_SIZE_RANGE: Record<DrawingTool, [number, number]> = {
  pen: [1, 30], fountain: [1, 30], pencil: [1, 30], marker: [2, 40], highlighter: [8, 80],
};

export interface PenSettings {
  // CSS colour (palette variable, hex) or null = the text colour.
  color: string | null;
  size: number;
}

export interface DrawingToolState {
  mode: 'pen' | 'eraser' | 'lasso';
  // Grid paper under the active drawing while writing (never part of the note).
  paper: 'none' | 'grid';
  gridSize: number;
  // What the eraser (also the pen's eraser) removes: whole strokes or the touched part.
  eraser: EraserMode;
  // The pen kind; each keeps its own colour and width.
  tool: DrawingTool;
  pens: Record<DrawingTool, PenSettings>;
}

interface DrawingStorage {
  // The tool new strokes use (platform toolbars change it).
  current: DrawingToolState;
  // The user is working in a drawing (drew in it or tapped it); cleared when the text gets
  // the focus. Platforms show the drawing tools meanwhile, next to `activeDom`.
  active: boolean;
  activeDom: HTMLElement | null;
  listeners: Set<() => void>;
  // Desktop "Draw with the mouse" (top toolbar): the mouse starts drawings like a pen does
  // (DrawingStarter); for this session only.
  // (A finger too: on touch screens without a pen it then draws instead of scrolling.)
  mouseDraws: boolean;
  // Live drawing blocks by their DOM: a pen stroke started outside a block (DrawingStarter)
  // is handed to the block made for it.
  views: Map<HTMLElement, { begin: (e: PointerEvent, earlier: PointLike[]) => void; hover: (at: PointLike | null) => void }>;
}

// What a stroke needs from a pointer event (also kept from events that already passed).
export interface PointLike {
  clientX: number;
  clientY: number;
  pressure: number;
}

declare module '@tiptap/core' {
  interface Storage {
    drawing: DrawingStorage;
  }
}

const notify = (editor: Editor) => editor.storage.drawing.listeners.forEach((fn) => fn());

const defaultPens = (): Record<DrawingTool, PenSettings> => Object.fromEntries(DRAWING_TOOLS.map((tool) => [
  tool, { color: tool === 'highlighter' ? 'var(--c-yellow)' : null, size: DEFAULT_TOOL_SIZES[tool] },
])) as Record<DrawingTool, PenSettings>;

export const setDrawingTool = (editor: Editor, patch: Partial<Omit<DrawingToolState, 'pens'>>): void => {
  Object.assign(editor.storage.drawing.current, patch);
  notify(editor);
};

// Colour / width of the current pen kind.
export const currentPen = (editor: Editor): PenSettings => {
  const state = editor.storage.drawing.current;
  return state.pens[state.tool];
};

export const setPenSettings = (editor: Editor, patch: Partial<PenSettings>): void => {
  const state = editor.storage.drawing.current;
  state.pens[state.tool] = { ...state.pens[state.tool], ...patch };
  state.mode = 'pen';
  notify(editor);
};

export const setDrawingActive = (editor: Editor, on: boolean, dom: HTMLElement | null = null): void => {
  const storage = editor.storage.drawing;
  const nextDom = on ? dom ?? storage.activeDom : null;
  if (storage.active === on && storage.activeDom === nextDom) return;
  storage.active = on;
  storage.activeDom = nextDom;
  notify(editor);
};

// Toolbar item (toolbar-items.ts) of each pen kind.
export const DRAWING_TOOL_ITEMS: Record<DrawingTool, string> = {
  pen: 'drawBallpoint', fountain: 'drawFountain', pencil: 'drawPencil', marker: 'drawMarker', highlighter: 'drawHighlighter',
};

// The tool choices as text, for the platform to keep (per device) and give back next time.
export const serializeDrawingTools = (state: DrawingToolState): string =>
  JSON.stringify({ v: 1, eraser: state.eraser, tool: state.tool, pens: state.pens, paper: state.paper, gridSize: state.gridSize });

export const restoreDrawingTools = (editor: Editor, text: string | null): void => {
  try {
    const data = JSON.parse(text ?? 'null');
    if (data?.v !== 1) return;
    const state = editor.storage.drawing.current;
    if (data.eraser === 'stroke' || data.eraser === 'part') state.eraser = data.eraser;
    if (data.paper === 'none' || data.paper === 'grid') state.paper = data.paper;
    const grid = Number(data.gridSize);
    if (Number.isFinite(grid)) state.gridSize = Math.min(DRAWING_GRID_RANGE[1], Math.max(DRAWING_GRID_RANGE[0], grid));
    if (isDrawingTool(data.tool)) state.tool = data.tool;
    for (const tool of DRAWING_TOOLS) {
      const pen = data.pens?.[tool];
      if (!pen) continue;
      const [min, max] = DRAWING_SIZE_RANGE[tool];
      const size = Number(pen.size);
      state.pens[tool] = {
        color: typeof pen.color === 'string' && pen.color ? pen.color : null,
        size: Number.isFinite(size) ? Math.min(max, Math.max(min, size)) : state.pens[tool].size,
      };
    }
    notify(editor);
  } catch {
    // Unreadable choices: the defaults stay.
  }
};

export const setMouseDraws = (editor: Editor, on: boolean): void => {
  editor.storage.drawing.mouseDraws = on;
  notify(editor);
};

// The pen above the screen (the phone's native code passes it on; the page gets no hover
// events): the drawing under it shows the eraser ring when the eraser or the side button
// would erase there. x = null: the pen went away.
export const showPenHover = (editor: Editor, x: number | null, y: number, sideButton: boolean): void => {
  if (editor.isDestroyed) return;
  const storage = editor.storage.drawing;
  let target: Element | null = null;
  if (x !== null && editor.isEditable && (sideButton || storage.current.mode === 'eraser')) {
    target = document.elementFromPoint(x, y)?.closest('[data-type="drawing"]') ?? null;
  }
  for (const [dom, view] of storage.views) view.hover(dom === target && x !== null ? { clientX: x, clientY: y, pressure: 0 } : null);
};

// Called when the tool or the active state changes; returns the unsubscribe function.
export const onDrawingChange = (editor: Editor, fn: () => void): (() => void) => {
  editor.storage.drawing.listeners.add(fn);
  return () => editor.storage.drawing.listeners.delete(fn);
};

const strokesOf = (node: PmNode): DrawingStrokeData[] => {
  const out: DrawingStrokeData[] = [];
  node.forEach((child) => {
    if (child.type.name === 'drawingStroke') out.push(strokeData(child.attrs));
  });
  return out;
};

export const DrawingStroke = Node.create({
  name: 'drawingStroke',
  atom: true,
  selectable: false,

  addAttributes() {
    return {
      points: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-points') ?? '',
        renderHTML: (attrs: Record<string, unknown>) => ({ 'data-points': String(attrs.points ?? '') }),
      },
      color: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-color') || null,
        renderHTML: (attrs: Record<string, unknown>) => (attrs.color ? { 'data-color': String(attrs.color) } : {}),
      },
      size: {
        default: DEFAULT_PEN_SIZE,
        parseHTML: (el: HTMLElement) => Number(el.getAttribute('data-size')) || DEFAULT_PEN_SIZE,
        renderHTML: (attrs: Record<string, unknown>) => ({ 'data-size': String(attrs.size) }),
      },
      tool: {
        default: 'pen',
        parseHTML: (el: HTMLElement) => {
          const tool = el.getAttribute('data-tool');
          return isDrawingTool(tool) ? tool : 'pen';
        },
        renderHTML: (attrs: Record<string, unknown>) => ({ 'data-tool': String(attrs.tool) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'path[data-points]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const stroke = strokeData(node.attrs);
    return [`${SVG_NS} path`, { ...HTMLAttributes, d: strokePath(stroke), style: strokeStyle(stroke) }];
  },

  renderText() {
    return '';
  },
});

export const Drawing = Node.create<Record<string, never>, DrawingStorage>({
  name: 'drawing',
  group: 'block',
  content: 'drawingStroke*',
  atom: true,
  selectable: true,
  draggable: false,
  isolating: true,

  addStorage() {
    return {
      current: { mode: 'pen', paper: 'none', gridSize: DEFAULT_GRID, eraser: 'stroke', tool: 'pen', pens: defaultPens() },
      active: false,
      activeDom: null,
      listeners: new Set(),
      views: new Map(),
      mouseDraws: false,
    };
  },

  onFocus() {
    setDrawingActive(this.editor, false);
  },

  addAttributes() {
    return {
      height: {
        default: DEFAULT_DRAWING_HEIGHT,
        parseHTML: (el: HTMLElement) => Number(el.getAttribute('data-height')) || DEFAULT_DRAWING_HEIGHT,
        renderHTML: (attrs: Record<string, unknown>) => ({ 'data-height': String(attrs.height) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'figure[data-drawing]', contentElement: 'svg' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const { width, height } = drawingSize(node.attrs.height, strokesOf(node));
    return [
      'figure',
      { ...HTMLAttributes, 'data-drawing': '', 'data-type': 'drawing', class: 'drawing-block' },
      [`${SVG_NS} svg`, { viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: 'xMinYMin meet', style: `width:${(width / DRAWING_WIDTH) * 100}%` }, 0],
    ];
  },

  renderText() {
    return '[drawing]';
  },

  addNodeView() {
    return ({ node: initial, getPos, editor }) => {
      let node = initial;
      const dom = document.createElement('figure');
      dom.className = 'drawing-block';
      dom.setAttribute('data-drawing', '');
      dom.setAttribute('data-type', 'drawing');
      dom.contentEditable = 'false';
      const scroller = document.createElement('div');
      scroller.className = 'drawing-scroll';
      const svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('preserveAspectRatio', 'xMinYMin meet');
      const strokesGroup = document.createElementNS(SVG_NS, 'g');
      // Pieces of strokes being cut by the part eraser.
      const piecesGroup = document.createElementNS(SVG_NS, 'g');
      const live = document.createElementNS(SVG_NS, 'path');
      const eraserRing = document.createElementNS(SVG_NS, 'circle');
      eraserRing.setAttribute('class', 'drawing-eraser');
      eraserRing.setAttribute('r', String(ERASER_RADIUS));
      // Grid paper (drawing units, so it scales with the drawing), only while writing here.
      const gridId = `drawing-grid-${++gridIds}`;
      const defs = document.createElementNS(SVG_NS, 'defs');
      defs.innerHTML = `<pattern id="${gridId}" patternUnits="userSpaceOnUse"><path fill="none" vector-effect="non-scaling-stroke"/></pattern>`;
      const pattern = defs.firstElementChild!;
      const gridPath = pattern.firstElementChild!;
      let gridShown = 0;
      const paper = document.createElementNS(SVG_NS, 'rect');
      paper.setAttribute('class', 'drawing-paper');
      paper.setAttribute('fill', `url(#${gridId})`);
      // The cut line being held (dashed, not a stroke).
      const cutLine = document.createElementNS(SVG_NS, 'polyline');
      cutLine.setAttribute('class', 'drawing-cut');
      // Lasso: the loop being drawn, the box around the selection and its corner handle.
      const loopLine = document.createElementNS(SVG_NS, 'polyline');
      loopLine.setAttribute('class', 'drawing-lasso');
      const selRect = document.createElementNS(SVG_NS, 'rect');
      selRect.setAttribute('class', 'drawing-selection');
      const selHandle = document.createElementNS(SVG_NS, 'circle');
      selHandle.setAttribute('class', 'drawing-handle');
      svg.append(defs, paper, strokesGroup, piecesGroup, live, cutLine, eraserRing, loopLine, selRect, selHandle);
      // What can be done with the selection (above it, or below when there is no room).
      const actions = document.createElement('div');
      actions.className = 'drawing-actions';
      const showPaper = () => {
        const storage = editor.storage.drawing;
        const on = storage.active && storage.activeDom === dom && storage.current.paper === 'grid' && editor.isEditable;
        paper.style.display = on ? 'block' : '';
        const cell = storage.current.gridSize;
        if (on && cell !== gridShown) {
          gridShown = cell;
          pattern.setAttribute('width', String(cell));
          pattern.setAttribute('height', String(cell));
          gridPath.setAttribute('d', `M ${cell} 0 L 0 0 0 ${cell}`);
        }
      };
      const offPaper = onDrawingChange(editor, showPaper);
      showPaper();
      scroller.append(svg);
      dom.append(scroller, actions);

      // Rendered strokes in document order. A stroke never changes (it only comes and goes), so
      // its path, points and box are kept by its attributes.
      interface Item { key: string; data: DrawingStrokeData; path: SVGPathElement; points: StrokePoint[]; box: Box }
      let items: Item[] = [];
      const render = () => {
        const strokes = strokesOf(node);
        const old = new Map<string, Item[]>();
        for (const item of items) old.set(item.key, [...(old.get(item.key) ?? []), item]);
        items = strokes.map((data) => {
          const key = `${data.points}|${data.color}|${data.size}|${data.tool}`;
          const reused = old.get(key)?.shift();
          if (reused) return reused;
          const path = document.createElementNS(SVG_NS, 'path');
          path.setAttribute('d', strokePath(data));
          path.setAttribute('style', strokeStyle(data));
          const points = decodePoints(data.points);
          return { key, data, path, points, box: pointsBox(points, data.size / 2) };
        });
        strokesGroup.replaceChildren(...items.map((item) => item.path));
        showErasing();
        // Strokes changed elsewhere (sync, undo) drop out of the selection.
        const keys = new Set(items.map((item) => item.key));
        for (const key of selection) if (!keys.has(key)) selection.delete(key);
        if (selection.size || actions.childElementCount) queueMicrotask(() => { if (!editor.isDestroyed) showSelection(); });
        const { width, height } = drawingSize(node.attrs.height, strokes, editor.isEditable ? EDIT_ROOM : undefined);
        setSize(width, height);
      };
      let shown = { width: DRAWING_WIDTH, height: DEFAULT_DRAWING_HEIGHT };
      const setSize = (width: number, height: number) => {
        shown = { width, height };
        paper.setAttribute('width', String(width));
        paper.setAttribute('height', String(height));
        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        svg.style.width = `${(width / DRAWING_WIDTH) * 100}%`;
      };
      // The stroke being drawn.
      let active: {
        pointerId: number; points: StrokePoint[]; tool: { tool: DrawingTool } & PenSettings; pen: boolean;
        // Holding still: where the pen rests and the timer; what the hold made of the stroke.
        rest: StrokePoint; timer: ReturnType<typeof setTimeout> | null; held: null | 'cut' | ShapeKind;
        // Screen x of the first and the latest point (a cut runs from one side to the other).
        firstX: number; lastX: number;
        // Pressed while the drawing was not active yet: a tap only wakes it (no dot).
        waking: boolean;
      } | null = null;
      // The eraser at work: strokes removed whole, or cut into pieces (by stroke key).
      let erasing: {
        pointerId: number; pen: boolean; mode: EraserMode; last: { x: number; y: number } | null;
        removed: Set<string>; pieces: Map<string, StrokePoint[][]>;
      } | null = null;
      let frame = 0;
      // Set by a pen's pointerdown, read by the touchstart that follows it.
      let penTouch = false;

      // Drawing units per CSS pixel: the note width is DRAWING_WIDTH units.
      const unitsPerPx = () => {
        const w = scroller.getBoundingClientRect().width;
        return w ? DRAWING_WIDTH / w : 1;
      };
      const toPoint = (e: PointLike, pen: boolean): StrokePoint => {
        const rect = svg.getBoundingClientRect();
        const scale = unitsPerPx();
        return {
          x: Math.min(MAX_WIDTH, Math.max(0, (e.clientX - rect.left) * scale)),
          y: Math.max(0, (e.clientY - rect.top) * scale),
          p: pen ? Math.min(1, e.pressure / PEN_PRESSURE_MAX) : MOUSE_PRESSURE,
        };
      };
      const drawLive = () => {
        frame = 0;
        if (!active) return;
        // Writing below the bottom edge (or a stroke started under the block): the block grows
        // at once, not only when the stroke is saved.
        let low = 0;
        for (const point of active.points) low = Math.max(low, point.y);
        if (low > shown.height - active.tool.size) setSize(shown.width, Math.ceil(low + EDIT_ROOM.y));
        live.setAttribute('d', strokeOutline(active.points, active.tool.size, active.tool.tool, false));
        live.setAttribute('style', strokeStyle(active.tool));
      };
      // The pen held still at the end of a stroke.
      const restartHold = () => {
        if (!active || active.held) return;
        if (active.timer) clearTimeout(active.timer);
        active.timer = setTimeout(onHold, HOLD_MS);
      };
      const onHold = () => {
        if (!active || active.held) return;
        active.timer = null;
        const { points } = active;
        const visible = scroller.getBoundingClientRect();
        if (visible.width && spansSides(active.firstX, active.lastX, visible.left, visible.right)) {
          active.held = 'cut';
          live.removeAttribute('d');
          cutLine.setAttribute('points', points.map((pt) => `${pt.x},${pt.y}`).join(' '));
          cutLine.style.display = 'block';
        } else {
          const shape = recognizeShape(points);
          if (!shape) return;
          active.held = shape.kind;
          active.points = shape.points;
          drawLive();
        }
        try {
          navigator.vibrate?.(12);
        } catch {
          // No vibration here.
        }
      };
      // Moving on after the hold: a line's end follows the pen; other shapes and a cut stay.
      const moveHeld = (point: StrokePoint) => {
        if (!active || active.held !== 'line') return;
        active.points = lineShape(active.points[0], point, active.points[0].p).points;
        if (!frame) frame = requestAnimationFrame(drawLive);
      };
      // Cut along the held line: the strokes below it become a drawing of their own under this one.
      const cutAt = (cut: StrokePoint[]) => {
        const pos = typeof getPos === 'function' ? getPos() : undefined;
        const current = typeof pos === 'number' ? editor.state.doc.nodeAt(pos) : null;
        if (typeof pos !== 'number' || current?.type.name !== 'drawing') return;
        const above: PmNode[] = [];
        const below: { node: PmNode; points: StrokePoint[] }[] = [];
        current.forEach((child) => {
          const points = decodePoints(child.attrs.points);
          if (points.length && belowCut(cut, points)) below.push({ node: child, points });
          else above.push(child);
        });
        if (!above.length || !below.length) return;
        // The lower part moves up and to the left edge (words that were on the right come into view).
        let top = Infinity;
        let left = Infinity;
        for (const { node: child, points } of below) {
          const half = Number(child.attrs.size || 0) / 2;
          for (const pt of points) {
            top = Math.min(top, pt.y - half);
            left = Math.min(left, pt.x - half);
          }
        }
        const dy = Math.max(0, top - CUT_MARGIN);
        const dx = Math.max(0, left - CUT_MARGIN);
        const moved = below.map(({ node: child, points }) => child.type.create({ ...child.attrs, points: encodePoints(points.map((pt) => ({ ...pt, x: pt.x - dx, y: pt.y - dy }))) }));
        const type = editor.schema.nodes.drawing;
        keepScroll(() => editor.view.dispatch(editor.state.tr.replaceWith(pos, pos + current.nodeSize, [
          type.create(current.attrs, above),
          type.create(null, moved),
        ])));
        // The tools stay, now with the upper part.
        const upper = editor.view.nodeDOM(pos) as HTMLElement | null;
        if (upper) setDrawingActive(editor, true, upper);
      };

      const clearLive = () => {
        cutLine.style.display = '';
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
        live.removeAttribute('d');
      };

      // Strokes the eraser has taken are hidden; cut ones show their pieces instead.
      let piecesFrame = 0;
      const showErasing = () => {
        for (const item of items) {
          const gone = !!erasing && (erasing.removed.has(item.key) || erasing.pieces.has(item.key));
          item.path.style.display = gone ? 'none' : '';
        }
        if (piecesFrame) return;
        piecesFrame = requestAnimationFrame(() => {
          piecesFrame = 0;
          const out: SVGPathElement[] = [];
          for (const [key, pieces] of erasing?.pieces ?? []) {
            const item = items.find((i) => i.key === key);
            if (!item) continue;
            for (const piece of pieces) {
              const path = document.createElementNS(SVG_NS, 'path');
              path.setAttribute('d', strokeOutline(piece, item.data.size, item.data.tool));
              path.setAttribute('style', strokeStyle(item.data));
              out.push(path);
            }
          }
          piecesGroup.replaceChildren(...out);
        });
      };
      const eraseAt = (x: number, y: number) => {
        if (!erasing) return;
        for (const item of items) {
          if (erasing.removed.has(item.key) || !boxNear(item.box, x, y, ERASER_RADIUS)) continue;
          if (erasing.mode === 'stroke') {
            if (strokeHit(item.points, item.data.size, x, y, ERASER_RADIUS)) erasing.removed.add(item.key);
            continue;
          }
          const current = erasing.pieces.get(item.key) ?? [item.points];
          let changed = false;
          const next: StrokePoint[][] = [];
          for (const piece of current) {
            const cut = eraseStrokePart(piece, item.data.size, x, y, ERASER_RADIUS);
            if (cut) changed = true;
            next.push(...(cut ?? [piece]));
          }
          if (changed) erasing.pieces.set(item.key, next);
        }
      };
      const moveEraserRing = (x: number, y: number) => {
        eraserRing.setAttribute('cx', String(x));
        eraserRing.setAttribute('cy', String(y));
        eraserRing.style.display = 'block';
      };
      // One transaction for the whole eraser movement (one undo step).
      const commitErasing = () => {
        const done = erasing;
        erasing = null;
        eraserRing.style.display = '';
        const pos = typeof getPos === 'function' ? getPos() : undefined;
        const current = typeof pos === 'number' ? editor.state.doc.nodeAt(pos) : null;
        const type = editor.schema.nodes.drawingStroke;
        if (done && (done.removed.size || done.pieces.size) && typeof pos === 'number' && current?.type.name === 'drawing' && type) {
          const changes: { from: number; to: number; nodes: PmNode[] }[] = [];
          const used = new Set<string>();
          current.forEach((child, offset) => {
            const data = strokeData(child.attrs);
            const key = `${data.points}|${data.color}|${data.size}|${data.tool}`;
            if (used.has(key)) return;
            const from = pos + 1 + offset;
            if (done.removed.has(key)) changes.push({ from, to: from + child.nodeSize, nodes: [] });
            const pieces = done.pieces.get(key);
            if (pieces) {
              changes.push({ from, to: from + child.nodeSize, nodes: pieces.map((piece) => type.create({ ...child.attrs, points: encodePoints(piece) })) });
            }
            if (done.removed.has(key) || pieces) used.add(key);
          });
          const tr = editor.state.tr;
          for (const change of changes.reverse()) tr.replaceWith(change.from, change.to, Fragment.from(change.nodes));
          // Everything erased: the empty block goes too (the same undo step brings both back).
          const left = tr.doc.nodeAt(pos);
          if (left?.type.name === 'drawing' && left.childCount === 0) tr.delete(pos, pos + left.nodeSize);
          if (tr.docChanged) keepScroll(() => editor.view.dispatch(tr));
        }
        piecesGroup.replaceChildren();
        showErasing();
      };

      // ---- lasso: select strokes, then move / scale / copy / cut / duplicate / delete / recolour ----
      let selection = new Set<string>();
      let lassoing:
        | { pointerId: number; kind: 'loop'; points: StrokePoint[] }
        | { pointerId: number; kind: 'move'; from: StrokePoint; move: StrokeMove }
        | { pointerId: number; kind: 'scale'; box: Box; move: StrokeMove }
        | null = null;
      let colorsOpen = false;
      const keyOf = (attrs: Record<string, unknown>) => {
        const data = strokeData(attrs);
        return `${data.points}|${data.color}|${data.size}|${data.tool}`;
      };
      const picked = () => items.filter((item) => selection.has(item.key));
      const pickedBox = () => strokesBox(picked().map((item) => ({ points: item.points, size: item.data.size })));
      const lassoHere = () => {
        if (editor.isDestroyed) return false;
        const storage = editor.storage.drawing;
        return storage.active && storage.activeDom === dom && storage.current.mode === 'lasso' && editor.isEditable;
      };
      const movedBox = (box: Box, move: StrokeMove): Box => {
        const at = (x: number, y: number) => ({ x: move.originX + (x - move.originX) * move.scale + move.dx, y: move.originY + (y - move.originY) * move.scale + move.dy });
        const a = at(box.minX, box.minY);
        const b = at(box.maxX, box.maxY);
        return { minX: a.x, minY: a.y, maxX: b.x, maxY: b.y };
      };
      const handleRadius = () => 10 * unitsPerPx();

      // Draws the box, the handle and the actions; `move` previews a drag on the picked strokes.
      const showSelection = (move: StrokeMove = NO_MOVE) => {
        const moving = move !== NO_MOVE;
        const transform = moving ? `translate(${move.dx + move.originX * (1 - move.scale)} ${move.dy + move.originY * (1 - move.scale)}) scale(${move.scale})` : '';
        for (const item of items) {
          const on = selection.has(item.key);
          item.path.classList.toggle('drawing-picked', on);
          if (on && transform) item.path.setAttribute('transform', transform);
          else item.path.removeAttribute('transform');
        }
        const raw = pickedBox();
        const box = raw && movedBox(raw, move);
        if (box) {
          const pad = 6 * unitsPerPx();
          selRect.setAttribute('x', String(box.minX - pad));
          selRect.setAttribute('y', String(box.minY - pad));
          selRect.setAttribute('width', String(box.maxX - box.minX + pad * 2));
          selRect.setAttribute('height', String(box.maxY - box.minY + pad * 2));
          selHandle.setAttribute('cx', String(box.maxX + pad));
          selHandle.setAttribute('cy', String(box.maxY + pad));
          selHandle.setAttribute('r', String(handleRadius()));
        }
        selRect.style.display = box ? 'block' : '';
        selHandle.style.display = box ? 'block' : '';
        showActions(moving ? null : box);
      };

      const actionButton = (path: string, title: string, run: () => void) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.title = title;
        b.setAttribute('aria-label', title);
        b.innerHTML = iconSvg(path);
        b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); });
        b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); run(); });
        return b;
      };
      const showActions = (box: Box | null) => {
        const pasteOnly = !box && lassoHere() && !!strokeClipboard;
        if (!box && !pasteOnly) {
          actions.replaceChildren();
          actions.style.display = '';
          colorsOpen = false;
          return;
        }
        const row = document.createElement('div');
        row.className = 'drawing-actions-row';
        if (box) {
          row.append(
            actionButton(mdiContentCopy, 'Copy (Ctrl+C)', copyPicked),
            actionButton(mdiContentCut, 'Cut (Ctrl+X)', () => { copyPicked(); deletePicked(); }),
            actionButton(mdiContentDuplicate, 'Duplicate (Ctrl+D)', duplicatePicked),
            actionButton(mdiPaletteOutline, 'Colour', () => { colorsOpen = !colorsOpen; showSelection(); }),
            actionButton(mdiDeleteOutline, 'Delete (Del)', deletePicked),
          );
        }
        if (strokeClipboard) row.append(actionButton(mdiContentPaste, 'Paste (Ctrl+V)', pasteHere));
        if (box) row.append(actionButton(mdiClose, 'Clear the selection (Esc)', clearSelection));
        const parts: HTMLElement[] = [row];
        if (box && colorsOpen) {
          const swatches = document.createElement('div');
          swatches.className = 'drawing-actions-row drawing-actions-colors';
          const own = currentPen(editor).color;
          const colors = [{ label: 'Text colour', value: null as string | null }, ...EDITOR_COLORS.map((c) => ({ label: c.label, value: c.text as string | null }))];
          if (own && own.startsWith('#')) colors.push({ label: 'Pen colour', value: own });
          for (const c of colors) {
            const b = actionButton('', c.label, () => recolorPicked(c.value));
            b.innerHTML = '';
            b.className = 'drawing-swatch';
            b.style.background = c.value ?? 'var(--text-main)';
            swatches.append(b);
          }
          parts.push(swatches);
        }
        actions.replaceChildren(...parts);
        actions.style.display = 'flex';
        // Placed over the selection, in the figure's coordinates.
        const figure = dom.getBoundingClientRect();
        const area = svg.getBoundingClientRect();
        const scale = unitsPerPx();
        const height = actions.offsetHeight || 44;
        const width = actions.offsetWidth || 240;
        let left = 8;
        let top = -height - 8;
        if (box) {
          left = area.left - figure.left + box.minX / scale;
          top = area.top - figure.top + box.minY / scale - height - 14;
          if (area.top + box.minY / scale - height - 14 < 0) top = area.top - figure.top + box.maxY / scale + 22;
        } else {
          top = 8;
        }
        actions.style.left = `${Math.max(0, Math.min(left, figure.width - width))}px`;
        actions.style.top = `${top}px`;
      };

      const clearSelection = () => {
        selection = new Set();
        colorsOpen = false;
        showSelection();
      };
      // Replaces the picked strokes (one transaction); `make` returns their new versions.
      const replacePicked = (make: (child: PmNode, item: Item) => PmNode[]): void => {
        const pos = typeof getPos === 'function' ? getPos() : undefined;
        const current = typeof pos === 'number' ? editor.state.doc.nodeAt(pos) : null;
        if (typeof pos !== 'number' || current?.type.name !== 'drawing') return;
        const byKey = new Map(picked().map((item) => [item.key, item]));
        const changes: { from: number; to: number; nodes: PmNode[] }[] = [];
        const next = new Set<string>();
        current.forEach((child, offset) => {
          const key = keyOf(child.attrs);
          const item = byKey.get(key);
          if (!item) return;
          byKey.delete(key);
          const nodes = make(child, item);
          for (const n of nodes) next.add(keyOf(n.attrs));
          changes.push({ from: pos + 1 + offset, to: pos + 1 + offset + child.nodeSize, nodes });
        });
        if (!changes.length) return;
        const tr = editor.state.tr;
        for (const change of changes.reverse()) tr.replaceWith(change.from, change.to, Fragment.from(change.nodes));
        // Everything deleted: the empty block goes too.
        const left = tr.doc.nodeAt(pos);
        if (left?.type.name === 'drawing' && left.childCount === 0) tr.delete(pos, pos + left.nodeSize);
        selection = next;
        keepScroll(() => editor.view.dispatch(tr));
        showSelection();
      };
      const strokeNode = (stroke: CopiedStroke) => editor.schema.nodes.drawingStroke.create({
        points: encodePoints(stroke.points), color: stroke.color, size: stroke.size, tool: stroke.tool,
      });
      // Adds strokes at the end and selects them.
      const appendStrokes = (strokes: CopiedStroke[]) => {
        const pos = typeof getPos === 'function' ? getPos() : undefined;
        const current = typeof pos === 'number' ? editor.state.doc.nodeAt(pos) : null;
        if (typeof pos !== 'number' || current?.type.name !== 'drawing' || !strokes.length) return;
        const nodes = strokes.map(strokeNode);
        selection = new Set(nodes.map((n) => keyOf(n.attrs)));
        keepScroll(() => editor.view.dispatch(editor.state.tr.insert(pos + 1 + current.content.size, nodes)));
        showSelection();
      };
      const copied = (item: Item, move: StrokeMove = NO_MOVE): CopiedStroke => {
        const moved = moveStroke({ points: item.points, size: item.data.size }, move);
        return { color: item.data.color, size: moved.size, tool: item.data.tool, points: moved.points };
      };
      const copyPicked = () => {
        const box = pickedBox();
        if (!box) return;
        strokeClipboard = { strokes: picked().map((item) => copied(item)), box };
        showSelection();
      };
      const deletePicked = () => replacePicked(() => []);
      const duplicatePicked = () => {
        const box = pickedBox();
        if (!box) return;
        const { dx, dy } = duplicateOffset(box);
        appendStrokes(picked().map((item) => copied(item, { ...NO_MOVE, dx, dy })));
      };
      const recolorPicked = (color: string | null) => {
        colorsOpen = false;
        replacePicked((child) => [child.type.create({ ...child.attrs, color })]);
      };
      const pasteHere = () => {
        if (!strokeClipboard) return;
        const { dx, dy } = pasteOffset(strokeClipboard.box, items.map((item) => item.box));
        appendStrokes(strokeClipboard.strokes.map((stroke) => ({ ...stroke, ...moveStroke(stroke, { ...NO_MOVE, dx, dy }) })));
      };
      const commitMove = (move: StrokeMove) => {
        replacePicked((child, item) => {
          const moved = moveStroke({ points: item.points, size: item.data.size }, move);
          return [child.type.create({ ...child.attrs, points: encodePoints(moved.points), size: moved.size })];
        });
      };

      const lassoDown = (e: PointerEvent, pen: boolean) => {
        const pt = toPoint(e, pen);
        const box = pickedBox();
        const pad = 6 * unitsPerPx();
        if (box && Math.hypot(pt.x - (box.maxX + pad), pt.y - (box.maxY + pad)) <= handleRadius() * 1.8) {
          lassoing = { pointerId: e.pointerId, kind: 'scale', box, move: NO_MOVE };
        } else if (box && pt.x >= box.minX - pad && pt.x <= box.maxX + pad && pt.y >= box.minY - pad && pt.y <= box.maxY + pad) {
          lassoing = { pointerId: e.pointerId, kind: 'move', from: pt, move: NO_MOVE };
        } else {
          selection = new Set();
          colorsOpen = false;
          lassoing = { pointerId: e.pointerId, kind: 'loop', points: [pt] };
          loopLine.setAttribute('points', `${pt.x},${pt.y}`);
          loopLine.style.display = 'block';
          showSelection();
        }
      };
      const lassoMove = (e: PointerEvent) => {
        if (!lassoing) return;
        const pt = toPoint(e, e.pointerType === 'pen');
        if (lassoing.kind === 'loop') {
          lassoing.points.push(pt);
          loopLine.setAttribute('points', lassoing.points.map((p) => `${p.x},${p.y}`).join(' '));
        } else if (lassoing.kind === 'move') {
          lassoing.move = { ...NO_MOVE, dx: pt.x - lassoing.from.x, dy: pt.y - lassoing.from.y };
          showSelection(lassoing.move);
        } else {
          const scale = cornerScale(lassoing.box, pt.x, pt.y);
          lassoing.move = { dx: 0, dy: 0, scale, originX: lassoing.box.minX, originY: lassoing.box.minY };
          showSelection(lassoing.move);
        }
      };
      const lassoUp = (keep: boolean) => {
        const done = lassoing;
        lassoing = null;
        if (!done) return;
        if (done.kind === 'loop') {
          loopLine.style.display = '';
          selection = keep ? new Set(items.filter((item) => lassoTakes(done.points, item.points)).map((item) => item.key)) : new Set();
          showSelection();
          return;
        }
        const { move } = done;
        if (keep && (move.dx || move.dy || move.scale !== 1)) commitMove(move);
        else showSelection();
      };
      // The selection goes when the lasso is put away or another drawing is worked in.
      const offSelection = onDrawingChange(editor, () => {
        if (!lassoHere() && selection.size) clearSelection();
        else showSelection();
      });
      // Desktop keys while the lasso is out here (nothing has the focus then).
      const onKey = (e: KeyboardEvent) => {
        if (!lassoHere()) return;
        const target = e.target as HTMLElement | null;
        if (target?.closest?.('input, textarea, [contenteditable="true"]')) return;
        const mod = e.ctrlKey || e.metaKey;
        const key = e.key.toLowerCase();
        const run = (fn: () => void) => { e.preventDefault(); e.stopPropagation(); fn(); };
        if (key === 'escape' && selection.size) run(clearSelection);
        else if ((key === 'delete' || key === 'backspace') && selection.size) run(deletePicked);
        else if (mod && key === 'c' && selection.size) run(copyPicked);
        else if (mod && key === 'x' && selection.size) run(() => { copyPicked(); deletePicked(); });
        else if (mod && key === 'd' && selection.size) run(duplicatePicked);
        else if (mod && key === 'v' && strokeClipboard) run(pasteHere);
      };
      document.addEventListener('keydown', onKey, true);

      render();

      // A pen stroke that started outside the block, under it (DrawingStarter): drawn on here.
      const begin = (e: PointerEvent, earlier: PointLike[]) => {
        if (!editor.isEditable || active || erasing) return;
        if (editor.view.hasFocus()) (editor.view.dom as HTMLElement).blur();
        setDrawingActive(editor, true, dom);
        try {
          svg.setPointerCapture(e.pointerId);
        } catch {
          // Without capture the rest of the stroke still reaches the block while over it.
        }
        const pen = e.pointerType === 'pen';
        penTouch = pen;
        const state = editor.storage.drawing.current;
        const points = [...earlier, e].map((p) => toPoint(p, pen));
        active = {
          pointerId: e.pointerId, points, tool: { tool: state.tool, ...state.pens[state.tool] }, pen, rest: points[points.length - 1], timer: null, held: null,
          firstX: earlier[0]?.clientX ?? e.clientX, lastX: e.clientX, waking: false,
        };
        restartHold();
        drawLive();
      };
      // The eraser ring under a pen in the air or the mouse (not while erasing: that moves it).
      const hover = (at: PointLike | null) => {
        if (erasing) return;
        if (!at) {
          eraserRing.style.display = '';
          return;
        }
        const { x, y } = toPoint(at, false);
        moveEraserRing(x, y);
      };
      editor.storage.drawing.views.set(dom, { begin, hover });
      const onHoverMove = (e: PointerEvent) => {
        if (e.pointerType !== 'mouse' || e.buttons || active || erasing || lassoing) return;
        hover(editor.isEditable && editor.storage.drawing.current.mode === 'eraser' ? e : null);
      };
      const onHoverLeave = () => hover(null);
      svg.addEventListener('pointermove', onHoverMove);
      svg.addEventListener('pointerleave', onHoverLeave);

      const onPointerDown = (e: PointerEvent) => {
        if (!editor.isEditable || active || erasing) return;
        // A finger scrolls, unless "Draw with the mouse or finger" is on (then it draws like
        // the pen, without pressure).
        const fingerDraws = e.pointerType === 'touch' && e.isPrimary && editor.storage.drawing.mouseDraws;
        if (e.pointerType === 'touch' && !fingerDraws) return;
        // Mouse: the left button draws, the right one erases (like the pen's side button).
        if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return;
        const pen = e.pointerType === 'pen';
        penTouch = pen || fingerDraws;
        e.preventDefault();
        e.stopPropagation();
        // Drawing takes the focus off the text: the phone keyboard goes away, and a focused
        // WebKit editor would scroll its selection into view when the stroke is saved.
        if (editor.view.hasFocus()) (editor.view.dom as HTMLElement).blur();
        const waking = !(editor.storage.drawing.active && editor.storage.drawing.activeDom === dom);
        setDrawingActive(editor, true, dom);
        try {
          svg.setPointerCapture(e.pointerId);
        } catch {
          // Capture is a nicety (strokes leaving the block); drawing works without it.
        }
        const state = editor.storage.drawing.current;
        // The pen's eraser end (the S Pen side button on the phone) erases whatever the tool.
        const penEraser = (pen && ((e.buttons & 32) !== 0 || e.button === 5)) || (e.pointerType === 'mouse' && e.button === 2);
        if (state.mode === 'lasso' && !penEraser) {
          lassoDown(e, pen);
          return;
        }
        if (state.mode === 'eraser' || penEraser) {
          const { x, y } = toPoint(e, pen);
          erasing = { pointerId: e.pointerId, pen, mode: state.eraser, last: { x, y }, removed: new Set(), pieces: new Map() };
          eraseAt(x, y);
          moveEraserRing(x, y);
          showErasing();
          return;
        }
        const first = toPoint(e, pen);
        active = {
          pointerId: e.pointerId, points: [first], tool: { tool: state.tool, ...state.pens[state.tool] }, pen, rest: first, timer: null, held: null,
          firstX: e.clientX, lastX: e.clientX, waking,
        };
        restartHold();
        drawLive();
      };
      const onPointerMove = (e: PointerEvent) => {
        if (lassoing && e.pointerId === lassoing.pointerId) {
          e.preventDefault();
          lassoMove(e);
          return;
        }
        if (erasing && e.pointerId === erasing.pointerId) {
          e.preventDefault();
          const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
          for (const ev of events.length ? events : [e]) {
            const point = toPoint(ev, erasing.pen);
            for (const at of eraserPath(erasing.last, point, ERASER_RADIUS)) eraseAt(at.x, at.y);
            erasing.last = point;
          }
          if (erasing.last) moveEraserRing(erasing.last.x, erasing.last.y);
          showErasing();
          return;
        }
        if (!active || e.pointerId !== active.pointerId) return;
        e.preventDefault();
        if (active.held) {
          moveHeld(toPoint(e, active.pen));
          return;
        }
        active.lastX = e.clientX;
        const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
        for (const ev of events.length ? events : [e]) {
          const point = toPoint(ev, active.pen);
          const last = active.points[active.points.length - 1];
          if (Math.hypot(point.x - last.x, point.y - last.y) < MIN_POINT_DISTANCE) {
            last.p = Math.max(last.p, point.p);
            continue;
          }
          active.points.push(point);
        }
        // Moved away from where it rested: the hold starts again.
        const last = active.points[active.points.length - 1];
        if (Math.hypot(last.x - active.rest.x, last.y - active.rest.y) > HOLD_PX * unitsPerPx()) {
          active.rest = last;
          restartHold();
        }
        if (!frame) frame = requestAnimationFrame(drawLive);
      };
      const finish = (e: PointerEvent, keep: boolean) => {
        if (lassoing && e.pointerId === lassoing.pointerId) {
          penTouch = false;
          lassoUp(keep);
          return;
        }
        if (erasing && e.pointerId === erasing.pointerId) {
          penTouch = false;
          if (keep) commitErasing();
          else {
            erasing = null;
            eraserRing.style.display = '';
            piecesGroup.replaceChildren();
            showErasing();
          }
          return;
        }
        if (!active || e.pointerId !== active.pointerId) return;
        const { points, tool, held, waking } = active;
        if (active.timer) clearTimeout(active.timer);
        // A tap on a drawing that was not active only shows its tools (and grid), no dot.
        const reach = TAP_PX * unitsPerPx();
        if (waking && !held && points.every((pt) => Math.hypot(pt.x - points[0].x, pt.y - points[0].y) <= reach)) keep = false;
        active = null;
        penTouch = false;
        if (held === 'cut') {
          if (keep) cutAt(points);
          clearLive();
          return;
        }
        const pos = typeof getPos === 'function' ? getPos() : undefined;
        if (keep && points.length && typeof pos === 'number') {
          const current = editor.state.doc.nodeAt(pos);
          const type = editor.schema.nodes.drawingStroke;
          if (current?.type.name === 'drawing' && type) {
            const stroke = type.create({ points: encodePoints(points), color: tool.color, size: tool.size, tool: tool.tool });
            // Drawn into the live path until the transaction re-renders the block. Saving a
            // stroke never scrolls the note.
            keepScroll(() => editor.view.dispatch(editor.state.tr.insert(pos + 1 + current.content.size, stroke)));
            followRightEdge(points[points.length - 1].x);
          }
        }
        clearLive();
      };
      const keepScroll = (run: () => void) => {
        const boxes: [Element, number][] = [];
        for (let el = dom.parentElement; el; el = el.parentElement) if (el.scrollHeight > el.clientHeight) boxes.push([el, el.scrollTop]);
        run();
        const restore = () => boxes.forEach(([el, top]) => { if (el.scrollTop !== top) el.scrollTop = top; });
        restore();
        requestAnimationFrame(restore);
      };
      // Writing a long formula: a stroke ending near the visible right edge scrolls the block
      // on (between strokes, never under the pen).
      const followRightEdge = (x: number) => {
        const visible = scroller.clientWidth;
        if (!visible) return;
        const endPx = x / unitsPerPx() - scroller.scrollLeft;
        if (endPx > visible * (1 - SCROLL_EDGE)) scroller.scrollBy({ left: visible * SCROLL_STEP, behavior: 'smooth' });
      };
      const onPointerUp = (e: PointerEvent) => finish(e, true);
      const onPointerCancel = (e: PointerEvent) => finish(e, false);
      // A pen touch must not scroll the note or move the cursor (Chromium fires touchstart
      // after the pointerdown of the same contact).
      // A finger tap (no scrolling) must not put the cursor next to the drawing either: that
      // opens the phone keyboard. It puts the keyboard away instead.
      let finger: { x: number; y: number } | null = null;
      const onTouchStart = (e: TouchEvent) => {
        if (penTouch || active?.pen || erasing?.pen) {
          e.preventDefault();
          finger = null;
          return;
        }
        const t = e.touches[0];
        finger = e.touches.length === 1 && t ? { x: t.clientX, y: t.clientY } : null;
      };
      const onTouchEnd = (e: TouchEvent) => {
        const t = e.changedTouches[0];
        const tap = finger && t && Math.hypot(t.clientX - finger.x, t.clientY - finger.y) < 10;
        finger = null;
        if (!tap || !e.cancelable || !editor.isEditable) return;
        e.preventDefault();
        if (editor.view.hasFocus()) (editor.view.dom as HTMLElement).blur();
        setDrawingActive(editor, true, dom);
      };
      // The mouse: no native selection / focus (WebKit would scroll the drawing's start into view).
      const onMouseDown = (e: MouseEvent) => {
        if (editor.isEditable && (e.button === 0 || e.button === 2)) e.preventDefault();
      };
      // The right button erases: no context menu over a drawing.
      const onContextMenu = (e: MouseEvent) => {
        if (editor.isEditable) e.preventDefault();
      };

      svg.addEventListener('pointerdown', onPointerDown);
      svg.addEventListener('pointermove', onPointerMove);
      svg.addEventListener('pointerup', onPointerUp);
      svg.addEventListener('pointercancel', onPointerCancel);
      svg.addEventListener('touchstart', onTouchStart, { passive: false });
      svg.addEventListener('touchend', onTouchEnd, { passive: false });
      svg.addEventListener('mousedown', onMouseDown);
      svg.addEventListener('contextmenu', onContextMenu);

      return {
        dom,
        update: (next) => {
          if (next.type !== node.type) return false;
          node = next;
          render();
          return true;
        },
        // Pointer input on the drawing is ours; ProseMirror would start a text selection.
        stopEvent: (event) => /^(pointer|mouse|touch|click)/.test(event.type) && (scroller.contains(event.target as globalThis.Node) || actions.contains(event.target as globalThis.Node)),
        ignoreMutation: () => true,
        destroy: () => {
          clearLive();
          svg.removeEventListener('pointermove', onHoverMove);
          svg.removeEventListener('pointerleave', onHoverLeave);
          offSelection();
          document.removeEventListener('keydown', onKey, true);
          offPaper();
          if (active?.timer) clearTimeout(active.timer);
          editor.storage.drawing.views.delete(dom);
          if (editor.storage.drawing.activeDom === dom) setDrawingActive(editor, false);
          if (piecesFrame) cancelAnimationFrame(piecesFrame);
          svg.removeEventListener('touchstart', onTouchStart);
          svg.removeEventListener('touchend', onTouchEnd);
        },
      };
    };
  },
});

// Strokes copied with the lasso (any drawing of any note of this window can paste them).
interface CopiedStroke { color: string | null; size: number; tool: DrawingTool; points: StrokePoint[] }
let strokeClipboard: { strokes: CopiedStroke[]; box: Box } | null = null;

const iconSvg = (path: string) => `<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="${path}" fill="currentColor"/></svg>`;

const isEmptyLine = (node: PmNode | null | undefined) => !!node && node.type.name === 'paragraph' && node.childCount === 0;

// Pen strokes started outside a drawing (the S Pen on the phone, a tablet pen on the desktop):
// - on an empty line of the note: the line becomes a drawing;
// - in the empty page under the note: a drawing at the end;
// and the stroke goes on in it without lifting the pen. Under a drawing (only empty lines in
// between) the stroke goes into that drawing instead, which grows. A tap without moving keeps
// the pen's usual meaning (the cursor); a stroke switches the tool back to the pen. The mouse
// only while "Draw with the mouse" is on (its press there then never places the cursor or
// selects).
export const DrawingStarter = Extension.create({
  name: 'drawingStarter',

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [new Plugin({
      view: (view) => {
        const doc = view.dom.ownerDocument;
        let pending: { pointerId: number; zone: { kind: 'line'; pos: number } | { kind: 'end' }; events: PointLike[]; x: number; y: number } | null = null;

        // Where a pen touch would start a drawing, or null.
        const zoneAt = (e: PointerEvent): { kind: 'line'; pos: number } | { kind: 'end' } | null => {
          const target = e.target as Element | null;
          if (!target?.closest) return null;
          if (target.closest('[data-type="drawing"], button, input, textarea, select, a, label, .tb, .db, .tb-notelink, .find-bar, .history-view, .niv, .backlinks, #chips, #title, #wordcount')) return null;
          const root = view.dom as HTMLElement;
          // (The editor itself under its last block, e.g. its minimum height on the phone, is
          // the empty page too.)
          if (target !== root && root.contains(target)) {
            // The top-level block under the pen: only an empty line counts (text, lists, images keep the pen).
            let block: Element | null = target;
            while (block && block.parentElement !== root) block = block.parentElement;
            if (!block || block === root) return null;
            const pos = view.posAtDOM(block, 0) - 1;
            return isEmptyLine(editor.state.doc.nodeAt(pos)) && editor.state.doc.resolve(pos).depth === 0 ? { kind: 'line', pos } : null;
          }
          // The empty page under the note (the note's scroll area on the desktop).
          const area = root.closest('[data-note-scroll]') ?? doc.body;
          if (!area.contains(target)) return null;
          const rect = root.getBoundingClientRect();
          if (rect.width && (e.clientX < rect.left || e.clientX > rect.right)) return null;
          const last = root.lastElementChild;
          return !last || e.clientY > last.getBoundingClientRect().bottom ? { kind: 'end' } : null;
        };

        const start = (e: PointerEvent, earlier: PointLike[], zone: { kind: 'line'; pos: number } | { kind: 'end' }) => {
          const { state } = editor;
          const { doc: pmDoc, schema } = state;
          const index = zone.kind === 'line' ? pmDoc.resolve(zone.pos).index(0) : pmDoc.childCount;
          let above = index - 1;
          while (above >= 0 && isEmptyLine(pmDoc.child(above))) above--;
          let drawingPos = -1;
          if (above >= 0 && pmDoc.child(above).type.name === 'drawing') {
            drawingPos = 0;
            for (let i = 0; i < above; i++) drawingPos += pmDoc.child(i).nodeSize;
          } else {
            let from = pmDoc.content.size;
            let to = from;
            if (zone.kind === 'line') {
              from = zone.pos;
              to = zone.pos + pmDoc.nodeAt(zone.pos)!.nodeSize;
            } else if (isEmptyLine(pmDoc.lastChild)) {
              from = pmDoc.content.size - pmDoc.lastChild!.nodeSize;
            }
            const nodes = [schema.nodes.drawing.create()];
            // The last block: a line under it to type on.
            if (to === pmDoc.content.size) nodes.push(schema.nodes.paragraph.create());
            view.dispatch(state.tr.replaceWith(from, to, nodes));
            drawingPos = from;
          }
          const dom = view.nodeDOM(drawingPos) as HTMLElement | null;
          const target = dom && editor.storage.drawing.views.get(dom);
          target?.begin(e, earlier);
        };

        const onDown = (e: PointerEvent) => {
          pending = null;
          const mouse = ((e.pointerType === 'mouse' && e.button === 0) || (e.pointerType === 'touch' && e.isPrimary)) && editor.storage.drawing.mouseDraws;
          if ((e.pointerType !== 'pen' && !mouse) || !editor.isEditable) return;
          // The eraser has nothing to erase there.
          if ((e.buttons & 32) !== 0 || e.button === 5) return;
          const zone = zoneAt(e);
          if (!zone) return;
          pending = { pointerId: e.pointerId, zone, events: [{ clientX: e.clientX, clientY: e.clientY, pressure: e.pressure }], x: e.clientX, y: e.clientY };
          // The mouse would start a text selection (and move the cursor) meanwhile.
          if (mouse) e.preventDefault();
        };
        const onMove = (e: PointerEvent) => {
          if (!pending || e.pointerId !== pending.pointerId) return;
          const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
          const all = events.length ? events : [e];
          if (Math.hypot(e.clientX - pending.x, e.clientY - pending.y) < 4) {
            for (const ev of all) pending.events.push({ clientX: ev.clientX, clientY: ev.clientY, pressure: ev.pressure });
            return;
          }
          const { zone, events: earlier } = pending;
          pending = null;
          e.preventDefault();
          // Writing in an empty place is writing, whatever tool was out (the lasso or the eraser
          // have nothing to work on there).
          if (editor.storage.drawing.current.mode !== 'pen') setDrawingTool(editor, { mode: 'pen' });
          for (const ev of all.slice(0, -1)) earlier.push({ clientX: ev.clientX, clientY: ev.clientY, pressure: ev.pressure });
          start(e, earlier, zone);
        };
        const onEnd = (e: PointerEvent) => {
          if (pending && e.pointerId === pending.pointerId) pending = null;
        };
        // A pen that may start a drawing must not scroll the page meanwhile.
        const onTouchStart = (e: TouchEvent) => {
          if (pending) e.preventDefault();
        };

        doc.addEventListener('pointerdown', onDown, true);
        doc.addEventListener('pointermove', onMove, true);
        doc.addEventListener('pointerup', onEnd, true);
        doc.addEventListener('pointercancel', onEnd, true);
        doc.addEventListener('touchstart', onTouchStart, { capture: true, passive: false });
        return {
          destroy: () => {
            doc.removeEventListener('pointerdown', onDown, true);
            doc.removeEventListener('pointermove', onMove, true);
            doc.removeEventListener('pointerup', onEnd, true);
            doc.removeEventListener('pointercancel', onEnd, true);
            doc.removeEventListener('touchstart', onTouchStart, true);
          },
        };
      },
    })];
  },
});
