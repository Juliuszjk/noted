import type Database from '@tauri-apps/plugin-sql';
import { fetch as httpFetch } from '@tauri-apps/plugin-http';
import { mkdir, readFile, remove, writeFile } from '@tauri-apps/plugin-fs';
import { save } from '@tauri-apps/plugin-dialog';
import { messageDialog } from '@noted/ui';
import { openPath } from '@tauri-apps/plugin-opener';
import { appCacheDir, appDataDir, join } from '@tauri-apps/api/path';
import { invoke } from '@tauri-apps/api/core';
import { bytesToBase64, base64ToBytes, generateKey, sealBytes } from '@noted/crypto';
import { MAX_BLOB_PLAINTEXT_BYTES, fetchSealedBlob, openBlob } from '@noted/sync';
import type { LocalBlobStore } from '@noted/sync';
import { normalizeLinkUrl, createBlobUrlCache } from '@noted/editor';
import type { BlobHandlers, BlobRef } from '@noted/editor';
import { compressImageBytes } from '@noted/media';
import { saveToDownloadFolder } from './download-folder';
import { withoutHeic } from './heic';

// Types of pasted local files (by extension; the clipboard only has their paths).
const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
  bmp: 'image/bmp', heic: 'image/heic', heif: 'image/heif', jxl: 'image/jxl', pdf: 'application/pdf', txt: 'text/plain',
  md: 'text/markdown', zip: 'application/zip', mp3: 'audio/mpeg', mp4: 'video/mp4', mkv: 'video/x-matroska',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', odt: 'application/vnd.oasis.opendocument.text',
};

// Sealed blobs are files in $APPDATA/blobs/<id> (binary, read without base64 copies); the
// SQLite table keeps which ones are uploaded (`uploaded = 0` rows are the upload queue).
// Older versions kept the bytes in `data` (base64): read from there until moved
// (migrateBlobsToFiles), then the column is empty.
export const BLOBS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS blobs (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    uploaded INTEGER NOT NULL DEFAULT 0
  )
