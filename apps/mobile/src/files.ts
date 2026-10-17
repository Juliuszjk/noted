import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Sharing from 'expo-sharing';
import * as IntentLauncher from 'expo-intent-launcher';
import { Directory, File, Paths } from 'expo-file-system';
import { getContentUriAsync } from 'expo-file-system/legacy';
import { goingAway } from './away';

// Attachments, images and exports on the phone: "Open" hands a decrypted copy (in the cache)
// to another app, "Save" writes the file into the download folder (Settings > Editor > Files;
// when none is set yet, the folder picker asks once and the choice is kept). "Share" is the
// separate way to send a file somewhere.

const FOLDER_KEY = 'noted_download_folder';

export interface DownloadFolder {
  folder: string;
  folderName: string;
}

export const readDownloadFolder = (): DownloadFolder | null => {
  try {
    const value = JSON.parse(SecureStore.getItem(FOLDER_KEY) ?? 'null');
    return value && typeof value.folder === 'string' ? value : null;
  } catch {
    return null;
  }
};

export const writeDownloadFolder = (value: DownloadFolder | null) => {
  if (value) SecureStore.setItem(FOLDER_KEY, JSON.stringify(value));
  else SecureStore.deleteItemAsync(FOLDER_KEY).catch(() => {});
};

const MIME: Record<string, string> = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  svg: 'image/svg+xml', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', html: 'text/html', zip: 'application/zip',
  epub: 'application/epub+zip', mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'video/mp4', doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', odt: 'application/vnd.oasis.opendocument.text',
};
export const mimeOf = (name: string, given?: string | null): string =>
  (given && given !== 'application/octet-stream' ? given : MIME[name.split('.').pop()?.toLowerCase() ?? '']) ?? 'application/octet-stream';

// File names come from notes: no folders, nothing hidden.
const safeName = (name: string) => name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '').slice(0, 120) || 'file';

const cacheCopy = (name: string, bytes: Uint8Array): File => {
  const dir = new Directory(Paths.cache, 'attachments');
  if (!dir.exists) dir.create();
  const file = new File(dir, safeName(name));
  if (file.exists) file.delete();
  file.create();
  file.write(bytes);
  return file;
};

export const openFileBytes = async (name: string, bytes: Uint8Array, mime?: string | null): Promise<void> => {
  const file = cacheCopy(name, bytes);
  const type = mimeOf(name, mime);
  if (Platform.OS === 'android') {
    try {
      const uri = await getContentUriAsync(file.uri);
      // 1 = FLAG_GRANT_READ_URI_PERMISSION: the other app may read this one file.
      goingAway();
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', { data: uri, flags: 1, type });
      return;
    } catch {
      // No app for this type: the share menu below lets the user pick one.
    }
  }
  goingAway();
  await Sharing.shareAsync(file.uri, { mimeType: type, dialogTitle: name });
};

// Resolves to a short message for the user (null = the user cancelled the folder picker).
export const saveFileBytes = async (name: string, bytes: Uint8Array | string, mime?: string | null): Promise<string | null> => {
  let target = readDownloadFolder();
  if (!target) {
    target = await chooseDownloadFolder();
    if (!target) return null;
    writeDownloadFolder(target);
  }
  try {
    // Android's document provider renames the file ("name (1).md") when the name is taken.
    const file = new Directory(target.folder).createFile(safeName(name), mimeOf(name, mime));
    file.write(bytes);
    return `Saved ${name} to ${target.folderName}.`;
  } catch (e) {
    throw new Error(`Could not write to ${target.folderName} (pick the folder again in Settings > Editor): ${e instanceof Error ? e.message : String(e)}`);
  }
};

export const shareFileBytes = async (name: string, bytes: Uint8Array | string, mime?: string | null): Promise<void> => {
  const dir = new Directory(Paths.cache, 'share');
  if (!dir.exists) dir.create();
  const file = new File(dir, safeName(name));
  if (file.exists) file.delete();
  file.create();
  file.write(bytes);
  goingAway();
  await Sharing.shareAsync(file.uri, { mimeType: mimeOf(name, mime), dialogTitle: name });
};

export const chooseDownloadFolder = async (): Promise<DownloadFolder | null> => {
  try {
    goingAway();
    const dir = await Directory.pickDirectoryAsync();
    if (!dir) return null;
    const raw = decodeURIComponent(dir.uri).replace(/\/+$/, '');
    return { folder: dir.uri, folderName: dir.name || raw.split(/[/:]/).pop() || raw };
  } catch {
    return null;
  }
};
