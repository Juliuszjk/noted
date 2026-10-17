import { deriveMasterKey } from '@noted/crypto';

// Runs inside a hidden WebView. Hermes has no JIT, so Argon2id takes minutes there; the
// WebView's Chromium engine does the same work in a few seconds. The derivation itself is
// the shared deriveMasterKey, so the result is identical to desktop. Nothing touches the network.

const post = (msg: Record<string, unknown>) =>
  (window as any).ReactNativeWebView?.postMessage(JSON.stringify(msg));

const toBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
};

const fromBase64 = (b64: string): Uint8Array => {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

(window as any).__kdf = {
  derive(raw: string) {
    const { id, passphrase, salt } = JSON.parse(raw);
    try {
      const key = deriveMasterKey(passphrase, fromBase64(salt));
      post({ type: 'key', id, key: toBase64(key) });
    } catch (e) {
      post({ type: 'error', id, message: e instanceof Error ? e.message : 'Key derivation failed' });
    }
  },
};

post({ type: 'ready' });
