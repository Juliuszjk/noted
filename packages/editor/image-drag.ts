import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, NodeSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { blockDropTarget, moveBlockTo } from './image-tools';
import { isSideBySide } from './blob-image';

// Moving an image by dragging it, the same on desktop and phone. A see-through copy follows
// the pointer / finger exactly; a line shows between which blocks it lands; where it is let go
// horizontally is kept (attribute `x`: 0 = left edge, 1 = right edge of the column). Mouse:
// press and move. Touch: hold ~0.4 s (short vibration), then drag; the note's own scrolling
// stops while an image is held and only the drag scrolls it (near the top / bottom edge).
// The browser's drag and drop of images is not used (it made copies).

const MOUSE_SLOP = 4;
const TOUCH_SLOP = 8;
const HOLD_MS = 400;
const EDGE = 56;
// Let go this close to the left / right edge or the middle: exactly there.
const SNAP_PX = 6;

const key = new PluginKey('imageDrag');

type Drag = {
  pos: number;
  source: HTMLElement;
  startX: number;
  startY: number;
  // Where the pointer grabbed the image (from its top left corner).
  grabX: number;
  grabY: number;
  x: number;
  y: number;
  active: boolean;
  touch: boolean;
  timer?: ReturnType<typeof setTimeout>;
  ghost?: HTMLElement;
  line?: HTMLElement;
  drop?: { pos: number; left: number; width: number } | null;
  frame?: number;
  unlock?: () => void;
};

const scrollerOf = (el: HTMLElement): HTMLElement => {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const style = getComputedStyle(p);
    if (/(auto|scroll)/.test(style.overflowY) && p.scrollHeight > p.clientHeight) return p;
  }
  return (document.scrollingElement as HTMLElement) ?? document.documentElement;
};

// The image node at a wrapper element (its position in the document), or null. Only the node
// drawn by this element counts: for an image right under another one `at - 1` is the upper
// image, and holding the lower one moved the upper one.
export const imagePosOf = (view: EditorView, el: HTMLElement): number | null => {
  try {
    const at = view.posAtDOM(el, 0);
    for (const pos of [at, at - 1]) {
      if (pos >= 0 && view.state.doc.nodeAt(pos)?.type.name === 'image' && view.nodeDOM(pos) === el) return pos;
    }
  } catch { /* not in this editor */ }
  return null;
};

const startDrag = (view: EditorView, drag: Drag) => {
  drag.active = true;
  if (drag.touch) {
    try { navigator.vibrate?.(12); } catch { /* not allowed */ }
    // No scrolling of the note under a held image (it fought the drag).
    const scroller = scrollerOf(view.dom as HTMLElement);
    const targets = scroller === document.scrollingElement ? [document.documentElement, document.body] : [scroller];
    const saved = targets.map((t) => t.style.overflow);
    targets.forEach((t) => { t.style.overflow = 'hidden'; });
    drag.unlock = () => targets.forEach((t, i) => { t.style.overflow = saved[i]; });
  }
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, drag.pos)));
  const img = drag.source.querySelector('img');
  const rect = (img ?? drag.source).getBoundingClientRect();
  const ghost = document.createElement('div');
  ghost.className = 'image-drag-ghost';
  Object.assign(ghost.style, { width: `${rect.width}px`, height: `${rect.height}px` });
  if (img?.src) {
    const copy = document.createElement('img');
    copy.src = img.src;
    ghost.append(copy);
  }
  const line = document.createElement('div');
  line.className = 'image-drop-line';
  document.body.append(ghost, line);
  drag.ghost = ghost;
  drag.line = line;
  drag.source.classList.add('image-dragging');
  place(view, drag);
};

