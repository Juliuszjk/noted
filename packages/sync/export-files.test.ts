import { it, expect } from 'vitest';
import * as Y from 'yjs';
import { unzipSync, strFromU8 } from 'fflate';
import { generateKey, seal, sealBytes, bytesToBase64 } from '@noted/crypto';
import type { NoteRecord } from '@noted/types';
import { exportAllNotes } from './export-all';
import { setNoteBodyJson } from './json-to-y';
import { sealDoc } from './doc';
import { buildNoteMeta, encodeNoteMeta, setTitle } from './note-meta';
import type { LocalBlobStore } from './blobs';

it('exports images and files into an attachments folder, linked from the note', async () => {
  const master = generateKey();
  const blobs = new Map<string, Uint8Array>();
  const blobStore: LocalBlobStore = { get: async (id) => blobs.get(id) ?? null, put: async () => {}, pending: async () => [], markUploaded: async () => {} };
  const add = (id: string, bytes: Uint8Array) => { const key = generateKey(); blobs.set(id, sealBytes(key, bytes)); return `${id}:${bytesToBase64(key)}`; };
  const png = add('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
  const mp4 = add('11111111-2222-3333-4444-555555555555', new Uint8Array([1, 2, 3]));
  const doc = new Y.Doc();
  setTitle(doc, 'TODO');
  setNoteBodyJson(doc, { type: 'doc', content: [
    { type: 'image', attrs: { blob: png, alt: 'shot' } },
    { type: 'attachment', attrs: { blob: mp4, name: 'clip.mp4', size: 3, mime: 'video/mp4' } },
  ] });
  const rows: NoteRecord[] = [{ id: 'n1', content: seal(master, new TextEncoder().encode(encodeNoteMeta(buildNoteMeta(doc)))), yjs_state: sealDoc(master, doc), updated_at: 1 } as NoteRecord];
  const store = { getAll: async () => rows, save: async () => {}, updateTimestamp: async () => {} };
  const { zip } = await exportAllNotes(master, store, 'markdown', { blobs: blobStore });
  const files = unzipSync(zip);
  expect(Object.keys(files).sort()).toEqual(['README.txt', 'TODO.md', 'attachments/1111111122223333-clip.mp4', 'attachments/aaaaaaaabbbbcccc-shot.png'].sort());
  const md = strFromU8(files['TODO.md']);
  expect(md).toContain('![shot](<./attachments/aaaaaaaabbbbcccc-shot.png>)');
  expect(md).toContain('[clip.mp4](<./attachments/1111111122223333-clip.mp4> "clip.mp4")');
});
