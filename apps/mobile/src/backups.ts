import * as SecureStore from 'expo-secure-store';
import { Directory, File } from 'expo-file-system';
import { createBackup, backupFileName } from '@noted/sync';
import type { LocalNoteStore, LocalBlobStore } from '@noted/sync';
import { goingAway } from './away';

// Backups on the phone: written into a folder the user picked once (Android's folder picker;
// the permission stays), by hand or automatically (daily / weekly, checked when the app opens).

const KEY = 'noted_backup_settings';
const KEEP = 10;
const DAY = 24 * 60 * 60 * 1000;

export type BackupInterval = 'off' | 'daily' | 'weekly';

export interface MobileBackupSettings {
  // Folder URI from the picker (content://… on Android), null = not chosen yet.
  folder: string | null;
  folderName: string | null;
  interval: BackupInterval;
  attachments: boolean;
  last: number | null;
}

const DEFAULTS: MobileBackupSettings = { folder: null, folderName: null, interval: 'off', attachments: true, last: null };

export const readBackupSettings = (): MobileBackupSettings => {
  try {
    return { ...DEFAULTS, ...JSON.parse(SecureStore.getItem(KEY) ?? '{}') };
  } catch {
    return DEFAULTS;
  }
};

export const writeBackupSettings = (settings: MobileBackupSettings) => {
  SecureStore.setItem(KEY, JSON.stringify(settings));
};

// Shown in Settings: the last part of the picked folder's path.
const folderLabel = (dir: Directory): string => {
  const raw = decodeURIComponent(dir.uri).replace(/\/+$/, '');
  return dir.name || raw.split(/[/:]/).pop() || raw;
};

// Opens Android's folder picker; null when cancelled.
export const chooseBackupFolder = async (): Promise<{ folder: string; folderName: string } | null> => {
  try {
    goingAway();
    const dir = await Directory.pickDirectoryAsync();
    return dir ? { folder: dir.uri, folderName: folderLabel(dir) } : null;
  } catch {
    return null;
  }
};

const backupNameDate = (name: string): number | null => {
  const m = /noted-backup-(\d{4})-(\d\d)-(\d\d)-(\d\d)(\d\d)/.exec(name);
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime() : null;
};

const oldBackups = (dir: Directory): File[] => dir.list()
  .filter((entry): entry is File => entry instanceof File && /^noted-backup-.*\.nbackup$/.test(entry.name ?? ''))
  .sort((a, b) => (b.name ?? '').localeCompare(a.name ?? ''));

// Writes a backup into the folder and keeps the newest ones. Returns the file name.
export const writeBackup = async (
  masterKey: Uint8Array, store: LocalNoteStore, blobs: LocalBlobStore, folder: string, attachments: boolean,
): Promise<string> => {
  const text = await createBackup(masterKey, store, attachments ? { blobs } : {});
  const name = backupFileName(new Date(), attachments);
  const dir = new Directory(folder);
  // Octet-stream: Android would add ".json" to the name otherwise.
  const file = dir.createFile(name, 'application/octet-stream');
  file.write(text);
  try {
    for (const old of oldBackups(dir).slice(KEEP)) old.delete();
  } catch {
    // Listing a picked folder may not be allowed everywhere; the backup is written anyway.
  }
  return name;
};

// When the app opens: a backup when the interval has passed since the last one.
export const runAutoBackupIfDue = async (masterKey: Uint8Array, store: LocalNoteStore, blobs: LocalBlobStore): Promise<void> => {
  const settings = readBackupSettings();
  if (settings.interval === 'off' || !settings.folder) return;
  const every = settings.interval === 'daily' ? DAY : 7 * DAY;
  // Due when the newest backup in the folder is older than the interval, or there is none.
  let newest: number | null = null;
  try {
    newest = oldBackups(new Directory(settings.folder)).map((f) => backupNameDate(f.name ?? '')).find((d): d is number => d !== null) ?? null;
  } catch {
    newest = settings.last;
  }
  if (newest && Date.now() - newest < every - 60 * 60 * 1000) return;
  await writeBackup(masterKey, store, blobs, settings.folder, settings.attachments);
  writeBackupSettings({ ...readBackupSettings(), last: Date.now() });
};

// The backups in the folder, newest first (Settings > Backup > compare).
export const listBackupFiles = (folder: string | null): { name: string; at: number | null; read: () => Promise<string> }[] => {
  if (!folder) return [];
  try {
    return oldBackups(new Directory(folder)).map((f) => ({ name: f.name ?? '', at: backupNameDate(f.name ?? ''), read: () => f.text() }));
  } catch {
    return [];
  }
};
