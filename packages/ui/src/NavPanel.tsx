import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  mdiHomeOutline, mdiBookOutline, mdiPound, mdiNoteTextOutline, mdiStarOutline, mdiBellOutline, mdiTrashCanOutline, mdiWeb,
  mdiArchiveOutline, mdiPlus, mdiPencilOutline, mdiDeleteOutline, mdiChevronDoubleLeft, mdiChevronDoubleRight, mdiFileTreeOutline, mdiCogOutline, mdiCreationOutline, mdiChevronDown, mdiChevronRight, mdiBookPlusOutline,
  mdiFolderMoveOutline, mdiArrowUp, mdiCheck,
} from '@mdi/js';
import { Icon } from './Icon';
import { IconBtn, popoverStyle } from './menu-parts';
import { notebookSubtree } from '@noted/sync';
import type { NoteView } from './note-list';

export interface NavEntry {
  id: string;
  name: string;
  count: number;
  // Notebooks: the parent notebook (sub-notebooks) and the depth in the tree; the list comes in
  // tree order (catalog listNotebookTree).
  parent?: string | null;
  depth?: number;
}

interface Props {
  view: NoteView;
  onView: (view: NoteView) => void;
  counts: { notes: number; favorites: number; trash: number; archive: number; published?: number; reminders?: number; claude?: number };
  notebooks: NavEntry[];
  tags: NavEntry[];
  // `parent`: a new sub-notebook inside that notebook (null = top level).
  onCreate: (kind: 'notebooks' | 'tags', name: string, parent?: string | null) => void;
  onRename: (kind: 'notebooks' | 'tags', id: string, name: string) => void;
  onDelete: (kind: 'notebooks' | 'tags', id: string) => void;
  // Moves a notebook into another one (null = top level).
  onMove?: (id: string, parent: string | null) => void;
  // Notebooks whose sub-notebooks are shown (per device).
  openNotebooks?: string[];
  onOpenNotebooks?: (ids: string[]) => void;
  // Hides this column (a button in the tab bar brings it back).
  onHide?: () => void;
  // Narrow rail: icons only, no names (the column was dragged narrower than its icons).
  compact?: boolean;
  // Leaves the rail (optionally on the Notebooks or Tags tab).
  onExpand?: (tab?: 'notebooks' | 'tags') => void;
  // Width of the header's icons (plus padding): the narrowest the column may get.
  onMinWidth?: (width: number) => void;
  // Opens Settings (gear at the bottom).
  onSettings?: () => void;
}

// Width of the narrow rail.
export const NAV_RAIL_WIDTH = 52;
// Starting value of the narrowest width, until the panel measured its header icons.
export const NAV_MIN_WIDTH = 190;

type Tab = 'home' | 'notebooks' | 'tags';

const rowStyle = (active: boolean) => ({
  display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '7px 10px', border: 'none', borderRadius: 8,
  cursor: 'pointer', fontSize: 13, textAlign: 'left' as const,
  backgroundColor: active ? 'var(--secondary-container)' : 'transparent',
  color: active ? 'var(--on-secondary-container)' : 'var(--text-main)',
});

function NameInput({ initial, placeholder, onDone, indent = 0 }: { initial: string; placeholder: string; onDone: (name: string | null) => void; indent?: number }) {
  const [value, setValue] = useState(initial);
  return (
    <input
      autoFocus
      value={value}
      placeholder={placeholder}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onDone(value.trim() || null)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onDone(value.trim() || null);
        else if (e.key === 'Escape') onDone(null);
      }}
      style={{ width: `calc(100% - ${indent}px)`, marginLeft: indent, padding: '6px 10px', fontSize: 13, color: 'var(--text-main)', background: 'var(--bg-surface)', border: '1px solid var(--primary)', borderRadius: 8, outline: 'none' }}
    />
  );
}

