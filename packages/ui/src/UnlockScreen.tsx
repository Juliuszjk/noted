import { useState, useEffect } from 'react';
import { apiUrl, hasServer, normalizeServerUrl, setServerAddress, MIN_PASSPHRASE_LENGTH } from '@noted/config';
import {
  apiFetch, fetchVaultStatus, setupCodeHeader, WRONG_SETUP_CODE, openWithPassphraseKey, openWithRecoveryKey, changePassphrase, setAuthEpoch, backupVault, vaultInfoOf, openBackup,
  restoreServerVault, connectServer, createLocalVault, readLocalVault,
} from '@noted/sync';
import type { VaultInfo } from '@noted/sync';
import { PasswordInput } from './PasswordInput';
import { generateSalt, deriveMasterKey, createVerifier, deriveAuthToken, bytesToBase64, parseRecoveryKey } from '@noted/crypto';

const packBlob = (b: { nonce: Uint8Array; ciphertext: Uint8Array }): string =>
  `${bytesToBase64(b.nonce)}.${bytesToBase64(b.ciphertext)}`;

type Mode =
  // No server chosen yet (or changing it): the vault lives on the server.
  | { kind: 'server' }
  | { kind: 'loading' }
  | { kind: 'create' }
  | { kind: 'unlock'; info: VaultInfo }
  // Forgot the passphrase: the recovery key opens the vault, then a new passphrase is set.
  | { kind: 'recover'; info: VaultInfo }
  | { kind: 'newPassphrase'; info: VaultInfo; dataKey: Uint8Array; restoreText?: string }
  // The server has no vault (new or replaced server): set it up from a backup file.
  | { kind: 'restore' };

