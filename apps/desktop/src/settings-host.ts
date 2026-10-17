import { save, open } from '@tauri-apps/plugin-dialog';
import { writeFile, readTextFile, readFile, mkdir, readDir, remove, stat, BaseDirectory } from '@tauri-apps/plugin-fs';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { documentDir, join } from '@tauri-apps/api/path';
import { invoke } from '@tauri-apps/api/core';
import { Editor } from '@tiptap/core';
import * as Y from 'yjs';
import { createBackup, backupFileName, exportAllNotes } from '@noted/sync';
import type { LocalNoteStore, LocalBlobStore } from '@noted/sync';
import { createSchemaExtensions } from '@noted/editor';
import type { BackupInterval, ImportFile } from '@noted/ui';
import { parseEditorPrefs, parseToolbarConfig, editorPrefsCssVars } from '@noted/editor';
import type { EditorPrefs, ToolbarConfig } from '@noted/editor';
import { enable as enableAutostart, disable as disableAutostart, isEnabled as autostartEnabled } from '@tauri-apps/plugin-autostart';

// Desktop side of Settings: files, the app zoom, automatic backups, HTML rendering.

export const EPOCH_KEY = 'noted_auth_epoch';
const ZOOM_KEY = 'noted_app_zoom';
const AUTO_KEY = 'noted_auto_backup';
// Automatic backups go to ~/Documents/Noted backups (allowed in the fs capability).
export const BACKUP_FOLDER = 'Noted backups';
const KEEP_BACKUPS = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not kept; fine until the next start.
  }
};

export const readEpoch = (): number => Number(read(EPOCH_KEY)) || 0;
export const writeEpoch = (epoch: number) => write(EPOCH_KEY, String(epoch));

// ---- app zoom (the whole window, through the webview) ----
export const readAppZoom = (): number => {
  const z = Number(read(ZOOM_KEY));
  return z >= 0.5 && z <= 2 ? z : 1;
};
export const applyAppZoom = (zoom: number) => {
  write(ZOOM_KEY, String(zoom));
  getCurrentWebview().setZoom(zoom).catch((e) => console.warn('Zoom failed:', e));
};

// ---- files ----
export const saveFileDialog = async (name: string, data: Uint8Array | string): Promise<boolean> => {
  const path = await save({ defaultPath: name });
  if (!path) return false;
  await writeFile(path, typeof data === 'string' ? new TextEncoder().encode(data) : data);
  return true;
};

export const openTextFileDialog = async (extensions: string[]): Promise<string | null> => {
  const path = await open({ multiple: false, directory: false, filters: [{ name: 'Noted backup', extensions }] });
  if (!path || Array.isArray(path)) return null;
  return readTextFile(path);
};

// ---- automatic backups ----
export interface AutoBackupSettings {
  interval: BackupInterval;
  attachments: boolean;
  last: number | null;
  // A folder picked in Settings (absolute path); null = ~/Documents/Noted backups.
  folder: string | null;
}

export const readAutoBackup = (): AutoBackupSettings => {
  try {
    const data = JSON.parse(read(AUTO_KEY) ?? '{}');
    return {
      interval: data.interval === 'daily' || data.interval === 'weekly' ? data.interval : 'off',
      attachments: data.attachments !== false,
      last: typeof data.last === 'number' ? data.last : null,
      folder: typeof data.folder === 'string' && data.folder ? data.folder : null,
    };
  } catch {
    return { interval: 'off', attachments: true, last: null, folder: null };
  }
};
export const writeAutoBackup = (settings: AutoBackupSettings) => write(AUTO_KEY, JSON.stringify(settings));

export const backupFolderPath = async () => readAutoBackup().folder ?? join(await documentDir(), BACKUP_FOLDER);

// Picks another folder for automatic backups (the dialog grants access to it, and the
// persisted-scope plugin keeps that across restarts).
export const chooseBackupFolder = async (): Promise<string | null> => {
  const path = await open({ directory: true, multiple: false, defaultPath: await backupFolderPath() });
  return typeof path === 'string' ? path : null;
};

export const openBackupFolder = async () => {
  if (!readAutoBackup().folder) await mkdir(BACKUP_FOLDER, { baseDir: BaseDirectory.Document, recursive: true });
  await invoke('open_folder', { path: await backupFolderPath() });
};

