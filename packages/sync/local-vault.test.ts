import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateKey, createVerifier, bytesToBase64, generateSalt, deriveAuthToken } from '@noted/crypto';
import { setServerAddress, apiUrl, hasServer } from '@noted/config';
import {
  configureLocalVault, createLocalVault, readLocalVault, fetchVault, changePassphrase, getRecoveryKey,
  openWithPassphraseKey, openWithRecoveryKey, moveVaultToServer, fetchBackupVault,
} from './account';
import { apiFetch } from './client';

const packed = (key: Uint8Array) => {
  const v = createVerifier(key);
  return `${bytesToBase64(v.nonce)}.${bytesToBase64(v.ciphertext)}`;
};

const setUp = () => {
  let stored: string | null = null;
  configureLocalVault({ load: () => stored, save: (text) => { stored = text; } });
  setServerAddress({ api: '', public: '' });
  const dataKey = generateKey();
  createLocalVault(generateSalt(), packed(dataKey));
  return dataKey;
};

afterEach(() => vi.unstubAllGlobals());

describe('a vault without a server', () => {
  it('is read, re-keyed and given a recovery key on the device', async () => {
    const dataKey = setUp();
    expect(hasServer()).toBe(false);
    const info = await fetchVault();
    expect(openWithPassphraseKey(info!, dataKey)).toEqual(dataKey);

    const newKey = generateKey();
    await changePassphrase(dataKey, generateSalt(), newKey);
    const changed = await fetchVault();
    expect(openWithPassphraseKey(changed!, newKey)).toEqual(dataKey);
    expect(openWithPassphraseKey(changed!, dataKey)).toBeNull();

    const recovery = await getRecoveryKey(dataKey);
    expect(await getRecoveryKey(dataKey)).toEqual(recovery);
    expect(openWithRecoveryKey((await fetchVault())!, recovery)).toEqual(dataKey);
    expect((await fetchBackupVault(dataKey))?.recoverySealed).toBeTruthy();
    expect(() => createLocalVault(generateSalt(), packed(dataKey))).toThrow('already');
  });

  it('never sends anything', async () => {
    setUp();
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(apiFetch('/notes', generateKey())).rejects.toThrow('without a server');
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('moving the vault to a server', () => {
  const server = (vault: Record<string, unknown> | null, sent: { url: string; init?: RequestInit }[]) => vi.fn(async (url: string, init?: RequestInit) => {
    sent.push({ url, init });
    if (url.endsWith('/info')) return new Response(JSON.stringify({ app: 'noted', publicUrl: 'https://share.test' }));
    if (init?.method === 'PUT') return new Response('{}', { status: 201 });
    return vault ? new Response(JSON.stringify(vault)) : new Response(JSON.stringify({ setupCode: true }), { status: 404 });
  });

  it('puts the vault on an empty server with the setup code', async () => {
    const dataKey = setUp();
    const local = readLocalVault()!;
    const sent: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal('fetch', server(null, sent));
    expect(await moveVaultToServer(dataKey, 'https://notes.test', 'ABCD')).toBe(0);
    expect(apiUrl()).toBe('https://notes.test');
    const put = sent.find((r) => r.init?.method === 'PUT')!;
    expect((put.init!.headers as Record<string, string>)['X-Setup-Code']).toBe('ABCD');
    expect(JSON.parse(String(put.init!.body))).toMatchObject({ salt: local.salt, verifier: local.verifier, auth_token: bytesToBase64(deriveAuthToken(dataKey, 0)) });
  });

  it('joins a server with the same vault, refuses another one', async () => {
    const dataKey = setUp();
    const local = readLocalVault()!;
    vi.stubGlobal('fetch', server({ salt: local.salt, verifier: local.verifier, auth_epoch: 3 }, []));
    expect(await moveVaultToServer(dataKey, 'https://notes.test')).toBe(3);

    const other = setUp();
    const sent: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal('fetch', server({ salt: 's', verifier: packed(generateKey()), auth_epoch: 0 }, sent));
    await expect(moveVaultToServer(other, 'https://notes.test')).rejects.toThrow('another vault');
    expect(hasServer()).toBe(false);
    expect(sent.some((r) => r.init?.method === 'PUT')).toBe(false);
  });
});
