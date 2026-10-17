import { Node } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import { DRAWING_WIDTH, encodePoints } from './drawing-codec';
import type { StrokePoint } from './drawing-codec';
import {
  DEFAULT_DRAWING_HEIGHT, DEFAULT_PEN_SIZE, drawingSize, isDrawingTool, strokeData, strokeOutline, strokePath, strokeStyle,
} from './drawing-render';
import type { DrawingStrokeData, DrawingTool } from './drawing-render';

// Hand drawing block. The strokes are child nodes (drawingStroke) of the block, so they live in
// the note body like any other content: two devices drawing at once merge, Yjs undo covers
// them, locked notes seal them with the body, copy / paste and history carry them. Coordinates
// are drawing units (x 0..DRAWING_WIDTH, see drawing-codec.ts), so a drawing scales with the
// note width and looks the same on every device. `height` is the minimum height in the same
// units; the block grows below its lowest stroke.
//
// A drawing wider than the note (a long formula) scrolls sideways inside the block.
//
// Input: a pen (S Pen, tablet) or the mouse draws, a finger scrolls the note (or the block
// sideways) and a tap with it puts the keyboard away.

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

export interface DrawingToolState {
  tool: DrawingTool;
  color: string | null;
  size: number;
}

interface DrawingStorage {
  // The tool new strokes use (platform toolbars change it).
  current: DrawingToolState;
}

declare module '@tiptap/core' {
  interface Storage {
    drawing: DrawingStorage;
  }
}

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
    return { current: { tool: 'pen', color: null, size: DEFAULT_PEN_SIZE } };
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
      const live = document.createElementNS(SVG_NS, 'path');
      svg.append(strokesGroup, live);
      scroller.append(svg);
      dom.append(scroller);

      // Rendered paths, by the stroke's encoded points (strokes never change, only come and go).
      let paths = new Map<string, SVGPathElement>();
      const render = () => {
        const strokes = strokesOf(node);
        const next = new Map<string, SVGPathElement>();
        const ordered: SVGPathElement[] = [];
        for (const stroke of strokes) {
          const key = `${stroke.points}|${stroke.color}|${stroke.size}|${stroke.tool}`;
          let path = paths.get(key) ?? next.get(key);
          if (!path || next.has(key)) {
            path = document.createElementNS(SVG_NS, 'path');
            path.setAttribute('d', strokePath(stroke));
            path.setAttribute('style', strokeStyle(stroke));
          }
          next.set(key, path);
          ordered.push(path);
        }
        paths = next;
        strokesGroup.replaceChildren(...ordered);
        const { width, height } = drawingSize(node.attrs.height, strokes, editor.isEditable ? EDIT_ROOM : undefined);
        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        svg.style.width = `${(width / DRAWING_WIDTH) * 100}%`;
      };
      render();

      // The stroke being drawn.
      let active: { pointerId: number; points: StrokePoint[]; tool: DrawingToolState; pen: boolean } | null = null;
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

      const onPointerDown = (e: PointerEvent) => {
        if (!editor.isEditable || active) return;
        if (e.pointerType === 'touch') return;
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        const pen = e.pointerType === 'pen';
        penTouch = pen;
        e.preventDefault();
        e.stopPropagation();
        // Drawing takes the focus off the text: the phone keyboard goes away, and a focused
        // WebKit editor would scroll its selection into view when the stroke is saved.
        if (editor.view.hasFocus()) (editor.view.dom as HTMLElement).blur();
        try {
          svg.setPointerCapture(e.pointerId);
        } catch {
          // Capture is a nicety (strokes leaving the block); drawing works without it.
        }
        active = { pointerId: e.pointerId, points: [toPoint(e, pen)], tool: { ...editor.storage.drawing.current }, pen };
        drawLive();
      };
      const onPointerMove = (e: PointerEvent) => {
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
        if (penTouch || active?.pen) {
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
      };
      // The mouse: no native selection / focus (WebKit would scroll the drawing's start into view).
      const onMouseDown = (e: MouseEvent) => {
        if (editor.isEditable && e.button === 0) e.preventDefault();
      };

      svg.addEventListener('pointerdown', onPointerDown);
      svg.addEventListener('pointermove', onPointerMove);
      svg.addEventListener('pointerup', onPointerUp);
      svg.addEventListener('pointercancel', onPointerCancel);
      svg.addEventListener('touchstart', onTouchStart, { passive: false });
      svg.addEventListener('touchend', onTouchEnd, { passive: false });
      svg.addEventListener('mousedown', onMouseDown);

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
          svg.removeEventListener('touchstart', onTouchStart);
          svg.removeEventListener('touchend', onTouchEnd);
        },
      };
    };
  },
});