// The backups in the backup folder, newest first.
export const listBackups = async (): Promise<{ name: string; read: () => Promise<string> }[]> => {
  const custom = readAutoBackup().folder;
  const where = custom ? {} : { baseDir: BaseDirectory.Document };
  const dir = custom ?? BACKUP_FOLDER;
  const entries = await readDir(dir, where).catch(() => []);
  return entries
    .filter((f) => f.isFile && f.name.startsWith('noted-backup-') && f.name.endsWith('.nbackup'))
    .map((f) => f.name)
    .sort()
    .reverse()
    .map((name) => ({ name, read: () => readTextFile(`${dir}/${name}`, where) }));
};

// Date in a backup file's name (noted-backup-2026-10-02-1430...).
const backupNameDate = (name: string): number | null => {
  const m = /noted-backup-(\d{4})-(\d\d)-(\d\d)-(\d\d)(\d\d)/.exec(name);
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime() : null;
};

// Runs a backup when one is due: when the newest backup in the folder is older than the
// interval, or there is none (deleted files count, not only the date of the last run). Keeps
// the newest KEEP_BACKUPS files.
export const runAutoBackupIfDue = async (masterKey: Uint8Array, store: LocalNoteStore, blobs: LocalBlobStore): Promise<boolean> => {
  const settings = readAutoBackup();
  if (settings.interval === 'off') return false;
  const every = settings.interval === 'daily' ? DAY_MS : 7 * DAY_MS;
  // The default folder is reached relative to ~/Documents (allowed in the capability), a
  // picked one by its absolute path (allowed by the dialog).
  const custom = settings.folder;
  const where = custom ? {} : { baseDir: BaseDirectory.Document };
  const dir = custom ?? BACKUP_FOLDER;
  if (!custom) await mkdir(BACKUP_FOLDER, { baseDir: BaseDirectory.Document, recursive: true });
  const existing = async () => (await readDir(dir, where))
    .filter((f) => f.isFile && f.name.startsWith('noted-backup-') && f.name.endsWith('.nbackup'))
    .map((f) => f.name)
    .sort();
  const newest = (await existing()).map(backupNameDate).filter((d): d is number => d !== null).sort((a, b) => b - a)[0];
  // A bit of slack, so "daily" at a slightly earlier hour the next day still runs.
  if (newest && Date.now() - newest < every - 60 * 60 * 1000) return false;
  const name = backupFileName(new Date(), settings.attachments);
  const text = new TextEncoder().encode(await createBackup(masterKey, store, settings.attachments ? { blobs } : {}));
  await writeFile(`${dir}/${name}`, text, where);
  writeAutoBackup({ ...readAutoBackup(), last: Date.now() });
  const files = await existing();
  for (const old of files.slice(0, Math.max(0, files.length - KEEP_BACKUPS))) {
    await remove(`${dir}/${old}`, where).catch(() => {});
  }
  return true;
};

// ---- export ----
// HTML of a note body (JSON), rendered by a hidden editor with the same schema.
const htmlEditor = () => new Editor({ element: document.createElement('div'), editable: false, extensions: createSchemaExtensions({ ydoc: new Y.Doc(), placeholder: '' }).filter((e) => e.name !== 'collaboration') });

const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

// Exported HTML: images and files point at their copies in "attachments/" (the decryption
// keys in data-blob are left out); files become links, like Notesnook's exports.
export const linkAttachments = (html: string, links: Record<string, string>): string => {
  const box = document.createElement('div');
  box.innerHTML = html;
  box.querySelectorAll('img[data-blob]').forEach((img) => {
    const path = links[img.getAttribute('data-blob') ?? ''];
    img.removeAttribute('data-blob');
    if (path) img.setAttribute('src', `./${path}`);
  });
  box.querySelectorAll('div[data-attachment]').forEach((div) => {
    const path = links[div.getAttribute('data-blob') ?? ''];
    const name = div.getAttribute('data-name') ?? div.textContent ?? 'file';
    const p = document.createElement('p');
    if (path) {
      const a = document.createElement('a');
      a.href = `./${path}`;
      a.title = name;
      a.textContent = name;
      p.append(a);
    } else p.textContent = `Attachment: ${name}`;
    div.replaceWith(p);
  });
  return box.innerHTML;
};

