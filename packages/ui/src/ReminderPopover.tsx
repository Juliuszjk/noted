import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReminderPickerHandle } from '@noted/editor';
import { renderReminderPicker } from '@noted/editor';
import type { ReminderCommit, ReminderState, ReminderTimes } from '@noted/editor';
import { popoverStyle } from './menu-parts';

const WIDTH = 340;
const MARGIN = 8;

export interface ReminderAnchor {
  top: number;
  bottom: number;
  left: number;
}

// The reminder picker (shared plain DOM, reminder-picker.ts) in a popover next to `anchor`:
// below it when it fits, else above, else as low as the window allows, never outside the
// window. With `text` (a reminder of its own) a text field comes first; a save without text
// puts the focus there. A click outside or Escape closes it.
export function ReminderPopover({ anchor, title, initial, times, text, onCommit, onCancel, onClose }: {
  anchor: ReminderAnchor;
  title: string;
  initial?: ReminderState;
  times: ReminderTimes;
  // Text of a reminder of its own; undefined = no text field (a chip in a note).
  text?: string;
  onCommit: (commit: ReminderCommit, text: string) => void;
  // Cancel / Escape (default: onClose); a click outside only closes.
  onCancel?: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<ReminderPickerHandle | null>(null);
  const [top, setTop] = useState<number | null>(null);
  const left = Math.max(MARGIN, Math.min(anchor.left, window.innerWidth - WIDTH - MARGIN));

  useLayoutEffect(() => {
    if (!bodyRef.current) return;
    const picker = pickerRef.current = renderReminderPicker(bodyRef.current, {
      initial,
      times,
      onCommit: (commit) => {
        const value = textRef.current?.value.trim() ?? '';
        if (text !== undefined && commit.kind === 'save' && !value) return textRef.current?.focus();
        onCommit(commit, value);
        onClose();
      },
      onCancel: onCancel ?? onClose,
    });
    const height = ref.current?.offsetHeight ?? 0;
    const below = anchor.bottom + MARGIN;
    const above = anchor.top - MARGIN - height;
    setTop(below + height <= window.innerHeight - MARGIN ? below
      : above >= MARGIN ? above
      : Math.max(MARGIN, window.innerHeight - height - MARGIN));
    // Keyboard first: the text of a new reminder of its own, otherwise the calendar's day
    // (arrows move it, Tab goes on, Enter saves, Escape cancels).
    // Tiptap's focus() runs a frame later (the slash menu, a click on a chip): take the focus
    // after it, or the arrows would move the text cursor.
    const focus = () => {
      if (textRef.current && !textRef.current.value) textRef.current.focus();
      else picker.focusDay();
    };
    focus();
    let frame = requestAnimationFrame(() => { frame = requestAnimationFrame(focus); });
    const timer = setTimeout(focus, 50);
    return () => { cancelAnimationFrame(frame); clearTimeout(timer); };
  }, []);

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
      <div style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 2px 8px' }}>{title}</div>
      {text !== undefined && (
        <input
          ref={textRef}
          defaultValue={text}
          placeholder="Remind me to…"
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); (onCancel ?? onClose)(); }
            else if (e.key === 'Enter') { e.preventDefault(); pickerRef.current?.save(); }
          }}
          style={{
            width: '100%', boxSizing: 'border-box', marginBottom: 10, padding: '8px 10px', fontSize: 14, borderRadius: 8, outline: 'none',
            border: '1px solid var(--border)', backgroundColor: 'var(--bg-surface)', color: 'var(--text-main)',
          }}
        />
      )}
      <div ref={bodyRef} />
    </div>
  );
}
