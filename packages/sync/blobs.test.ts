import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateKey } from '@noted/crypto';
import { createBlob, uploadPendingBlobs, fetchSealedBlob, openBlob } from './blobs';
import type { LocalBlobStore } from './blobs';

const memoryStore = () => {
  const rows = new Map<string, { sealed: Uint8Array; uploaded: boolean }>();
  const store: LocalBlobStore = {
    get: async (id) => rows.get(id)?.sealed ?? null,
    put: async (id, sealed, uploaded) => { rows.set(id, { sealed, uploaded }); },
    pending: async () => [...rows].filter(([, r]) => !r.uploaded).map(([id]) => id),
    markUploaded: async (id) => { rows.get(id)!.uploaded = true; },
  };
  return { store, rows };
};

afterEach(() => vi.unstubAllGlobals());

describe('blobs', () => {
  const masterKey = generateKey();

  it('queues new blobs and uploads them once the server accepts', async () => {
    const { store } = memoryStore();
    const blob = await createBlob(store, new Uint8Array([9, 8, 7]), () => 'id-1');
    expect(await store.pending()).toEqual(['id-1']);

    const server = new Map<string, Uint8Array>();
    let online = false;
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      if (!online) throw new TypeError('offline');
      server.set(url.split('/').pop()!, init.body as Uint8Array);
      return new Response('{}', { status: 201 });
    });

    expect(await uploadPendingBlobs(masterKey, store)).toBe(1);
    expect(await store.pending()).toEqual(['id-1']);
    online = true;
    expect(await uploadPendingBlobs(masterKey, store)).toBe(0);
    expect(await store.pending()).toEqual([]);
    // The server only ever gets sealed bytes.
    expect(openBlob(server.get('id-1')!, blob.key)).toEqual(new Uint8Array([9, 8, 7]));
  });

  it('downloads missing blobs into the cache and reports absent ones as null', async () => {
    const source = memoryStore();
    const blob = await createBlob(source.store, new Uint8Array([1, 2]), () => 'id-2');
    const sealed = (await source.store.get('id-2'))!;
    const { store } = memoryStore();
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith('id-2') ? new Response(sealed, { status: 200 }) : new Response('{}', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);

    const got = await fetchSealedBlob(masterKey, store, 'id-2');
    expect(openBlob(got!, blob.key)).toEqual(new Uint8Array([1, 2]));
    await fetchSealedBlob(masterKey, store, 'id-2');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await store.pending()).toEqual([]);
    expect(await fetchSealedBlob(masterKey, store, 'nope')).toBeNull();
  });
});
