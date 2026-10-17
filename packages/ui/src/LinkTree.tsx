import { useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { mdiChevronDoubleLeft, mdiMagnify, mdiFileTreeOutline, mdiChevronDown, mdiChevronRight, mdiFileTree } from '@mdi/js';
import { Icon } from './Icon';
import { IconBtn } from './menu-parts';
import { buildLinkTree, filterTree, foldTree } from './link-tree';
import type { TreeNote } from './link-tree';

// The "Tree" view of the note list column: note links drawn like the `tree` command. It shows
// the open note and what it links to (every tree when no note is open, or with "All notes").
// Opening a note from the tree keeps its tree; from the list of all trees, only the tree of
// the opened note stays. Click opens a note, Ctrl/middle
// click opens it in a new tab; the arrow on the right folds a branch. The filter keeps the
// rows whose title matches, with their ancestors.
export function LinkTree({ notes, activeId, onOpen, onHide }: {
  notes: TreeNote[];
  activeId: string | null;
  onOpen: (id: string, newTab: boolean) => void;
  onHide?: () => void;
}) {
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [root, setRoot] = useState<string | null>(activeId);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  // The note last opened from the tree itself: the tree does not move to it.
  const openedHere = useRef<string | null>(null);
  useEffect(() => {
    if (activeId && activeId === openedHere.current) return;
    openedHere.current = null;
    setRoot(activeId);
  }, [activeId]);

  const rootId = showAll ? null : root;
  const rows = useMemo(() => buildLinkTree(notes, rootId), [notes, rootId]);
  const visible = useMemo(() => (query.trim() ? filterTree(rows, query) : foldTree(rows, collapsed)), [rows, query, collapsed]);
  const rootTitle = rootId ? notes.find((n) => n.id === rootId)?.title : null;

  const open = (id: string, key: string, newTab: boolean) => {
    if (!newTab) {
      openedHere.current = id;
      // Showing every tree: keep only the one the note belongs to (its top row).
      if (rootId === null) {
        setRoot(key.split('/')[0]);
        setShowAll(false);
      }
    }
    onOpen(id, newTab);
  };
  const toggle = (e: ReactMouseEvent, key: string) => {
    e.stopPropagation();
    setCollapsed((set) => {
      const next = new Set(set);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '8px 8px 0 12px' }}>
        <span style={{ flex: 1, fontSize: 15, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {rootTitle ? `Links of ${rootTitle || 'Untitled'}` : 'Links tree'}
        </span>
        <IconBtn icon={mdiFileTree} title={showAll ? 'Only the open note' : 'All notes'} active={showAll} onClick={() => setShowAll((v) => !v)} />
        {onHide && <IconBtn icon={mdiChevronDoubleLeft} title="Hide note list" onClick={onHide} />}
      </div>
      <div style={{ padding: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px', height: 32, borderRadius: 8, backgroundColor: 'var(--bg-surface-high)', color: 'var(--text-muted)' }}>
          <Icon path={mdiMagnify} size={16} />
          <input
            value={query}
            placeholder="Filter the tree"
            onChange={(e) => setQuery(e.target.value)}
            style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', color: 'var(--text-main)', fontSize: 13 }}
          />
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '0 8px 12px' }}>
        {rows.length === 0 && (
          <div style={{ padding: '12px 8px', fontSize: 12, color: 'var(--text-muted)', display: 'flex', gap: 8 }}>
            <Icon path={mdiFileTreeOutline} size={18} />
            <span>No note links yet. Link notes with [[ and the notes that link to others become branches here.</span>
          </div>
        )}
        {visible.map((row) => {
          const folded = collapsed.has(row.key);
          const canFold = row.hasChildren && !row.cycle && !query.trim();
          return (
            <div
              key={row.key}
              role="button"
              title={row.cycle ? `${row.title} (links back to a note above)` : row.title}
              onClick={(e) => open(row.id, row.key, e.ctrlKey || e.metaKey)}
              onAuxClick={(e) => { if (e.button === 1) open(row.id, row.key, true); }}
              style={{
                display: 'flex', alignItems: 'center', width: '100%', minWidth: 'max-content', boxSizing: 'border-box', padding: '2px 0 2px 6px',
                borderRadius: 6, cursor: 'pointer', fontSize: 13, whiteSpace: 'pre',
                backgroundColor: row.id === activeId ? 'var(--secondary-container)' : 'transparent',
                color: row.id === activeId ? 'var(--on-secondary-container)' : 'var(--text-main)',
              }}
              onMouseEnter={(e) => { if (row.id !== activeId) e.currentTarget.style.backgroundColor = 'var(--bg-surface-high)'; }}
              onMouseLeave={(e) => { if (row.id !== activeId) e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              <span style={{ fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-muted)' }}>{row.prefix}</span>
              <span style={{ flex: 1, paddingRight: 28, fontWeight: row.depth === 0 ? 700 : 400, opacity: row.cycle ? 0.6 : 1 }}>{row.title || 'Untitled'}{row.cycle ? ' ↻' : ''}</span>
              {/* Pinned to the right edge of the column, over long titles. */}
              {canFold && (
                <button
                  type="button"
                  title={folded ? 'Expand' : 'Collapse'}
                  onClick={(e) => toggle(e, row.key)}
                  style={{
                    position: 'sticky', right: 0, display: 'flex', marginLeft: -28, padding: '2px 4px', border: 'none', borderRadius: 4, cursor: 'pointer',
                    color: 'var(--text-muted)', backgroundColor: row.id === activeId ? 'var(--secondary-container)' : 'var(--bg-surface-low)',
                  }}
                >
                  <Icon path={folded ? mdiChevronRight : mdiChevronDown} size={16} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
