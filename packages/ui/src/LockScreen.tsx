import { useState } from 'react';
import { mdiLockOutline } from '@mdi/js';
import { Icon } from './Icon';
import { PasswordInput } from './PasswordInput';

// Settings > App lock: covers the app until the passphrase is entered. The notes stay
// decrypted in memory meanwhile (it keeps out people at the screen, not someone with the disk).
export function LockScreen({ onUnlock }: { onUnlock: (passphrase: string) => Promise<boolean> }) {
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    setBusy(true);
    setError('');
    await new Promise((r) => setTimeout(r, 30));
    try {
      if (!(await onUnlock(passphrase))) setError('Wrong passphrase.');
      else setPassphrase('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50000, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--bg-base)' }}>
      <form onSubmit={(e) => { e.preventDefault(); submit(); }} style={{ width: 320, textAlign: 'center' }}>
        <Icon path={mdiLockOutline} size={44} style={{ color: 'var(--primary)', margin: '0 auto' }} />
        <div style={{ fontSize: 18, fontWeight: 700, margin: '10px 0 4px' }}>Noted is locked</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>Enter your passphrase to continue.</div>
        <PasswordInput autoFocus value={passphrase} onChange={setPassphrase} placeholder="Passphrase" style={{
          width: '100%', boxSizing: 'border-box', padding: '10px 12px', marginBottom: 10, borderRadius: 8, border: '1px solid var(--border)',
          backgroundColor: 'var(--bg-surface-high)', color: 'var(--text-main)', fontSize: 14, outline: 'none',
        }} />
        {error && <div style={{ color: 'var(--error)', fontSize: 12, marginBottom: 10 }}>{error}</div>}
        <button type="submit" disabled={busy || !passphrase} style={{ width: '100%', padding: 10, borderRadius: 8, border: 'none', fontWeight: 700, cursor: 'pointer', backgroundColor: 'var(--primary)', color: 'var(--primary-fg)' }}>
          {busy ? 'Checking…' : 'Unlock'}
        </button>
      </form>
    </div>
  );
}
