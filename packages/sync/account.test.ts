import { describe, it, expect } from 'vitest';
import { generateKey, createVerifier, bytesToBase64, wrapKey, recoveryWrappingKey } from '@noted/crypto';
import { openWithPassphraseKey, openWithRecoveryKey } from './account';
import type { VaultInfo } from './account';

const vaultFor = (dataKey: Uint8Array, extra: Partial<VaultInfo> = {}): VaultInfo => {
  const v = createVerifier(dataKey);
  return { salt: 's', verifier: `${bytesToBase64(v.nonce)}.${bytesToBase64(v.ciphertext)}`, keyEnvelope: null, recoveryEnvelope: null, authEpoch: 0, createdAt: null, ...extra };
};

describe('opening the vault', () => {
  it('uses the passphrase key itself in old vaults, the envelope after a passphrase change', () => {
    const dataKey = generateKey();
    expect(openWithPassphraseKey(vaultFor(dataKey), dataKey)).toEqual(dataKey);
    expect(openWithPassphraseKey(vaultFor(dataKey), generateKey())).toBeNull();
    const newKey = generateKey();
    const changed = vaultFor(dataKey, { keyEnvelope: wrapKey(newKey, dataKey) });
    expect(openWithPassphraseKey(changed, newKey)).toEqual(dataKey);
    // The old passphrase's key does not open the envelope.
    expect(openWithPassphraseKey(changed, dataKey)).toBeNull();
  });

  it('opens with the recovery key', () => {
    const dataKey = generateKey();
    const recovery = generateKey();
    const info = vaultFor(dataKey, { recoveryEnvelope: wrapKey(recoveryWrappingKey(recovery), dataKey) });
    expect(openWithRecoveryKey(info, recovery)).toEqual(dataKey);
    expect(openWithRecoveryKey(info, generateKey())).toBeNull();
    expect(openWithRecoveryKey(vaultFor(dataKey), recovery)).toBeNull();
  });
});

describe('setting up a server from a backup', async () => {
  const { vi } = await import('vitest');
  const { restoreServerVault, vaultInfoOf } = await import('./account');
  const { createBackup, backupVault } = await import('./backup');
  const { deriveAuthToken } = await import('@noted/crypto');
  const { getAuthEpoch } = await import('./client');

  it('keeps the vault in the backup and puts it on an empty server', async () => {
    const { setServerAddress } = await import('@noted/config');
    setServerAddress({ api: 'http://test.invalid', public: '' });
    const dataKey = generateKey();
    const info = vaultFor(dataKey, { keyEnvelope: 'a.b', recoveryEnvelope: 'c.d', createdAt: 5 });
    const vault = { salt: info.salt, verifier: info.verifier, keyEnvelope: 'a.b', recoveryEnvelope: 'c.d', recoverySealed: 'e.f', createdAt: 5 };
    const store = { getAll: async () => [], save: async () => {}, updateTimestamp: async () => {} };
    const text = await createBackup(dataKey, store, { vault });
    expect(backupVault(text)).toEqual(vault);
    expect(vaultInfoOf(vault).keyEnvelope).toBe('a.b');

    const sent: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)));
      return new Response('{}', { status: 201 });
    });
    await restoreServerVault(dataKey, vault, 2);
    expect(sent[0]).toMatchObject({ salt: 's', key_envelope: 'a.b', recovery_sealed: 'e.f', auth_epoch: 2, auth_token: bytesToBase64(deriveAuthToken(dataKey, 2)) });
    expect(getAuthEpoch()).toBe(2);
    // Another vault's key is refused before anything is sent.
    await expect(restoreServerVault(generateKey(), vault)).rejects.toThrow('another vault');
    expect(sent).toHaveLength(1);
    vi.unstubAllGlobals();
  });
});