// Left navigation: Home (Notes, Favorites, Trash, Archive), Notebooks and Tags, with counts.
export function NavPanel({ view, onView, counts, notebooks, tags, onCreate, onRename, onDelete, onMove, openNotebooks = [], onOpenNotebooks, onHide, compact, onExpand, onMinWidth, onSettings }: Props) {
  const [tab, setTab] = useState<Tab>(view.kind === 'notebook' ? 'notebooks' : view.kind === 'tag' ? 'tags' : 'home');
  // A name field for a new entry: at the top level, or inside a notebook (new sub-notebook).
  const [creating, setCreating] = useState<{ parent: string | null } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ kind: 'notebooks' | 'tags'; id: string; x: number; y: number } | null>(null);
  // "Move to…": a tree of the notebooks to pick the new parent from.
  const [mover, setMover] = useState<{ id: string; x: number; y: number } | null>(null);
  // Dragging a notebook onto another one nests it (mouse driven: no HTML drag and drop).
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; over: string | null } | null>(null);
  const dragStart = useRef<{ id: string; x: number; y: number } | null>(null);
  const swallowClick = useRef(false);
  // The scrolling list: a notebook dropped on its empty part goes back to the top level.
  const listArea = useRef<HTMLDivElement>(null);

  const parentOf = useMemo(() => new Map(notebooks.map((n) => [n.id, n.parent ?? null])), [notebooks]);
  const hasChildren = useMemo(() => new Set(notebooks.map((n) => n.parent).filter((p): p is string => !!p)), [notebooks]);
  // The notebook and every notebook below it (where it may not be moved).
  const subtree = (id: string) => notebookSubtree(notebooks.map((n) => ({ id: n.id, parent: n.parent ?? null })), id);
  const open = useMemo(() => new Set(openNotebooks), [openNotebooks]);
  const setOpen = (id: string, on: boolean) => {
    if (open.has(id) === on) return;
    onOpenNotebooks?.(on ? [...openNotebooks, id] : openNotebooks.filter((k) => k !== id));
  };
  // The notebook shown in the list is never hidden in a folded parent.
  useEffect(() => {
    if (view.kind !== 'notebook') return;
    const missing: string[] = [];
    for (let p = parentOf.get(view.id) ?? null, guard = 0; p && guard < 100; p = parentOf.get(p) ?? null, guard++) if (!open.has(p)) missing.push(p);
    if (missing.length) onOpenNotebooks?.([...openNotebooks, ...missing]);
  }, [view, parentOf]);

  const beginDrag = (id: string, e: React.MouseEvent) => {
    if (e.button !== 0 || !onMove) return;
    dragStart.current = { id, x: e.clientX, y: e.clientY };
    const banned = subtree(id);
    const move = (ev: MouseEvent) => {
      const start = dragStart.current;
      if (!start) return;
      if (Math.abs(ev.clientX - start.x) + Math.abs(ev.clientY - start.y) < 5 && !swallowClick.current) return;
      swallowClick.current = true;
      const target = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-nb]')?.dataset.nb ?? null;
      setDrag({ id: start.id, x: ev.clientX, y: ev.clientY, over: target && !banned.has(target) ? target : null });
    };
    const up = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      const start = dragStart.current;
      dragStart.current = null;
      setDrag(null);
      if (!start || !swallowClick.current) return;
      const under = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
      const target = under?.closest<HTMLElement>('[data-nb]')?.dataset.nb ?? null;
      if (target && !banned.has(target) && parentOf.get(start.id) !== target) {
        onMove?.(start.id, target);
        setOpen(target, true);
      } else if (!target && under && under === listArea.current && parentOf.get(start.id)) {
        // Dropped on the empty part of the list: back to the top level (elsewhere: cancelled).
        onMove?.(start.id, null);
      }
      // The click that ends the drag must not select the notebook under the pointer.
      setTimeout(() => { swallowClick.current = false; }, 0);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  // The header icons side by side, without the spacer: the column's minimum width.
  const header = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = header.current;
    if (!el || compact) return;
    const icons = [...el.children].filter((c) => (c as HTMLElement).dataset.spacer === undefined) as HTMLElement[];
    const gap = 4;
    const panelPadding = 16;
    onMinWidth?.(Math.ceil(icons.reduce((sum, c) => sum + c.offsetWidth, 0) + gap * (icons.length - 1) + panelPadding + 2));
  }, [tab, compact, !!onHide]);

  useEffect(() => {
    if (!menu && !mover) return;
    const close = () => { setMenu(null); setMover(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', onKey); };
  }, [menu, mover]);

  const isView = (v: NoteView) => v.kind === view.kind && ('id' in v ? 'id' in view && view.id === v.id : true);
  const count = (n: number) => <span style={{ fontSize: 11, opacity: 0.7 }}>{n}</span>;

  const home: { view: NoteView; icon: string; label: string; n: number }[] = [
    { view: { kind: 'notes' }, icon: mdiNoteTextOutline, label: 'Notes', n: counts.notes },
    { view: { kind: 'favorites' }, icon: mdiStarOutline, label: 'Favorites', n: counts.favorites },
    // Notes made through the MCP (only shown once there is one).
    ...(counts.claude ? [{ view: { kind: 'claude' } as NoteView, icon: mdiCreationOutline, label: 'From Claude', n: counts.claude }] : []),
    // Count: reminders due now or today.
    { view: { kind: 'reminders' }, icon: mdiBellOutline, label: 'Reminders', n: counts.reminders ?? 0 },
    { view: { kind: 'trash' }, icon: mdiTrashCanOutline, label: 'Trash', n: counts.trash },
    { view: { kind: 'archive' }, icon: mdiArchiveOutline, label: 'Archive', n: counts.archive },
    // Notes published to the web (only shown once there is one).
    ...(counts.published ? [{ view: { kind: 'published' } as NoteView, icon: mdiWeb, label: 'Published', n: counts.published }] : []),
  ];

  const INDENT = 16;
  const catalog = (kind: 'notebooks' | 'tags', list: NavEntry[]) => {
    const isTree = kind === 'notebooks';
    // Rows shown: notebooks whose parents are all unfolded.
    const visible = isTree ? list.filter((e) => {
      for (let p = e.parent ?? null, guard = 0; p && guard < 100; p = parentOf.get(p) ?? null, guard++) if (!open.has(p)) return false;
      return true;
    }) : list;
    // A new sub-notebook's field goes after its parent's last visible descendant.
    const creatingAfter = creating?.parent ? (() => {
      const inside = subtree(creating.parent!);
      let last = creating.parent!;
      for (const e of visible) if (inside.has(e.id)) last = e.id;
      return last;
    })() : null;
    const creatingDepth = creating?.parent ? (list.find((e) => e.id === creating.parent)?.depth ?? 0) + 1 : 0;
    const field = (indent: number): ReactNode => (
      <NameInput
        key="new"
        indent={indent}
        initial=""
        placeholder={kind === 'tags' ? 'Tag name' : creating?.parent ? 'Sub-notebook name' : 'Notebook name'}
        onDone={(name) => { if (name) onCreate(kind, name, isTree ? creating?.parent ?? null : undefined); setCreating(null); }}
      />
    );
    return (
      <>
        {visible.map((entry) => {
          const v: NoteView = { kind: isTree ? 'notebook' : 'tag', id: entry.id };
          const depth = isTree ? entry.depth ?? 0 : 0;
          const after = creating && creatingAfter === entry.id ? field(creatingDepth * INDENT) : null;
          if (renaming === entry.id) {
            return <Fragment key={entry.id}><NameInput indent={depth * INDENT} initial={entry.name} placeholder="Name" onDone={(name) => { if (name) onRename(kind, entry.id, name); setRenaming(null); }} />{after}</Fragment>;
          }
          const kids = isTree && hasChildren.has(entry.id);
          const unfolded = kids && open.has(entry.id);
          const dropTarget = drag?.over === entry.id;
          return (
            <Fragment key={entry.id}>
              <button
                type="button"
                data-nb={isTree ? entry.id : undefined}
                style={{
                  ...rowStyle(isView(v)),
                  ...(isTree ? { paddingLeft: 10 + depth * INDENT } : {}),
                  ...(drag?.id === entry.id ? { opacity: 0.35 } : {}),
                  ...(dropTarget ? { outline: '2px solid var(--primary)', outlineOffset: -2, backgroundColor: 'var(--bg-surface-high)' } : {}),
                }}
                onMouseDown={isTree ? (e) => beginDrag(entry.id, e) : undefined}
                onClick={() => { if (!swallowClick.current) onView(v); }}
                onContextMenu={(e) => { e.preventDefault(); setMover(null); setMenu({ kind, id: entry.id, x: e.clientX, y: e.clientY }); }}
              >
                {isTree && (
                  <span
                    onClick={kids ? (e) => { e.stopPropagation(); setOpen(entry.id, !unfolded); } : undefined}
                    onMouseDown={kids ? (e) => e.stopPropagation() : undefined}
                    title={kids ? (unfolded ? 'Fold' : 'Unfold') : undefined}
                    style={{ width: 16, height: 18, flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: -6, borderRadius: 4, color: 'var(--text-muted)', cursor: kids ? 'pointer' : 'inherit' }}
                  >
                    {kids && <Icon path={unfolded ? mdiChevronDown : mdiChevronRight} size={15} />}
                  </span>
                )}
                {isTree ? <Icon path={mdiBookOutline} size={16} /> : <Icon path={mdiPound} size={16} />}
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.name}</span>
                {count(entry.count)}
              </button>
              {after}
            </Fragment>
          );
        })}
        {creating && !creating.parent && field(0)}
        {list.length === 0 && !creating && (
          <div style={{ padding: '8px 10px', fontSize: 12, color: 'var(--text-muted)' }}>
            {isTree ? 'No notebooks yet. Create one with + or type /notebook in a note.' : 'No tags yet. Create one with + or type /tag in a note.'}
          </div>
        )}
      </>
    );
  };

  // "Move to…": every notebook as a tree; the notebook itself and those inside it cannot be picked.
  const moverPopover = () => {
    if (!mover) return null;
    const entry = notebooks.find((n) => n.id === mover.id);
    if (!entry) return null;
    const banned = subtree(mover.id);
    const current = entry.parent ?? null;
    const row = (id: string | null, label: string, icon: string, depth: number, disabled: boolean) => (
      <button
        key={id ?? 'top'}
        type="button"
        disabled={disabled}
        style={{ ...rowStyle(false), paddingLeft: 10 + depth * INDENT, opacity: disabled ? 0.4 : 1, cursor: disabled ? 'default' : 'pointer' }}
        onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.backgroundColor = 'var(--bg-surface-highest)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
        onClick={() => {
          setMover(null);
          if (id === current) return;
          onMove?.(mover.id, id);
          if (id) setOpen(id, true);
        }}
      >
        <Icon path={icon} size={16} />
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        {id === current && <Icon path={mdiCheck} size={16} style={{ color: 'var(--primary)' }} />}
      </button>
    );
    return (
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{ ...popoverStyle, position: 'fixed', top: Math.max(8, Math.min(mover.y, window.innerHeight - 420)), left: Math.min(mover.x, window.innerWidth - 268), zIndex: 10000, minWidth: 240, maxWidth: 320, maxHeight: 420, overflowY: 'auto', padding: 4 }}
      >
        <div style={{ padding: '4px 10px 2px', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.03em', textTransform: 'uppercase', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Move “{entry.name}” to</div>
        {row(null, 'Top level', mdiArrowUp, 0, false)}
        {notebooks.map((n) => row(n.id, n.name, mdiBookOutline, n.depth ?? 0, banned.has(n.id)))}
      </div>
    );
  };

  if (compact) {
    // Icons only: the main views, then Notebooks / Tags (they open the full column) and Tree.
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', padding: '8px 0', gap: 4 }}>
        {home.map((item) => (
          <IconBtn key={item.label} icon={item.icon} size={20} title={`${item.label} (${item.n})`} active={isView(item.view)} onClick={() => onView(item.view)} />
        ))}
        <div style={{ width: 24, height: 1, backgroundColor: 'var(--border)', margin: '4px 0' }} />
        <IconBtn icon={mdiBookOutline} size={20} title="Notebooks" active={view.kind === 'notebook'} onClick={() => { setTab('notebooks'); onExpand?.('notebooks'); }} />
        <IconBtn icon={mdiPound} size={20} title="Tags" active={view.kind === 'tag'} onClick={() => { setTab('tags'); onExpand?.('tags'); }} />
        <IconBtn icon={mdiFileTreeOutline} size={20} title="Links tree" active={view.kind === 'tree'} onClick={() => onView({ kind: 'tree' })} />
        <div style={{ flex: 1 }} />
        {onSettings && <IconBtn icon={mdiCogOutline} size={20} title="Settings (Ctrl+,)" onClick={onSettings} />}
        <IconBtn icon={mdiChevronDoubleRight} size={20} title="Show names" onClick={() => onExpand?.()} />
        {onHide && <IconBtn icon={mdiChevronDoubleLeft} size={20} title="Hide navigation" onClick={onHide} />}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 8, gap: 2 }}>
      <div ref={header} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 8 }}>
        <IconBtn icon={mdiHomeOutline} title="Home" active={tab === 'home'} onClick={() => setTab('home')} />
        <IconBtn icon={mdiBookOutline} title="Notebooks" active={tab === 'notebooks'} onClick={() => setTab('notebooks')} />
        <IconBtn icon={mdiPound} title="Tags" active={tab === 'tags'} onClick={() => setTab('tags')} />
        <IconBtn icon={mdiFileTreeOutline} title="Links tree (notes and the notes they link to)" active={view.kind === 'tree'} onClick={() => onView({ kind: 'tree' })} />
        <div data-spacer="" style={{ flex: 1 }} />
        {tab !== 'home' && <IconBtn icon={mdiPlus} title={tab === 'notebooks' ? 'New notebook' : 'New tag'} onClick={() => { setRenaming(null); setCreating({ parent: null }); }} />}
        {onHide && <IconBtn icon={mdiChevronDoubleLeft} title="Hide navigation" onClick={onHide} />}
      </div>
      <div ref={listArea} style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {tab === 'home' && home.map((item) => (
          <button key={item.label} type="button" style={rowStyle(isView(item.view))} onClick={() => onView(item.view)}>
            <Icon path={item.icon} size={18} />
            <span style={{ flex: 1 }}>{item.label}</span>
            {count(item.n)}
          </button>
        ))}
        {tab === 'notebooks' && catalog('notebooks', notebooks)}
        {tab === 'tags' && catalog('tags', tags)}
      </div>

      {onSettings && (
        <button type="button" style={{ ...rowStyle(false), marginTop: 4 }} onClick={onSettings} title="Settings (Ctrl+,)">
          <Icon path={mdiCogOutline} size={18} />
          <span style={{ flex: 1 }}>Settings</span>
        </button>
      )}

      {menu && (
        <div onMouseDown={(e) => e.stopPropagation()} style={{ ...popoverStyle, position: 'fixed', top: Math.min(menu.y, window.innerHeight - 190), left: menu.x, zIndex: 10000, minWidth: 180, padding: 4 }}>
          {menu.kind === 'notebooks' && (
            <>
              <button type="button" style={rowStyle(false)} onClick={() => { setRenaming(null); setCreating({ parent: menu.id }); setOpen(menu.id, true); setMenu(null); }}>
                <Icon path={mdiBookPlusOutline} size={16} /> New sub-notebook
              </button>
              {onMove && (
                <button type="button" style={rowStyle(false)} onClick={() => { setMover({ id: menu.id, x: menu.x, y: menu.y }); setMenu(null); }}>
                  <Icon path={mdiFolderMoveOutline} size={16} /> Move to…
                </button>
              )}
            </>
          )}
          <button type="button" style={rowStyle(false)} onClick={() => { setCreating(null); setRenaming(menu.id); setMenu(null); }}>
            <Icon path={mdiPencilOutline} size={16} /> Rename
          </button>
          <button type="button" style={{ ...rowStyle(false), color: 'var(--error)' }} onClick={() => { onDelete(menu.kind, menu.id); setMenu(null); }}>
            <Icon path={mdiDeleteOutline} size={16} /> Delete
          </button>
        </div>
      )}
      {moverPopover()}
      {drag && (
        <div style={{ position: 'fixed', left: drag.x + 12, top: drag.y + 8, zIndex: 10001, pointerEvents: 'none', padding: '4px 8px', borderRadius: 6, fontSize: 12, backgroundColor: 'var(--bg-surface-highest)', border: '1px solid var(--border-focus)', color: 'var(--text-main)', whiteSpace: 'nowrap' }}>
          {notebooks.find((n) => n.id === drag.id)?.name}
        </div>
      )}
    </div>
  );
}
