import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import type { CSSProperties } from 'react';
import {
  mdiMagnify, mdiClose, mdiLock, mdiLockOpenVariantOutline, mdiPin, mdiPinOff, mdiTabPlus, mdiStar, mdiStarOutline, mdiArchiveArrowDownOutline,
  mdiArchiveArrowUpOutline, mdiTrashCanOutline, mdiRestore, mdiDeleteForeverOutline, mdiSortVariant, mdiCheck, mdiChevronDoubleLeft,
  mdiDeleteSweepOutline, mdiChevronDown, mdiChevronRight,
} from '@mdi/js';
import { Icon } from './Icon';
import { IconBtn, popoverStyle } from './menu-parts';
import { searchSections, searchHighlights, relativeTime } from './note-list';
import type { CatalogNames, NoteListItem, NoteSort, NoteView } from './note-list';
import { buildNoteRows } from './note-groups';
import type { ListRow, NoteGrouping } from './note-groups';

export type NoteAction =
  | 'pin' | 'unpin' | 'favorite' | 'unfavorite' | 'archive' | 'unarchive' | 'trash' | 'restore' | 'deleteForever' | 'newTab'
  | 'lock' | 'unlock';

interface Props {
  title: string;
  items: NoteListItem[];
  activeId: string | null;
  sort: NoteSort;
  onSort: (sort: NoteSort) => void;
  // The view shown (notebook / tag views are one tree) and the grouping of the Notes view.
  view: NoteView;
  grouping: NoteGrouping;
  onGrouping: (grouping: NoteGrouping) => void;
  // Note links of a note (the trees inside notebooks and tags).
  linksOf: (id: string) => string[];
  // Folded / unfolded groups and branches (note-groups.ts `toggled`).
  folds: string[];
  onFolds: (folds: string[]) => void;
  // Pressing a note may start dragging it (desktop split view; the app follows the mouse).
  onDragNote?: (id: string, e: React.MouseEvent) => void;
  // Names for grouping by notebook / tag.
  names?: CatalogNames;
  // Plain click: open in the current tab. Middle click: new tab. Ctrl+click / Shift+click
  // select several notes; the right-click menu then acts on all of them.
  onOpen: (id: string, newTab: boolean) => void;
  onAction: (ids: string[], action: NoteAction) => void;
  // Whole text of a note, for searching inside notes (not only titles).
  textOf?: (id: string) => string;
  // Trash view: "Empty trash" next to the sort button.
  onEmptyTrash?: () => void;
  // Hides this column (a button in the tab bar brings it back).
  onHide?: () => void;
  // Width of the header's buttons plus a little of the title: the narrowest the list may get.
  onMinWidth?: (width: number) => void;
}

const sectionTitle: CSSProperties = {
  padding: '10px 12px 4px', fontSize: 11, fontWeight: 700, letterSpacing: '0.04em',
  color: 'var(--primary)', textTransform: 'uppercase', borderBottom: '1px solid var(--border)',
};

const SORTS: [NoteSort, string][] = [['edited', 'Last edited'], ['created', 'Date created'], ['title', 'Title (A–Z)']];
const GROUPINGS: [NoteGrouping, string][] = [['notebook', 'Notebooks'], ['tag', 'Tags'], ['az', 'A–Z'], ['date', 'Date']];
const INDENT = 14;

const menuRow = (danger = false): CSSProperties => ({
  display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '7px 10px', border: 'none', borderRadius: 6,
  background: 'transparent', color: danger ? 'var(--error)' : 'var(--text-main)', fontSize: 13, cursor: 'pointer', textAlign: 'left',
});

