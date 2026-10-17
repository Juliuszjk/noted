import { useState } from 'react';
import { mdiClose, mdiLockOutline } from '@mdi/js';
import { Icon } from './Icon';
import { PasswordInput } from './PasswordInput';

const field = { width: '100%', boxSizing: 'border-box' as const, padding: '9px 10px', marginBottom: 10, fontSize: 14, color: 'var(--text-main)', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, outline: 'none' };
const btn = (primary: boolean) => ({ padding: '7px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600, border: primary ? 'none' : '1px solid var(--border)', backgroundColor: primary ? 'var(--primary)' : 'transparent', color: primary ? 'var(--primary-fg)' : 'var(--text-main)' });

// The vault of locked notes: create it (password twice) or open it (password). `onSubmit`
// resolves to an error message, or null when it worked.
export function VaultDialog({ mode, onSubmit, onClose }: {
  mode: 'create' | 'unlock';
  onSubmit: (password: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setError(null);
    if (mode === 'create') {
      if (password.length < 6) return setError('Use at least 6 characters.');
      if (password !== repeat) return setError('The passwords do not match.');
    }
    setBusy(true);
    await new Promise((r) => setTimeout(r, 30));
    try {
      const result = await onSubmit(password);
      if (result) setError(result);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div onMouseDown={onClose} style={{ position: 'fixed', inset: 0, zIndex: 32000, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)' }}>
      <form onMouseDown={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); submit(); }} style={{ width: 400, padding: 20, borderRadius: 14, backgroundColor: 'var(--bg-surface-high)', border: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <Icon path={mdiLockOutline} size={20} style={{ color: 'var(--primary)' }} />
          <span style={{ flex: 1, fontSize: 17, fontWeight: 700 }}>{mode === 'create' ? 'Create the vault' : 'Open the vault'}</span>
          <button type="button" onClick={onClose} style={{ display: 'flex', border: 'none', background: 'transparent', color: 'var(--text-main)', cursor: 'pointer' }}><Icon path={mdiClose} size={18} /></button>
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 12 }}>
          {mode === 'create'
            ? 'Locked notes are encrypted once more with the vault password. It is separate from your passphrase and cannot be recovered: forget it and the locked notes are gone.'
            : 'Enter the vault password to open locked notes. They stay open until Noted is locked or closed.'}
        </div>
        <PasswordInput autoFocus value={password} onChange={setPassword} placeholder="Vault password" style={field} />
        {mode === 'create' && <PasswordInput value={repeat} onChange={setRepeat} placeholder="Repeat the password" style={field} />}
        {error && <div style={{ fontSize: 13, color: 'var(--error)', marginBottom: 10 }}>{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" style={btn(false)} onClick={onClose}>Cancel</button>
          <button type="submit" disabled={busy} style={btn(true)}>{busy ? 'Working…' : mode === 'create' ? 'Create' : 'Open'}</button>
        </div>
      </form>
    </div>
  );
}

// In place of the editor while a locked note is closed.
export function LockedNote({ title, onOpen }: { title: string; onOpen: () => void }) {
  return (
    <div style={{ textAlign: 'center', marginTop: '18vh' }}>
      <Icon path={mdiLockOutline} size={44} style={{ color: 'var(--primary)', margin: '0 auto' }} />
      <div style={{ fontSize: 20, fontWeight: 700, margin: '10px 0 4px' }}>{title || 'Untitled'}</div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>This note is locked.</div>
      <button type="button" onClick={onOpen} style={btn(true)}>Open with the vault password</button>
    </div>
  );
}
