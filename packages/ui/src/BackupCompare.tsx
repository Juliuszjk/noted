import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import * as Y from 'yjs';
import { mdiClose, mdiBackupRestore, mdiCallMerge, mdiHistory } from '@mdi/js';
import type { BackupDiff, BackupDiffStatus, RestoreMode } from '@noted/sync';
import { HistoryPreview } from './HistoryPreview';
import { Icon } from './Icon';
import { formatDateTime } from './format-date';

// A backup next to the notes now (Settings > Backup & export): the notes that differ, each one
// shown like a history version (backup on the left, the note now with the changes on the
// right), restored or merged one by one, or all at once, or everything returned to the backup.

const STATUS: Record<BackupDiffStatus, { label: string; color: string }> = {
  changed: { label: 'Changed since', color: 'var(--primary)' },
  missing: { label: 'Not here any more', color: 'var(--error)' },
  trashed: { label: 'In the trash now', color: 'var(--error)' },
  new: { label: 'New since the backup', color: '#3fb950' },
};

const btn = (kind: 'plain' | 'primary' | 'danger' = 'plain') => ({
  display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 16, cursor: 'pointer', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' as const,
  border: kind === 'plain' ? '1px solid var(--border)' : 'none',
  backgroundColor: kind === 'primary' ? 'var(--primary)' : kind === 'danger' ? 'var(--error)' : 'transparent',
  color: kind === 'primary' ? 'var(--primary-fg)' : kind === 'danger' ? 'var(--bg-base)' : 'var(--text-main)',
});

const docOf = (state: Uint8Array | null) => {
  const doc = new Y.Doc();
  if (state) Y.applyUpdate(doc, state);
  return doc;
};

