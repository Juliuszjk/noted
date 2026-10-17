import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// Ensure data directory exists
const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'server_notes.db');
const db = new Database(dbPath);

// Use Write-Ahead Logging for better concurrent performance
db.pragma('journal_mode = WAL');

// The server ONLY stores ciphertext. No plaintext columns exist here.
db.exec(`
  CREATE TABLE IF NOT EXISTS server_notes (
    id TEXT PRIMARY KEY,
    encrypted_html TEXT NOT NULL,
    encrypted_yjs TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )
`);

export { db, dataDir };
