import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { commitReminderEdit, getReminderTimes, renderReminderPicker } from '@noted/editor';
import type { ReminderEditRequest } from '@noted/editor';
import { popoverStyle } from './menu-parts';

const WIDTH = 340;
const MARGIN = 8;

// The reminder picker (shared plain DOM, reminder-picker.ts) in a popover below the chip,
// or below the cursor for a new reminder. A click outside or Escape closes it.
export function ReminderEditor({ editor, request, onClose }: { editor: Editor; request: ReminderEditRequest; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // Set once the popover is measured; hidden until then.
  const [top, setTop] = useState<number | null>(null);

  const anchor = (() => {
    const dom = request.mode === 'edit' ? (editor.view.nodeDOM(request.pos) as HTMLElement | null) : null;
    if (dom?.getBoundingClientRect) return dom.getBoundingClientRect();
    const coords = editor.view.coordsAtPos(Math.min(request.pos, editor.state.doc.content.size));
    return { top: coords.top, bottom: coords.bottom, left: coords.left };
  })();
  const left = Math.max(MARGIN, Math.min(anchor.left, window.innerWidth - WIDTH - MARGIN));

  useLayoutEffect(() => {
    if (!bodyRef.current) return;
    renderReminderPicker(bodyRef.current, {
      initial: request.mode === 'edit' ? request.attrs : undefined,
      times: getReminderTimes(editor),
      onCommit: (commit) => {
        commitReminderEdit(editor, request, commit);
        onClose();
      },
      onCancel: () => {
        editor.commands.focus();
        onClose();
      },
    });
    // Placed from its real height: below the chip when it fits, else above it, else as low
    // as the window allows. Never outside the window.
    const height = ref.current?.offsetHeight ?? 0;
    const below = anchor.bottom + MARGIN;
    const above = anchor.top - MARGIN - height;
    setTop(below + height <= window.innerHeight - MARGIN ? below
      : above >= MARGIN ? above
      : Math.max(MARGIN, window.innerHeight - height - MARGIN));
  }, [editor, request, onClose]);

  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onMouseDown, true);
    return () => document.removeEventListener('mousedown', onMouseDown, true);
  }, [onClose]);

  return (
    <div ref={ref} style={{
      ...popoverStyle, position: 'fixed', top: top ?? anchor.bottom + MARGIN, left, width: WIDTH, zIndex: 10000, padding: 12,
      maxHeight: `calc(100vh - ${2 * MARGIN}px)`, overflowY: 'auto', boxSizing: 'border-box', visibility: top === null ? 'hidden' : 'visible',
    }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 2px 8px' }}>{request.mode === 'edit' ? 'Reminder' : 'New reminder'}</div>
      <div ref={bodyRef} />
    </div>
  );
}
