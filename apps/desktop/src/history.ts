import type Database from '@tauri-apps/plugin-sql';
import type { HistoryEntry } from '@noted/ui';

// Local version history (this device only, like Notesnook): one row per editing session of a
// note, holding the sealed Yjs state at the end of that session. A session starts when the
// note is opened (and after a pause longer than SESSION_GAP_MS); the session being edited
// right now equals the current content, so the list leaves it out. The newest MAX_PER_NOTE
// sessions are kept.
export const HISTORY_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS note_history (
    id TEXT PRIMARY KEY,
    note_id TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER NOT NULL,
    state TEXT NOT NULL
  )
`;

const SESSION_GAP_MS = 10 * 60 * 1000;
const MAX_PER_NOTE = 30;

export interface HistorySession {
  id: string;
  lastAt: number;
}

// Stores the state in the running session (or a new one) and returns that session.
export const recordHistory = async (
  db: Database, noteId: string, sealedState: string, at: number, current: HistorySession | undefined,
): Promise<HistorySession> => {
  if (current && at - current.lastAt < SESSION_GAP_MS) {
    await db.execute('UPDATE note_history SET ended_at = $1, state = $2 WHERE id = $3', [at, sealedState, current.id]);
    return { id: current.id, lastAt: at };
  }
  const id = crypto.randomUUID();
  await db.execute(
    'INSERT INTO note_history (id, note_id, started_at, ended_at, state) VALUES ($1, $2, $3, $3, $4)',
    [id, noteId, at, sealedState],
  );
  await db.execute(
    `DELETE FROM note_history WHERE note_id = $1 AND id NOT IN
       (SELECT id FROM note_history WHERE note_id = $1 ORDER BY ended_at DESC LIMIT $2)`,
    [noteId, MAX_PER_NOTE],
  );
  return { id, lastAt: at };
};

export const listHistory = async (db: Database, noteId: string, currentSessionId?: string): Promise<HistoryEntry[]> =>
  (await db.select<{ id: string; started_at: number; ended_at: number }[]>(
    'SELECT id, started_at, ended_at FROM note_history WHERE note_id = $1 ORDER BY ended_at DESC',
    [noteId],
  ))
    .filter((r) => r.id !== currentSessionId)
    .map((r) => ({ id: r.id, startedAt: r.started_at, endedAt: r.ended_at }));

export const readHistoryState = async (db: Database, id: string): Promise<string | null> =>
  (await db.select<{ state: string }[]>('SELECT state FROM note_history WHERE id = $1', [id]))[0]?.state ?? null;

// Every sealed state in the history (Settings > Sync clean-up keeps the images they use).
export const allHistoryStates = async (db: Database): Promise<string[]> =>
  (await db.select<{ state: string }[]>('SELECT state FROM note_history')).map((r) => r.state);
