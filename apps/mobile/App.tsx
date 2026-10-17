import { KeyboardProvider } from 'react-native-keyboard-controller';
// POLYFILL MUST BE FIRST
import './src/polyfill';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { generateSalt, createVerifier, deriveAuthToken, bytesToBase64, parseRecoveryKey } from '@noted/crypto';
import { saveMasterKey, getMasterKey, clearMasterKey, getAuthEpochStored, saveAuthEpoch } from './src/storage';
import { createExpoStore } from './src/store';
import { apiFetch, fetchVault, openWithPassphraseKey, openWithRecoveryKey, changePassphrase, setAuthEpoch, mergingNoteStore } from '@noted/sync';
import type { LocalNoteStore, LocalBlobStore, VaultInfo } from '@noted/sync';
import { isLightColor } from '@noted/theme';
import { registerKdf } from './src/kdf';
import { AppState, Appearance } from 'react-native';
import { reloadAppAsync } from 'expo';
import { LockScreen, readAppLock, cacheVaultInfoForLock } from './src/LockScreen';
import { setVaultKey } from './src/vault-session';
import { NotesScreen } from './src/NotesScreen';
import { T, PasswordField, themeSignature, startThemeSignature } from './src/ui';
import { KdfRunner, KdfHandle } from './src/KdfRunner';
import { DialogHost } from './src/Dialog';
import { API_URL, MIN_PASSPHRASE_LENGTH } from '@noted/config';
import { backgroundWasIntended, consumeReloadPass, markReloadUnlocked } from './src/away';

// Status bar icons (clock, battery) contrast with the app background: light on a dark theme,
// dark on a light one.
const STATUS_BAR_STYLE = isLightColor(T.background) ? 'dark' : 'light';

const packBlob = (b: { nonce: Uint8Array; ciphertext: Uint8Array }): string =>
  `${bytesToBase64(b.nonce)}.${bytesToBase64(b.ciphertext)}`;

type Mode =
  | { kind: 'loading' }
  | { kind: 'create' }
  | { kind: 'unlock'; info: VaultInfo }
  // Forgot the passphrase: the recovery key opens the vault, then a new passphrase is set.
  | { kind: 'recover'; info: VaultInfo }
  | { kind: 'newPassphrase'; info: VaultInfo; dataKey: Uint8Array };

