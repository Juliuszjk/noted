import { apiUrl } from '@noted/config';
import {
  base64ToBytes, bytesToBase64, checkVerifier, deriveAuthToken, generateKey, recoveryWrappingKey, seal, unseal,
  unwrapKey, wrapKey,
} from '@noted/crypto';
import { apiFetch, getAuthEpoch, setAuthEpoch } from './client';

// The vault and the account settings: passphrase change, recovery key, logging out other
// devices. The data key (that encrypts every note) never changes; the passphrase's key and
// the recovery key only wrap it (see the envelope notes in @noted/crypto). Argon2id runs in
// the app (desktop directly, mobile in a WebView), so these functions take the derived key.

export interface VaultInfo {
  salt: string;
  verifier: string;
  keyEnvelope: string | null;
  recoveryEnvelope: string | null;
  authEpoch: number;
  createdAt: number | null;
}

const NO_KEY = new Uint8Array(32);

// The vault, or null and whether creating one needs the server's setup code (its log shows it).
export const fetchVaultStatus = async (): Promise<{ info: VaultInfo | null; setupCode: boolean }> => {
  const res = await apiFetch(`${apiUrl()}/vault`, NO_KEY);
  if (res.status === 404) {
    const body = await res.json().catch(() => null);
    return { info: null, setupCode: body?.setupCode === true };
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const v = await res.json();
  return {
    info: {
      salt: v.salt, verifier: v.verifier, keyEnvelope: v.key_envelope ?? null, recoveryEnvelope: v.recovery_envelope ?? null,
      authEpoch: typeof v.auth_epoch === 'number' ? v.auth_epoch : 0, createdAt: typeof v.created_at === 'number' ? v.created_at : null,
    },
    setupCode: false,
  };
};

export const fetchVault = async (): Promise<VaultInfo | null> => (await fetchVaultStatus()).info;

// Header of a vault creation on a server that wants its setup code.
export const setupCodeHeader = (code?: string): Record<string, string> => (code?.trim() ? { 'X-Setup-Code': code.trim() } : {});
export const WRONG_SETUP_CODE = 'Wrong setup code. It is in the server\'s log (docker logs noted_api).';

const verifies = (info: VaultInfo, dataKey: Uint8Array): boolean => {
  const [n, c] = info.verifier.split('.');
  return !!n && !!c && checkVerifier(dataKey, base64ToBytes(n), base64ToBytes(c));
};

// The data key from the key derived from the passphrase; null = wrong passphrase.
export const openWithPassphraseKey = (info: VaultInfo, passphraseKey: Uint8Array): Uint8Array | null => {
  const dataKey = info.keyEnvelope ? unwrapKey(passphraseKey, info.keyEnvelope) : passphraseKey;
  return dataKey && verifies(info, dataKey) ? dataKey : null;
};

// The data key from the recovery key; null = wrong key or no recovery key was ever saved.
export const openWithRecoveryKey = (info: VaultInfo, recoveryKey: Uint8Array): Uint8Array | null => {
  if (!info.recoveryEnvelope) return null;
  const dataKey = unwrapKey(recoveryWrappingKey(recoveryKey), info.recoveryEnvelope);
  return dataKey && verifies(info, dataKey) ? dataKey : null;
};

const json = (body: unknown): RequestInit => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const check = async (res: Response, what: string) => {
  if (res.status === 401) throw new Error('This device is logged out. Unlock again.');
  if (!res.ok) throw new Error(`${what} failed (HTTP ${res.status})`);
};

// New passphrase: `newSalt` and `newPassphraseKey` = Argon2id(new passphrase, newSalt).
export const changePassphrase = async (dataKey: Uint8Array, newSalt: Uint8Array, newPassphraseKey: Uint8Array): Promise<void> => {
  const res = await apiFetch(`${apiUrl()}/account/password`, dataKey, {
    method: 'PUT', ...json({ salt: bytesToBase64(newSalt), key_envelope: wrapKey(newPassphraseKey, dataKey) }),
  });
  await check(res, 'Changing the passphrase');
};

// The recovery key: the saved one, or (with `renew`, or when none exists yet) a new one that
// replaces it on the server.
export const getRecoveryKey = async (dataKey: Uint8Array, renew = false): Promise<Uint8Array> => {
  if (!renew) {
    const res = await apiFetch(`${apiUrl()}/account/recovery`, dataKey);
    await check(res, 'Reading the recovery key');
    const { recovery_sealed } = await res.json();
    if (recovery_sealed) {
      const key = unseal(dataKey, recovery_sealed);
      if (key.length === 32) return key;
    }
  }
  const recoveryKey = generateKey();
  const res = await apiFetch(`${apiUrl()}/account/recovery`, dataKey, {
    method: 'PUT', ...json({ recovery_envelope: wrapKey(recoveryWrappingKey(recoveryKey), dataKey), recovery_sealed: seal(dataKey, recoveryKey) }),
  });
  await check(res, 'Saving the recovery key');
  return recoveryKey;
};

// Every other device must unlock again (honest devices: one that is still unlocked holds the
// data key and could compute the next token itself; that needs a new data key, not this).
export const logoutOtherDevices = async (dataKey: Uint8Array): Promise<number> => {
  const epoch = getAuthEpoch() + 1;
  const res = await apiFetch(`${apiUrl()}/account/rotate-auth`, dataKey, {
    method: 'POST', ...json({ auth_token: bytesToBase64(deriveAuthToken(dataKey, epoch)), epoch }),
  });
  await check(res, 'Logging out the other devices');
  setAuthEpoch(epoch);
  return epoch;
};

// Is this device still logged in? false = the token epoch moved on (logged out elsewhere);
// null = the server cannot be asked right now.
export const sessionStillValid = async (): Promise<boolean | null> => {
  try {
    const info = await fetchVault();
    return info ? info.authEpoch === getAuthEpoch() : null;
  } catch {
    return null;
  }
};

export interface AccountStats {
  notes: number;
  noteBytes: number;
  blobs: number;
  blobBytes: number;
  published: number;
}

export const fetchAccountStats = async (dataKey: Uint8Array): Promise<AccountStats> => {
  const res = await apiFetch(`${apiUrl()}/account/stats`, dataKey);
  await check(res, 'Reading the storage numbers');
  return res.json();
};

// App lock: does this passphrase key open the vault to this data key? (Works offline with a
// cached VaultInfo.)
export const passphraseOpens = (info: VaultInfo, passphraseKey: Uint8Array, dataKey: Uint8Array): boolean => {
  const opened = openWithPassphraseKey(info, passphraseKey);
  return !!opened && opened.length === dataKey.length && opened.every((b, i) => b === dataKey[i]);
};

// ---- the vault inside backups: a new (or replaced) server can be set up from a backup ----

// Everything here is public on the server or sealed (like GET /vault), so it may sit in a
// backup file. The auth token is not in it: it follows from the data key.
export interface BackupVault {
  salt: string;
  verifier: string;
  keyEnvelope: string | null;
  recoveryEnvelope: string | null;
  // The recovery key sealed with the data key (Settings shows the key again with it).
  recoverySealed: string | null;
  createdAt: number | null;
}

export const fetchBackupVault = async (dataKey: Uint8Array): Promise<BackupVault | null> => {
  const info = await fetchVault();
  if (!info) return null;
  let recoverySealed: string | null = null;
  try {
    const res = await apiFetch(`${apiUrl()}/account/recovery`, dataKey);
    if (res.ok) recoverySealed = (await res.json()).recovery_sealed ?? null;
  } catch {
    // Without it the vault still works; the recovery key can be renewed later.
  }
  return { salt: info.salt, verifier: info.verifier, keyEnvelope: info.keyEnvelope, recoveryEnvelope: info.recoveryEnvelope, recoverySealed, createdAt: info.createdAt };
};

export const vaultInfoOf = (v: BackupVault): VaultInfo => ({
  salt: v.salt, verifier: v.verifier, keyEnvelope: v.keyEnvelope, recoveryEnvelope: v.recoveryEnvelope, authEpoch: 0, createdAt: v.createdAt,
});

// The server has no vault (new or replaced server): put the backup's vault there, so the same
// passphrase, recovery key and data key work again. `epoch` = this device's auth epoch.
export const restoreServerVault = async (dataKey: Uint8Array, v: BackupVault, epoch = 0, setupCode?: string): Promise<void> => {
  if (!verifies(vaultInfoOf(v), dataKey)) throw new Error('This backup belongs to another vault (a different key).');
  const res = await apiFetch(`${apiUrl()}/vault`, dataKey, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...setupCodeHeader(setupCode) },
    body: JSON.stringify({
      salt: v.salt, verifier: v.verifier, auth_token: bytesToBase64(deriveAuthToken(dataKey, epoch)), auth_epoch: epoch,
      key_envelope: v.keyEnvelope, recovery_envelope: v.recoveryEnvelope, recovery_sealed: v.recoverySealed, created_at: v.createdAt,
    }),
  });
  if (res.status === 403) throw new Error(WRONG_SETUP_CODE);
  if (res.status === 409) throw new Error('This server already has a vault, so nothing was changed. This is only for a new or replaced server without one.');
  if (!res.ok) throw new Error(`Setting up the vault failed (HTTP ${res.status})`);
  setAuthEpoch(epoch);
};

export const serializeVaultInfo = (info: VaultInfo): string => JSON.stringify(info);
export const parseVaultInfo = (text: string | null): VaultInfo | null => {
  try {
    const v = JSON.parse(text ?? 'null');
    return v && typeof v.salt === 'string' && typeof v.verifier === 'string' ? v as VaultInfo : null;
  } catch {
    return null;
  }
};
