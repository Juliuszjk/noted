import { useEffect, useState } from 'react';
import { mdiClose, mdiContentCopy, mdiOpenInNew } from '@mdi/js';
import { Icon } from './Icon';
import { PasswordInput } from './PasswordInput';
import { Select } from './Select';
import { popoverStyle } from './menu-parts';
import { formatDateTime } from './format-date';

export interface PublishSettings {
  password: string | null;
  selfDestruct: boolean;
  autoUpdate: boolean;
  // When the link stops working (ms); null = never.
  expiresAt: number | null;
  // Live (sync/live.ts): the link shows the note itself, changes appear at once; with
  // `editable` readers may edit the title and the text too.
  live?: boolean;
  editable?: boolean;
}

const HOUR = 60 * 60 * 1000;
const EXPIRY: [string, string, number | null][] = [
  ['never', 'Never', null], ['1h', 'In 1 hour', HOUR], ['1d', 'In 1 day', 24 * HOUR], ['7d', 'In 7 days', 7 * 24 * HOUR], ['30d', 'In 30 days', 30 * 24 * HOUR],
];

const box = { border: '1px solid var(--border)', borderRadius: 8, padding: '4px 12px', margin: '12px 0' } as const;
const row = { display: 'flex', alignItems: 'center', gap: 12, minHeight: 38, fontSize: 14 } as const;
const value = { marginLeft: 'auto', color: 'var(--text-muted)', fontSize: 13 } as const;
const wideButton = (primary: boolean, danger = false) => ({
  flex: 1, padding: '9px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 14, textAlign: 'left' as const,
  border: `1px solid ${danger ? 'var(--error)' : 'var(--border)'}`,
  backgroundColor: primary ? 'var(--bg-surface-high)' : 'transparent',
  color: danger ? 'var(--error)' : 'var(--primary)',
});

function Switch({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      style={{ position: 'relative', width: 40, height: 22, marginLeft: 'auto', borderRadius: 11, border: 'none', cursor: 'pointer', padding: 0, backgroundColor: on ? 'var(--primary)' : 'var(--bg-surface-highest)' }}
    >
      <span style={{ position: 'absolute', top: 3, left: on ? 21 : 3, width: 16, height: 16, borderRadius: 8, transition: 'left 0.15s', backgroundColor: on ? 'var(--primary-fg)' : 'var(--text-muted)' }} />
    </button>
  );
}

