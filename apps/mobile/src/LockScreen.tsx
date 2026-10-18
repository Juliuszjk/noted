import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { mdiLockOutline, mdiFingerprint } from '@mdi/js';
import { fetchVault, parseVaultInfo, passphraseOpens, serializeVaultInfo } from '@noted/sync';
import { T, Icon, PasswordField, themed } from './ui';
import { deriveKeyInWebView } from './kdf';

// Settings > App lock on the phone: fingerprint / face (when switched on), or the passphrase.
export const APP_LOCK_KEY = 'noted_app_lock';
const VAULT_INFO_KEY = 'noted_vault_info';

export interface AppLock {
  enabled: boolean;
  // Minutes in the background before it locks; 0 = at once.
  minutes: number;
  biometrics: boolean;
}

export const readAppLock = (): AppLock => {
  try {
    const d = JSON.parse(SecureStore.getItem(APP_LOCK_KEY) ?? '{}');
    return { enabled: d.enabled === true, minutes: [0, 1, 5, 15].includes(d.minutes) ? d.minutes : 1, biometrics: d.biometrics !== false };
  } catch {
    return { enabled: false, minutes: 1, biometrics: true };
  }
};
export const writeAppLock = (lock: AppLock) => SecureStore.setItem(APP_LOCK_KEY, JSON.stringify(lock));

// The vault whose notes this phone holds (null = none yet): the unlock screen refuses another.
export const cachedVaultVerifier = (): string | null => parseVaultInfo(SecureStore.getItem(VAULT_INFO_KEY))?.verifier ?? null;

export const cacheVaultInfoForLock = async () => {
  const info = await fetchVault().catch(() => null);
  if (info) await SecureStore.setItemAsync(VAULT_INFO_KEY, serializeVaultInfo(info));
};

export function LockScreen({ masterKey, onUnlocked }: { masterKey: Uint8Array; onUnlocked: () => void }) {
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [canBio, setCanBio] = useState(false);
  const lock = readAppLock();

  const biometric = async () => {
    const result = await LocalAuthentication.authenticateAsync({ promptMessage: 'Unlock Noted', cancelLabel: 'Use passphrase' });
    if (result.success) onUnlocked();
  };
  useEffect(() => {
    (async () => {
      const ok = lock.biometrics && await LocalAuthentication.hasHardwareAsync() && await LocalAuthentication.isEnrolledAsync();
      setCanBio(!!ok);
      if (ok) biometric().catch(() => {});
    })();
  }, []);

  const unlock = async () => {
    setBusy(true);
    setError('');
    try {
      const fresh = await fetchVault().catch(() => null);
      if (fresh) await SecureStore.setItemAsync(VAULT_INFO_KEY, serializeVaultInfo(fresh));
      const info = fresh ?? parseVaultInfo(await SecureStore.getItemAsync(VAULT_INFO_KEY));
      if (!info) throw new Error('Cannot check the passphrase (no vault data yet).');
      if (passphraseOpens(info, await deriveKeyInWebView(passphrase, info.salt), masterKey)) onUnlocked();
      else setError('Wrong passphrase.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.screen}>
      <Icon path={mdiLockOutline} size={48} color={T.primary} />
      <Text style={styles.title}>Noted is locked</Text>
      {canBio ? (
        <TouchableOpacity style={styles.bio} onPress={() => biometric().catch(() => {})}>
          <Icon path={mdiFingerprint} size={28} color={T.on_primary} />
          <Text style={styles.bioText}>Unlock</Text>
        </TouchableOpacity>
      ) : null}
      <View style={{ width: '100%', marginTop: 24 }}>
        <PasswordField value={passphrase} onChangeText={setPassphrase} placeholder="Passphrase" style={styles.input} />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <TouchableOpacity style={styles.button} disabled={busy || !passphrase} onPress={unlock}>
          {busy ? <ActivityIndicator color={T.on_surface} /> : <Text style={styles.buttonText}>Unlock with passphrase</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  screen: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: T.background, alignItems: 'center', justifyContent: 'center', padding: 32, zIndex: 1000, elevation: 20 },
  title: { color: T.on_surface, fontSize: 22, fontWeight: 'bold', marginTop: 12 },
  bio: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 28, paddingHorizontal: 24, paddingVertical: 14, borderRadius: 28, backgroundColor: T.primary },
  bioText: { color: T.on_primary, fontSize: 16, fontWeight: 'bold' },
  input: { backgroundColor: T.surface_container_high, color: T.on_surface, padding: 12, borderRadius: 10, fontSize: 16, marginBottom: 10 },
  error: { color: T.error, fontSize: 13, marginBottom: 10, textAlign: 'center' },
  button: { padding: 13, borderRadius: 22, borderWidth: 1, borderColor: T.outline_variant, alignItems: 'center' },
  buttonText: { color: T.on_surface, fontSize: 15, fontWeight: '600' },
}));
