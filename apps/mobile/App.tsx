import { KeyboardProvider } from 'react-native-keyboard-controller';
// POLYFILL MUST BE FIRST
import './src/polyfill';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';

import { generateSalt, createVerifier, deriveAuthToken, bytesToBase64, parseRecoveryKey } from '@noted/crypto';
import { saveMasterKey, getMasterKey, clearMasterKey, getAuthEpochStored, saveAuthEpoch } from './src/storage';
import { createExpoStore } from './src/store';
import { apiFetch, fetchVaultStatus, setupCodeHeader, WRONG_SETUP_CODE, openWithPassphraseKey, openWithRecoveryKey, changePassphrase, setAuthEpoch, mergingNoteStore, connectServer, refreshServerInfo, createLocalVault, readLocalVault } from '@noted/sync';
import type { LocalNoteStore, LocalBlobStore, VaultInfo } from '@noted/sync';
import { isLightColor } from '@noted/theme';
import { registerKdf } from './src/kdf';
import { AppState, Appearance } from 'react-native';
import { LockScreen, readAppLock, cacheVaultInfoForLock, cachedVaultVerifier } from './src/LockScreen';
import { setVaultKey } from './src/vault-session';
import { NotesScreen } from './src/NotesScreen';
import { T, PasswordField, refreshTheme, useThemeVersion, themed } from './src/ui';
import { KdfRunner, KdfHandle } from './src/KdfRunner';
import { DialogHost } from './src/Dialog';
import { apiUrl, hasServer, normalizeServerUrl, setServerAddress, MIN_PASSPHRASE_LENGTH } from '@noted/config';
import { backgroundWasIntended } from './src/away';

// Status bar icons (clock, battery) contrast with the app background: light on a dark theme,
// dark on a light one.
const statusBarStyle = () => (isLightColor(T.background) ? 'dark' : 'light');

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
  | { kind: 'newPassphrase'; info: VaultInfo; dataKey: Uint8Array };