// "Publish to the web" (note properties "Publish…", or "/publish"), laid out like Notesnook's:
// the title, self destruct, password, then Publish. Once published: the link, Update and
// Unpublish.
export function PublishDialog({ title, url, publishedAt, initial, onPublish, onUnpublish, onAutoUpdate, onOpenLink, onClose }: {
  title: string;
  // Link of the published copy, null when the note is not published.
  url: string | null;
  publishedAt: number | null;
  initial: PublishSettings;
  onPublish: (settings: PublishSettings) => Promise<void>;
  onUnpublish: () => Promise<void>;
  // Published already: "Update automatically" takes effect at once (only the note changes).
  onAutoUpdate?: (on: boolean) => void;
  onOpenLink?: (href: string) => void;
  onClose: () => void;
}) {
  const [settings, setSettings] = useState<PublishSettings>(initial);
  const [editingPassword, setEditingPassword] = useState(false);
  const [busy, setBusy] = useState<'publish' | 'unpublish' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const run = async (kind: 'publish' | 'unpublish') => {
    setBusy(kind);
    setError(null);
    try {
      await (kind === 'publish' ? onPublish(settings) : onUnpublish());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div onMouseDown={onClose} style={{ position: 'fixed', inset: 0, zIndex: 30000, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)' }}>
      <div onMouseDown={(e) => e.stopPropagation()} style={{ ...popoverStyle, position: 'relative', top: 'auto', left: 'auto', width: 420, padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <span style={{ flex: 1, fontSize: 17, fontWeight: 700 }}>Publish to the web</span>
          <button type="button" title="Close" onClick={onClose} style={{ display: 'flex', border: 'none', background: 'transparent', color: 'var(--text-main)', cursor: 'pointer' }}>
            <Icon path={mdiClose} size={18} />
          </button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
          {settings.live
            ? (settings.editable ? 'Live: anyone with the link can read and edit the title and the text with you.' : 'Live: anyone with the link sees the note and your edits at once.')
            : url ? (settings.autoUpdate ? 'This note is published and follows your edits.' : 'This note is published. Edits appear after Update.') : 'This note will be published to a public URL.'}
        </div>

        {url && (
          <div style={{ ...box, display: 'flex', alignItems: 'center', gap: 6, padding: '6px 6px 6px 12px' }}>
            <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontFamily: 'monospace', color: 'var(--primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={url}>{url}</span>
            <button type="button" title={copied ? 'Copied' : 'Copy link'} style={{ display: 'flex', padding: 6, border: 'none', borderRadius: 6, background: 'transparent', color: 'var(--text-main)', cursor: 'pointer' }} onClick={() => {
              navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }, () => setError('Copying failed'));
            }}>
              <Icon path={mdiContentCopy} size={16} />
            </button>
            {onOpenLink && (
              <button type="button" title={settings.selfDestruct ? 'Opening it uses up the only view' : 'Open in the browser'} style={{ display: 'flex', padding: 6, border: 'none', borderRadius: 6, background: 'transparent', color: 'var(--text-main)', cursor: 'pointer' }} onClick={() => onOpenLink(url)}>
                <Icon path={mdiOpenInNew} size={16} />
              </button>
            )}
          </div>
        )}

        <div style={box}>
          <div style={row}>
            <span>Title</span>
            <span style={{ ...value, maxWidth: 230, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title || 'Untitled'}</span>
          </div>
          <div style={row} title="The note is deleted from the server after it was opened once">
            <span>Self destruct</span>
            <Switch on={settings.selfDestruct} onChange={(on) => setSettings((st) => ({ ...st, selfDestruct: on, autoUpdate: on ? false : st.autoUpdate, live: on ? false : st.live, editable: on ? false : st.editable }))} />
          </div>
          <div style={row} title="Readers see the note itself, and every change at once (yours and theirs)">
            <span>Live</span>
            <Switch on={!!settings.live} onChange={(on) => setSettings((st) => ({ ...st, live: on, editable: on ? st.editable : false, selfDestruct: on ? false : st.selfDestruct, autoUpdate: on ? false : st.autoUpdate }))} />
          </div>
          {settings.live && (
            <div style={row} title="Anyone with the link (and the password) can edit the title and the text; notebooks, tags and the other settings stay yours">
              <span>Allow editing</span>
              <Switch on={!!settings.editable} onChange={(on) => setSettings((st) => ({ ...st, editable: on }))} />
            </div>
          )}
          {!settings.live && <div style={{ ...row, opacity: settings.selfDestruct ? 0.5 : 1 }} title="Edits are published by themselves a few seconds after you stop typing">
            <span>Update automatically</span>
            <Switch on={settings.autoUpdate} onChange={(on) => {
              if (settings.selfDestruct) return;
              setSettings((st) => ({ ...st, autoUpdate: on }));
              if (url) onAutoUpdate?.(on);
            }} />
          </div>}
          <div style={row} title="The server deletes the published copy at this time">
            <span>Link expires</span>
            <span style={{ marginLeft: 'auto' }}>
              <Select
                compact
                width={170}
                value={settings.expiresAt ? 'keep' : 'never'}
                options={[...(settings.expiresAt ? [['keep', formatDateTime(settings.expiresAt)] as [string, string]] : []), ...EXPIRY.map(([id, label]) => [id, label] as [string, string])]}
                onChange={(id) => {
                  const choice = EXPIRY.find(([key]) => key === id);
                  if (choice) setSettings((st) => ({ ...st, expiresAt: choice[2] === null ? null : Date.now() + choice[2] }));
                }}
              />
            </span>
          </div>
          <div style={row}>
            <span>Password protection</span>
            {editingPassword ? (
              <PasswordInput
                autoFocus
                value={settings.password ?? ''}
                placeholder="No password"
                onChange={(v) => setSettings((st) => ({ ...st, password: v || null }))}
                onBlur={() => setEditingPassword(false)}
                onKeyDown={(e) => { if (e.key === 'Enter') setEditingPassword(false); }}
                style={{ marginLeft: 'auto', width: 200, padding: '4px 8px', fontSize: 13, color: 'var(--text-main)', background: 'var(--bg-surface)', border: '1px solid var(--border-focus)', borderRadius: 6, outline: 'none' }}
              />
            ) : (
              <button type="button" onClick={() => setEditingPassword(true)} style={{ ...value, border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }}>
                {settings.password ? '•'.repeat(Math.min(10, settings.password.length)) : 'No password'}
              </button>
            )}
          </div>
        </div>

        {error && <div style={{ fontSize: 12, color: 'var(--error)', marginBottom: 8 }}>{error}</div>}
        {url && publishedAt && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>Last published {formatDateTime(publishedAt)}{initial.expiresAt !== settings.expiresAt || !!initial.live !== !!settings.live || !!initial.editable !== !!settings.editable || (initial.password ?? null) !== (settings.password ?? null) ? ' • the changes apply after Update' : ''}</div>}
        <div style={{ display: 'flex', gap: 8 }}>
          {url && (
            <button type="button" disabled={!!busy} style={wideButton(false, true)} onClick={() => run('unpublish')}>
              {busy === 'unpublish' ? 'Unpublishing…' : 'Unpublish'}
            </button>
          )}
          <button type="button" disabled={!!busy} style={wideButton(true)} onClick={() => run('publish')}>
            {busy === 'publish' ? 'Publishing…' : url ? 'Update' : 'Publish'}
          </button>
        </div>
      </div>
    </div>
  );
}
