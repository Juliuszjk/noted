import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { searchNotes, canCreateNote, titleTaken } from '@noted/editor';
import type { NoteChoice } from '@noted/editor';

const MENU_MAX_HEIGHT = 360;
const WIDTH = 380;

type Row = { kind: 'note'; note: NoteChoice } | { kind: 'create'; title: string };

export interface NotePickerProps {
  // Shown above the search field ("Go to note", "Add a link to this note in…").
  title: string;
  // In the order shown before anything is typed (the app passes the most recent first).
  notes: NoteChoice[];
  // Left out of the list (the open note).
  excludeId?: string | null;
  // Screen position (top left); without it the picker sits at the top centre like a switcher.
  at?: { x: number; y: number } | null;
  onPick: (id: string) => void;
  // Set: offers "Create note “…”" with the typed title.
  onCreate?: (title: string) => void;
  onClose: () => void;
}

// A search field with a list of notes: "/goto", "/linkto" and Ctrl+P.
export function NotePicker({ title, notes, excludeId = null, at = null, onPick, onCreate, onClose }: NotePickerProps) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const q = query.trim();
  const found = searchNotes(notes, q, excludeId, 12);
  const rows: Row[] = found.map((note) => ({ kind: 'note', note }));
  if (onCreate && canCreateNote(notes, q)) rows.push({ kind: 'create', title: q });

  useEffect(() => setIndex(0), [q]);
  useEffect(() => {
    inputRef.current?.focus();
    const outside = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener('mousedown', outside, true);
    return () => window.removeEventListener('mousedown', outside, true);
  }, []);

  const pick = (row: Row | undefined) => {
    if (!row) return;
    onClose();
    if (row.kind === 'note') onPick(row.note.id);
    else onCreate?.(row.title);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (rows.length) setIndex((index + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(rows[index]);
    }
  };

  const left = at ? Math.max(8, Math.min(at.x, window.innerWidth - WIDTH - 8)) : Math.max(8, (window.innerWidth - WIDTH) / 2);
  const roomBelow = at ? window.innerHeight - at.y - 8 : window.innerHeight - 96;
  const openUp = !!at && roomBelow < 240 && at.y > roomBelow;
  const vertical: CSSProperties = !at ? { top: 80 } : openUp ? { bottom: window.innerHeight - at.y + 28 } : { top: at.y };
  const maxHeight = Math.max(160, Math.min(MENU_MAX_HEIGHT, openUp ? at!.y - 36 : roomBelow));

  return (
    <div
      ref={boxRef}
      style={{
        position: 'fixed', left, ...vertical, width: WIDTH, maxHeight, zIndex: 9999, display: 'flex', flexDirection: 'column',
        backgroundColor: 'var(--bg-surface-high)', border: '1px solid var(--border-focus)', borderRadius: 8,
        boxShadow: '0 8px 16px rgba(0,0,0,0.4)', padding: '4px 0',
      }}
    >
      <div style={{ padding: '4px 12px 4px', fontSize: 11, color: 'var(--text-muted)' }}>{title}</div>
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Search notes…"
        spellCheck={false}
        style={{
          margin: '2px 8px 6px', padding: '6px 8px', fontSize: 13, borderRadius: 6, outline: 'none',
          border: '1px solid var(--border)', backgroundColor: 'var(--bg-surface)', color: 'var(--text-main)',
        }}
      />
      <div style={{ overflowY: 'auto' }}>
        {rows.length === 0 && (
          <div style={{ padding: '6px 12px 8px', fontSize: 13, color: 'var(--text-muted)' }}>No matching notes</div>
        )}
        {rows.map((row, i) => (
          <div
            key={row.kind === 'note' ? row.note.id : 'create'}
            ref={(el) => { if (el && i === index) el.scrollIntoView({ block: 'nearest' }); }}
            onMouseMove={() => { if (i !== index) setIndex(i); }}
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
    </div>
  );
}
