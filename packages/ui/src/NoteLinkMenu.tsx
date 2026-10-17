import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Editor } from '@tiptap/core';
import { searchNotes, canCreateNote, titleTaken } from '@noted/editor';
import type { NoteChoice } from '@noted/editor';
import type { SlashMenuHandle, SlashMenuState } from './SlashMenu';

const MENU_MAX_HEIGHT = 320;

const panelStyle: CSSProperties = {
  minWidth: 260,
  maxWidth: 380,
  overflowY: 'auto',
  backgroundColor: 'var(--bg-surface-high)',
  border: '1px solid var(--border-focus)',
  borderRadius: 8,
  boxShadow: '0 8px 16px rgba(0,0,0,0.4)',
};

type Row = { kind: 'note'; note: NoteChoice } | { kind: 'create'; title: string };

interface Props {
  editor: Editor;
  state: SlashMenuState;
  notes: NoteChoice[];
  currentNoteId: string;
  // Creates a note with this title and returns its id (null when it failed).
  onCreateNote?: (title: string) => Promise<string | null>;
  onClose: () => void;
}

// Picker opened by "[[": choose a note to link, or create one with the typed title.
export const NoteLinkMenu = forwardRef<SlashMenuHandle, Props>(function NoteLinkMenu(
  { editor, state, notes, currentNoteId, onCreateNote, onClose }, ref,
) {
  // Typing the closing "]]" is allowed and ignored.
  const query = state.query.replace(/\]+$/, '').trim();
  const rows: Row[] = searchNotes(notes, query, currentNoteId, 12).map((note) => ({ kind: 'note', note }));
  if (onCreateNote && canCreateNote(notes, query)) rows.push({ kind: 'create', title: query });

  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [query]);

  const pick = async (row: Row | undefined) => {
    if (!row) return;
    const range = state.range;
    let id: string | null = row.kind === 'note' ? row.note.id : null;
    if (row.kind === 'create') {
      onClose();
      id = (await onCreateNote?.(row.title)) ?? null;
      if (!id) return;
    }
    editor.chain().focus().deleteRange(range).insertNoteLink(id!).run();
    onClose();
  };

  // The key handler is called from ProseMirror, outside React; it reads the latest values here.
  const latest = useRef({ rows, index, pick });
  latest.current = { rows, index, pick };

  useImperativeHandle(ref, () => ({
    handleKey(event: KeyboardEvent) {
      const { rows: list, index: current } = latest.current;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if (list.length === 0) return false;
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setIndex((current + step + list.length) % list.length);
        return true;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        if (list.length === 0) return false;
        event.preventDefault();
        latest.current.pick(list[current]);
        return true;
      }
      return false;
    },
  }), []);

  const spaceBelow = window.innerHeight - state.top - 8;
  const spaceAbove = state.caretTop - 16;
  const openUp = spaceBelow < MENU_MAX_HEIGHT && spaceAbove > spaceBelow;
  const maxHeight = Math.max(120, Math.min(MENU_MAX_HEIGHT, openUp ? spaceAbove : spaceBelow));
  const vertical: CSSProperties = openUp ? { bottom: window.innerHeight - state.caretTop + 8 } : { top: state.top };
  const left = Math.max(8, Math.min(state.left, window.innerWidth - 390));

  return (
    <div style={{ ...panelStyle, position: 'fixed', ...vertical, left, maxHeight, zIndex: 9999, padding: '4px 0' }}>
      <div style={{ padding: '4px 12px 6px', fontSize: 11, color: 'var(--text-muted)' }}>Link to note</div>
      {rows.length === 0 && (
        <div style={{ padding: '6px 12px 8px', fontSize: 13, color: 'var(--text-muted)' }}>
          {query ? 'No matching notes' : 'Type a note title'}
        </div>
      )}
      {rows.map((row, i) => (
        <div
          key={row.kind === 'note' ? row.note.id : 'create'}
          ref={(el) => { if (el && i === index) el.scrollIntoView({ block: 'nearest' }); }}
          onMouseEnter={() => setIndex(i)}
          onMouseDown={(e) => {
            e.preventDefault();
            pick(row);
          }}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', cursor: 'pointer', fontSize: 13,
            color: 'var(--text-main)', backgroundColor: i === index ? 'var(--bg-surface)' : 'transparent',
            borderTop: row.kind === 'create' && i > 0 ? '1px solid var(--border)' : undefined,
          }}
        >
          <span style={{ width: 16, textAlign: 'center', color: 'var(--text-muted)' }}>{row.kind === 'note' ? '↗' : '+'}</span>
          <span style={{ overflow: 'hidden', minWidth: 0 }}>
            <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {row.kind === 'note' ? row.note.title : <>{titleTaken(notes, row.title) ? 'Create another note' : 'Create note'} “<b>{row.title}</b>”</>}
            </span>
            {row.kind === 'note' && row.note.place && (
              <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.note.place}</span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
});
