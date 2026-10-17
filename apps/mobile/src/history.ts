import type * as SQLite from 'expo-sqlite';
import { randomUUID } from './uuid';

// Local version history (this device only), the same model as the desktop
// (apps/desktop/src/history.ts): one row per editing session of a note, holding the sealed Yjs
// state at the end of that session. A session starts when the note is opened (and after a
// pause longer than SESSION_GAP_MS); the running session equals the current content, so the
// list leaves it out. The newest MAX_PER_NOTE sessions are kept.

const SESSION_GAP_MS = 10 * 60 * 1000;
const MAX_PER_NOTE = 30;

let db: SQLite.SQLiteDatabase | null = null;

export const initHistory = async (database: SQLite.SQLiteDatabase) => {
  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS note_history (
      id TEXT PRIMARY KEY,
      note_id TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER NOT NULL,
      state TEXT NOT NULL
    )
  `);
  db = database;
};

// Every stored version (Settings > Sync "Clean up storage": their images stay).
export const allHistoryStates = async (): Promise<string[]> =>
  db ? (await db.getAllAsync<{ state: string }>('SELECT state FROM note_history')).map((r) => r.state) : [];

export interface HistorySession {
  id: string;
  lastAt: number;
}

export interface HistoryEntry {
  id: string;
  startedAt: number;
  endedAt: number;
}

// Stores the state in the running session (or a new one) and returns that session.
export const recordHistory = async (noteId: string, sealedState: string, at: number, current: HistorySession | null): Promise<HistorySession | null> => {
  if (!db) return current;
  if (current && at - current.lastAt < SESSION_GAP_MS) {
    await db.runAsync('UPDATE note_history SET ended_at = ?, state = ? WHERE id = ?', [at, sealedState, current.id]);
    return { id: current.id, lastAt: at };
  }
  const id = randomUUID();
  await db.runAsync('INSERT INTO note_history (id, note_id, started_at, ended_at, state) VALUES (?, ?, ?, ?, ?)', [id, noteId, at, at, sealedState]);
  await db.runAsync(
    `DELETE FROM note_history WHERE note_id = ? AND id NOT IN
       (SELECT id FROM note_history WHERE note_id = ? ORDER BY ended_at DESC LIMIT ?)`,
    [noteId, noteId, MAX_PER_NOTE],
  );
  return { id, lastAt: at };
};

export const listHistory = async (noteId: string, currentSessionId?: string): Promise<HistoryEntry[]> => {
  if (!db) return [];
  const rows = await db.getAllAsync<{ id: string; started_at: number; ended_at: number }>(
    'SELECT id, started_at, ended_at FROM note_history WHERE note_id = ? ORDER BY ended_at DESC', [noteId],
  );
  return rows.filter((r) => r.id !== currentSessionId).map((r) => ({ id: r.id, startedAt: r.started_at, endedAt: r.ended_at }));
};

export const readHistoryState = async (id: string): Promise<string | null> =>
  (db ? (await db.getFirstAsync<{ state: string }>('SELECT state FROM note_history WHERE id = ?', [id]))?.state ?? null : null);