export const exportAll = async (masterKey: Uint8Array, store: LocalNoteStore, format: 'markdown' | 'text' | 'html', notebookNames: Map<string, string>, blobs?: LocalBlobStore) => {
  let editor: Editor | null = null;
  try {
    const toHtml = (json: object, title: string, links: Record<string, string>) => {
      editor ??= htmlEditor();
      editor.commands.setContent(json);
      return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body><h1>${escapeHtml(title)}</h1>${linkAttachments(editor.getHTML(), links)}</body></html>\n`;
    };
    const { zip, count } = await exportAllNotes(masterKey, store, format, { notebookNames, toHtml, blobs });
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return { name: `noted-export-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${format}.zip`, zip, count };
  } finally {
    (editor as Editor | null)?.destroy();
  }
};

// ---- Settings > Editor / Toolbar / Desktop integration (this device) ----
const EDITOR_KEY = 'noted_editor_prefs';
const TOOLBAR_KEY = 'noted_toolbar_desktop';
const TABLE_TOOLBAR_KEY = 'noted_toolbar_desktop_table';
const DRAWING_TOOLBAR_KEY = 'noted_toolbar_desktop_drawing';
const DRAWING_TOOLS_KEY = 'noted_drawing_tools';
const DESKTOP_KEY = 'noted_desktop_integration';

export const readEditorPrefs = (): EditorPrefs => parseEditorPrefs(read(EDITOR_KEY));
export const readToolbarConfig = (): ToolbarConfig | null => parseToolbarConfig(read(TOOLBAR_KEY));
export const writeToolbarConfig = (config: ToolbarConfig | null) => write(TOOLBAR_KEY, JSON.stringify(config));
export const readTableToolbarConfig = (): ToolbarConfig | null => parseToolbarConfig(read(TABLE_TOOLBAR_KEY));
export const writeTableToolbarConfig = (config: ToolbarConfig | null) => write(TABLE_TOOLBAR_KEY, JSON.stringify(config));
export const readDrawingToolbarConfig = (): ToolbarConfig | null => parseToolbarConfig(read(DRAWING_TOOLBAR_KEY));
export const writeDrawingToolbarConfig = (config: ToolbarConfig | null) => write(DRAWING_TOOLBAR_KEY, JSON.stringify(config));
// The pen kind, colours and widths of this device (NoteEditor drawingTools).
export const drawingToolsStore = { load: () => read(DRAWING_TOOLS_KEY), save: (text: string) => write(DRAWING_TOOLS_KEY, text) };

// Applies the editor settings to the whole window (CSS variables, the spell checker).
export const applyEditorPrefs = (prefs: EditorPrefs) => {
  write(EDITOR_KEY, JSON.stringify(prefs));
  for (const [name, value] of Object.entries(editorPrefsCssVars(prefs))) document.documentElement.style.setProperty(name, value);
  invoke('set_spellcheck', { enabled: prefs.spellcheck, languages: prefs.spellLanguages }).catch((e) => console.warn('Spell check settings failed:', e));
};

export const spellLanguagesAvailable = (): Promise<string[]> => invoke<string[]>('spellcheck_languages_available').catch(() => []);
export const getCustomWords = (languages: string[]): Promise<string[]> => invoke<string[]>('get_custom_words', { languages });
export const setCustomWords = (languages: string[], words: string[]): Promise<void> => invoke('set_custom_words', { languages, words });

export interface DesktopIntegration {
  autostart: boolean;
  closeToTray: boolean;
  minimizeToTray: boolean;
}

export const readDesktopIntegration = async (): Promise<DesktopIntegration> => {
  let stored: Partial<DesktopIntegration> = {};
  try {
    stored = JSON.parse(read(DESKTOP_KEY) ?? '{}');
  } catch {
    stored = {};
  }
  return {
    autostart: await autostartEnabled().catch(() => false),
    closeToTray: stored.closeToTray === true,
    minimizeToTray: stored.minimizeToTray === true,
  };
};

export const applyDesktopIntegration = async (next: DesktopIntegration, previous?: DesktopIntegration) => {
  write(DESKTOP_KEY, JSON.stringify({ closeToTray: next.closeToTray, minimizeToTray: next.minimizeToTray }));
  await invoke('set_tray_behaviour', { closeToTray: next.closeToTray, minimizeToTray: next.minimizeToTray });
  if (previous && previous.autostart !== next.autostart) await (next.autostart ? enableAutostart() : disableAutostart());
};

// ---- import (Settings > Import) ----
// The files of a picked folder (recursively, hidden folders skipped) or of picked files.
const importFile = (abs: string, rel: string): ImportFile => ({ path: rel, text: () => readTextFile(abs), bytes: () => readFile(abs) });

// A folder's files (paths relative to the folder's parent, so the folder becomes a notebook
// when `keepName`), hidden ones skipped.
const walkFolder = async (root: string, keepName: boolean): Promise<ImportFile[]> => {
  const out: ImportFile[] = [];
  const walk = async (dir: string, rel: string, depth: number) => {
    if (depth > 12 || out.length > 20000) return;
    for (const entry of await readDir(dir)) {
      if (entry.name.startsWith('.')) continue;
      const abs = await join(dir, entry.name);
      const r = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory) await walk(abs, r, depth + 1);
      else if (entry.isFile) out.push(importFile(abs, r));
    }
  };
  await walk(root, keepName ? root.split(/[\\/]/).filter(Boolean).pop() ?? '' : '', 0);
  return out;
};

export const pickImportFiles = async (folder: boolean, extensions: string[]): Promise<ImportFile[] | null> => {
  const picked = await open(folder
    ? { directory: true, multiple: false }
    : { multiple: true, filters: [{ name: 'Notes', extensions: [...extensions, 'zip'] }] });
  if (!picked) return null;
  if (!folder) return (Array.isArray(picked) ? picked : [picked]).map((p) => importFile(p, p.split(/[\\/]/).pop() ?? p));
  return walkFolder(picked as string, false);
};

// Files and folders dropped on the window (Tauri allows reading them).
export const importFilesFromPaths = async (paths: string[]): Promise<ImportFile[]> => {
  const out: ImportFile[] = [];
  for (const path of paths) {
    const info = await stat(path);
    if (info.isDirectory) out.push(...await walkFolder(path, paths.length > 1));
    else out.push(importFile(path, path.split(/[\\/]/).pop() ?? path));
  }
  return out;
};

// Drag and drop of files over the window.
export const onFileDrop = (listener: (event: { type: 'over' | 'leave' | 'drop'; paths: string[] }) => void): (() => void) => {
  let unlisten: (() => void) | null = null;
  let stopped = false;
  getCurrentWebview().onDragDropEvent((e) => {
    const p = e.payload;
    if (p.type === 'drop') listener({ type: 'drop', paths: p.paths });
    else if (p.type === 'leave') listener({ type: 'leave', paths: [] });
    else listener({ type: 'over', paths: [] });
  }).then((fn) => { if (stopped) fn(); else unlisten = fn; });
  return () => { stopped = true; unlisten?.(); };
};

// ---- App lock (Settings > App lock) ----
const LOCK_KEY = 'noted_app_lock';
const VAULT_INFO_KEY = 'noted_vault_info';

export interface AppLockSettings {
  enabled: boolean;
  // Minutes without using the app before it locks; 0 = only when it starts.
  minutes: number;
}

export const readAppLock = (): AppLockSettings => {
  try {
    const d = JSON.parse(read(LOCK_KEY) ?? '{}');
    return { enabled: d.enabled === true, minutes: [0, 1, 5, 15, 30, 60].includes(d.minutes) ? d.minutes : 5 };
  } catch {
    return { enabled: false, minutes: 5 };
  }
};
export const writeAppLock = (settings: AppLockSettings) => write(LOCK_KEY, JSON.stringify(settings));

// The vault's public data (salt, verifier, envelope), kept so the lock screen works offline.
export const cacheVaultInfo = (text: string) => write(VAULT_INFO_KEY, text);
export const readCachedVaultInfo = () => read(VAULT_INFO_KEY);
