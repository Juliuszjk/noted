import { open } from '@tauri-apps/plugin-dialog';
import { readDir, writeFile } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';

// Settings > Editor "Download folder": "Save" of an attachment or image writes straight into
// it (no dialog). The folder is picked in a dialog, which also allows writing there; the
// persisted-scope plugin keeps that across restarts.

const KEY = 'noted_download_folder';

export const readDownloadFolder = (): string | null => {
  try {
    return localStorage.getItem(KEY) || null;
  } catch {
    return null;
  }
};

export const writeDownloadFolder = (path: string | null) => {
  try {
    if (path) localStorage.setItem(KEY, path);
    else localStorage.removeItem(KEY);
  } catch {
    // Not available: the dialog is used every time.
  }
};

export const chooseDownloadFolder = async (): Promise<string | null> => {
  const path = await open({ directory: true, multiple: false, defaultPath: readDownloadFolder() ?? undefined });
  return typeof path === 'string' ? path : null;
};

// Writes into the download folder under a free name ("name (2).ext" when taken). Returns the
// path, or null when no folder is set.
export const saveToDownloadFolder = async (name: string, bytes: Uint8Array): Promise<string | null> => {
  const folder = readDownloadFolder();
  if (!folder) return null;
  const taken = new Set((await readDir(folder).catch(() => [])).map((e) => e.name));
  const dot = name.lastIndexOf('.');
  const [base, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  let candidate = name;
  for (let n = 2; taken.has(candidate); n++) candidate = `${base} (${n})${ext}`;
  const path = await join(folder, candidate);
  await writeFile(path, bytes);
  return path;
};
