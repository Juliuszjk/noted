import { useEffect, useState } from 'react';
import { mdiClose, mdiPlus, mdiRestore } from '@mdi/js';
import { Icon } from './Icon';
import {
  SHORTCUT_ACTIONS, FIXED_SHORTCUTS, shortcutKeys, comboOf, shortcutConflict, formatCombo,
} from './shortcuts';
import type { ShortcutGroup, ShortcutOverrides } from './shortcuts';

const GROUPS: [ShortcutGroup, string][] = [['App', 'App'], ['Tabs', 'Tabs and history'], ['Note', 'Note'], ['Formatting', 'Formatting']];

const keyChip = {
  display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 4px 3px 8px', borderRadius: 6, fontSize: 12,
  fontFamily: 'var(--font-mono, monospace)', border: '1px solid var(--border)', backgroundColor: 'var(--bg-surface)',
} as const;
const smallBtn = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: 'none', background: 'transparent',
  color: 'var(--text-muted)', cursor: 'pointer', padding: 2, borderRadius: 4,
} as const;

// Settings > Keyboard shortcuts: every action with its keys; "+" records a new key, × removes
// one, the arrow restores the defaults. A key used by two actions is marked.
export function ShortcutSettings({ overrides, onChange }: { overrides: ShortcutOverrides; onChange: (next: ShortcutOverrides) => void }) {
  const [recording, setRecording] = useState<string | null>(null);

  const setKeys = (id: string, keys: string[]) => {
    const action = SHORTCUT_ACTIONS.find((a) => a.id === id)!;
    const next = { ...overrides };
    const same = keys.length === action.defaults.length && keys.every((k, i) => k === action.defaults[i]);
    if (same) delete next[id];
    else next[id] = keys;
    onChange(next);
  };

  useEffect(() => {
    if (!recording) return;
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') return setRecording(null);
      const combo = comboOf(e);
      if (!combo) return;
      const keys = shortcutKeys(recording, overrides);
      if (!keys.includes(combo)) setKeys(recording, [...keys, combo]);
      setRecording(null);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [recording, overrides]);

  return (
    <>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.45, margin: '6px 0 4px' }}>
        Click + and press the new keys (Esc cancels). A key can belong to one action only; a clash is marked in red.
      </div>
      {GROUPS.map(([group, title]) => (
        <div key={group}>
          <div style={{ margin: '22px 0 2px', fontSize: 12, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--primary)' }}>{title}</div>
          {SHORTCUT_ACTIONS.filter((a) => a.group === group).map((action) => {
            const keys = shortcutKeys(action.id, overrides);
            const changed = !!overrides[action.id];
            return (
              <div key={action.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ flex: 1, minWidth: 0, fontSize: 14 }}>{action.label}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center', gap: 6 }}>
                  {keys.map((combo) => {
                    const clash = shortcutConflict(combo, action.id, overrides);
                    return (
                      <span key={combo} style={{ ...keyChip, ...(clash ? { borderColor: 'var(--error)', color: 'var(--error)' } : {}) }}
                        title={clash ? `Also used by “${clash.label}”` : undefined}>
                        {formatCombo(combo)}
                        <button type="button" style={smallBtn} title="Remove this key" onClick={() => setKeys(action.id, keys.filter((k) => k !== combo))}>
                          <Icon path={mdiClose} size={13} />
                        </button>
                      </span>
                    );
                  })}
                  {recording === action.id ? (
                    <span style={{ ...keyChip, padding: '3px 8px', borderColor: 'var(--primary)', color: 'var(--primary)' }}>Press keys…</span>
                  ) : (
                    <button type="button" style={{ ...smallBtn, border: '1px solid var(--border)', padding: 3 }} title="Add a key" onClick={() => setRecording(action.id)}>
                      <Icon path={mdiPlus} size={14} />
                    </button>
                  )}
                  <button type="button" style={{ ...smallBtn, visibility: changed ? 'visible' : 'hidden' }} title="Back to the default keys" onClick={() => setKeys(action.id, [...action.defaults])}>
                    <Icon path={mdiRestore} size={16} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ))}
      <div style={{ margin: '22px 0 2px', fontSize: 12, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--primary)' }}>Fixed</div>
      {FIXED_SHORTCUTS.map((s) => (
        <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
          <div style={{ flex: 1, fontSize: 14 }}>{s.label}</div>
          <span style={{ ...keyChip, padding: '3px 8px', color: 'var(--text-muted)' }}>{s.keys}</span>
        </div>
      ))}
      {Object.keys(overrides).length > 0 && (
        <div style={{ marginTop: 16 }}>
          <button type="button" onClick={() => onChange({})} style={{ padding: '6px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 13, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-main)' }}>
            Reset all shortcuts
          </button>
        </div>
      )}
    </>
  );
}
