import { createRequire } from 'node:module';
import type { DatabaseSync as Database } from 'node:sqlite';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { NoteRecord } from '@noted/types';
import type { LocalBlobStore, LocalNoteStore } from '@noted/sync';

// Where the MCP server keeps its data: the data key (like the desktop app's localStorage, a
// file only this user can read) and a local copy of the notes, sealed like every device's.

const xdg = (name: string, fallback: string) => process.env[name] || join(homedir(), fallback);
export const CONFIG_DIR = process.env.NOTED_MCP_CONFIG || join(xdg('XDG_CONFIG_HOME', '.config'), 'noted-mcp');
export const DATA_DIR = process.env.NOTED_MCP_DATA || join(xdg('XDG_DATA_HOME', '.local/share'), 'noted-mcp');
const KEY_FILE = join(CONFIG_DIR, 'key.json');

// Loaded at run time (the test runner does not know node:sqlite yet).
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: typeof Database };

export interface StoredKey {
  key: string;
  epoch: number;
}

export const readKey = (): StoredKey | null => {
  try {
    const data = JSON.parse(readFileSync(KEY_FILE, 'utf8'));
    return typeof data.key === 'string' && Number.isInteger(data.epoch) ? data : null;
  } catch {
    return null;
  }
};

export const writeKey = (value: StoredKey): string => {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(KEY_FILE, JSON.stringify(value), { mode: 0o600 });
  chmodSync(KEY_FILE, 0o600);
  return KEY_FILE;
};

export interface HistoryEntry {
  id: number;
  noteId: string;
  // What Claude did ("rewrite_note", ...).
  action: string;
  // Sealed JSON of the note before the change (see notes.ts).
  before: string;
  at: number;
}

export const openStore = (file = join(DATA_DIR, 'notes.db')) => {
  if (file !== ':memory:') mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, content TEXT NOT NULL, yjs_state TEXT, updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS history (id INTEGER PRIMARY KEY AUTOINCREMENT, note_id TEXT NOT NULL, action TEXT NOT NULL, before TEXT NOT NULL, at INTEGER NOT NULL);
  `);
  const notes: LocalNoteStore & { get(id: string): Promise<NoteRecord | null> } = {
    getAll: async () => db.prepare('SELECT id, content, yjs_state, updated_at FROM notes').all() as unknown as NoteRecord[],
    get: async (id) => (db.prepare('SELECT id, content, yjs_state, updated_at FROM notes WHERE id = ?').get(id) as unknown as NoteRecord | undefined) ?? null,
    save: async (id, content, yjsState, updatedAt) => {
      db.prepare(`INSERT INTO notes (id, content, yjs_state, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET content = excluded.content, yjs_state = excluded.yjs_state, updated_at = excluded.updated_at`).run(id, content, yjsState, updatedAt);
    },
    updateTimestamp: async (id, updatedAt) => {
      db.prepare('UPDATE notes SET updated_at = ? WHERE id = ?').run(updatedAt, id);
    },
    remove: async (id) => {
      db.prepare('DELETE FROM notes WHERE id = ?').run(id);
    },
  };
  const history = {
    add: (noteId: string, action: string, before: string) => {
      db.prepare('INSERT INTO history (note_id, action, before, at) VALUES (?, ?, ?, ?)').run(noteId, action, before, Date.now());
      // The newest 200 are enough to undo with.
      db.prepare('DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY id DESC LIMIT 200)').run();
    },
    last: (noteId?: string): HistoryEntry | null => {
      const row = (noteId
        ? db.prepare('SELECT * FROM history WHERE note_id = ? ORDER BY id DESC LIMIT 1').get(noteId)
        : db.prepare('SELECT * FROM history ORDER BY id DESC LIMIT 1').get()) as Record<string, unknown> | undefined;
      return row ? { id: Number(row.id), noteId: String(row.note_id), action: String(row.action), before: String(row.before), at: Number(row.at) } : null;
    },
    remove: (id: number) => {
      db.prepare('DELETE FROM history WHERE id = ?').run(id);
    },
  };
  return { notes, history };
};

// Downloaded files (sealed, as the server has them). Nothing is created here, so nothing is
// waiting for upload.
export const blobCache = (dir = join(DATA_DIR, 'blobs')): LocalBlobStore => ({
  get: async (id) => {
    const file = join(dir, id.replace(/[^\w-]/g, ''));
    return existsSync(file) ? new Uint8Array(readFileSync(file)) : null;
  },
  put: async (id, sealed) => {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(join(dir, id.replace(/[^\w-]/g, '')), sealed, { mode: 0o600 });
  },
  pending: async () => [],
  markUploaded: async () => {},
});
