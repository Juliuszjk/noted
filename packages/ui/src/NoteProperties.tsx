import { useState } from 'react';
import type { ReactNode } from 'react';
import {
  mdiPin, mdiStarOutline, mdiLockOutline, mdiPencilOffOutline, mdiArchiveOutline, mdiSpellcheck, mdiBookOutline, mdiPound,
  mdiClose, mdiPlus, mdiTrashCanOutline, mdiHistory, mdiRestore, mdiDeleteForeverOutline, mdiVectorLink, mdiFormatFont, mdiDockTop, mdiTableCog, mdiDraw, mdiExportVariant, mdiWeb,
  mdiChevronDown, mdiChevronRight, mdiPaperclip, mdiImageOutline, mdiOpenInNew, mdiDownload, mdiCrosshairsGps,
} from '@mdi/js';
import { Icon } from './Icon';
import { formatDateTime } from './format-date';
import { relativeTime } from './note-list';

export interface PropertyFlags {
  pinned: boolean;
  // Body sealed with the vault (locked notes).
  locked: boolean;
  favorite: boolean;
  readOnly: boolean;
  archived: boolean;
  spellcheck: boolean;
}

export interface HistoryEntry {
  id: string;
  startedAt: number;
  endedAt: number;
}

export interface AttachmentEntry {
  kind: 'file' | 'image';
  blob: string;
  name: string;
  size: number | null;
}

interface Props {
  // Panel width in px (the app lets the user drag it).
  width?: number;
  flags: PropertyFlags;
  onFlag: (flag: keyof PropertyFlags, on: boolean) => void;
  font: 'sans' | 'serif' | 'mono';
  onFont: (font: 'sans' | 'serif' | 'mono') => void;
  created: number | null;
  edited: number;
  notebooks: { id: string; name: string }[];
  tags: { id: string; name: string }[];
  // Opens the notebook / tag picker at a screen position.
  onPick: (kind: 'notebooks' | 'tags', x: number, y: number) => void;
  onRemoveNotebook: (id: string) => void;
  onRemoveTag: (id: string) => void;
  links: { id: string; title: string }[];
  backlinks: { id: string; title: string }[];
  onOpenNote: (id: string) => void;
  // Files and images in the note.
  attachments: AttachmentEntry[];
  onOpenAttachment: (a: AttachmentEntry) => void;
  onSaveAttachment: (a: AttachmentEntry) => void;
  onShowAttachment: (a: AttachmentEntry) => void;
  history: HistoryEntry[];
  onOpenHistory: (entry: HistoryEntry) => void;
  toolbar: 'top' | 'floating';
  onToolbar: (mode: 'top' | 'floating') => void;
  tableMenu?: 'floating' | 'toolbar';
  onTableMenu?: (mode: 'floating' | 'toolbar') => void;
  drawingMenu?: 'floating' | 'toolbar';
  onDrawingMenu?: (mode: 'floating' | 'toolbar') => void;
  trashed: boolean;
  // Opens the export dialog (Markdown, plain text, PDF).
  onExport: () => void;
  // Opens the publish dialog; `published` = a public copy exists.
  published: boolean;
  // Absent on a device without a server (nowhere to publish to).
  onPublish?: () => void;
  onTrash: () => void;
  onRestore: () => void;
  onDeleteForever: () => void;
  onClose: () => void;
}

