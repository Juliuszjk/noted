import type { KdfHandle } from './KdfRunner';

// Argon2id for screens other than unlocking (Settings > Change passphrase): App keeps the
// hidden KDF WebView mounted and registers it here.
let handle: KdfHandle | null = null;

export const registerKdf = (kdf: KdfHandle | null) => { handle = kdf; };

export const deriveKeyInWebView = (passphrase: string, saltBase64: string): Promise<Uint8Array> => {
  if (!handle) return Promise.reject(new Error('Key derivation is not ready yet.'));
  return handle.derive(passphrase, saltBase64);
};
