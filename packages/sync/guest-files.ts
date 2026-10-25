import { apiUrl, hasServer } from '@noted/config';
import { apiFetch } from './client';
import { docFromSealed } from './doc';
import { noteBodyJson, noteBlobIds } from './doc-json';
import { isNoteLocked, readLockedBody } from './locked';
import { getNotePublish, isNoteDeleted } from './note-meta';
import type { LocalNoteStore } from './engine';

// Images and files guests of live notes added (apps/api/src/live.ts) are deleted from the
// server once no note uses them: removed from the note, the note unpublished without them,
// or deleted for good. Only the owner's apps can tell (the notes are encrypted), so after a
// sync they ask the server for the guest files and delete the unused ones. Never the
// owner's own files (the server refuses those on this path), never a file younger than
// GUEST_FILE_GRACE_MS or one whose guest edit has not reached the owner's snapshot yet
// (`settled`), and, while locked notes cannot be read (vault closed), only files of notes
// that are still live and readable: a locked note may hold the others.

export const GUEST_FILE_GRACE_MS = 60 * 60 * 1000;

export interface GuestFile {
  id: string;
  // The live share (published note id) the guest added it to.
  share: string;
  size: number;
  at: number;
  settled: boolean;
}

export interface NoteScan {
  // Blob ids the readable notes use.
  used: Set<string>;
  // Share ids of readable, not deleted notes that are published now.
  readableShares: Set<string>;
  // A locked note could not be read (its files are unknown).
  unreadableLocked: boolean;
}

export const unusedGuestFiles = (files: GuestFile[], scan: NoteScan, now = Date.now()): GuestFile[] => files.filter((f) =>
  f.settled
  && now - f.at > GUEST_FILE_GRACE_MS
  && !scan.used.has(f.id)
  && (!scan.unreadableLocked || scan.readableShares.has(f.share)));

export const scanNotes = async (masterKey: Uint8Array, store: LocalNoteStore, vaultKey: Uint8Array | null): Promise<NoteScan> => {
  const scan: NoteScan = { used: new Set(), readableShares: new Set(), unreadableLocked: false };
  for (const note of await store.getAll()) {
    if (!note.yjs_state || !note.yjs_state.includes('.')) continue;
    // A note this key cannot open is an error: nothing may be deleted then.
    const doc = docFromSealed(masterKey, note.yjs_state);
    if (isNoteDeleted(doc)) continue;
    for (const id of noteBlobIds(noteBodyJson(doc))) scan.used.add(id);
    if (isNoteLocked(doc)) {
      const body = vaultKey ? readLockedBody(doc, vaultKey) : null;
      if (!body) {
        scan.unreadableLocked = true;
        continue;
      }
      for (const id of noteBlobIds(body)) scan.used.add(id);
    }
    const published = getNotePublish(doc);
    if (published) scan.readableShares.add(published.id);
  }
  return scan;
};

// Deletes the guest files no note uses; returns how many. Servers without guest files (older
// versions) answer 404: nothing to do.
export const cleanUpGuestFiles = async (masterKey: Uint8Array, store: LocalNoteStore, vaultKey: Uint8Array | null, now = Date.now()): Promise<number> => {
  if (!hasServer()) return 0;
  const res = await apiFetch(`${apiUrl()}/live/guest-files`, masterKey);
  if (!res.ok) return 0;
  const files = await res.json() as GuestFile[];
  // Reading every note only when something could go.
  if (!files.some((f) => f.settled && now - f.at > GUEST_FILE_GRACE_MS)) return 0;
  const unused = unusedGuestFiles(files, await scanNotes(masterKey, store, vaultKey), now);
  if (!unused.length) return 0;
  const del = await apiFetch(`${apiUrl()}/live/guest-files/delete`, masterKey, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: unused.map((f) => f.id) }),
  });
  if (!del.ok) throw new Error(`Deleting guest files failed (HTTP ${del.status})`);
  return (await del.json()).deleted ?? 0;
};

const CLEAN_UP_EVERY_MS = 60 * 60 * 1000;
let lastCleanUp = 0;

// After a sync: cleanUpGuestFiles at most once an hour (in the background; errors are logged).
export const cleanUpGuestFilesHourly = (masterKey: Uint8Array, store: LocalNoteStore, vaultKey: Uint8Array | null): void => {
  if (Date.now() - lastCleanUp < CLEAN_UP_EVERY_MS) return;
  lastCleanUp = Date.now();
  cleanUpGuestFiles(masterKey, store, vaultKey).then(
    (deleted) => { if (deleted) console.info(`Deleted ${deleted} guest file${deleted === 1 ? '' : 's'} no note uses`); },
    (e) => console.warn('Guest file clean-up failed:', e),
  );
};