const heading = { padding: '14px 14px 6px', fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', color: 'var(--text-muted)', textTransform: 'uppercase' } as const;
const rowBase = { display: 'flex', alignItems: 'center', gap: 10, padding: '7px 14px', fontSize: 13 } as const;
const sep = { height: 1, backgroundColor: 'var(--border)', margin: '6px 0' } as const;

function Switch({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      style={{ position: 'relative', width: 36, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer', padding: 0, backgroundColor: on ? 'var(--primary)' : 'var(--bg-surface-highest)' }}
    >
      <span style={{ position: 'absolute', top: 2, left: on ? 18 : 2, width: 16, height: 16, borderRadius: 8, transition: 'left 0.15s', backgroundColor: on ? 'var(--primary-fg)' : 'var(--text-muted)' }} />
    </button>
  );
}

function Chip({ icon, label, onRemove }: { icon: string; label: string; onRemove: () => void }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 6px 3px 8px', borderRadius: 8, fontSize: 12, backgroundColor: 'var(--secondary-container)', color: 'var(--on-secondary-container)' }}>
      <Icon path={icon} size={13} /> {label}
      <button type="button" title="Remove" onClick={onRemove} style={{ display: 'flex', border: 'none', background: 'transparent', color: 'inherit', padding: 0, cursor: 'pointer' }}>
        <Icon path={mdiClose} size={13} />
      </button>
    </span>
  );
}

const linkRow = (note: { id: string; title: string }, onOpen: (id: string) => void): ReactNode => (
  <button
    key={note.id}
    type="button"
    onClick={() => onOpen(note.id)}
    style={{ ...rowBase, width: '100%', border: 'none', background: 'transparent', color: 'var(--primary)', cursor: 'pointer', textAlign: 'left' }}
  >
    ↗ {note.title}
  </button>
);

const formatSize = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

type SectionId = 'links' | 'attachments' | 'history';
const SECTIONS_KEY = 'noted_properties_sections';
// Open / closed sections, per device. History starts closed (it gets long).
const readSections = (): Record<SectionId, boolean> => {
  const fallback = { links: true, attachments: true, history: false };
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(SECTIONS_KEY) ?? '{}') };
  } catch {
    return fallback;
  }
};