function App() {
  const [masterKey, setMasterKey] = useState<Uint8Array | null>(null);
  const [rawStore, setDbStore] = useState<LocalNoteStore | null>(null);
  // Every save is merged with what is already stored (merging-store.ts): a slow sync can no
  // longer overwrite text typed meanwhile.
  const dbStore = useMemo(() => (rawStore && masterKey ? mergingNoteStore(masterKey, rawStore) : null), [rawStore, masterKey]);
  const [blobStore, setBlobStore] = useState<LocalBlobStore | null>(null);

  const [mode, setMode] = useState<Mode>({ kind: 'loading' });
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [recoveryText, setRecoveryText] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(true);
  const kdfRef = useRef<KdfHandle>(null);
  // Settings > App lock: locked at start (when on) and after time in the background.
  const [locked, setLocked] = useState(() => readAppLock().enabled && !consumeReloadPass());
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const intendedAway = useRef(false);
  // Locking the app closes the vault of locked notes too.
  useEffect(() => { if (locked) setVaultKey(null); }, [locked]);
  const backgroundAt = useRef<number | null>(null);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      const lock = readAppLock();
      if (state === 'background') {
        backgroundAt.current = Date.now();
        intendedAway.current = backgroundWasIntended();
      } else if (state === 'active' && backgroundAt.current !== null) {
        // A picker / share menu Noted opened itself does not lock (unless it took over 30 min).
        const away = Date.now() - backgroundAt.current;
        const intended = intendedAway.current && away < 30 * 60_000;
        if (lock.enabled && !intended && away >= lock.minutes * 60_000) { setLocked(true); lockedRef.current = true; }
        backgroundAt.current = null;
        intendedAway.current = false;
      }
    });
    return () => sub.remove();
  }, []);
  // New colours (system light / dark switched, new wallpaper for Material You): reload to
  // show them, checked when the app comes to the front and when the system scheme changes.
  useEffect(() => {
    const check = () => {
      if (themeSignature() === startThemeSignature) return;
      // An unlocked app stays unlocked across this reload.
      if (!lockedRef.current) markReloadUnlocked();
      reloadAppAsync().catch(() => {});
    };
    const app = AppState.addEventListener('change', (state) => { if (state === 'active') check(); });
    const scheme = Appearance.addChangeListener(check);
    return () => { app.remove(); scheme.remove(); };
  }, []);
  useEffect(() => {
    registerKdf(kdfRef.current);
    return () => registerKdf(null);
  }, []);

  const dummyKey = new Uint8Array(32);

  const loadVault = async () => {
    try {
      const info = await fetchVault();
      setMode(info ? { kind: 'unlock', info } : { kind: 'create' });
      setError('');
    } catch {
      setError('Cannot reach the server. Is Tailscale on?');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    async function init() {
      try {
        const { store, blobStore: blobs } = await createExpoStore();
        setDbStore(store);
        setBlobStore(blobs);
        setAuthEpoch(await getAuthEpochStored());
        const key = await getMasterKey();
        if (key) {
          setMasterKey(key);
        } else {
          await loadVault();
        }
      } catch (err) {
        setError('Failed to initialize storage or DB.');
        setBusy(false);
      }
    }
    init();
  }, []);

  const unlocked = async (key: Uint8Array, epoch: number) => {
    setAuthEpoch(epoch);
    await saveAuthEpoch(epoch);
    await saveMasterKey(key);
    setPassphrase('');
    setConfirm('');
    setRecoveryText('');
    setNotice('');
    setLocked(false);
    setMasterKey(key);
    cacheVaultInfoForLock();
  };

  const newPassphraseOk = () => {
    if (passphrase.length < MIN_PASSPHRASE_LENGTH) throw new Error(`Use at least ${MIN_PASSPHRASE_LENGTH} characters.`);
    if (passphrase !== confirm) throw new Error('Passphrases do not match.');
  };

  const handleUnlock = async () => {
    setError('');
    setBusy(true);
    await new Promise(r => setTimeout(r, 100));

    try {
      if (mode.kind === 'create') {
        newPassphraseOk();
        const salt = generateSalt();
        const key = await kdfRef.current!.derive(passphrase, bytesToBase64(salt));
        const res = await apiFetch(`${API_URL}/vault`, dummyKey, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            salt: bytesToBase64(salt),
            verifier: packBlob(createVerifier(key)),
            auth_token: bytesToBase64(deriveAuthToken(key)),
          }),
        });
        if (res.status === 409) {
          await loadVault();
          throw new Error('A vault exists. Enter passphrase.');
        }
        if (!res.ok) throw new Error(`Server error (HTTP ${res.status})`);
        await unlocked(key, 0);
      } else if (mode.kind === 'unlock') {
        const key = openWithPassphraseKey(mode.info, await kdfRef.current!.derive(passphrase, mode.info.salt));
        if (!key) throw new Error('Wrong passphrase.');
        await unlocked(key, mode.info.authEpoch);
      } else if (mode.kind === 'recover') {
        const recoveryKey = parseRecoveryKey(recoveryText);
        if (!recoveryKey) throw new Error('That is not a valid recovery key (check for typos).');
        const dataKey = openWithRecoveryKey(mode.info, recoveryKey);
        if (!dataKey) throw new Error('This recovery key does not open this vault.');
        setPassphrase('');
        setConfirm('');
        setMode({ kind: 'newPassphrase', info: mode.info, dataKey });
      } else if (mode.kind === 'newPassphrase') {
        newPassphraseOk();
        const salt = generateSalt();
        setAuthEpoch(mode.info.authEpoch);
        await changePassphrase(mode.dataKey, salt, await kdfRef.current!.derive(passphrase, bytesToBase64(salt)));
        await unlocked(mode.dataKey, mode.info.authEpoch);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unlock failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = async (reason?: string) => {
    await clearMasterKey();
    setMasterKey(null);
    setNotice(reason ?? '');
    setMode({ kind: 'loading' });
    loadVault();
  };

  const choosing = mode.kind === 'create' || mode.kind === 'newPassphrase';
  return (
    <>
      {/* Always mounted: unlocking and Settings > Change passphrase derive keys in it. */}
      <KdfRunner ref={kdfRef} />
      <DialogHost />
      {masterKey && dbStore && blobStore ? (
        <>
          <StatusBar style={STATUS_BAR_STYLE} />
          <NotesScreen masterKey={masterKey} dbStore={dbStore} blobStore={blobStore} onLogout={handleLogout} onLockNow={() => setLocked(true)} />
          {locked ? <LockScreen masterKey={masterKey} onUnlocked={() => setLocked(false)} /> : null}
        </>
      ) : (
        <View style={styles.container}>
          <StatusBar style={STATUS_BAR_STYLE} />
          <Text style={styles.title}>Noted</Text>
          {notice ? <Text style={styles.notice}>{notice}</Text> : null}
          <View style={styles.card}>
            <Text style={styles.label}>
              {mode.kind === 'create' ? 'Create a passphrase (save the recovery key in Settings afterwards):'
                : mode.kind === 'unlock' ? 'Enter passphrase:'
                : mode.kind === 'recover' ? 'Enter your recovery key:'
                : mode.kind === 'newPassphrase' ? 'Recovery key accepted. Choose a new passphrase:'
                : 'Connecting to server...'}
            </Text>
            {mode.kind === 'unlock' || choosing ? (
              <PasswordField style={styles.input} value={passphrase} onChangeText={setPassphrase}
                placeholder={mode.kind === 'newPassphrase' ? 'New passphrase' : 'Passphrase'} />
            ) : null}
            {choosing ? (
              <PasswordField style={styles.input} value={confirm} onChangeText={setConfirm} placeholder="Repeat passphrase" />
            ) : null}
            {mode.kind === 'recover' ? (
              <TextInput style={[styles.input, { fontFamily: 'monospace', minHeight: 72 }]} value={recoveryText} onChangeText={setRecoveryText}
                autoCapitalize="characters" autoCorrect={false} multiline placeholder="XXXX-XXXX-XXXX-…" placeholderTextColor={T.on_surface_variant} />
            ) : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}

            {mode.kind === 'loading' && error ? (
              <TouchableOpacity style={styles.button} onPress={loadVault}>
                <Text style={styles.buttonText}>Retry</Text>
              </TouchableOpacity>
            ) : mode.kind !== 'loading' ? (
              <TouchableOpacity style={styles.button} onPress={handleUnlock} disabled={busy}>
                {busy ? <ActivityIndicator color={T.on_primary} /> : (
                  <Text style={styles.buttonText}>
                    {mode.kind === 'create' ? 'Create Vault' : mode.kind === 'recover' ? 'Check recovery key' : mode.kind === 'newPassphrase' ? 'Set passphrase and unlock' : 'Unlock'}
                  </Text>
                )}
              </TouchableOpacity>
            ) : (
              <ActivityIndicator color={T.primary} />
            )}
            {mode.kind === 'unlock' && mode.info.recoveryEnvelope ? (
              <TouchableOpacity onPress={() => { setError(''); setMode({ kind: 'recover', info: mode.info }); }} style={styles.link}>
                <Text style={styles.linkText}>Forgot your passphrase? Use the recovery key</Text>
              </TouchableOpacity>
            ) : null}
            {mode.kind === 'recover' ? (
              <TouchableOpacity onPress={() => { setError(''); setMode({ kind: 'unlock', info: mode.info }); }} style={styles.link}>
                <Text style={styles.linkText}>Back to the passphrase</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: T.background },
  title: { fontSize: 28, fontWeight: 'bold', color: T.on_surface, marginBottom: 32, textAlign: 'center' },
  notice: { color: T.on_surface, fontSize: 14, textAlign: 'center', marginBottom: 16 },
  card: { backgroundColor: T.surface_container, padding: 20, borderRadius: 16, borderWidth: 1, borderColor: T.outline_variant },
  label: { color: T.on_surface_variant, marginBottom: 8, fontSize: 14 },
  input: { backgroundColor: T.surface_container_high, color: T.on_surface, padding: 12, borderRadius: 8, marginBottom: 16, fontSize: 16 },
  button: { backgroundColor: T.primary, padding: 14, borderRadius: 24, alignItems: 'center' },
  buttonText: { color: T.on_primary, fontWeight: 'bold', fontSize: 16 },
  error: { color: T.error, fontSize: 12, marginBottom: 12, textAlign: 'center' },
  link: { marginTop: 14, alignItems: 'center' },
  linkText: { color: T.primary, fontSize: 14 },
});

// The keyboard is followed natively, frame by frame (react-native-keyboard-controller): the
// editor's box shrinks together with the keyboard animation instead of after it.
export default function Root() {
  return (
    <KeyboardProvider>
      <App />
    </KeyboardProvider>
  );
}
