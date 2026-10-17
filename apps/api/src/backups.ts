import path from 'path';
import fs from 'fs';
import { db, dataDir } from './db.js';

// Nightly copies of the database (SQLite online backup: consistent while the server runs),
// into data/backups in the same volume. They guard against a broken or wrongly changed
// database, not against losing the disk. Copy them off the server for that.

const BACKUP_DIR = path.join(dataDir, 'backups');
const KEEP = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

const files = () => fs.readdirSync(BACKUP_DIR).filter((f) => /^server_notes-\d{4}-\d\d-\d\d\.db$/.test(f)).sort();

const pad = (n: number) => String(n).padStart(2, '0');
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export const backupNow = async (): Promise<void> => {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  // Space left by deleted notes and files goes back to the disk (more than 5 MB free inside).
  const free = (db.pragma('freelist_count', { simple: true }) as number) * (db.pragma('page_size', { simple: true }) as number);
  if (free > 5 * 1024 * 1024) {
    db.exec('VACUUM');
    console.log(`backup: compacted the database (${Math.round(free / 1024 / 1024)} MB free space)`);
  }
  const target = path.join(BACKUP_DIR, `server_notes-${today()}.db`);
  const temp = `${target}.part`;
  await db.backup(temp);
  fs.renameSync(temp, target);
  for (const old of files().slice(0, Math.max(0, files().length - KEEP))) fs.rmSync(path.join(BACKUP_DIR, old));
  console.log(`backup: wrote ${path.basename(target)} (${Math.round(fs.statSync(target).size / 1024)} KB)`);
};

// At midnight (the container's time zone, TZ), and at start when today's copy is missing.
export const startDailyBackups = () => {
  const run = () => backupNow().catch((e) => console.error('backup: failed', e));
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  if (!files().includes(`server_notes-${today()}.db`)) run();
  const scheduleNext = () => {
    const next = new Date();
    next.setHours(24, 0, 5, 0);
    setTimeout(() => { run(); scheduleNext(); }, Math.min(next.getTime() - Date.now(), DAY_MS));
  };
  scheduleNext();
};
