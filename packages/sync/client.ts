import { API_URL, REQUEST_TIMEOUT_MS } from '@noted/config';
import { deriveAuthToken, checkVerifier, base64ToBytes, bytesToBase64 } from '@noted/crypto';
import { RemoteNote } from '@noted/types';

// Epoch of the auth token (see account.ts, "log out from all other devices"). The app sets it
// from its storage at start and after unlocking.
let authEpoch = 0;
export const setAuthEpoch = (epoch: number): void => { authEpoch = Number.isInteger(epoch) && epoch >= 0 ? epoch : 0; };
export const getAuthEpoch = (): number => authEpoch;
export const currentAuthToken = (masterKey: Uint8Array): string => bytesToBase64(deriveAuthToken(masterKey, authEpoch));

const authHeaders = (masterKey: Uint8Array): Record<string, string> => ({
  Authorization: `Bearer ${currentAuthToken(masterKey)}`,
});

export const apiFetch = (url: string, masterKey: Uint8Array, init: RequestInit = {}, timeoutMs = REQUEST_TIMEOUT_MS) =>
  fetch(url, {
    ...init,
    headers: { ...authHeaders(masterKey), ...(init.headers as Record<string, string> | undefined) },
    signal: AbortSignal.timeout(timeoutMs),
  });

export const fetchRemoteNote = async (id: string, masterKey: Uint8Array): Promise<RemoteNote> => {
  const res = await apiFetch(`${API_URL}/notes/${id}`, masterKey);
  if (!res.ok) throw new Error(`Pull failed for ${id} (HTTP ${res.status})`);
  return res.json();
};

export const pushNote = async (id: string, content: string, yjsState: string, updatedAt: number, masterKey: Uint8Array) => {
  const res = await apiFetch(`${API_URL}/notes/${id}`, masterKey, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ encrypted_html: content, encrypted_yjs: yjsState, updated_at: updatedAt }),
  });
  if (!res.ok) throw new Error(`Push failed for ${id} (HTTP ${res.status})`);
};

// Optional persistent cache for the vault verifier, provided by the host app (desktop uses
// localStorage). Without one the verifier is fetched once per launch.
export interface VerifierCache {
  get(): string | null;
  set(verifier: string): void;
}

let verifierCache: VerifierCache | null = null;
let cachedVerifier: string | null = null;

export const configureVerifierCache = (cache: VerifierCache) => {
  verifierCache = cache;
  cachedVerifier = cache.get();
};

export const keyMatchesVault = async (masterKey: Uint8Array): Promise<boolean> => {
  let verifier = cachedVerifier;
  if (!verifier) {
    const res = await apiFetch(`${API_URL}/vault`, masterKey);
    if (!res.ok) throw new Error(`Vault fetch failed (HTTP ${res.status})`);
    verifier = (await res.json()).verifier as string;
    cachedVerifier = verifier;
    verifierCache?.set(verifier);
  }
  const [n, c] = verifier.split('.');
  return checkVerifier(masterKey, base64ToBytes(n), base64ToBytes(c));
};

let authRegistered = false;
export const ensureAuthRegistered = async (masterKey: Uint8Array) => {
  if (authRegistered) return;
  const res = await apiFetch(`${API_URL}/vault/auth`, masterKey, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ auth_token: bytesToBase64(deriveAuthToken(masterKey)) }),
  });
  if (!res.ok && res.status !== 409) throw new Error(`Auth registration failed (HTTP ${res.status})`);
  authRegistered = true;
};
