import { useEffect, useRef, useState } from 'react';
import {
  mdiSync, mdiCheckAll, mdiCloudUploadOutline, mdiGlasses, mdiArrowExpandHorizontal,
  mdiArrowCollapseHorizontal, mdiMinus, mdiPlus, mdiClose,
} from '@mdi/js';
import { IconBtn, popoverStyle } from './menu-parts';

export interface TextStats {
  words: number;
  characters: number;
  paragraphs: number;
  spaces: number;
}

interface Props {
  online: boolean;
  syncing: boolean;
  // No local change waits for upload.
  synced: boolean;
  onSync: () => void;
  fullWidth: boolean;
  onToggleWidth: () => void;
  focusMode: boolean;
  onToggleFocus: () => void;
  zoom: number;
  onZoom: (zoom: number) => void;
  stats: TextStats | null;
  created: number | null;
  // A problem worth showing (offline, key mismatch, ...).
  message?: string;
}

export const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

export { formatDateTime } from './format-date';
import { formatDateTime } from './format-date';

// Bottom bar: connection and sync on the left; layout, focus mode, zoom, text statistics,
// creation date and sync state on the right.
export function StatusBar(props: Props) {
  const { online, syncing, synced, onSync, fullWidth, onToggleWidth, focusMode, onToggleFocus, zoom, onZoom, stats, created, message } = props;
  const [statsOpen, setStatsOpen] = useState(false);
  const statsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!statsOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (!statsRef.current?.contains(e.target as Node)) setStatsOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown, true);
    return () => document.removeEventListener('mousedown', onMouseDown, true);
  }, [statsOpen]);

  const step = (direction: 1 | -1) => {
    const index = ZOOM_STEPS.findIndex((z) => Math.abs(z - zoom) < 0.001);
    const next = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, (index < 0 ? ZOOM_STEPS.indexOf(1) : index) + direction))];
    onZoom(next);
  };

  const text = { fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' } as const;
  const small = { minWidth: 24, height: 24 } as const;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, height: 28, padding: '0 8px', borderTop: '1px solid var(--border)', backgroundColor: 'var(--bg-surface-low)' }}>
      <span
        title={online ? 'Online: connected to the server' : 'Offline'}
        style={{
          width: 9, height: 9, margin: '0 6px', borderRadius: 5, boxSizing: 'border-box',
          backgroundColor: online ? 'var(--primary)' : 'transparent',
          border: `1.5px solid ${online ? 'var(--primary)' : 'var(--text-muted)'}`,
        }}
      />
      <IconBtn icon={mdiSync} title="Sync now" onClick={onSync} size={15} style={{ ...small, animation: syncing ? 'noted-spin 1s linear infinite' : undefined }} />

      {message && <span style={{ fontSize: 12, color: 'var(--error)', marginLeft: 6, whiteSpace: 'nowrap' }}>{message}</span>}
      <div style={{ flex: 1 }} />

      <IconBtn
        icon={fullWidth ? mdiArrowCollapseHorizontal : mdiArrowExpandHorizontal}
        title={fullWidth ? 'Centered text' : 'Full width text'}
        onClick={onToggleWidth}
        size={15}
        style={small}
      />
      <IconBtn icon={mdiGlasses} title="Focus mode (hide the note list)" onClick={onToggleFocus} active={focusMode} size={15} style={small} />
      <IconBtn icon={mdiMinus} title="Zoom out (Ctrl+-)" onClick={() => step(-1)} size={14} style={small} />
      <button
        type="button"
        title="Reset zoom (Ctrl+0)"
        onClick={() => onZoom(1)}
        style={{ ...text, border: 'none', background: 'transparent', cursor: 'pointer', minWidth: 38, padding: 0 }}
      >
        {Math.round(zoom * 100)}%
      </button>
      <IconBtn icon={mdiPlus} title="Zoom in (Ctrl+=)" onClick={() => step(1)} size={14} style={small} />

      {stats && (
        <div ref={statsRef} style={{ position: 'relative' }}>
          <button type="button" title="Text statistics" onClick={() => setStatsOpen((o) => !o)} style={{ ...text, border: 'none', background: 'transparent', cursor: 'pointer', padding: '0 8px' }}>
            {stats.words} {stats.words === 1 ? 'word' : 'words'}
          </button>
          {statsOpen && (
            <div style={{ ...popoverStyle, top: 'auto', bottom: 'calc(100% + 6px)', left: 'auto', right: 0, minWidth: 190, padding: '8px 12px' }}>
              {([['Words', stats.words], ['Characters', stats.characters], ['Paragraphs', stats.paragraphs], ['Spaces', stats.spaces]] as const).map(([label, value]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '4px 0', fontSize: 13 }}>
                  <span style={{ color: 'var(--text-main)' }}>{label}</span>
                  <b>{value}</b>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'center', marginTop: 4 }}>
                <IconBtn icon={mdiClose} title="Close" onClick={() => setStatsOpen(false)} size={14} style={small} />
              </div>
            </div>
          )}
        </div>
      )}
      {created !== null && <span style={{ ...text, padding: '0 6px' }} title="Created">{formatDateTime(created)}</span>}
      <span title={synced ? 'Synced' : 'Changes waiting to be uploaded'} style={{ display: 'flex', padding: '0 4px', color: synced ? 'var(--primary)' : 'var(--text-muted)' }}>
        <svg width={16} height={16} viewBox="0 0 24 24" aria-hidden="true"><path d={synced ? mdiCheckAll : mdiCloudUploadOutline} fill="currentColor" /></svg>
      </span>
    </div>
  );
}

// Word, character, paragraph and space counts of a note's plain text (blocks joined by \n).
export const computeTextStats = (text: string, paragraphs: number): TextStats => ({
  words: (text.match(/\S+/g) ?? []).length,
  characters: text.replace(/\n/g, '').length,
  paragraphs,
  spaces: (text.match(/ /g) ?? []).length,
});