`;

const URL_DOWNLOAD_LIMIT = 25 * 1024 * 1024;
const URL_TIMEOUT_MS = 30_000;

let blobsDirPath: Promise<string> | null = null;
const blobsDir = () => (blobsDirPath ??= appDataDir().then((dir) => join(dir, 'blobs')).then(async (dir) => {
  await mkdir(dir, { recursive: true }).catch(() => {});
  return dir;
}));
// Blob ids are UUIDs; anything else never becomes a path.
const SAFE_ID = /^[A-Za-z0-9-]{8,64}$/;
const blobPath = async (id: string) => {
  if (!SAFE_ID.test(id)) throw new Error('Bad blob id');
  return join(await blobsDir(), id);
};

export const createDesktopBlobStore = (db: Database): LocalBlobStore & { remove: (id: string) => Promise<void> } => ({
  get: async (id) => {
    const rows = await db.select<{ data: string }[]>('SELECT data FROM blobs WHERE id = $1', [id]);
    if (!rows[0]) return null;
    if (rows[0].data) return base64ToBytes(rows[0].data);
    try {
      return await readFile(await blobPath(id));
    } catch {
      return null;
    }
  },
  put: async (id, sealed, uploaded) => {
    await writeFile(await blobPath(id), sealed);
    await db.execute(
      `INSERT INTO blobs (id, data, uploaded) VALUES ($1, '', $2)
       ON CONFLICT(id) DO UPDATE SET uploaded = MAX(blobs.uploaded, excluded.uploaded)`,
      [id, uploaded ? 1 : 0],
    );
  },
  pending: async () => (await db.select<{ id: string }[]>('SELECT id FROM blobs WHERE uploaded = 0')).map((r) => r.id),
  markUploaded: async (id) => {
    await db.execute('UPDATE blobs SET uploaded = 1 WHERE id = $1', [id]);
  },
  remove: async (id) => {
    await db.execute('DELETE FROM blobs WHERE id = $1', [id]);
    await remove(await blobPath(id)).catch(() => {});
  },
});

// Moves blobs kept in the database by older versions into files, one at a time (no big reads),
// then shrinks the database file. Returns how many were moved.
export const migrateBlobsToFiles = async (db: Database): Promise<number> => {
  let moved = 0;
  for (;;) {
    const rows = await db.select<{ id: string; data: string }[]>("SELECT id, data FROM blobs WHERE data != '' LIMIT 1");
    const row = rows[0];
    if (!row) break;
    try {
      await writeFile(await blobPath(row.id), base64ToBytes(row.data));
      await db.execute("UPDATE blobs SET data = '' WHERE id = $1", [row.id]);
      moved++;
    } catch (e) {
      console.error('Moving a blob to a file failed:', row.id, e);
      break;
    }
  }
  if (moved) await db.execute('VACUUM').catch(() => {});
  return moved;
};

// Opened attachments are decrypted into the app cache so the default app can read them.
// They are plaintext on disk, so the folder is wiped at every start.
const attachmentsDir = async () => join(await appCacheDir(), 'attachments');

export const clearAttachmentCache = async (): Promise<void> => {
  try {
    await remove(await attachmentsDir(), { recursive: true });
  } catch {
    // nothing there yet
  }
};

// A file name that cannot leave the folder it is written to.
const safeFileName = (name: string): string => {
  const cleaned = name.replace(/[/\\\u0000-\u001f]/g, '_').trim().slice(0, 200);
  return cleaned && cleaned !== '.' && cleaned !== '..' ? cleaned : 'file';
};

// Real image type from the first bytes. Images are stored compressed (usually WebP), so a
// saved copy gets the matching extension instead of the original file's one.
const IMAGE_SIGNATURES: [string, number[]][] = [
  ['png', [0x89, 0x50, 0x4e, 0x47]],
  ['jpg', [0xff, 0xd8, 0xff]],
  ['gif', [0x47, 0x49, 0x46, 0x38]],
];
const imageExtension = (bytes: Uint8Array): string | null => {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
  for (const [ext, sig] of IMAGE_SIGNATURES) if (sig.every((b, i) => bytes[i] === b)) return ext;
  return null;
};
const withImageExtension = (name: string, bytes: Uint8Array): string => {
  const ext = imageExtension(bytes);
  if (!ext) return name;
  const base = name.replace(/\.(png|jpe?g|gif|webp|bmp|tiff?|heic|avif|svg)$/i, '');
  return `${base || 'image'}.${ext}`;
};

// Editor handlers: decrypt blobs into object URLs (cached per blob for the session), turn new
// images and files into sealed, queued blobs, and open/save attachments. `onStored` lets the
// app start an upload right away.
export const createDesktopBlobHandlers = (
  masterKey: Uint8Array,
  store: LocalBlobStore,
  onStored: () => void,
): BlobHandlers => {
  // Decrypted images while they are shown (blob-url-cache.ts); keys come with each resolve.
  const keys = new Map<string, string>();
  const images = createBlobUrlCache(async (id) => {
    const key = keys.get(id);
    const sealed = key ? await fetchSealedBlob(masterKey, store, id) : null;
    return sealed && key ? new Blob([openBlob(sealed, key) as BlobPart]) : null;
  });

  const seal = async (bytes: Uint8Array): Promise<BlobRef> => {
    if (bytes.length > MAX_BLOB_PLAINTEXT_BYTES) throw new Error('File is larger than 30 MB');
    const id = crypto.randomUUID();
    const key = generateKey();
    await store.put(id, sealBytes(key, bytes), false);
    onStored();
    return { id, key: bytesToBase64(key) };
  };

  const storeImage = async (bytes: Uint8Array, type = 'image/webp'): Promise<BlobRef> => {
    const ref = await seal(bytes);
    keys.set(ref.id, ref.key);
    images.put(ref.id, new Blob([bytes as BlobPart], { type }));
    return ref;
  };

  const decrypted = async (ref: BlobRef): Promise<Uint8Array> => {
    const sealed = await fetchSealedBlob(masterKey, store, ref.id);
    if (!sealed) throw new Error('Not uploaded yet by the device that added it');
    return openBlob(sealed, ref.key);
  };

  return {
    resolve: (ref) => {
      keys.set(ref.id, ref.key);
      return images.acquire(ref.id);
    },
    release: (ref) => images.release(ref.id),

    upload: async (file) => {
      const { bytes, type } = await compressImageBytes(await withoutHeic(file));
      return storeImage(bytes, type);
    },

    storeBytes: (bytes) => storeImage(bytes),

    clipboardPaths: () => invoke<string[]>('clipboard_file_paths'),

    // Files copied in a file manager (yazi `c y`, Nautilus, ...) are pasted as their paths;
    // Rust reads them (only regular files up to the blob limit).
    readPaths: async (paths) => {
      const files: File[] = [];
      for (const path of paths) {
        const bytes = await invoke<ArrayBuffer>('read_local_file', { path });
        const name = path.split('/').pop() || 'file';
        const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
        files.push(new File([bytes], name, { type: MIME_BY_EXTENSION[ext] ?? '' }));
      }
      return files;
    },

    // Downloaded through the Tauri HTTP plugin (no CORS limits), then compressed like any
    // other image. Only http(s) addresses are accepted.
    storeUrl: async (input) => {
      const url = normalizeLinkUrl(input);
      if (!url || !/^https?:/i.test(url)) throw new Error('Not a web address');
      const res = await httpFetch(url, { method: 'GET', connectTimeout: URL_TIMEOUT_MS });
      if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`);
      const declared = Number(res.headers.get('content-length') ?? 0);
      if (declared > URL_DOWNLOAD_LIMIT) throw new Error('Image is larger than 25 MB');
      const type = (res.headers.get('content-type') ?? '').split(';')[0].trim();
      if (type && !type.startsWith('image/')) throw new Error(`Not an image (${type})`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length > URL_DOWNLOAD_LIMIT) throw new Error('Image is larger than 25 MB');
      const name = decodeURIComponent(new URL(url).pathname.split('/').pop() || 'image');
      const compressed = await compressImageBytes(new File([bytes as BlobPart], name, { type: type || 'image/png' }));
      return storeImage(compressed.bytes, compressed.type);
    },

    uploadFile: async (file) => {
      if (file.size > MAX_BLOB_PLAINTEXT_BYTES) throw new Error('File is larger than 30 MB');
      return seal(new Uint8Array(await file.arrayBuffer()));
    },

    openFile: async (ref, name) => {
      const bytes = await decrypted(ref);
      const dir = await join(await attachmentsDir(), ref.id);
      await mkdir(dir, { recursive: true });
      const path = await join(dir, safeFileName(name));
      await writeFile(path, bytes);
      await openPath(path);
    },

    saveFile: async (ref, name) => {
      const bytes = await decrypted(ref);
      const fileName = safeFileName(withImageExtension(name, bytes));
      // Settings > Editor "Download folder": straight there, no dialog.
      let path = await saveToDownloadFolder(fileName, bytes);
      if (!path) {
        path = await save({ defaultPath: fileName });
        if (!path) return;
        await writeFile(path, bytes);
      }
      // A system notification like the user's others ("Downloaded" + where to).
      const image = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(path);
      invoke('notify', { summary: image ? 'Image downloaded' : 'File downloaded', body: path.replace(/^\/home\/[^/]+/, '~'), kind: image ? 'image' : 'file' })
        .catch((e) => console.warn('Notification failed:', e));
    },

    notify: (text) => {
      messageDialog('Noted', text, 'error');
    },
  };
};
