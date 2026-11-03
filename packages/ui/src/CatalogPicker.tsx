import { useEffect, useRef, useState } from 'react';
import { mdiBookOutline, mdiPound, mdiCheck, mdiPlus, mdiClose } from '@mdi/js';
import { Icon } from './Icon';
import { popoverStyle } from './menu-parts';

export interface CatalogChoice {
  id: string;
  name: string;
  // Notebooks: their place in the tree (catalog listNotebookTree, which also gives the order).
  depth?: number;
  path?: string[];
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ł/g, 'l').trim();

// Toggles the note's notebooks or tags (several of each); it stays open until closed. Typing a
// new name offers to create it (a notebook as a path, "Linux/TODO"). Shown at a screen position
// (caret for /notebook and /tag, or a clicked control). Notebooks show as a tree; while typing,
// matches show their full path.
export function CatalogPicker({ kind, entries, selected, heading, x, y, onToggle, onCreate, onClose }: {
  kind: 'notebooks' | 'tags';
  // A line above the field (which note it changes, when not the open one).
  heading?: string;
  entries: CatalogChoice[];
  selected: string[];
  x: number;
  y: number;
  onToggle: (id: string) => void;
  onCreate: (name: string) => void;
  // `clickedAway`: closed by a click outside it (the caller then leaves the focus there).
  onClose: (clickedAway?: boolean) => void;
}) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose(true);
    };
    document.addEventListener('mousedown', onMouseDown, true);
    return () => document.removeEventListener('mousedown', onMouseDown, true);
  }, [onClose]);

  const q = fold(query.replace(/^#/, ''));
  const pathOf = (e: CatalogChoice) => (e.path ?? [e.name]).join(' / ');
  // "Linux/TODO", "linux / todo" and "Linux / TODO" are the same path.
  const pathKey = (s: string) => fold(s).split('/').map((p) => p.trim()).join('/');
  const matches = entries.filter((e) => fold(pathOf(e)).includes(q) || pathKey(pathOf(e)).includes(pathKey(q)));
  const canCreate = q.length > 0 && !entries.some((e) => fold(e.name) === q || pathKey(pathOf(e)) === pathKey(q));
  const rows = [...matches.map((e) => ({ kind: 'entry' as const, entry: e })), ...(canCreate ? [{ kind: 'create' as const }] : [])];
  useEffect(() => setIndex(0), [query]);

  const pick = (row: (typeof rows)[number] | undefined) => {
    if (!row) return;
    if (row.kind === 'create') onCreate(query.replace(/^#/, '').trim());
    else onToggle(row.entry.id);
    setQuery('');
  };

  const icon = kind === 'notebooks' ? mdiBookOutline : mdiPound;
  const width = 280;

  return (
    <div
      ref={ref}
      style={{ ...popoverStyle, position: 'fixed', left: Math.max(8, Math.min(x, window.innerWidth - width - 8)), top: Math.min(y, window.innerHeight - 320), width, zIndex: 10000, padding: 6 }}
    >
      {heading && <div style={{ padding: '2px 4px 6px', fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{heading}</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <input
          autoFocus
          value={query}
          placeholder={kind === 'notebooks' ? 'Add to notebook…' : 'Add a tag…'}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(rows.length - 1, i + 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(0, i - 1)); }
            else if (e.key === 'Enter') { e.preventDefault(); pick(rows[index]); }
            else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
          }}
          style={{ flex: 1, padding: '6px 8px', fontSize: 13, color: 'var(--text-main)', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 6, outline: 'none' }}
        />
        <button type="button" title="Close" onClick={() => onClose()} style={{ display: 'flex', border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}>
          <Icon path={mdiClose} size={16} />
        </button>
      </div>
      <div style={{ maxHeight: 240, overflowY: 'auto' }}>
        {rows.length === 0 && <div style={{ padding: 8, fontSize: 12, color: 'var(--text-muted)' }}>Type a name to create one</div>}
        {rows.map((row, i) => {
          const on = row.kind === 'entry' && selected.includes(row.entry.id);
          return (
            <button
              key={row.kind === 'entry' ? row.entry.id : 'create'}
              type="button"
              onMouseEnter={() => setIndex(i)}
              onClick={() => pick(row)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '7px 8px', border: 'none', borderRadius: 6,
                cursor: 'pointer', fontSize: 13, textAlign: 'left', color: 'var(--text-main)',
                backgroundColor: i === index ? 'var(--bg-surface-highest)' : 'transparent',
              }}
            >
              {row.kind === 'entry' && !q && row.entry.depth ? <span style={{ width: row.entry.depth * 14, flexShrink: 0 }} /> : null}
              <Icon path={row.kind === 'create' ? mdiPlus : icon} size={16} />
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {row.kind === 'create' ? <>Create “<b>{query.replace(/^#/, '').trim()}</b>”</>
                  : q && row.entry.path && row.entry.path.length > 1
                    ? <><span style={{ color: 'var(--text-muted)' }}>{row.entry.path.slice(0, -1).join(' / ')} / </span>{row.entry.name}</>
                    : row.entry.name}
              </span>
              {on && <Icon path={mdiCheck} size={16} style={{ color: 'var(--primary)' }} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
