import { Node } from '@tiptap/core';
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
  mode: 'pen' | 'eraser';
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
  JSON.stringify({ v: 1, eraser: state.eraser, tool: state.tool, pens: state.pens });

export const restoreDrawingTools = (editor: Editor, text: string | null): void => {
  try {
    const data = JSON.parse(text ?? 'null');
    if (data?.v !== 1) return;
    const state = editor.storage.drawing.current;
    if (data.eraser === 'stroke' || data.eraser === 'part') state.eraser = data.eraser;
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
      current: { mode: 'pen', eraser: 'stroke', tool: 'pen', pens: defaultPens() },
      active: false,
      activeDom: null,
      listeners: new Set(),
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
      svg.append(strokesGroup, piecesGroup, live, eraserRing);
      scroller.append(svg);
      dom.append(scroller);

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
        const { width, height } = drawingSize(node.attrs.height, strokes, editor.isEditable ? EDIT_ROOM : undefined);
        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        svg.style.width = `${(width / DRAWING_WIDTH) * 100}%`;
      };
      // The stroke being drawn.
      let active: { pointerId: number; points: StrokePoint[]; tool: { tool: DrawingTool } & PenSettings; pen: boolean } | null = null;
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
      const toPoint = (e: PointerEvent, pen: boolean): StrokePoint => {
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
        live.setAttribute('d', strokeOutline(active.points, active.tool.size, active.tool.tool, false));
        live.setAttribute('style', strokeStyle(active.tool));
      };
      const clearLive = () => {
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
          if (tr.docChanged) keepScroll(() => editor.view.dispatch(tr));
        }
        piecesGroup.replaceChildren();
        showErasing();
      };

      render();

      const onPointerDown = (e: PointerEvent) => {
        if (!editor.isEditable || active || erasing) return;
        if (e.pointerType === 'touch') return;
        // Mouse: the left button draws, the right one erases (like the pen's side button).
        if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return;
        const pen = e.pointerType === 'pen';
        penTouch = pen;
        e.preventDefault();
        e.stopPropagation();
        // Drawing takes the focus off the text: the phone keyboard goes away, and a focused
        // WebKit editor would scroll its selection into view when the stroke is saved.
        if (editor.view.hasFocus()) (editor.view.dom as HTMLElement).blur();
        setDrawingActive(editor, true, dom);
        try {
          svg.setPointerCapture(e.pointerId);
        } catch {
          // Capture is a nicety (strokes leaving the block); drawing works without it.
        }
        const state = editor.storage.drawing.current;
        // The pen's eraser end (the S Pen side button on the phone) erases whatever the tool.
        const penEraser = (pen && ((e.buttons & 32) !== 0 || e.button === 5)) || (e.pointerType === 'mouse' && e.button === 2);
        if (state.mode === 'eraser' || penEraser) {
          const { x, y } = toPoint(e, pen);
          erasing = { pointerId: e.pointerId, pen, mode: state.eraser, last: { x, y }, removed: new Set(), pieces: new Map() };
          eraseAt(x, y);
          moveEraserRing(x, y);
          showErasing();
          return;
        }
        active = { pointerId: e.pointerId, points: [toPoint(e, pen)], tool: { tool: state.tool, ...state.pens[state.tool] }, pen };
        drawLive();
      };
      const onPointerMove = (e: PointerEvent) => {
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
        if (!frame) frame = requestAnimationFrame(drawLive);
      };
      const finish = (e: PointerEvent, keep: boolean) => {
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
        const { points, tool } = active;
        active = null;
        penTouch = false;
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
        stopEvent: (event) => /^(pointer|mouse|touch)/.test(event.type) && scroller.contains(event.target as globalThis.Node),
        ignoreMutation: () => true,
        destroy: () => {
          clearLive();
          if (editor.storage.drawing.activeDom === dom) setDrawingActive(editor, false);
          if (piecesFrame) cancelAnimationFrame(piecesFrame);
          svg.removeEventListener('touchstart', onTouchStart);
          svg.removeEventListener('touchend', onTouchEnd);
        },
      };
    };
  },
});