function App() {
  const [masterKey, setMasterKey] = useState<Uint8Array | null>(null);
  const [rawStore, setDbStore] = useState<LocalNoteStore | null>(null);
  // Every save is merged with what is already stored (merging-store.ts): a slow sync can no
  // longer overwrite text typed meanwhile.
  const dbStore = useMemo(() => (rawStore && masterKey ? mergingNoteStore(masterKey, rawStore) : null), [rawStore, masterKey]);
  const [blobStore, setBlobStore] = useState<LocalBlobStore | null>(null);

  const [mode, setMode] = useState<Mode>(() => (hasServer() ? { kind: 'loading' } : { kind: 'server' }));
  const [serverText, setServerText] = useState(() => apiUrl());
  // A fresh server wants the setup code from its log before the vault can be created.
  const [needsCode, setNeedsCode] = useState(false);
  const [setupCode, setSetupCode] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [recoveryText, setRecoveryText] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(true);
  const kdfRef = useRef<KdfHandle>(null);
  // Settings > App lock: locked at start (when on) and after time in the background.
  const [locked, setLocked] = useState(() => readAppLock().enabled);
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
  // New colours (system light / dark switched, new wallpaper for Material You): checked when
  // the app comes to the front and when the system scheme changes; the app repaints in place.
  useEffect(() => {
    const app = AppState.addEventListener('change', (state) => { if (state === 'active') refreshTheme(); });
    const scheme = Appearance.addChangeListener(() => refreshTheme());
    return () => { app.remove(); scheme.remove(); };
  }, []);
  useEffect(() => {
    registerKdf(kdfRef.current);
    return () => registerKdf(null);
  }, []);

  const dummyKey = new Uint8Array(32);

  const loadVault = async () => {
    try {
      const { info, setupCode: codeNeeded } = await fetchVaultStatus();
      setNeedsCode(codeNeeded);
      setMode(info ? { kind: 'unlock', info } : { kind: 'create' });
      setError('');
    } catch {
      setError(`Cannot reach the server ${apiUrl().replace(/^https?:\/\//, '')}.`);
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
          refreshServerInfo();
        } else if (hasServer()) {
          await loadVault();
        } else {
          setBusy(false);
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
      if (mode.kind === 'server') {
        const base = normalizeServerUrl(serverText);
        if (!base) throw new Error('Enter the server address, e.g. https://notes.example.com or 100.64.0.1:3333.');
        if (!hasServer() && readLocalVault()) throw new Error('This phone keeps its vault without a server: unlock it, then use Settings > Sync > Connect a server (the notes go along).');
        await connectServer(base);
        setMode({ kind: 'loading' });
        await loadVault();
      } else if (mode.kind === 'create') {
        newPassphraseOk();
        const salt = generateSalt();
        const key = await kdfRef.current!.derive(passphrase, bytesToBase64(salt));
        const verifier = packBlob(createVerifier(key));
        otherVault(verifier);
        if (!hasServer()) {
          createLocalVault(salt, verifier);
          await unlocked(key, 0);
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
          throw new Error('A vault exists. Enter passphrase.');
        }
        if (!res.ok) throw new Error(`Server error (HTTP ${res.status})`);
        await unlocked(key, 0);
      } else if (mode.kind === 'unlock') {
        const key = openWithPassphraseKey(mode.info, await kdfRef.current!.derive(passphrase, mode.info.salt));
        if (!key) throw new Error('Wrong passphrase.');
        otherVault(mode.info.verifier);
        await unlocked(key, mode.info.authEpoch);
      } else if (mode.kind === 'recover') {
        const recoveryKey = parseRecoveryKey(recoveryText);
        if (!recoveryKey) throw new Error('That is not a valid recovery key (check for typos).');
        const dataKey = openWithRecoveryKey(mode.info, recoveryKey);
        if (!dataKey) throw new Error('This recovery key does not open this vault.');
        otherVault(mode.info.verifier);
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
    if (hasServer()) {
      setMode({ kind: 'loading' });
      loadVault();
    } else {
      setMode({ kind: 'server' });
    }
  };

  // The notes on this phone belong to one vault; another vault's key could not read them.
  const otherVault = (verifier: string) => {
    const known = cachedVaultVerifier();
    if (known && verifier !== known) {
      throw new Error('This phone holds the notes of another vault, which this one could not read. Go back to that vault\'s server, or clear Noted\'s app data first.');
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

  const choosing = mode.kind === 'create' || mode.kind === 'newPassphrase';
  return (
    <>
      {/* Always mounted: unlocking and Settings > Change passphrase derive keys in it. */}
      <KdfRunner ref={kdfRef} />
      <DialogHost />
      {masterKey && dbStore && blobStore ? (
        <>
          <StatusBar style={statusBarStyle()} />
          <NotesScreen masterKey={masterKey} dbStore={dbStore} blobStore={blobStore} onLogout={handleLogout} onLockNow={() => setLocked(true)} />
          {locked ? <LockScreen masterKey={masterKey} onUnlocked={() => setLocked(false)} /> : null}
        </>
      ) : (
        <View style={styles.container}>
          <StatusBar style={statusBarStyle()} />
          <Text style={styles.title}>Noted</Text>
          {notice ? <Text style={styles.notice}>{notice}</Text> : null}
          <View style={styles.card}>
            <Text style={styles.label}>
              {mode.kind === 'create' ? (hasServer()
                ? 'Create a passphrase (save the recovery key in Settings afterwards):'
                : 'Create a passphrase for a vault on this phone only (a server can be connected later in Settings > Sync). Save the recovery key and make backups:')
                : mode.kind === 'unlock' ? 'Enter passphrase:'
                : mode.kind === 'recover' ? 'Enter your recovery key:'
                : mode.kind === 'newPassphrase' ? 'Recovery key accepted. Choose a new passphrase:'
                : mode.kind === 'server' ? 'Address of your Noted server (it only ever stores encrypted data), or use Noted without one: notes then stay on this phone.'
                : 'Connecting to server...'}
            </Text>
            {mode.kind === 'server' ? (
              <TextInput style={styles.input} value={serverText} onChangeText={setServerText} autoCapitalize="none" autoCorrect={false}
                keyboardType="url" placeholder="https://notes.example.com" placeholderTextColor={T.on_surface_variant} />
            ) : null}
            {mode.kind === 'unlock' || choosing ? (
              <PasswordField style={styles.input} value={passphrase} onChangeText={setPassphrase}
                placeholder={mode.kind === 'newPassphrase' ? 'New passphrase' : 'Passphrase'} />
            ) : null}
            {choosing ? (
              <PasswordField style={styles.input} value={confirm} onChangeText={setConfirm} placeholder="Repeat passphrase" />
            ) : null}
            {needsCode && mode.kind === 'create' ? (
              <>
                <Text style={styles.label}>This server is new: enter the setup code from its log (docker logs noted_api).</Text>
                <TextInput style={[styles.input, { fontFamily: 'monospace' }]} value={setupCode} onChangeText={setSetupCode}
                  autoCapitalize="characters" autoCorrect={false} placeholder="XXXX-XXXX-XXXX" placeholderTextColor={T.on_surface_variant} />
              </>
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
                    {mode.kind === 'server' ? 'Connect' : mode.kind === 'create' ? 'Create Vault' : mode.kind === 'recover' ? 'Check recovery key' : mode.kind === 'newPassphrase' ? 'Set passphrase and unlock' : 'Unlock'}
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
            {mode.kind === 'server' ? (
              <TouchableOpacity onPress={withoutServer} disabled={busy} style={[styles.button, styles.secondary]}>
                <Text style={styles.secondaryText}>Use without a server</Text>
              </TouchableOpacity>
            ) : null}
            {mode.kind === 'server' && hasServer() ? (
              <TouchableOpacity onPress={() => { setError(''); setMode({ kind: 'loading' }); loadVault(); }} style={styles.link}>
                <Text style={styles.linkText}>Back: keep {apiUrl().replace(/^https?:\/\//, '')}</Text>
              </TouchableOpacity>
            ) : null}
            {mode.kind !== 'server' ? (
              <TouchableOpacity onPress={changeServer} style={styles.link}>
                <Text style={styles.linkText}>{hasServer() ? `Server: ${apiUrl().replace(/^https?:\/\//, '')}` : 'No server (this phone only)'} · change</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      )}
    </>
  );
}

const styles = themed(() => StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: T.background },
  title: { fontSize: 28, fontWeight: 'bold', color: T.on_surface, marginBottom: 32, textAlign: 'center' },
  notice: { color: T.on_surface, fontSize: 14, textAlign: 'center', marginBottom: 16 },
  card: { backgroundColor: T.surface_container, padding: 20, borderRadius: 16, borderWidth: 1, borderColor: T.outline_variant },
  label: { color: T.on_surface_variant, marginBottom: 8, fontSize: 14 },
  input: { backgroundColor: T.surface_container_high, color: T.on_surface, padding: 12, borderRadius: 8, marginBottom: 16, fontSize: 16 },
  button: { backgroundColor: T.primary, padding: 14, borderRadius: 24, alignItems: 'center' },
  buttonText: { color: T.on_primary, fontWeight: 'bold', fontSize: 16 },
  secondary: { marginTop: 10, backgroundColor: 'transparent', borderWidth: 1, borderColor: T.outline_variant },
  secondaryText: { color: T.on_surface, fontSize: 16 },
  error: { color: T.error, fontSize: 12, marginBottom: 12, textAlign: 'center' },
  link: { marginTop: 14, alignItems: 'center' },
  linkText: { color: T.primary, fontSize: 14 },
}));

// The keyboard is followed natively, frame by frame (react-native-keyboard-controller): the
// editor's box shrinks together with the keyboard animation instead of after it.
// A theme change re-renders everything from here (the colours are read while rendering).
export default function Root() {
  const themeVersion = useThemeVersion();
  // The window behind the app (seen while the keyboard animates) in the theme's background.
  useEffect(() => { SystemUI.setBackgroundColorAsync(T.background).catch(() => {}); }, [themeVersion]);
  return (
    <KeyboardProvider>
      <App />
    </KeyboardProvider>
  );
}
