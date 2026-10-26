import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

// A mouse selection dragged over a task's checkbox (or the space after it) ends at the start
// of that line, and one dragged beside the note's text column ends at that edge of the line
// at the pointer's height. WebKitGTK placed both inconsistently (a letter off, or nowhere), so
// there the end of the native selection is moved by hand. Bullets and numbers need no help:
// their text reaches over the marker (content.css).

// Where the selection should end for a pointer at (x, y), or null when the browser's own
// placement is fine (not left of a task item's text).
const taskLineStart = (view: EditorView, x: number, y: number): number | null => {
  const hit = document.elementFromPoint(x, y);
  const item = hit?.closest?.('ul[data-type="taskList"] > li');
  const text = item?.querySelector(':scope > div');
  if (!item || !text || !view.dom.contains(item)) return null;
  const box = text.getBoundingClientRect();
  const left = box.left + parseFloat(getComputedStyle(text).paddingLeft || '0');
  if (x >= left) return null;
  const top = Math.min(Math.max(y, box.top + 1), box.bottom - 1);
  return view.posAtCoords({ left: left + 1, top })?.pos ?? null;
};

// For a pointer left or right of the editor's text column (but beside it): the position at
// that edge of the line at the pointer's height.
const columnEdge = (view: EditorView, x: number, y: number): number | null => {
  const box = view.dom.getBoundingClientRect();
  const style = getComputedStyle(view.dom);
  const left = box.left + parseFloat(style.paddingLeft || '0');
  const right = box.right - parseFloat(style.paddingRight || '0');
  if ((x >= left && x <= right) || y < box.top || y > box.bottom) return null;
  return view.posAtCoords({ left: x < left ? left + 1 : right - 1, top: y })?.pos ?? null;
};

export const ListSelect = Extension.create({
  name: 'listSelect',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey('listSelect'),
      view: (view) => {
        let dragging = false;
        let target: number | null = null;
        const move = (e: MouseEvent) => {
          if (!dragging || !(e.buttons & 1)) return;
          target = taskLineStart(view, e.clientX, e.clientY) ?? columnEdge(view, e.clientX, e.clientY);
          fix();
        };
        const up = () => { dragging = false; target = null; };
        // Runs after every native change too (the browser moves the selection after our move
        // handler): the selection's end is put back on the line start.
        const fix = () => {
          if (!dragging || target === null) return;
          const sel = document.getSelection();
          if (!sel || !sel.anchorNode || !view.dom.contains(sel.anchorNode)) return;
          let at: { node: Node; offset: number };
          try { at = view.domAtPos(target); } catch { return; }
          if (sel.focusNode === at.node && sel.focusOffset === at.offset) return;
          sel.extend(at.node, at.offset);
        };
        // A press something else handled (the fold arrows in the margin) starts no selection:
        // the next tiny movement extended the old selection to the line beside the arrow.
        const down = (e: MouseEvent) => {
          dragging = e.button === 0 && !e.shiftKey && e.detail === 1 && !e.defaultPrevented && !(e.target as Element | null)?.closest?.('label');
          target = null;
        };
        view.dom.addEventListener('mousedown', down);
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up, true);
        document.addEventListener('selectionchange', fix);
        return {
          destroy: () => {
            view.dom.removeEventListener('mousedown', down);
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', up, true);
            document.removeEventListener('selectionchange', fix);
          },
        };
      },
    })];
  },
});
