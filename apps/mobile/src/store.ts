import * as SQLite from 'expo-sqlite';
import { LocalNoteStore, LocalBlobStore } from '@noted/sync';
import { base64ToBytes } from '@noted/crypto';
import { NoteRecord } from '@noted/types';
import { initHistory } from './history';
import { Directory, File, Paths } from 'expo-file-system';

const DB_NAME = 'noted.db';

// The native side can drop the shared database handle while this JavaScript keeps it: the app
// swiped away from the recent apps while its process stays (background sync, the widget) and
// opened again re-runs the app in the same runtime, and every call then failed with a
// NullPointerException (2026-10-17: edits were not saved). This handle opens the database
// again (a connection of its own) and repeats the call once when that happens.
const isLostHandle = (e: unknown) =>
  /NullPointerException|database is closed|not open|ContextDestroyed/i.test(e instanceof Error ? `${e.message} ${String((e as { cause?: unknown }).cause ?? '')}` : String(e));

const openHealingDatabase = async (): Promise<SQLite.SQLiteDatabase> => {
  let current = await SQLite.openDatabaseAsync(DB_NAME);
  let reopening: Promise<void> | null = null;
  const reopen = (lost: SQLite.SQLiteDatabase) => {
    if (current !== lost) return reopening ?? Promise.resolve();
    reopening ??= (async () => {
      console.warn('Database handle lost, opening it again');
      current = await SQLite.openDatabaseAsync(DB_NAME, { useNewConnection: true });
    })().finally(() => { reopening = null; });
    return reopening;
  };
  return new Proxy({} as SQLite.SQLiteDatabase, {
    get(_target, prop) {
      const value = (current as unknown as Record<PropertyKey, unknown>)[prop];
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        const used = current;
        const call = () => (current as unknown as Record<PropertyKey, (...a: unknown[]) => unknown>)[prop](...args);
        const result = (used as unknown as Record<PropertyKey, (...a: unknown[]) => unknown>)[prop](...args);
        if (!(result instanceof Promise)) return result;
        return result.catch(async (e: unknown) => {
          if (!isLostHandle(e)) throw e;
          await reopen(used);
          return call();
        });
      };
    },
  });
};

// Adapter for Expo SQLite implementing our generic LocalNoteStore interface
export const createExpoStore = async (): Promise<{ db: SQLite.SQLiteDatabase; store: LocalNoteStore; blobStore: LocalBlobStore }> => {
  const db = await openHealingDatabase();
  
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      content TEXT,
      yjs_state TEXT,
      updated_at INTEGER
    )
  `);

  await initHistory(db);

  // Sealed blobs (images, files): files in <documents>/blobs/<id>; the table keeps which are
  // uploaded (`uploaded = 0` rows are the upload queue). Older versions kept the bytes in
  // `data` (base64): read from there until moved into files (below), then it is empty.
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS blobs (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      uploaded INTEGER NOT NULL DEFAULT 0
    )
  `);

  const blobsDir = new Directory(Paths.document, 'blobs');
  if (!blobsDir.exists) blobsDir.create();
  const blobFile = (id: string) => {
    if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) throw new Error('Bad blob id');
    return new File(blobsDir, id);
  };
  const writeBlob = (id: string, sealed: Uint8Array) => {
    const file = blobFile(id);
    if (file.exists) file.delete();
    file.create();
    file.write(sealed);
  };
  const blobStore: LocalBlobStore = {
    get: async (id) => {
      const row = await db.getFirstAsync<{ data: string }>('SELECT data FROM blobs WHERE id = ?', [id]);
      if (!row) return null;
      if (row.data) return base64ToBytes(row.data);
      const file = blobFile(id);
      return file.exists ? await file.bytes() : null;
    },
    put: async (id, sealed, uploaded) => {
      writeBlob(id, sealed);
      await db.runAsync(
        `INSERT INTO blobs (id, data, uploaded) VALUES (?, '', ?)
         ON CONFLICT(id) DO UPDATE SET uploaded = MAX(blobs.uploaded, excluded.uploaded)`,
        [id, uploaded ? 1 : 0],
      );
    },
    pending: async () => (await db.getAllAsync<{ id: string }>('SELECT id FROM blobs WHERE uploaded = 0')).map((r) => r.id),
    markUploaded: async (id) => {
      await db.runAsync('UPDATE blobs SET uploaded = 1 WHERE id = ?', [id]);
    },
  };

  // Blobs of older versions move into files, one at a time, then the database shrinks.
  (async () => {
    let moved = 0;
    for (;;) {
      const row = await db.getFirstAsync<{ id: string; data: string }>("SELECT id, data FROM blobs WHERE data != '' LIMIT 1");
      if (!row) break;
      try {
        writeBlob(row.id, base64ToBytes(row.data));
        await db.runAsync("UPDATE blobs SET data = '' WHERE id = ?", [row.id]);
        moved++;
      } catch (e) {
        console.warn('Moving a blob to a file failed:', e);
        break;
      }
    }
    if (moved) await db.execAsync('VACUUM').catch(() => {});
  })().catch((e) => console.warn('Blob move failed:', e));

  const store: LocalNoteStore & { get(id: string): Promise<NoteRecord | null> } = {
    getAll: async () => {
      return await db.getAllAsync<NoteRecord>('SELECT * FROM notes');
    },
    get: async (id) => (await db.getFirstAsync<NoteRecord>('SELECT * FROM notes WHERE id = ?', [id])) ?? null,
    save: async (id, content, yjsState, updatedAt) => {
      await db.runAsync(
        `INSERT INTO notes (id, content, yjs_state, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET content = excluded.content, yjs_state = excluded.yjs_state, updated_at = excluded.updated_at`,
        [id, content, yjsState, updatedAt]
      );
    },
    updateTimestamp: async (id, updatedAt) => {
      await db.runAsync('UPDATE notes SET updated_at = ? WHERE id = ?', [updatedAt, id]);
    },
    // A note deleted for good and cleaned up on the server (sync engine).
    remove: async (id) => {
      await db.runAsync('DELETE FROM notes WHERE id = ?', [id]);
      await db.runAsync('DELETE FROM note_history WHERE note_id = ?', [id]).catch(() => {});
    },
  };

  cleanLocal = async (used: Set<string>) => {
    // Cached files no note or version uses (uploaded ones only: pending ones still go up),
    // history of notes that are gone, then the database file shrinks.
    const cached = await db.getAllAsync<{ id: string }>('SELECT id FROM blobs WHERE uploaded = 1');
    let removed = 0;
    for (const { id } of cached) {
      if (used.has(id)) continue;
      try { const file = blobFile(id); if (file.exists) file.delete(); } catch { /* bad id */ }
      await db.runAsync('DELETE FROM blobs WHERE id = ?', [id]);
      removed++;
    }
    await db.runAsync('DELETE FROM note_history WHERE note_id NOT IN (SELECT id FROM notes)').catch(() => {});
    await db.execAsync('VACUUM').catch(() => {});
    return removed;
  };

  return { db, store, blobStore };
};

// Settings > Sync "Clean up storage", this phone's part (set once the database is open).
let cleanLocal: ((used: Set<string>) => Promise<number>) | null = null;
export const cleanLocalStorage = (used: Set<string>): Promise<number> => {
  if (!cleanLocal) throw new Error('Not ready yet');
  return cleanLocal(used);
};
