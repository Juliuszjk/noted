import { zipSync, strToU8 } from 'fflate';
import type { LocalBlobStore } from './blobs';
import { fetchSealedBlob, openBlob } from './blobs';
import { noteAttachments } from './doc-json';

// Images and files of a note for exports (like Notesnook's): decrypted into an "attachments"
// folder next to the note, named "<first 16 characters of the blob id>-<name>". `links` maps
// each node's blob attribute to that relative path, for the note's text.

export interface ExportedFile {
  path: string;
  bytes: Uint8Array;
}

const safeName = (name: string) => name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100) || 'file';

// The real type of image bytes, for a name without an extension.
const imageExtension = (bytes: Uint8Array): string => {
  const b = bytes;
  if (b[0] === 0x89 && b[1] === 0x50) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpg';
  if (b[0] === 0x47 && b[1] === 0x49) return 'gif';
  if (b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
  if (b[0] === 0x3c) return 'svg';
  return 'png';
};

export const exportAttachments = (
  masterKey: Uint8Array, json: Parameters<typeof noteAttachments>[0], blobs: LocalBlobStore, dir = '',
): Promise<{ links: Record<string, string>; files: ExportedFile[] }> => exportAttachmentsWith(json, async (id, key) => {
  const sealed = await fetchSealedBlob(masterKey, blobs, id);
  return sealed ? openBlob(sealed, key) : null;
}, dir);

// The same with the files read by the caller (`read`: decrypted bytes of a blob id and its
// key, null when missing), e.g. the live note page, which downloads them from the server.
export const exportAttachmentsWith = async (
  json: Parameters<typeof noteAttachments>[0], read: (id: string, key: string) => Promise<Uint8Array | null>, dir = '',
): Promise<{ links: Record<string, string>; files: ExportedFile[] }> => {
  const links: Record<string, string> = {};
  const files: ExportedFile[] = [];
  for (const a of noteAttachments(json)) {
    if (links[a.blob]) continue;
    const at = a.blob.indexOf(':');
    const id = a.blob.slice(0, at);
    const key = a.blob.slice(at + 1);
    let bytes: Uint8Array | null;
    try {
      bytes = await read(id, key);
    } catch {
      continue;
    }
    if (!bytes) continue;
    let name = safeName(a.name);
    if (a.kind === 'image' && !/\.[a-z0-9]{2,5}$/i.test(name)) name = `${name}.${imageExtension(bytes)}`;
    const rel = `attachments/${id.replace(/-/g, '').slice(0, 16)}-${name}`;
    links[a.blob] = rel;
    files.push({ path: `${dir}${rel}`, bytes });
  }
  return { links, files };
};

// One note and its files as a zip ("Note.md" + "attachments/…").
export const zipNoteWithFiles = (name: string, text: string, files: ExportedFile[]): Uint8Array => {
  const entries: Record<string, Uint8Array> = { [name]: strToU8(text) };
  for (const f of files) entries[f.path] = f.bytes;
  return zipSync(entries);
};