// A heading that folds its section.
function SectionHead({ open, onToggle, icon, label }: { open: boolean; onToggle: () => void; icon: string; label: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={open ? 'Fold' : 'Unfold'}
      style={{ ...rowBase, gap: 6, paddingTop: 10, width: '100%', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', textAlign: 'left' }}
    >
      <Icon path={open ? mdiChevronDown : mdiChevronRight} size={16} />
      <Icon path={icon} size={15} />
      {label}
    </button>
  );
}

const iconBtn = { display: 'flex', border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', padding: 4, borderRadius: 6 } as const;

// Right-hand panel with everything about the open note (opened with "⋮" in the tab bar).
export function NoteProperties(p: Props) {
  const [linkTab, setLinkTab] = useState<'links' | 'backlinks'>('backlinks');
  const [sections, setSections] = useState(readSections);
  const toggle = (id: SectionId) => setSections((prev) => {
    const next = { ...prev, [id]: !prev[id] };
    try { localStorage.setItem(SECTIONS_KEY, JSON.stringify(next)); } catch { /* not stored */ }
    return next;
  });
  const toggles: { key: keyof PropertyFlags; icon: string; label: string }[] = [
    { key: 'pinned', icon: mdiPin, label: 'Pin' },
    { key: 'favorite', icon: mdiStarOutline, label: 'Favorite' },
    { key: 'locked', icon: mdiLockOutline, label: 'Lock' },
    { key: 'readOnly', icon: mdiPencilOffOutline, label: 'Read only' },
    { key: 'archived', icon: mdiArchiveOutline, label: 'Archive' },
    { key: 'spellcheck', icon: mdiSpellcheck, label: 'Spell check' },
  ];
  const linkList = linkTab === 'links' ? p.links : p.backlinks;

  return (
    <div style={{ width: p.width ?? 300, flex: '0 0 auto', overflowY: 'auto', borderLeft: '1px solid var(--border)', backgroundColor: 'var(--bg-surface-low)' }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '8px 8px 0 14px' }}>
        <span style={{ flex: 1, ...heading, padding: 0 }}>Properties</span>
        <button type="button" title="Close" onClick={p.onClose} style={{ display: 'flex', border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', padding: 6 }}>
          <Icon path={mdiClose} size={18} />
        </button>
      </div>
      {toggles.map((t) => (
        <div key={t.key} style={rowBase}>
          <Icon path={t.icon} size={16} style={{ color: 'var(--text-muted)' }} />
          <span style={{ flex: 1 }}>{t.label}</span>
          <Switch on={p.flags[t.key]} onChange={(on) => p.onFlag(t.key, on)} />
        </div>
      ))}
      <div style={rowBase}>
        <Icon path={mdiFormatFont} size={16} style={{ color: 'var(--text-muted)' }} />
        <span style={{ flex: 1 }}>Font</span>
        {(['sans', 'serif', 'mono'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => p.onFont(f)}
            style={{
              padding: '3px 8px', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontFamily: `var(--font-${f})`,
              backgroundColor: p.font === f ? 'var(--secondary-container)' : 'transparent',
              color: p.font === f ? 'var(--on-secondary-container)' : 'var(--text-main)',
            }}
          >
            {f[0].toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>
      <div style={{ ...rowBase, color: 'var(--text-muted)' }}><span style={{ flex: 1 }}>Created at</span>{p.created ? formatDateTime(p.created) : '—'}</div>
      <div style={{ ...rowBase, color: 'var(--text-muted)' }}><span style={{ flex: 1 }}>Last edited at</span>{formatDateTime(p.edited)}</div>

      <div style={sep} />
      <div style={heading}>Notebooks</div>
      <div style={{ ...rowBase, flexWrap: 'wrap', gap: 6 }}>
        {p.notebooks.map((n) => <Chip key={n.id} icon={mdiBookOutline} label={n.name} onRemove={() => p.onRemoveNotebook(n.id)} />)}
        <button type="button" onClick={(e) => p.onPick('notebooks', e.clientX, e.clientY)} style={{ display: 'flex', alignItems: 'center', gap: 4, border: 'none', background: 'transparent', color: 'var(--primary)', cursor: 'pointer', fontSize: 12 }}>
          <Icon path={mdiPlus} size={14} /> Add to notebook
        </button>
      </div>
      <div style={heading}>Tags</div>
      <div style={{ ...rowBase, flexWrap: 'wrap', gap: 6 }}>
        {p.tags.map((t) => <Chip key={t.id} icon={mdiPound} label={t.name} onRemove={() => p.onRemoveTag(t.id)} />)}
        <button type="button" onClick={(e) => p.onPick('tags', e.clientX, e.clientY)} style={{ display: 'flex', alignItems: 'center', gap: 4, border: 'none', background: 'transparent', color: 'var(--primary)', cursor: 'pointer', fontSize: 12 }}>
          <Icon path={mdiPlus} size={14} /> Add tag
        </button>
      </div>

      <div style={sep} />
      <SectionHead open={sections.links} onToggle={() => toggle('links')} icon={mdiVectorLink} label={`Links (${p.backlinks.length + p.links.length})`} />
      {sections.links && (
        <>
          <div style={{ ...rowBase, gap: 6, paddingTop: 2 }}>
            {(['backlinks', 'links'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setLinkTab(tab)}
                style={{ padding: '3px 8px', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, backgroundColor: linkTab === tab ? 'var(--secondary-container)' : 'transparent', color: linkTab === tab ? 'var(--on-secondary-container)' : 'var(--text-main)' }}
              >
                {tab === 'backlinks' ? `Linked from (${p.backlinks.length})` : `Links to (${p.links.length})`}
              </button>
            ))}
          </div>
          {linkList.length === 0
            ? <div style={{ ...rowBase, color: 'var(--text-muted)' }}>{linkTab === 'backlinks' ? 'No note links here.' : 'This note links to no other note.'}</div>
            : linkList.map((n) => linkRow(n, p.onOpenNote))}
        </>
      )}

      <SectionHead open={sections.attachments} onToggle={() => toggle('attachments')} icon={mdiPaperclip} label={`Attachments (${p.attachments.length})`} />
      {sections.attachments && (
        p.attachments.length === 0
          ? <div style={{ ...rowBase, color: 'var(--text-muted)' }}>No files or images in this note.</div>
          : p.attachments.map((a, i) => (
            <div key={`${a.blob}-${i}`} style={{ ...rowBase, gap: 6, paddingTop: 4, paddingBottom: 4 }}>
              <Icon path={a.kind === 'image' ? mdiImageOutline : mdiPaperclip} size={16} style={{ color: 'var(--text-muted)', flex: '0 0 auto' }} />
              <span title={a.name} style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
              {a.size !== null && <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{formatSize(a.size)}</span>}
              <button type="button" title="Show in the note" onClick={() => p.onShowAttachment(a)} style={iconBtn}><Icon path={mdiCrosshairsGps} size={15} /></button>
              {a.kind === 'file' && <button type="button" title="Open" onClick={() => p.onOpenAttachment(a)} style={iconBtn}><Icon path={mdiOpenInNew} size={15} /></button>}
              <button type="button" title="Save" onClick={() => p.onSaveAttachment(a)} style={iconBtn}><Icon path={mdiDownload} size={15} /></button>
            </div>
          ))
      )}

      <div style={sep} />
      <button
        type="button"
        onClick={p.onExport}
        style={{ ...rowBase, width: '100%', border: 'none', background: 'transparent', color: 'var(--text-main)', cursor: 'pointer', textAlign: 'left' }}
        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-surface-high)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
      >
        <Icon path={mdiExportVariant} size={16} style={{ color: 'var(--text-muted)' }} />
        <span style={{ flex: 1 }}>Export…</span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Markdown, text, PDF</span>
      </button>
      {p.onPublish && (
        <button
          type="button"
          onClick={p.onPublish}
          style={{ ...rowBase, width: '100%', border: 'none', background: 'transparent', color: 'var(--text-main)', cursor: 'pointer', textAlign: 'left' }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-surface-high)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
        >
          <Icon path={mdiWeb} size={16} style={{ color: p.published ? 'var(--primary)' : 'var(--text-muted)' }} />
          <span style={{ flex: 1 }}>Publish…</span>
          <span style={{ fontSize: 11, color: p.published ? 'var(--primary)' : 'var(--text-muted)' }}>{p.published ? 'Published' : 'Public link'}</span>
        </button>
      )}
      <div style={rowBase}>
        <Icon path={mdiDockTop} size={16} style={{ color: 'var(--text-muted)' }} />
        <span style={{ flex: 1 }}>Toolbar at the top</span>
        <Switch on={p.toolbar === 'top'} onChange={(on) => p.onToolbar(on ? 'top' : 'floating')} />
      </div>
      {p.onTableMenu && (
        <div style={rowBase}>
          <Icon path={mdiTableCog} size={16} style={{ color: 'var(--text-muted)' }} />
          <span style={{ flex: 1 }}>Table menu at the top</span>
          <Switch on={p.tableMenu === 'toolbar'} onChange={(on) => p.onTableMenu?.(on ? 'toolbar' : 'floating')} />
        </div>
      )}
      {p.onDrawingMenu && (
        <div style={rowBase}>
          <Icon path={mdiDraw} size={16} style={{ color: 'var(--text-muted)' }} />
          <span style={{ flex: 1 }}>Drawing menu at the top</span>
          <Switch on={p.drawingMenu === 'toolbar'} onChange={(on) => p.onDrawingMenu?.(on ? 'toolbar' : 'floating')} />
        </div>
      )}
      {p.trashed ? (
        <>
          <button type="button" onClick={p.onRestore} style={{ ...rowBase, width: '100%', border: 'none', background: 'transparent', color: 'var(--text-main)', cursor: 'pointer', marginTop: 6 }}>
            <Icon path={mdiRestore} size={16} /> Restore from trash
          </button>
          <button type="button" onClick={p.onDeleteForever} style={{ ...rowBase, width: '100%', border: 'none', background: 'transparent', color: 'var(--error)', cursor: 'pointer', marginBottom: 16 }}>
            <Icon path={mdiDeleteForeverOutline} size={16} /> Delete forever
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={p.onTrash}
          style={{ ...rowBase, width: '100%', border: 'none', background: 'transparent', color: 'var(--error)', cursor: 'pointer', margin: '6px 0 16px' }}
        >
          <Icon path={mdiTrashCanOutline} size={16} /> Move to trash
        </button>
      )}
      <div style={sep} />
      <SectionHead open={sections.history} onToggle={() => toggle('history')} icon={mdiHistory} label={`Note history (${p.history.length})`} />
      {sections.history && (
        <>
          <div style={{ padding: '0 14px 6px', fontSize: 11, color: 'var(--text-muted)' }}>
            The note as it was at the end of earlier editing sessions (a session starts when the note is opened). Kept on this device only.
          </div>
          {p.history.length === 0 && <div style={{ ...rowBase, color: 'var(--text-muted)' }}>No versions yet.</div>}
          {p.history.map((h) => (
            <button
              key={h.id}
              type="button"
              onClick={() => p.onOpenHistory(h)}
              style={{ ...rowBase, width: '100%', border: 'none', background: 'transparent', color: 'var(--text-main)', cursor: 'pointer', textAlign: 'left' }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-surface-high)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              <Icon path={mdiHistory} size={16} style={{ color: 'var(--text-muted)' }} />
              <span style={{ flex: 1 }}>{formatDateTime(h.startedAt)} — {formatDateTime(h.endedAt).slice(11)}</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{relativeTime(h.endedAt, Date.now()) === 'now' ? 'just now' : `${relativeTime(h.endedAt, Date.now())} ago`}</span>
            </button>
          ))}
          <div style={{ height: 16 }} />
        </>
      )}
    </div>
  );
}
