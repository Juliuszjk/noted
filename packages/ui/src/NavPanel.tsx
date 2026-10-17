import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  mdiHomeOutline, mdiBookOutline, mdiPound, mdiNoteTextOutline, mdiStarOutline, mdiTrashCanOutline, mdiWeb,
  mdiArchiveOutline, mdiPlus, mdiPencilOutline, mdiDeleteOutline, mdiChevronDoubleLeft, mdiChevronDoubleRight, mdiFileTreeOutline, mdiCogOutline,
} from '@mdi/js';
import { Icon } from './Icon';
import { IconBtn, popoverStyle } from './menu-parts';
import type { NoteView } from './note-list';

export interface NavEntry {
  id: string;
  name: string;
  count: number;
}

interface Props {
  view: NoteView;
  onView: (view: NoteView) => void;
  counts: { notes: number; favorites: number; trash: number; archive: number; published?: number };
  notebooks: NavEntry[];
  tags: NavEntry[];
  onCreate: (kind: 'notebooks' | 'tags', name: string) => void;
  onRename: (kind: 'notebooks' | 'tags', id: string, name: string) => void;
  onDelete: (kind: 'notebooks' | 'tags', id: string) => void;
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

function NameInput({ initial, placeholder, onDone }: { initial: string; placeholder: string; onDone: (name: string | null) => void }) {
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
      style={{ width: '100%', padding: '6px 10px', fontSize: 13, color: 'var(--text-main)', background: 'var(--bg-surface)', border: '1px solid var(--primary)', borderRadius: 8, outline: 'none' }}
    />
  );
}

// Left navigation: Home (Notes, Favorites, Trash, Archive), Notebooks and Tags, with counts.
export function NavPanel({ view, onView, counts, notebooks, tags, onCreate, onRename, onDelete, onHide, compact, onExpand, onMinWidth, onSettings }: Props) {
  const [tab, setTab] = useState<Tab>(view.kind === 'notebook' ? 'notebooks' : view.kind === 'tag' ? 'tags' : 'home');
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ kind: 'notebooks' | 'tags'; id: string; x: number; y: number } | null>(null);
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
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menu]);

  const isView = (v: NoteView) => v.kind === view.kind && ('id' in v ? 'id' in view && view.id === v.id : true);
  const count = (n: number) => <span style={{ fontSize: 11, opacity: 0.7 }}>{n}</span>;

  const home: { view: NoteView; icon: string; label: string; n: number }[] = [
    { view: { kind: 'notes' }, icon: mdiNoteTextOutline, label: 'Notes', n: counts.notes },
    { view: { kind: 'favorites' }, icon: mdiStarOutline, label: 'Favorites', n: counts.favorites },
    { view: { kind: 'trash' }, icon: mdiTrashCanOutline, label: 'Trash', n: counts.trash },
    { view: { kind: 'archive' }, icon: mdiArchiveOutline, label: 'Archive', n: counts.archive },
    // Notes published to the web (only shown once there is one).
    ...(counts.published ? [{ view: { kind: 'published' } as NoteView, icon: mdiWeb, label: 'Published', n: counts.published }] : []),
  ];

  const catalog = (kind: 'notebooks' | 'tags', list: NavEntry[]) => (
    <>
      {list.map((entry) => {
        const v: NoteView = { kind: kind === 'notebooks' ? 'notebook' : 'tag', id: entry.id };
        if (renaming === entry.id) {
          return <NameInput key={entry.id} initial={entry.name} placeholder="Name" onDone={(name) => { if (name) onRename(kind, entry.id, name); setRenaming(null); }} />;
        }
        return (
          <button
            key={entry.id}
            type="button"
            style={rowStyle(isView(v))}
            onClick={() => onView(v)}
            onContextMenu={(e) => { e.preventDefault(); setMenu({ kind, id: entry.id, x: e.clientX, y: e.clientY }); }}
          >
            {kind === 'notebooks' ? <Icon path={mdiBookOutline} size={16} /> : <Icon path={mdiPound} size={16} />}
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.name}</span>
            {count(entry.count)}
          </button>
        );
      })}
      {creating && (
        <NameInput initial="" placeholder={kind === 'notebooks' ? 'Notebook name' : 'Tag name'} onDone={(name) => { if (name) onCreate(kind, name); setCreating(false); }} />
      )}
      {list.length === 0 && !creating && (
        <div style={{ padding: '8px 10px', fontSize: 12, color: 'var(--text-muted)' }}>
          {kind === 'notebooks' ? 'No notebooks yet. Create one with + or type /notebook in a note.' : 'No tags yet. Create one with + or type /tag in a note.'}
        </div>
      )}
    </>
  );

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
        {tab !== 'home' && <IconBtn icon={mdiPlus} title={tab === 'notebooks' ? 'New notebook' : 'New tag'} onClick={() => setCreating(true)} />}
        {onHide && <IconBtn icon={mdiChevronDoubleLeft} title="Hide navigation" onClick={onHide} />}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
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
        <div onMouseDown={(e) => e.stopPropagation()} style={{ ...popoverStyle, position: 'fixed', top: menu.y, left: menu.x, zIndex: 10000, minWidth: 150, padding: 4 }}>
          <button type="button" style={rowStyle(false)} onClick={() => { setRenaming(menu.id); setMenu(null); }}>
            <Icon path={mdiPencilOutline} size={16} /> Rename
          </button>
          <button type="button" style={{ ...rowStyle(false), color: 'var(--error)' }} onClick={() => { onDelete(menu.kind, menu.id); setMenu(null); }}>
            <Icon path={mdiDeleteOutline} size={16} /> Delete
          </button>
        </div>
      )}
    </div>
  );
}
