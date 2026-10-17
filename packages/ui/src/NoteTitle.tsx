import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import * as Y from 'yjs';
import { getTitleText, setTitle } from '@noted/sync';

// Big title field above the editor, bound to the note's Y.Text 'title' (part of the same
// encrypted Y.Doc, so it syncs and merges like the body). Enter or ArrowDown at the end
// moves into the body.
export function NoteTitle({ ydoc, editor, onChange, readOnly = false }: { ydoc: Y.Doc; editor: Editor | null; onChange: () => void; readOnly?: boolean }) {
  const [value, setValue] = useState(() => getTitleText(ydoc).toString());
  const ref = useRef<HTMLTextAreaElement>(null);

  // Remote edits (sync merges into this doc in place) update the field.
  useEffect(() => {
    const text = getTitleText(ydoc);
    const observer = () => setValue(text.toString());
    text.observe(observer);
    setValue(text.toString());
    return () => text.unobserve(observer);
  }, [ydoc]);

  // Grow with the text instead of scrolling.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      className="note-title"
      readOnly={readOnly}
      value={value}
      rows={1}
      placeholder="Untitled"
      spellCheck={false}
      onChange={(e) => {
        // A title is one line; pasted line breaks become spaces.
        const next = e.target.value.replace(/\r?\n/g, ' ');
        setValue(next);
        setTitle(ydoc, next);
        onChange();
      }}
      onKeyDown={(e) => {
        const el = e.currentTarget;
        const atEnd = el.selectionStart === el.value.length && el.selectionEnd === el.value.length;
        // Ctrl+A again when the whole title is selected: the whole note body instead.
        if (e.key.toLowerCase() === 'a' && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey
          && el.selectionStart === 0 && el.selectionEnd === el.value.length && editor) {
          e.preventDefault();
          editor.chain().focus().selectAll().run();
          return;
        }
        if (e.key === 'Enter' || (e.key === 'ArrowDown' && atEnd)) {
          e.preventDefault();
          editor?.commands.focus('start');
        }
      }}
      style={{
        display: 'block', width: '100%', boxSizing: 'border-box', resize: 'none', overflow: 'hidden',
        margin: '0 0 12px', padding: 0, border: 'none', outline: 'none', boxShadow: 'none', background: 'transparent',
        color: 'var(--text-main)', fontSize: '2.1em', fontWeight: 700, lineHeight: 1.25,
      }}
    />
  );
}