const place = (view: EditorView, drag: Drag) => {
  if (!drag.ghost || !drag.line) return;
  drag.ghost.style.transform = `translate(${drag.x - drag.grabX}px, ${drag.y - drag.grabY}px)`;
  // The top edge of the copy decides: the picture hangs under the line above it.
  const drop = blockDropTarget(view, drag.x, drag.y - drag.grabY + 4, drag.pos);
  const node = view.state.doc.nodeAt(drag.pos);
  // Its own place: no line (only the side changes).
  const same = !drop || !node || (drop.pos >= drag.pos && drop.pos <= drag.pos + node.nodeSize);
  drag.drop = drop ? { pos: drop.pos, left: drop.left, width: drop.width } : null;
  drag.line.style.display = same ? 'none' : '';
  if (drop && !same) Object.assign(drag.line.style, { top: `${drop.y - 1.5}px`, left: `${drop.left}px`, width: `${drop.width}px` });
  autoScroll(view, drag);
};

// Near the top / bottom of the visible note the note scrolls, faster closer to the edge.
const autoScroll = (view: EditorView, drag: Drag) => {
  if (drag.frame) cancelAnimationFrame(drag.frame);
  const scroller = scrollerOf(view.dom as HTMLElement);
  const box = scroller === document.scrollingElement
    ? { top: window.visualViewport?.offsetTop ?? 0, bottom: (window.visualViewport?.offsetTop ?? 0) + (window.visualViewport?.height ?? window.innerHeight) }
    : scroller.getBoundingClientRect();
  const speed = drag.y < box.top + EDGE ? -Math.ceil((box.top + EDGE - drag.y) / 5)
    : drag.y > box.bottom - EDGE ? Math.ceil((drag.y - box.bottom + EDGE) / 5) : 0;
  if (!speed) return;
  drag.frame = requestAnimationFrame(() => {
    if (!drag.active) return;
    scroller.scrollTop += speed;
    place(view, drag);
  });
};

const finish = (view: EditorView, drag: Drag, drop: boolean) => {
  if (drag.timer) clearTimeout(drag.timer);
  if (drag.frame) cancelAnimationFrame(drag.frame);
  drag.ghost?.remove();
  drag.line?.remove();
  drag.unlock?.();
  drag.source.classList.remove('image-dragging');
  if (!drag.active || !drop) return;
  const node = view.state.doc.nodeAt(drag.pos);
  if (!node || node.type.name !== 'image') return;
  let tr = view.state.tr;
  let pos = drag.pos;
  const target = drag.drop?.pos;
  if (target !== undefined) {
    const moved = moveBlockTo(view.state, drag.pos, target);
    if (moved) {
      tr = moved;
      pos = moved.selection.from;
    }
  }
  // The side: where the copy's left edge was let go within the column.
  if (!isSideBySide(node.attrs.align) && drag.ghost && drag.drop) {
    const width = parseFloat(drag.ghost.style.width) || 0;
    const left = drag.x - drag.grabX;
    const free = drag.drop.width - width;
    let x: number | null = null;
    if (free > 2) {
      const offset = left - drag.drop.left;
      x = Math.min(1, Math.max(0, offset / free));
      if (Math.abs(offset) < SNAP_PX) x = 0;
      else if (Math.abs(offset - free) < SNAP_PX) x = 1;
      else if (Math.abs(offset - free / 2) < SNAP_PX) x = 0.5;
      x = Math.round(x * 1000) / 1000;
    }
    const current = tr.doc.nodeAt(pos);
    if (current && current.attrs.x !== x) tr.setNodeMarkup(pos, undefined, { ...current.attrs, x, align: null });
  }
  if (!tr.docChanged) return;
  tr.setSelection(NodeSelection.create(tr.doc, pos));
  view.dispatch(tr.scrollIntoView());
};

