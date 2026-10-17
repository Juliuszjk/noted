import { zipSync, strToU8 } from 'fflate';
import { unseal } from '@noted/crypto';
import type { LocalNoteStore } from './engine';
import { docFromSealed } from './doc';
import { decodeNoteMeta, displayTitle, getTitleText } from './note-meta';
import { isSystemNote } from './catalog';
import { noteBodyJson } from './doc-json';
import { exportNote, exportFileName } from '@noted/editor/export';
import type { LocalBlobStore } from './blobs';
import { exportAttachments } from './export-files';

// "Export all notes": a zip of plain files (no encryption). Notes in a notebook go into its
// folder (the first one, when there are several); the trash is left out, the archive gets
// its own folder. HTML needs an editor to render (desktop passes `toHtml`).

export type ExportAllFormat = 'markdown' | 'text' | 'html';

const safe = (name: string) => name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Untitled';

export const exportAllNotes = async (
  masterKey: Uint8Array, store: LocalNoteStore, format: ExportAllFormat,
  // `blobs`: images and files go into an "attachments" folder next to the notes, linked from
  // them (like Notesnook's exports); without it they are left out.
  options: { notebookNames?: Map<string, string>; toHtml?: (json: object, title: string, links: Record<string, string>) => string; blobs?: LocalBlobStore } = {},
): Promise<{ zip: Uint8Array; count: number }> => {
  // A plain, uncompressed README first: libmagic (`file`, used by some file managers) took
  // some exports for Office documents (OOXML) because of what followed the first entry.
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {
    'README.txt': [strToU8(`Notes exported from Noted (${format === 'markdown' ? 'Markdown' : format === 'text' ? 'plain text' : 'HTML'}), one file per note.\nNotes in a notebook are in its folder; archived notes are in Archive.\n`), { level: 0 }],
  };
  const used = new Set<string>();
  const ext = format === 'markdown' ? 'md' : format === 'text' ? 'txt' : 'html';
  let count = 0;
  for (const note of await store.getAll()) {
    if (isSystemNote(note.id) || !note.yjs_state || !note.content) continue;
    let meta;
    try {
      meta = decodeNoteMeta(new TextDecoder().decode(unseal(masterKey, note.content)));
    } catch {
      continue;
    }
    // Locked notes stay in the vault: an export is plain text.
    if (meta.deleted || meta.trashedAt || meta.locked) continue;
    const doc = docFromSealed(masterKey, note.yjs_state);
    const title = getTitleText(doc).toString().trim() || displayTitle(meta);
    const json = noteBodyJson(doc);
    const folder = meta.archived ? 'Archive/' : meta.notebooks[0] && options.notebookNames?.get(meta.notebooks[0]) ? `${safe(options.notebookNames.get(meta.notebooks[0])!)}/` : '';
    const base = exportFileName(title, ext).replace(/\.[a-z]+$/, '');
    // Text files cannot link to files (Notesnook leaves them out too).
    const attached = options.blobs && format !== 'text' ? await exportAttachments(masterKey, json, options.blobs, folder) : { links: {}, files: [] };
    for (const f of attached.files) files[f.path] = f.bytes;
    const body = format === 'html'
      ? (options.toHtml ? options.toHtml(json, title, attached.links) : null)
      : exportNote(title, json, format, {}, attached.links);
    if (body === null) throw new Error('HTML export is not available here');
    let path = `${folder}${base}.${ext}`;
    for (let i = 2; used.has(path.toLowerCase()); i++) path = `${folder}${base} (${i}).${ext}`;
    used.add(path.toLowerCase());
    files[path] = strToU8(body);
    count++;
  }
  if (count === 0) throw new Error('There are no notes to export.');
  return { zip: zipSync(files), count };
};
