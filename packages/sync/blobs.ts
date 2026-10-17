import { API_URL } from '@noted/config';
import { base64ToBytes, bytesToBase64, generateKey, sealBytes, unsealBytes } from '@noted/crypto';
import { apiFetch } from './client';

// Encrypted blobs (images, attachments). A blob is sealed with its own random key; the note
// stores a reference "<id>:<key>" (see blob-ref in @noted/editor). Locally every platform keeps
// the sealed bytes in a LocalBlobStore, which doubles as the upload queue.

// The server accepts sealed blobs up to 30 MB; sealing adds 40 bytes (nonce + tag).
export const MAX_BLOB_PLAINTEXT_BYTES = 30 * 1024 * 1024 - 40;

// Transfers can be large; the normal 8 s request timeout is too short.
const BLOB_TIMEOUT_MS = 120_000;

export interface LocalBlobStore {
  get(id: string): Promise<Uint8Array | null>;
  put(id: string, sealed: Uint8Array, uploaded: boolean): Promise<void>;
  // Ids of blobs created here that the server does not have yet.
  pending(): Promise<string[]>;
  markUploaded(id: string): Promise<void>;
}

export interface NewBlob {
  id: string;
  // Base64 of the blob's own key.
  key: string;
}

// Seals new content and queues it for upload. Works offline.
export const createBlob = async (store: LocalBlobStore, plaintext: Uint8Array, newId: () => string): Promise<NewBlob> => {
  const id = newId();
  const key = generateKey();
  await store.put(id, sealBytes(key, plaintext), false);
  return { id, key: bytesToBase64(key) };
};

export const uploadBlob = async (masterKey: Uint8Array, id: string, sealed: Uint8Array): Promise<void> => {
  const res = await apiFetch(`${API_URL}/blobs/${id}`, masterKey, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: sealed as BodyInit,
  }, BLOB_TIMEOUT_MS);
  if (!res.ok) throw new Error(`Blob upload failed for ${id} (HTTP ${res.status})`);
};

// Uploads everything still queued. Returns how many failed (they stay queued).
export const uploadPendingBlobs = async (masterKey: Uint8Array, store: LocalBlobStore): Promise<number> => {
  let failed = 0;
  for (const id of await store.pending()) {
    try {
      const sealed = await store.get(id);
      if (!sealed) continue;
      await uploadBlob(masterKey, id, sealed);
      await store.markUploaded(id);
    } catch (err) {
      console.error(`Blob ${id} not uploaded:`, err);
      failed++;
    }
  }
  return failed;
};

// Sealed bytes of a blob: from the local store, otherwise downloaded and cached.
// Null when the server does not have it (yet), e.g. the creating device is still offline.
export const fetchSealedBlob = async (masterKey: Uint8Array, store: LocalBlobStore, id: string): Promise<Uint8Array | null> => {
  const local = await store.get(id);
  if (local) return local;
  const res = await apiFetch(`${API_URL}/blobs/${id}`, masterKey, {}, BLOB_TIMEOUT_MS);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Blob download failed for ${id} (HTTP ${res.status})`);
  const sealed = new Uint8Array(await res.arrayBuffer());
  await store.put(id, sealed, true);
  return sealed;
};

export const openBlob = (sealed: Uint8Array, keyBase64: string): Uint8Array => unsealBytes(base64ToBytes(keyBase64), sealed);