export const ImageDrag = new Plugin({
  key,
  view(view) {
    let drag: Drag | null = null;
    const imageAt = (target: EventTarget | null): HTMLElement | null => {
      const el = (target as HTMLElement | null)?.closest?.('.image-node') as HTMLElement | null;
      if (!el || !view.dom.contains(el) || !view.editable) return null;
      // Corner grips and edges resize instead.
      if ((target as HTMLElement).closest('.image-grip') || el.classList.contains('resizing')) return null;
      return el;
    };
    const begin = (el: HTMLElement, x: number, y: number, touch: boolean): Drag | null => {
      const pos = imagePosOf(view, el);
      if (pos === null) return null;
      const rect = (el.querySelector('img') ?? el).getBoundingClientRect();
      return { pos, source: el, startX: x, startY: y, grabX: x - rect.left, grabY: y - rect.top, x, y, active: false, touch };
    };

    // ---- mouse ----
    const mouseDown = (e: MouseEvent) => {
      if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const el = imageAt(e.target);
      if (!el || (el.querySelector('img') as HTMLElement | null)?.style.cursor) return; // on an edge: resize
      const started = begin(el, e.clientX, e.clientY, false);
      if (!started) return;
      // The editor's own handling (text selection, the browser's image drag) stays out.
      e.preventDefault();
      e.stopPropagation();
      drag = started;
      window.addEventListener('mousemove', mouseMove, true);
      window.addEventListener('mouseup', mouseUp, true);
    };
    const mouseMove = (e: MouseEvent) => {
      if (!drag) return;
      drag.x = e.clientX;
      drag.y = e.clientY;
      if (!drag.active && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > MOUSE_SLOP) startDrag(view, drag);
      if (drag.active) {
        e.preventDefault();
        place(view, drag);
      }
    };
    const mouseUp = (e: MouseEvent) => {
      window.removeEventListener('mousemove', mouseMove, true);
      window.removeEventListener('mouseup', mouseUp, true);
      const d = drag;
      drag = null;
      if (!d) return;
      if (!d.active) {
        // A click: select the image (what the editor would have done).
        view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, d.pos)));
        view.focus();
        return;
      }
      e.preventDefault();
      finish(view, d, true);
    };

    // ---- touch ----
    const touchStart = (e: TouchEvent) => {
      if (drag) { finish(view, drag, false); drag = null; }
      const t = e.touches[0];
      const el = e.touches.length === 1 && t ? imageAt(e.target) : null;
      if (!el) return;
      const started = begin(el, t.clientX, t.clientY, true);
      if (!started) return;
      drag = started;
      started.timer = setTimeout(() => { if (drag === started) startDrag(view, started); }, HOLD_MS);
    };
    const touchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!drag?.touch || !t) return;
      drag.x = t.clientX;
      drag.y = t.clientY;
      if (!drag.active) {
        // Moving before the hold is over: the finger scrolls the note.
        if (Math.hypot(t.clientX - drag.startX, t.clientY - drag.startY) > TOUCH_SLOP) {
          finish(view, drag, false);
          drag = null;
        }
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      place(view, drag);
    };
    const touchEnd = (e: TouchEvent, drop: boolean) => {
      const d = drag;
      if (!d?.touch) return;
      drag = null;
      if (d.active) {
        e.preventDefault();
        e.stopPropagation();
      }
      finish(view, d, drop);
    };
    const onTouchEnd = (e: TouchEvent) => touchEnd(e, true);
    const onTouchCancel = (e: TouchEvent) => touchEnd(e, false);
    // Android's long-press menu must not open under the held finger.
    const contextMenu = (e: Event) => { if (imageAt(e.target)) e.preventDefault(); };

    window.addEventListener('mousedown', mouseDown, true);
    window.addEventListener('touchstart', touchStart, { capture: true, passive: true });
    window.addEventListener('touchmove', touchMove, { capture: true, passive: false });
    window.addEventListener('touchend', onTouchEnd, { capture: true, passive: false });
    window.addEventListener('touchcancel', onTouchCancel, { capture: true, passive: false });
    window.addEventListener('contextmenu', contextMenu, true);
    return {
      destroy() {
        if (drag) finish(view, drag, false);
        window.removeEventListener('mousedown', mouseDown, true);
        window.removeEventListener('mousemove', mouseMove, true);
        window.removeEventListener('mouseup', mouseUp, true);
        window.removeEventListener('touchstart', touchStart, true);
        window.removeEventListener('touchmove', touchMove, true);
        window.removeEventListener('touchend', onTouchEnd, true);
        window.removeEventListener('touchcancel', onTouchCancel, true);
        window.removeEventListener('contextmenu', contextMenu, true);
      },
    };
  },
});

export const ImageDragging = Extension.create({
  name: 'imageDragging',
  addProseMirrorPlugins: () => [ImageDrag],
});
