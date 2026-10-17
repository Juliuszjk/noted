import { seal, unseal } from '@noted/crypto';
import type { LocalNoteStore } from './engine';
import { docFromSealed, sealDoc } from './doc';
import { buildNoteMeta, decodeNoteMeta, deleteNoteForever, encodeNoteMeta } from './note-meta';
import { unpublishQuietly } from './publish';

export const TRASH_DAYS = 7;
const DAY_MS = 86_400_000;

// Deletes for good the notes that have been in the trash longer than TRASH_DAYS (like
// Notesnook). Each one becomes a tombstone, saved with a new timestamp so sync spreads it.
// Returns how many notes were deleted.
export const purgeExpiredTrash = async (masterKey: Uint8Array, store: LocalNoteStore, now: number = Date.now()): Promise<number> => {
  let purged = 0;
  for (const note of await store.getAll()) {
    if (!note.content || !note.content.includes('.') || !note.yjs_state) continue;
    try {
      const meta = decodeNoteMeta(new TextDecoder().decode(unseal(masterKey, note.content)));
      if (meta.deleted || meta.trashedAt === null || now - meta.trashedAt < TRASH_DAYS * DAY_MS) continue;
      const doc = docFromSealed(masterKey, note.yjs_state);
      unpublishQuietly(masterKey, doc);
      deleteNoteForever(doc);
      await store.save(note.id, seal(masterKey, new TextEncoder().encode(encodeNoteMeta(buildNoteMeta(doc)))), sealDoc(masterKey, doc), now);
      purged++;
    } catch (err) {
      console.error(`Trash cleanup skipped note ${note.id}:`, err);
    }
  }
  return purged;
};
