import { API_URL } from '@noted/config';
import { apiFetch } from './client';
import { docFromSealed } from './doc';
import { noteBodyJson, noteBlobIds } from './doc-json';
import { isNoteLocked, readLockedBody } from './locked';
import { isNoteDeleted } from './note-meta';
import type { LocalNoteStore } from './engine';

// Clean-up of images and files that no note uses any more. The server cannot tell (the
// references live inside the encrypted notes), so a client collects every blob id its notes
// refer to and deletes the server's other blobs, but only those older than GRACE_MS: younger
// ones may belong to a note another device has not synced yet, to its note history, or to a
// recent backup made without attachments.

export const BLOB_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

export interface ServerBlob {
  id: string;
  size: number;
  created_at: number;
}

export interface UnusedBlobs {
  blobs: ServerBlob[];
  bytes: number;
}

export const listServerBlobs = async (masterKey: Uint8Array): Promise<ServerBlob[]> => {
  const res = await apiFetch(`${API_URL}/blobs`, masterKey);
  if (!res.ok) throw new Error(`Listing the files failed (HTTP ${res.status})`);
  return res.json();
};

// Blob ids used by the stored notes. Locked notes need the vault key; without it nothing may
// be deleted (their images would look unused), so this throws.
export const usedBlobIds = async (masterKey: Uint8Array, store: LocalNoteStore, vaultKey: Uint8Array | null): Promise<Set<string>> => {
  const used = new Set<string>();
  for (const note of await store.getAll()) {
    if (!note.yjs_state || !note.yjs_state.includes('.')) continue;
    const doc = docFromSealed(masterKey, note.yjs_state);
    for (const id of noteBlobIds(noteBodyJson(doc))) used.add(id);
    if (isNoteLocked(doc)) {
      const body = vaultKey ? readLockedBody(doc, vaultKey) : null;
      if (!body) throw new Error('Open the vault first: the images of locked notes are inside it.');
      for (const id of noteBlobIds(body)) used.add(id);
    }
  }
  return used;
};

export const findUnusedBlobs = async (
  masterKey: Uint8Array, store: LocalNoteStore, vaultKey: Uint8Array | null, alsoUsed: Iterable<string> = [], now = Date.now(), graceMs = BLOB_GRACE_MS,
): Promise<UnusedBlobs> => {
  const used = await usedBlobIds(masterKey, store, vaultKey);
  for (const id of alsoUsed) used.add(id);
  const blobs = (await listServerBlobs(masterKey)).filter((b) => !used.has(b.id) && now - b.created_at > graceMs);
  return { blobs, bytes: blobs.reduce((sum, b) => sum + b.size, 0) };
};

export const deleteServerBlobs = async (masterKey: Uint8Array, ids: string[]): Promise<number> => {
  let deleted = 0;
  for (const id of ids) {
    const res = await apiFetch(`${API_URL}/blobs/${id}`, masterKey, { method: 'DELETE' });
    if (res.ok) deleted++;
  }
  return deleted;
};

// Notes deleted for good are kept as tombstones (so no device brings them back). Clean-up
// removes them from the server and from this device; other devices drop theirs on their next
// sync (runSyncEngine). A device that was offline since the deletion still has the note
// itself and would upload it again.
export const deletedNoteIds = async (masterKey: Uint8Array, store: LocalNoteStore): Promise<string[]> => {
  const ids: string[] = [];
  for (const note of await store.getAll()) {
    if (!note.yjs_state || !note.yjs_state.includes('.')) continue;
    try {
      if (isNoteDeleted(docFromSealed(masterKey, note.yjs_state))) ids.push(note.id);
    } catch {
      // Not readable with this key: left alone.
    }
  }
  return ids;
};

export const purgeDeletedNotes = async (masterKey: Uint8Array, store: LocalNoteStore, ids: string[]): Promise<number> => {
  let purged = 0;
  for (const id of ids) {
    const res = await apiFetch(`${API_URL}/notes/${encodeURIComponent(id)}`, masterKey, { method: 'DELETE' });
    if (!res.ok) continue;
    await store.remove?.(id);
    purged++;
  }
  return purged;
};