// First screen: choose a server (or none), create the vault, unlock it, recover it with the
// recovery key, or set it up from a backup. `onUnlock` gets the data key and the auth token epoch
// of the vault (and the backup, whose notes the app then restores). `knownVerifier`: the vault
// whose notes this device already holds (null = none yet); another vault is refused, its key
// could not read them.
export function UnlockScreen({ onUnlock, knownVerifier = null }: {
  onUnlock: (key: Uint8Array, epoch: number, restoreBackupText?: string) => void;
  knownVerifier?: string | null;
}) {
  const [mode, setMode] = useState<Mode>(() => (hasServer() ? { kind: 'loading' } : { kind: 'server' }));
  const [serverText, setServerText] = useState(() => apiUrl());
  // A fresh server wants the setup code from its log before the vault can be created.
  const [needsCode, setNeedsCode] = useState(false);
  const [setupCode, setSetupCode] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [recoveryText, setRecoveryText] = useState('');
  const [error, setError] = useState('');
  const [backupFile, setBackupFile] = useState<File | null>(null);
  const [useRecovery, setUseRecovery] = useState(false);
  const [busy, setBusy] = useState(false);

  // The vault endpoints before unlocking need no valid auth; apiFetch still wants a key.
  const dummyKey = new Uint8Array(32);

  const loadVault = async () => {
    try {
      const { info, setupCode: codeNeeded } = await fetchVaultStatus();
      setNeedsCode(codeNeeded);
      setMode(info ? { kind: 'unlock', info } : { kind: 'create' });
      setError('');
    } catch {
      setError(`Cannot reach the server ${apiUrl().replace(/^https?:\/\//, '')}.`);
    }
  };

  useEffect(() => {
    if (hasServer()) loadVault();
  }, []);

  const otherVault = (verifier: string) => {
    if (knownVerifier && verifier !== knownVerifier) {
      throw new Error('This device holds the notes of another vault, which this one could not read. Go back to that vault\'s server, or remove this device\'s Noted data first.');
    }
  };

  const withoutServer = () => {
    setError('');
    setServerAddress({ api: '', public: '' });
    setMode({ kind: 'loading' });
    loadVault();
  };

  const changeServer = () => {
    setError('');
    setServerText(apiUrl());
    setMode({ kind: 'server' });
  };

  const newPassphraseOk = () => {
    if (passphrase.length < MIN_PASSPHRASE_LENGTH) throw new Error(`Use at least ${MIN_PASSPHRASE_LENGTH} characters.`);
    if (passphrase !== confirm) throw new Error('Passphrases do not match.');
  };

  const submit = async () => {
    setError('');
    setBusy(true);
    await new Promise((r) => setTimeout(r, 50));
    try {
      if (mode.kind === 'server') {
        const base = normalizeServerUrl(serverText);
        if (!base) throw new Error('Enter the server address, e.g. https://notes.example.com or 100.64.0.1:3333.');
        if (!hasServer() && readLocalVault()) throw new Error('This device keeps its vault without a server: unlock it, then use Settings > Sync > Connect a server (the notes go along).');
        await connectServer(base);
        setMode({ kind: 'loading' });
        await loadVault();
      } else if (mode.kind === 'create') {
        newPassphraseOk();
        const salt = generateSalt();
        const key = deriveMasterKey(passphrase, salt);
        const verifier = packBlob(createVerifier(key));
        otherVault(verifier);
        if (!hasServer()) {
          createLocalVault(salt, verifier);
          onUnlock(key, 0);
          return;
        }
        const res = await apiFetch(`${apiUrl()}/vault`, dummyKey, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...setupCodeHeader(setupCode) },
          body: JSON.stringify({
            salt: bytesToBase64(salt),
            verifier,
            auth_token: bytesToBase64(deriveAuthToken(key)),
          }),
        });
        if (res.status === 403) throw new Error(WRONG_SETUP_CODE);
        if (res.status === 409) {
          await loadVault();
          throw new Error('A vault already exists. Enter its passphrase.');
        }
        if (!res.ok) throw new Error(`Server error (HTTP ${res.status}).`);
        onUnlock(key, 0);
      } else if (mode.kind === 'unlock') {
        const salt = Uint8Array.from(atob(mode.info.salt), (c) => c.charCodeAt(0));
        const dataKey = openWithPassphraseKey(mode.info, deriveMasterKey(passphrase, salt));
        if (!dataKey) throw new Error('Wrong passphrase.');
        otherVault(mode.info.verifier);
        onUnlock(dataKey, mode.info.authEpoch);
      } else if (mode.kind === 'recover') {
        const recoveryKey = parseRecoveryKey(recoveryText);
        if (!recoveryKey) throw new Error('That is not a valid recovery key (check for typos).');
        const dataKey = openWithRecoveryKey(mode.info, recoveryKey);
        if (!dataKey) throw new Error('This recovery key does not open this vault.');
        otherVault(mode.info.verifier);
        setPassphrase('');
        setConfirm('');
        setMode({ kind: 'newPassphrase', info: mode.info, dataKey });
      } else if (mode.kind === 'restore') {
        if (!backupFile) throw new Error('Choose a backup file first.');
        const text = await backupFile.text();
        const vault = backupVault(text);
        if (!vault) throw new Error('This backup has no vault data (it was made by an older version or offline). Use a newer backup.');
        const info = vaultInfoOf(vault);
        let dataKey: Uint8Array | null;
        if (useRecovery) {
          const recoveryKey = parseRecoveryKey(recoveryText);
          if (!recoveryKey) throw new Error('That is not a valid recovery key (check for typos).');
          dataKey = openWithRecoveryKey(info, recoveryKey);
        } else {
          const salt = Uint8Array.from(atob(vault.salt), (c) => c.charCodeAt(0));
          dataKey = openWithPassphraseKey(info, deriveMasterKey(passphrase, salt));
        }
        if (!dataKey) throw new Error(useRecovery ? 'This recovery key does not open this backup.' : 'Wrong passphrase for this backup.');
        openBackup(dataKey, text);
        otherVault(vault.verifier);
        await restoreServerVault(dataKey, vault, 0, setupCode);
        if (useRecovery) {
          // Opened with the recovery key: a new passphrase first (the old one is forgotten).
          setPassphrase('');
          setConfirm('');
          setMode({ kind: 'newPassphrase', info, dataKey, restoreText: text });
          return;
        }
        onUnlock(dataKey, 0, text);
      } else if (mode.kind === 'newPassphrase') {
        newPassphraseOk();
        const salt = generateSalt();
        setAuthEpoch(mode.info.authEpoch);
        await changePassphrase(mode.dataKey, salt, deriveMasterKey(passphrase, salt));
        onUnlock(mode.dataKey, mode.info.authEpoch, mode.restoreText);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unlock failed.');
    } finally {
      setBusy(false);
    }
  };

  const inputStyle = {
    width: '100%', boxSizing: 'border-box' as const, padding: '10px 12px', marginBottom: '12px',
    borderRadius: '6px', border: '1px solid var(--border)', backgroundColor: 'var(--bg-surface-high)',
    color: 'var(--text-main)', fontSize: '14px',
  };
  const linkStyle = { marginTop: 12, padding: 0, border: 'none', background: 'transparent', color: 'var(--primary)', cursor: 'pointer', fontSize: 12 } as const;
  const choosing = mode.kind === 'create' || mode.kind === 'newPassphrase';

  return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <form
        onSubmit={(e) => { e.preventDefault(); submit(); }}
        style={{ width: '340px', padding: '24px', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '12px' }}
      >
        <div style={{ fontWeight: 'bold', fontSize: '16px', marginBottom: '4px' }}>Noted</div>
        <div style={{ color: 'var(--text-muted)', fontSize: '12px', marginBottom: '16px', lineHeight: 1.5 }}>
          {mode.kind === 'create' && (hasServer()
            ? 'Create a passphrase for your encrypted vault. Save the recovery key in Settings afterwards: without it a forgotten passphrase cannot be recovered.'
            : 'Create a passphrase for your encrypted vault, kept on this device only (a server can be connected later in Settings > Sync). Save the recovery key and make backups: without them a forgotten passphrase or a lost disk cannot be recovered.')}
          {mode.kind === 'unlock' && 'Enter your passphrase to unlock your notes.'}
          {mode.kind === 'recover' && 'Enter your recovery key (the groups of letters and digits you saved).'}
          {mode.kind === 'newPassphrase' && 'Recovery key accepted. Choose a new passphrase for every device.'}
          {mode.kind === 'loading' && 'Connecting to server...'}
          {mode.kind === 'server' && 'Enter the address of your Noted server (it only ever stores encrypted data), or use Noted without one: your notes then stay on this device, and a server can be connected later.'}
          {mode.kind === 'restore' && (hasServer()
            ? 'The server has no vault yet. Pick a Noted backup (.nbackup) and enter the passphrase it was made with: the vault comes back with the same passphrase and recovery key, then your notes are restored and uploaded.'
            : 'Pick a Noted backup (.nbackup) and enter the passphrase it was made with: the vault comes back on this device with the same passphrase and recovery key, then your notes are restored.')}
        </div>
        {mode.kind === 'server' && (
          <input autoFocus placeholder="https://notes.example.com" value={serverText} spellCheck={false}
            onChange={(e) => setServerText(e.target.value)} style={inputStyle} />
        )}
        {mode.kind === 'restore' && (
          <>
            <input type="file" accept=".nbackup,.json" onChange={(e) => setBackupFile(e.target.files?.[0] ?? null)} style={{ ...inputStyle, padding: '8px' }} />
            {useRecovery ? (
              <textarea placeholder="Recovery key XXXX-XXXX-…" value={recoveryText} rows={3}
                onChange={(e) => setRecoveryText(e.target.value)} style={{ ...inputStyle, fontFamily: 'monospace', resize: 'none' }} />
            ) : (
              <PasswordInput placeholder="Passphrase of the backup" value={passphrase} onChange={setPassphrase} style={inputStyle} />
            )}
          </>
        )}
        {(mode.kind === 'unlock' || choosing) && (
          <PasswordInput autoFocus placeholder={choosing && mode.kind === 'newPassphrase' ? 'New passphrase' : 'Passphrase'} value={passphrase}
            onChange={setPassphrase} style={inputStyle} />
        )}
        {choosing && (
          <PasswordInput placeholder="Repeat passphrase" value={confirm} onChange={setConfirm} style={inputStyle} />
        )}
        {needsCode && (mode.kind === 'create' || mode.kind === 'restore') && (
          <>
            <div style={{ color: 'var(--text-muted)', fontSize: '12px', marginBottom: '6px', lineHeight: 1.5 }}>
              This server is new: enter the setup code from its log (docker logs noted_api), so nobody else can claim it first.
            </div>
            <input placeholder="Setup code XXXX-XXXX-XXXX" value={setupCode} spellCheck={false}
              onChange={(e) => setSetupCode(e.target.value)} style={{ ...inputStyle, fontFamily: 'monospace' }} />
          </>
        )}
        {mode.kind === 'recover' && (
          <textarea autoFocus placeholder="XXXX-XXXX-XXXX-…" value={recoveryText} rows={3}
            onChange={(e) => setRecoveryText(e.target.value)} style={{ ...inputStyle, fontFamily: 'monospace', resize: 'none' }} />
        )}
        {error && <div style={{ color: 'var(--error)', fontSize: '12px', marginBottom: '12px' }}>{error}</div>}
        {mode.kind === 'loading' && error && (
          <button type="button" onClick={loadVault}
            style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid var(--border)', cursor: 'pointer' }}>
            Retry
          </button>
        )}
        {mode.kind !== 'loading' && (
          <button type="submit" disabled={busy}
            style={{ width: '100%', padding: '10px', borderRadius: '6px', border: 'none', fontWeight: 'bold', cursor: 'pointer', backgroundColor: 'var(--primary)', color: 'var(--primary-fg)' }}>
            {busy ? 'Working...' : mode.kind === 'server' ? 'Connect' : mode.kind === 'restore' ? 'Set up the vault and restore' : mode.kind === 'create' ? 'Create vault' : mode.kind === 'recover' ? 'Check recovery key' : mode.kind === 'newPassphrase' ? 'Set passphrase and unlock' : 'Unlock'}
          </button>
        )}
        {mode.kind === 'unlock' && mode.info.recoveryEnvelope && (
          <button type="button" style={linkStyle} onClick={() => { setError(''); setMode({ kind: 'recover', info: mode.info }); }}>
            Forgot your passphrase? Use the recovery key
          </button>
        )}
        {mode.kind === 'recover' && (
          <button type="button" style={linkStyle} onClick={() => { setError(''); setMode({ kind: 'unlock', info: mode.info }); }}>
            Back to the passphrase
          </button>
        )}
        {mode.kind === 'create' && (
          <button type="button" style={{ ...linkStyle, display: 'block' }} onClick={() => { setError(''); setPassphrase(''); setMode({ kind: 'restore' }); }}>
            {hasServer() ? 'New or replaced server? Set it up from a backup' : 'Have a backup? Set the vault up from it'}
          </button>
        )}
        {mode.kind === 'server' && (
          <button type="button" onClick={withoutServer} disabled={busy}
            style={{ width: '100%', marginTop: 8, padding: '10px', borderRadius: '6px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-main)', cursor: 'pointer' }}>
            Use without a server
          </button>
        )}
        {mode.kind === 'server' && hasServer() && (
          <button type="button" style={{ ...linkStyle, display: 'block' }} onClick={() => { setError(''); setMode({ kind: 'loading' }); loadVault(); }}>
            Back: keep {apiUrl().replace(/^https?:\/\//, '')}
          </button>
        )}
        {mode.kind !== 'server' && (
          <button type="button" style={{ ...linkStyle, display: 'block' }} onClick={changeServer}>
            {hasServer() ? `Server: ${apiUrl().replace(/^https?:\/\//, '')}` : 'No server (this device only)'} · change
          </button>
        )}
        {mode.kind === 'restore' && (
          <>
            <button type="button" style={{ ...linkStyle, display: 'block' }} onClick={() => { setError(''); setUseRecovery(!useRecovery); }}>
              {useRecovery ? 'Use the passphrase instead' : 'Forgot the passphrase? Use the recovery key'}
            </button>
            <button type="button" style={{ ...linkStyle, display: 'block' }} onClick={() => { setError(''); setMode({ kind: 'create' }); }}>
              Back: create a new, empty vault
            </button>
          </>
        )}
      </form>
    </div>
  );
}