// Note list column: title of the current view, search, sort, sections with compact ages.
export function NoteList({ title, items, activeId, sort, onSort, view, grouping, onGrouping, linksOf, folds, onFolds, onDragNote, names, onOpen, onAction, onEmptyTrash, onHide, onMinWidth, textOf }: Props) {
  const header = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = header.current;
    if (!el) return;
    const buttons = [...el.children].filter((c) => (c as HTMLElement).dataset.title === undefined) as HTMLElement[];
    // Buttons, gaps, padding (8 + 12) and room for a few letters of the title.
    onMinWidth?.(Math.ceil(buttons.reduce((sum, c) => sum + c.offsetWidth, 0) + 4 * buttons.length + 20 + 48));
  }, [!!onEmptyTrash && items.length > 0, !!onHide]);
  const [query, setQuery] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [menu, setMenu] = useState<{ item: NoteListItem; x: number; y: number } | null>(null);
  const [sortOpen, setSortOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [anchor, setAnchor] = useState<string | null>(null);

  // Ages tick along without a re-render from outside.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!menu && !sortOpen) return;
    const close = () => { setMenu(null); setSortOpen(false); };
    window.addEventListener('mousedown', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('blur', close);
    };
  }, [menu, sortOpen]);

  // Search matches in bold.
  const marked = (text: string) => (query.trim()
    ? searchHighlights(text, query).map((p, i) => (p.hit ? <b key={i} style={{ fontWeight: 700, color: 'var(--text-main)' }}>{p.text}</b> : p.text))
    : text);
  const toggled = useMemo(() => new Set(folds), [folds]);
  const toggle = (key: string) => onFolds(toggled.has(key) ? folds.filter((k) => k !== key) : [...folds, key]);
  // Searching: title matches, then text matches (flat). Otherwise Pinned / Recent / groups
  // with trees (note-groups.ts).
  const rows = useMemo<ListRow[]>(() => {
    if (!query.trim()) return buildNoteRows(items, { view, grouping, sort, now, names, linksOf, toggled });
    return searchSections(items, query, sort, textOf).flatMap((sec) => [
      { kind: 'header' as const, key: `search:${sec.title}`, title: sec.title, count: sec.items.length, collapsed: false },
      ...sec.items.map((n) => ({ kind: 'note' as const, key: `search:${sec.title}/${n.id}`, item: n, depth: 0, hasChildren: false, collapsed: false, foldKey: '' })),
    ]);
  }, [items, query, now, sort, names, textOf, view, grouping, linksOf, toggled]);
  // Notes in the order shown (for Shift+click ranges), each once.
  const shown = useMemo(() => [...new Set(rows.flatMap((r) => (r.kind === 'note' ? [r.item.id] : [])))], [rows]);
  // Selections never outlive the notes they point to (another view, deleted notes).
  useEffect(() => setSelected((sel) => sel.filter((id) => items.some((n) => n.id === id))), [items]);
  // Several notes selected: Delete moves them to the trash (in the trash: deletes them for
  // good, after the app's confirmation). Not while typing somewhere.
  const deleteSelected = () => {
    if (selected.length < 2) return;
    const inTrash = selected.every((id) => items.find((n) => n.id === id)?.trashedAt);
    onAction(selected, inTrash ? 'deleteForever' : 'trash');
    setSelected([]);
  };
  const deleteRef = useRef(deleteSelected);
  deleteRef.current = deleteSelected;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected([]);
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      if (e.key === 'Delete' && !typing) deleteRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const click = (e: React.MouseEvent, id: string) => {
    if (e.ctrlKey || e.metaKey) {
      setSelected((sel) => (sel.includes(id) ? sel.filter((s) => s !== id) : [...(sel.length ? sel : activeId ? [activeId] : []), id]));
      setAnchor(id);
    } else if (e.shiftKey && (anchor ?? activeId)) {
      const from = shown.indexOf((anchor ?? activeId)!);
      const to = shown.indexOf(id);
      if (from >= 0 && to >= 0) setSelected(shown.slice(Math.min(from, to), Math.max(from, to) + 1));
    } else {
      setSelected([]);
      setAnchor(id);
      onOpen(id, false);
    }
  };

  const actionsFor = (n: NoteListItem, count: number): { icon: string; label: string; action: NoteAction; danger?: boolean }[] => {
    if (count > 1) {
      if (n.trashedAt) {
        return [
          { icon: mdiRestore, label: `Restore ${count} notes`, action: 'restore' },
          { icon: mdiDeleteForeverOutline, label: `Delete ${count} notes forever`, action: 'deleteForever', danger: true },
        ];
      }
      return [
        { icon: mdiPin, label: 'Pin', action: 'pin' },
        { icon: mdiPinOff, label: 'Unpin', action: 'unpin' },
        { icon: mdiStarOutline, label: 'Add to favorites', action: 'favorite' },
        { icon: mdiStar, label: 'Remove from favorites', action: 'unfavorite' },
        { icon: mdiArchiveArrowDownOutline, label: 'Archive', action: 'archive' },
        { icon: mdiArchiveArrowUpOutline, label: 'Unarchive', action: 'unarchive' },
        { icon: mdiTrashCanOutline, label: `Move ${count} notes to trash`, action: 'trash', danger: true },
      ];
    }
    if (n.trashedAt) {
      return [
        { icon: mdiRestore, label: 'Restore', action: 'restore' },
        { icon: mdiDeleteForeverOutline, label: 'Delete forever', action: 'deleteForever', danger: true },
      ];
    }
    return [
      { icon: mdiTabPlus, label: 'Open in new tab', action: 'newTab' },
      n.pinned ? { icon: mdiPinOff, label: 'Unpin', action: 'unpin' } : { icon: mdiPin, label: 'Pin', action: 'pin' },
      n.favorite ? { icon: mdiStar, label: 'Remove from favorites', action: 'unfavorite' } : { icon: mdiStarOutline, label: 'Add to favorites', action: 'favorite' },
      n.archived ? { icon: mdiArchiveArrowUpOutline, label: 'Unarchive', action: 'unarchive' } : { icon: mdiArchiveArrowDownOutline, label: 'Archive', action: 'archive' },
      n.locked ? { icon: mdiLockOpenVariantOutline, label: 'Unlock (remove from the vault)', action: 'unlock' } : { icon: mdiLock, label: 'Lock (vault)', action: 'lock' },
      { icon: mdiTrashCanOutline, label: 'Move to trash', action: 'trash', danger: true },
    ];
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <div ref={header} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '8px 8px 0 12px' }}>
        <span data-title="" style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
        {onEmptyTrash && items.length > 0 && (
          <IconBtn icon={mdiDeleteSweepOutline} title="Empty trash (delete every note in it forever)" onClick={onEmptyTrash} style={{ color: 'var(--error)' }} />
        )}
        <div style={{ position: 'relative' }} onMouseDown={(e) => e.stopPropagation()}>
          <IconBtn icon={mdiSortVariant} title="Sort" active={sortOpen} onClick={() => setSortOpen((o) => !o)} />
          {sortOpen && (
            <div style={{ ...popoverStyle, left: 'auto', right: 0, top: 'calc(100% + 4px)', zIndex: 100, minWidth: 170, padding: 4 }}>
              <div style={{ padding: '4px 10px 2px', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>GROUP BY</div>
              {GROUPINGS.map(([value, label]) => (
                <button key={value} type="button" style={menuRow()} onClick={() => { onGrouping(value); setSortOpen(false); }}>
                  <span style={{ width: 16, display: 'flex', color: 'var(--primary)' }}>{grouping === value && <Icon path={mdiCheck} size={16} />}</span>
                  {label}
                </button>
              ))}
              <div style={{ padding: '8px 10px 2px', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', borderTop: '1px solid var(--border)', marginTop: 4 }}>SORT</div>
              {SORTS.map(([value, label]) => (
                <button key={value} type="button" style={menuRow()} onClick={() => { onSort(value); setSortOpen(false); }}>
                  <span style={{ width: 16, display: 'flex', color: 'var(--primary)' }}>{sort === value && <Icon path={mdiCheck} size={16} />}</span>
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
        {onHide && <IconBtn icon={mdiChevronDoubleLeft} title="Hide note list" onClick={onHide} />}
      </div>
      <div style={{ padding: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px', height: 32, borderRadius: 8, backgroundColor: 'var(--bg-surface-high)', color: 'var(--text-muted)' }}>
          <Icon path={mdiMagnify} size={16} />
          <input
            value={query}
            placeholder="Search in notes"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') setQuery(''); }}
            style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', color: 'var(--text-main)', fontSize: 13 }}
          />
          {query && (
            <button type="button" title="Clear search" onClick={() => setQuery('')} style={{ border: 'none', background: 'transparent', color: 'inherit', padding: 0, cursor: 'pointer', display: 'flex' }}>
              <Icon path={mdiClose} size={14} />
            </button>
          )}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {rows.length === 0 && (
          <div style={{ padding: 16, fontSize: 13, color: 'var(--text-muted)' }}>{query ? 'No notes match' : 'Nothing here yet'}</div>
        )}
        {rows.map((row) => {
          if (row.kind === 'header') {
            const foldable = !row.key.startsWith('search:');
            return (
              <div
                key={row.key}
                onClick={foldable ? () => toggle(row.key) : undefined}
                style={{ ...sectionTitle, display: 'flex', alignItems: 'center', gap: 4, cursor: foldable ? 'pointer' : 'default', userSelect: 'none' }}
              >
                {foldable && <Icon path={row.collapsed ? mdiChevronRight : mdiChevronDown} size={14} />}
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.title}</span>
                <span style={{ fontWeight: 500, color: 'var(--text-muted)' }}>{row.count}</span>
              </div>
            );
          }
          const n = row.item;
          const active = n.id === activeId;
          const isSelected = selected.includes(n.id);
          const highlighted = active || isSelected;
          // Parents stand out a little more than their children.
          const weight = active ? 600 : row.hasChildren ? (row.depth === 0 ? 600 : 500) : 400;
          const muted = row.depth > 0 && !row.hasChildren && !highlighted;
          return (
            <div
              key={row.key}
              onClick={(e) => click(e, n.id)}
              onMouseDown={(e) => {
                if (e.shiftKey) e.preventDefault();
                else if (e.button === 0 && !e.ctrlKey && !e.metaKey) onDragNote?.(n.id, e);
              }}
              onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); onOpen(n.id, true); } }}
              onContextMenu={(e) => {
                e.preventDefault();
                // Right-click outside the selection acts on that note alone.
                if (!isSelected) setSelected([]);
                setMenu({ item: n, x: e.clientX, y: e.clientY });
              }}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px 6px 6px', cursor: 'pointer', fontSize: 13,
                backgroundColor: isSelected ? 'var(--primary-container)' : active ? 'var(--secondary-container)' : 'transparent',
                color: isSelected ? 'var(--on-primary-container)' : active ? 'var(--on-secondary-container)' : 'var(--text-main)',
              }}
              onMouseEnter={(e) => { if (!highlighted) e.currentTarget.style.backgroundColor = 'var(--bg-surface-high)'; }}
              onMouseLeave={(e) => { if (!highlighted) e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              {/* One guide line per level, so children read as part of their parent. */}
              {Array.from({ length: row.depth }, (_, i) => (
                <span key={i} style={{ alignSelf: 'stretch', width: INDENT, flexShrink: 0, borderLeft: '1px solid var(--border)', marginTop: -6, marginBottom: -6, marginLeft: i === 0 ? 7 : 0 }} />
              ))}
              <span
                onClick={row.hasChildren ? (e) => { e.stopPropagation(); toggle(row.foldKey); } : undefined}
                title={row.hasChildren ? (row.collapsed ? 'Show the linked notes' : 'Hide the linked notes') : undefined}
                style={{ width: 16, flexShrink: 0, display: 'flex', justifyContent: 'center', color: 'var(--text-muted)', cursor: row.hasChildren ? 'pointer' : 'inherit' }}
              >
                {row.hasChildren && <Icon path={row.collapsed ? mdiChevronRight : mdiChevronDown} size={15} />}
              </span>
              {n.favorite && <Icon path={mdiStar} size={13} style={{ color: 'var(--primary)' }} />}
              {n.locked && <Icon path={mdiLock} size={13} style={{ color: 'var(--text-muted)' }} />}
              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: weight, color: muted ? 'var(--text-muted)' : undefined }}>{marked(n.title)}</span>
                {/* While searching: the text around the match. */}
                {query.trim() && n.excerpt && (
                  <span style={{ fontSize: 12, color: active ? 'inherit' : 'var(--text-muted)', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' } as CSSProperties}>{marked(n.excerpt)}</span>
                )}
              </span>
              <span style={{ fontSize: 11, color: active ? 'inherit' : 'var(--text-muted)', opacity: 0.8 }}>
                {relativeTime(sort === 'created' && n.created ? n.created : n.updatedAt, now)}
              </span>
            </div>
          );
        })}
      </div>

      {selected.length > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px 4px 12px', fontSize: 12, color: 'var(--text-muted)', borderTop: '1px solid var(--border)' }}>
          <span style={{ flex: 1 }}>{selected.length} selected · right-click for more · Esc to clear</span>
          <IconBtn
            icon={selected.every((id) => items.find((n) => n.id === id)?.trashedAt) ? mdiDeleteForeverOutline : mdiTrashCanOutline}
            title={selected.every((id) => items.find((n) => n.id === id)?.trashedAt) ? 'Delete forever (Delete)' : 'Move to trash (Delete)'}
            onClick={deleteSelected}
            style={{ color: 'var(--error)' }}
          />
        </div>
      )}

      {menu && (
        <div
          onMouseDown={(e) => e.stopPropagation()}
          style={{ ...popoverStyle, position: 'fixed', top: Math.min(menu.y, window.innerHeight - 230), left: menu.x, zIndex: 10000, minWidth: 200, padding: 4 }}
        >
          {actionsFor(menu.item, selected.includes(menu.item.id) ? selected.length : 1).map((item) => (
            <button
              key={item.action}
              type="button"
              onClick={() => {
                onAction(selected.includes(menu.item.id) && selected.length > 1 ? selected : [menu.item.id], item.action);
                setMenu(null);
                setSelected([]);
              }}
              style={menuRow(item.danger)}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-surface-highest)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              <Icon path={item.icon} size={16} /> {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