export function BackupCompare({ name, createdAt, load, titles, onRestoreNote, onRestoreAll, onClose }: {
  name: string;
  createdAt: number;
  load: () => Promise<BackupDiff[]>;
  titles: Record<string, string>;
  onRestoreNote: (id: string, mode: 'merge' | 'replace') => Promise<void>;
  // Resolves to a summary.
  onRestoreAll: (mode: RestoreMode) => Promise<string>;
  onClose: () => void;
}) {
  const [diffs, setDiffs] = useState<BackupDiff[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmRollback, setConfirmRollback] = useState(false);
  const reload = async () => {
    const next = await load();
    setDiffs(next);
    setSelected((s) => (s && next.some((d) => d.id === s) ? s : next[0]?.id ?? null));
  };
  useEffect(() => { reload().catch((e) => setMessage(String(e))); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  const diff = diffs?.find((d) => d.id === selected) ?? null;
  const backupDoc = useMemo(() => (diff ? docOf(diff.backup) : null), [diff]);
  const currentDoc = useMemo(() => (diff ? docOf(diff.current) : null), [diff]);
  const run = async (work: () => Promise<string | null | void>) => {
    setBusy(true);
    setMessage(null);
    try {
      const text = await work();
      if (text) setMessage(text);
      await reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const newCount = diffs?.filter((d) => d.status === 'new').length ?? 0;
  const when = formatDateTime(createdAt);

  const noteActions = (d: BackupDiff): ReactNode => {
    if (d.status === 'new') {
      return <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Made after the backup. "Return everything" would move it to the trash.</span>;
    }
    return (
      <>
        <button type="button" disabled={busy} style={btn('primary')} onClick={() => run(() => onRestoreNote(d.id, 'replace'))}>
          <Icon path={mdiBackupRestore} size={16} /> {d.status === 'missing' ? 'Bring it back' : 'Restore as in the backup'}
        </button>
        {d.status !== 'missing' && (
          <button type="button" disabled={busy} style={btn()} title="Keeps the note as it is now and adds the blocks (paragraphs, images…) removed since the backup" onClick={() => run(() => onRestoreNote(d.id, 'merge'))}>
            <Icon path={mdiCallMerge} size={16} /> Merge both
          </button>
        )}
      </>
    );
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 32000, display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-base)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
        <Icon path={mdiHistory} size={20} style={{ color: 'var(--primary)' }} />
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Backup from {when}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {name} • {diffs === null ? 'Comparing…' : diffs.length ? `${diffs.length} ${diffs.length === 1 ? 'note differs' : 'notes differ'} from now` : 'Your notes are the same as in the backup'}
          </div>
        </div>
        <button type="button" disabled={busy || !diffs?.length} style={btn()} title="Every note keeps its later changes and gets back the blocks removed since; missing notes come back" onClick={() => run(() => onRestoreAll('merge'))}>
          <Icon path={mdiCallMerge} size={16} /> Merge all
        </button>
        <button type="button" disabled={busy || !diffs?.length} style={btn()} title="Notes in the backup get their content from then; notes made since stay" onClick={() => run(() => onRestoreAll('replace'))}>
          <Icon path={mdiBackupRestore} size={16} /> Restore all as in the backup
        </button>
        <button type="button" disabled={busy || !diffs?.length} style={btn('danger')} onClick={() => setConfirmRollback(true)}>
          Return everything to {when.slice(0, 10)}…
        </button>
        <button type="button" title="Close (Esc)" onClick={onClose} style={{ ...btn(), border: 'none', padding: 6 }}><Icon path={mdiClose} size={20} /></button>
      </div>
      {message && <div style={{ padding: '8px 16px', fontSize: 13, borderBottom: '1px solid var(--border)', backgroundColor: 'var(--bg-surface-high)' }}>{message}</div>}
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <div style={{ width: 320, flexShrink: 0, overflowY: 'auto', borderRight: '1px solid var(--border)', backgroundColor: 'var(--bg-surface-low)' }}>
          {diffs?.map((d) => (
            <button key={d.id} type="button" onClick={() => setSelected(d.id)} style={{
              display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', border: 'none', borderBottom: '1px solid var(--border)', cursor: 'pointer',
              backgroundColor: d.id === selected ? 'var(--secondary-container)' : 'transparent', color: d.id === selected ? 'var(--on-secondary-container)' : 'var(--text-main)',
            }}>
              <div style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.title || 'Untitled'}</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 3, fontSize: 12 }}>
                <span style={{ color: STATUS[d.status].color, fontWeight: 600 }}>{STATUS[d.status].label}</span>
                <span style={{ color: 'var(--text-muted)' }}>{formatDateTime(d.updatedAt)}</span>
              </div>
            </button>
          ))}
        </div>
        <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
          {diff && backupDoc && currentDoc ? (
            <HistoryPreview
              key={diff.id}
              embedded
              state={Y.encodeStateAsUpdate(backupDoc)}
              current={currentDoc}
              startedAt={createdAt}
              endedAt={createdAt}
              edited={diff.updatedAt}
              titles={titles}
              oldLabel={diff.backup ? `In the backup | ${when}` : 'Not in the backup'}
              currentLabel={diff.current ? `Now | ${formatDateTime(diff.updatedAt)}` : 'Not here any more'}
              actions={noteActions(diff)}
            />
          ) : (
            <div style={{ padding: 32, color: 'var(--text-muted)' }}>{diffs === null ? 'Comparing…' : 'Nothing differs.'}</div>
          )}
        </div>
      </div>
      {confirmRollback && (
        <div onMouseDown={() => setConfirmRollback(false)} style={{ position: 'fixed', inset: 0, zIndex: 33000, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)' }}>
          <div onMouseDown={(e) => e.stopPropagation()} style={{ width: 460, padding: 20, borderRadius: 14, backgroundColor: 'var(--bg-surface-high)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 10 }}>Return everything to {when}?</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 16 }}>
              Every note in the backup gets its content from then; later changes to them are replaced. {newCount ? `${newCount} notes made after the backup go to the trash (you can restore them from there for 7 days).` : ''}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" style={btn()} onClick={() => setConfirmRollback(false)}>Cancel</button>
              <button type="button" style={btn('danger')} onClick={() => { setConfirmRollback(false); run(() => onRestoreAll('rollback')); }}>Return everything</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
