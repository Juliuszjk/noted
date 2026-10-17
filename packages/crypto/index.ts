import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha2";
import { argon2id } from "@noble/hashes/argon2";
import { pbkdf2 } from "@noble/hashes/pbkdf2";
import { xchacha20poly1305 } from '@noble/ciphers/chacha';

// Universal generator using native Web Crypto API
export function getRandomBytes(length: number): Uint8Array {
  // Web Crypto exists in browsers, Tauri webviews and Node >= 19.
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  return arr;
}

export function generateKey(): Uint8Array {
  return getRandomBytes(32);
}

export function generateNonce(): Uint8Array {
  return getRandomBytes(24);
}

export function encryptBlob(key: Uint8Array, plaintext: Uint8Array): { ciphertext: Uint8Array; nonce: Uint8Array } {
  const nonce = generateNonce();
  const cipher = xchacha20poly1305(key, nonce);
  const ciphertext = cipher.encrypt(plaintext);
  
  return { ciphertext, nonce };
}

export function decryptBlob(key: Uint8Array, nonce: Uint8Array, ciphertext: Uint8Array): Uint8Array {
  const cipher = xchacha20poly1305(key, nonce);
  return cipher.decrypt(ciphertext);
}

// ---- Key derivation: passphrase -> master key ----
// m is in KiB (65536 = 64 MiB). Tune on target devices (see phone spike).
const KDF_PARAMS = { t: 3, m: 65536, p: 1, dkLen: 32 } as const;
const VERIFIER_PLAINTEXT = new TextEncoder().encode('noted-vault-v1');

export function generateSalt(): Uint8Array {
  return getRandomBytes(16);
}

export function deriveMasterKey(passphrase: string, salt: Uint8Array): Uint8Array {
  return argon2id(passphrase, salt, KDF_PARAMS);
}

// Stored on the server next to the salt. Lets a new device detect a wrong
// passphrase instead of silently deriving a key that decrypts nothing.
export function createVerifier(key: Uint8Array): { ciphertext: Uint8Array; nonce: Uint8Array } {
  return encryptBlob(key, VERIFIER_PLAINTEXT);
}

export function checkVerifier(key: Uint8Array, nonce: Uint8Array, ciphertext: Uint8Array): boolean {
  try {
    const plain = decryptBlob(key, nonce, ciphertext);
    return new TextDecoder().decode(plain) === 'noted-vault-v1';
  } catch {
    return false;
  }
}

// ---- Wire format: "base64(nonce).base64(ciphertext)" ----
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Base64 never contains '.', so splitting on it is safe.
export function seal(key: Uint8Array, plaintext: Uint8Array): string {
  const { nonce, ciphertext } = encryptBlob(key, plaintext);
  return `${bytesToBase64(nonce)}.${bytesToBase64(ciphertext)}`;
}

export function unseal(key: Uint8Array, packed: string): Uint8Array {
  const [n, c] = packed.split('.');
  if (!n || !c) throw new Error('Malformed sealed blob');
  return decryptBlob(key, base64ToBytes(n), base64ToBytes(c));
}

// ---- Binary sealing for blobs (images, attachments) ----
// The nonce (24 bytes) followed by the ciphertext, without base64, so uploads stay small.
// Each blob has its own random key (generateKey), stored inside the encrypted note.
const NONCE_BYTES = 24;

export function sealBytes(key: Uint8Array, plaintext: Uint8Array): Uint8Array {
  const { nonce, ciphertext } = encryptBlob(key, plaintext);
  const packed = new Uint8Array(NONCE_BYTES + ciphertext.length);
  packed.set(nonce, 0);
  packed.set(ciphertext, NONCE_BYTES);
  return packed;
}

export function unsealBytes(key: Uint8Array, packed: Uint8Array): Uint8Array {
  if (packed.length <= NONCE_BYTES) throw new Error('Malformed sealed blob');
  return decryptBlob(key, packed.subarray(0, NONCE_BYTES), packed.subarray(NONCE_BYTES));
}

// ---- Auth token: proves knowledge of the master key to the server without revealing it ----
// Derived with HKDF under its own label, so it is independent of the encryption key.
// The server stores only a hash of this token.
// `epoch` grows when the user logs out every other device (the server then accepts only the
// token of the new epoch). Epoch 0 keeps the original label, so existing vaults are unchanged.
export function deriveAuthToken(masterKey: Uint8Array, epoch = 0): Uint8Array {
  return hkdf(sha256, masterKey, undefined, epoch > 0 ? `noted-auth-v1:${epoch}` : 'noted-auth-v1', 32);
}

// ---- Key envelopes: change of password and the recovery key ----
// The notes are encrypted with the data key. Vaults created before envelopes existed use the
// passphrase-derived key itself as the data key; afterwards the data key is wrapped ("sealed")
// by the key derived from the current passphrase, and once more by the recovery key, so a new
// passphrase or the recovery key open the same notes without re-encrypting anything.

export function wrapKey(wrappingKey: Uint8Array, dataKey: Uint8Array): string {
  return seal(wrappingKey, dataKey);
}

export function unwrapKey(wrappingKey: Uint8Array, wrapped: string): Uint8Array | null {
  try {
    const key = unseal(wrappingKey, wrapped);
    return key.length === 32 ? key : null;
  } catch {
    return null;
  }
}

// The recovery key wraps the data key through HKDF under its own label.
export function recoveryWrappingKey(recoveryKey: Uint8Array): Uint8Array {
  return hkdf(sha256, recoveryKey, undefined, 'noted-recovery-v1', 32);
}

// Recovery key as text: Crockford base32 of the 32 bytes plus 2 check characters, in groups of
// four ("7K3M-...") so it can be written down; reading it back forgives case, spaces, dashes
// and the usual look-alikes (O/0, I/L/1, U/V).
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const toBase32 = (bytes: Uint8Array): string => {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
};

const fromBase32 = (text: string): Uint8Array | null => {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of text) {
    const v = B32.indexOf(ch);
    if (v < 0) return null;
    value = ((value << 5) | v) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
};

const recoveryCheck = (key: Uint8Array): string => toBase32(sha256(key).subarray(0, 2)).slice(0, 2);

export function formatRecoveryKey(key: Uint8Array): string {
  return (toBase32(key) + recoveryCheck(key)).match(/.{1,4}/g)!.join('-');
}

export function parseRecoveryKey(text: string): Uint8Array | null {
  const clean = text.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1').replace(/U/g, 'V');
  if (clean.length !== 54) return null;
  const key = fromBase32(clean.slice(0, 52));
  if (!key || key.length !== 32) return null;
  return recoveryCheck(key) === clean.slice(52) ? key : null;
}
export * from './encoding';

// Key of a password-protected published note: both the key in the link and the password are
// needed. PBKDF2 (fast enough for a phone's browser) stretches the password, salted with the
// link key, and HKDF binds both together.
export function publishPasswordKey(linkKey: Uint8Array, password: string): Uint8Array {
  const stretched = pbkdf2(sha256, new TextEncoder().encode(password.normalize('NFC')), linkKey, { c: 100_000, dkLen: 32 });
  return hkdf(sha256, stretched, linkKey, 'noted-publish-password-v1', 32);
}
