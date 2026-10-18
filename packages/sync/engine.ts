import { NoteRecord } from '@noted/types';
import { fetchRemoteNote, pushNote, keyMatchesVault, ensureAuthRegistered, apiFetch } from './client';
import { apiUrl } from '@noted/config';
import { sealDoc, mergeRemote, docFromSealed } from './doc';
import { buildNoteMeta, encodeNoteMeta, isNoteDeleted } from './note-meta';
import { seal } from '@noted/crypto';
import * as Y from 'yjs';

// An adapter interface allowing the sync engine to be used with SQLite (Desktop) or Expo SQLite (Mobile)
export interface LocalNoteStore {
  getAll(): Promise<NoteRecord[]>;
  save(id: string, content: string, yjsState: string, updatedAt: number): Promise<void>;
  updateTimestamp(id: string, updatedAt: number): Promise<void>;
  // Removes a note (a tombstone the server no longer has, see below).
  remove?(id: string): Promise<void>;
}

// The sealed `content` column holds the note's metadata (title, excerpt, links).
const previewFromDoc = (doc: Y.Doc): string => encodeNoteMeta(buildNoteMeta(doc));

export const runSyncEngine = async (
  masterKey: Uint8Array,
  db: LocalNoteStore,
  activeNoteId: string | null,
  activeNoteDoc: Y.Doc | null
): Promise<{ changedAnything: boolean; requiresReload: boolean; failedNotes: number }> => {
  let failedNotes = 0;
  let changedAnything = false;
  let requiresReload = false;

  const push = async (...args: Parameters<typeof pushNote>) => {
    await pushNote(...args);
    changedAnything = true;
  };

  if (!(await keyMatchesVault(masterKey))) {
    throw new Error('Key mismatch: restart the app');
  }
  await ensureAuthRegistered(masterKey);
  const res = await apiFetch(`${apiUrl()}/notes`, masterKey);
  if (res.status === 401) throw new Error('Unauthorized');
  if (!res.ok) throw new Error('API down');
  const remoteList: { id: string; updated_at: number }[] = await res.json();

  const localNotes = await db.getAll();
  const localMap = new Map(localNotes.map((n) => [n.id, n]));
  const remoteMap = new Map(remoteList.map((n) => [n.id, n]));

  for (const id of new Set([...localMap.keys(), ...remoteMap.keys()])) {
    const local = localMap.get(id);
    const remoteMeta = remoteMap.get(id);
    try {
      if (local && remoteMeta && local.updated_at === remoteMeta.updated_at) continue;

      if (!remoteMeta) {
        if (local && local.yjs_state && local.content) {
          // A note deleted for good that the server no longer has was cleaned up (Settings >
          // Sync): it goes here too instead of coming back.
          if (isNoteDeleted(docFromSealed(masterKey, local.yjs_state))) {
            if (db.remove) { await db.remove(id); requiresReload = true; }
            continue;
          }
          await push(id, local.content, local.yjs_state, local.updated_at, masterKey);
        }
        continue;
      }

      const remote = await fetchRemoteNote(id, masterKey);

      if (!local) {
        await db.save(id, remote.encrypted_html, remote.encrypted_yjs, remote.updated_at);
        requiresReload = true;
        continue;
      }

      const localDoc = (activeNoteId === id && activeNoteDoc)
        ? activeNoteDoc
        : docFromSealed(masterKey, local.yjs_state);

      const { changedLocal, changedRemote } = mergeRemote(masterKey, localDoc, remote.encrypted_yjs);

      if (!changedLocal && !changedRemote) {
        if (local.updated_at < remote.updated_at) {
          await db.updateTimestamp(id, remote.updated_at);
        } else if (local.yjs_state && local.content) {
          await push(id, local.content, local.yjs_state, local.updated_at, masterKey);
        }
        continue;
      }

      const mergedYjs = sealDoc(masterKey, localDoc);
      const mergedContent = seal(masterKey, new TextEncoder().encode(previewFromDoc(localDoc)));

      if (changedRemote) {
        const now = Date.now();
        await db.save(id, mergedContent, mergedYjs, now);
        await push(id, mergedContent, mergedYjs, now, masterKey);
      } else {
        await db.save(id, mergedContent, mergedYjs, remote.updated_at);
      }
      requiresReload = true;
    } catch (err) {
      console.error(`Sync skipped note ${id}:`, err);
      failedNotes++;
    }
  }

  return { changedAnything, requiresReload, failedNotes };
};
