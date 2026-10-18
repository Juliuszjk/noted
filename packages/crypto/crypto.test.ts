import { describe, it, expect, test } from 'vitest';
import { generateKey, encryptBlob, decryptBlob } from './index';

test('encrypts and decrypts successfully', () => {
  const key = generateKey();
  const message = new TextEncoder().encode('Hello Apollo');

  const { ciphertext, nonce } = encryptBlob(key, message);
  expect(ciphertext).not.toEqual(message);

  const decrypted = decryptBlob(key, nonce, ciphertext);
  expect(new TextDecoder().decode(decrypted)).toBe('Hello Apollo');
});

test('fails to decrypt with wrong key', () => {
  const key = generateKey();
  const wrongKey = generateKey();
  const message = new TextEncoder().encode('Secret data');

  const { ciphertext, nonce } = encryptBlob(key, message);

  expect(() => decryptBlob(wrongKey, nonce, ciphertext)).toThrow();
});

import { deriveMasterKey, generateSalt, createVerifier, checkVerifier } from './index';

test('same passphrase and salt give the same key, different passphrase does not', () => {
  const salt = generateSalt();
  const a = deriveMasterKey('correct horse', salt);
  const b = deriveMasterKey('correct horse', salt);
  const c = deriveMasterKey('wrong horse', salt);
  expect(a).toEqual(b);
  expect(a).not.toEqual(c);
  expect(a.length).toBe(32);
}, 60000);

test('verifier accepts the right key and rejects the wrong one', () => {
  const key = generateKey();
  const { nonce, ciphertext } = createVerifier(key);
  expect(checkVerifier(key, nonce, ciphertext)).toBe(true);
  expect(checkVerifier(generateKey(), nonce, ciphertext)).toBe(false);
});

import { deriveAuthToken } from './index';

test('auth token is deterministic, 32 bytes, and differs from the key and between keys', () => {
  const k1 = generateKey();
  const k2 = generateKey();
  expect(deriveAuthToken(k1)).toEqual(deriveAuthToken(k1));
  expect(deriveAuthToken(k1)).not.toEqual(deriveAuthToken(k2));
  expect(deriveAuthToken(k1)).not.toEqual(k1);
  expect(deriveAuthToken(k1).length).toBe(32);
});

import { sealBytes, unsealBytes } from './index';

test('binary sealing round-trips and rejects a wrong key or tampering', () => {
  const key = generateKey();
  const data = new Uint8Array([1, 2, 3, 250, 0, 7]);
  const packed = sealBytes(key, data);
  expect(packed.length).toBe(24 + data.length + 16);
  expect(unsealBytes(key, packed)).toEqual(data);
  expect(() => unsealBytes(generateKey(), packed)).toThrow();
  const tampered = packed.slice();
  tampered[30] ^= 1;
  expect(() => unsealBytes(key, tampered)).toThrow();
  expect(() => unsealBytes(key, new Uint8Array(10))).toThrow();
});
describe('publishPasswordKey', () => {
  it('needs both the link key and the password', async () => {
    const { publishPasswordKey } = await import('./index');
    const link = new Uint8Array(32).fill(7);
    const a = publishPasswordKey(link, 'hasło');
    expect(a).toHaveLength(32);
    expect(publishPasswordKey(link, 'hasło')).toEqual(a);
    expect(publishPasswordKey(link, 'haslo')).not.toEqual(a);
    expect(publishPasswordKey(new Uint8Array(32).fill(8), 'hasło')).not.toEqual(a);
  });
});

describe('key envelopes and the recovery key', () => {
  it('wraps the data key and reads the recovery key back from its text form', async () => {
    const m = await import('./index');
    const dataKey = m.generateKey();
    const kek = m.generateKey();
    const wrapped = m.wrapKey(kek, dataKey);
    expect(m.unwrapKey(kek, wrapped)).toEqual(dataKey);
    expect(m.unwrapKey(m.generateKey(), wrapped)).toBeNull();

    for (let i = 0; i < 50; i++) {
      const recovery = m.generateKey();
      const text = m.formatRecoveryKey(recovery);
      expect(text).toMatch(/^([0-9A-Z]{4}-){13}[0-9A-Z]{2}$/);
      expect(m.parseRecoveryKey(text)).toEqual(recovery);
      expect(m.parseRecoveryKey(` ${text.toLowerCase().replace(/-/g, ' ')} `)).toEqual(recovery);
    }
    // A typo is caught by the check characters (fixed key: the result does not depend on luck).
    const fixed = m.formatRecoveryKey(new Uint8Array(32).map((_, i) => i * 7));
    expect(m.parseRecoveryKey(fixed)).not.toBeNull();
    expect(m.parseRecoveryKey((fixed[0] === 'A' ? 'B' : 'A') + fixed.slice(1))).toBeNull();
    expect(m.parseRecoveryKey(fixed.slice(0, -1))).toBeNull();
    const recovery = m.generateKey();
    expect(m.unwrapKey(m.recoveryWrappingKey(recovery), m.wrapKey(m.recoveryWrappingKey(recovery), dataKey))).toEqual(dataKey);
  });

  it('keeps the epoch 0 auth token unchanged', async () => {
    const m = await import('./index');
    const key = new Uint8Array(32).fill(1);
    expect(m.deriveAuthToken(key)).toEqual(m.deriveAuthToken(key, 0));
    expect(m.deriveAuthToken(key, 1)).not.toEqual(m.deriveAuthToken(key, 0));
  });
});

describe('deriveLiveKeys', () => {
  it('gives three different keys that depend on the link key', async () => {
    const { deriveLiveKeys } = await import('./index');
    const a = deriveLiveKeys(generateKey());
    const b = deriveLiveKeys(generateKey());
    expect(a.content).toHaveLength(32);
    expect(new Set([a.content, a.read, a.write].map((k) => k.join()))).toHaveProperty('size', 3);
    expect(a.read.join()).not.toBe(b.read.join());
  });
});
