import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { generateKey, seal } from '@noted/crypto';
import type { NoteRecord } from '@noted/types';
import type { LocalNoteStore } from './engine';
import { sealDoc } from './doc';
import { buildNoteMeta, deleteNoteForever, encodeNoteMeta, setNotePublish } from './note-meta';
import { lockNote } from './locked';
import { GUEST_FILE_GRACE_MS, scanNotes, unusedGuestFiles } from './guest-files';
import type { GuestFile } from './guest-files';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

const withImage = (blobId: string | null, share?: string) => {
  const doc = new Y.Doc();
  const body = doc.getXmlFragment('default');
  const para = new Y.XmlElement('paragraph');
  body.insert(0, [para]);
  if (blobId) {
    const image = new Y.XmlElement('image');
    image.setAttribute('blob', `${blobId}:a2V5` as never);
    body.insert(1, [image]);
  }
  if (share) setNotePublish(doc, { id: share, key: 'k', at: 1, live: true } as never);
  return doc;
};

const storeOf = (key: Uint8Array, docs: Y.Doc[]): LocalNoteStore => {
  const rows: NoteRecord[] = docs.map((doc, i) => ({
    id: `n${i}`, content: seal(key, new TextEncoder().encode(encodeNoteMeta(buildNoteMeta(doc)))), yjs_state: sealDoc(key, doc), updated_at: 1,
  }));
  return { getAll: async () => rows, save: async () => {}, updateTimestamp: async () => {} };
};

const now = 10 * GUEST_FILE_GRACE_MS;
const file = (id: string, share: string, over: Partial<GuestFile> = {}): GuestFile => ({ id, share, size: 10, at: now - 2 * GUEST_FILE_GRACE_MS, settled: true, ...over });

describe('guest file clean-up', () => {
  it('deletes guest files no note uses, keeps used, young and unsettled ones', async () => {
    const key = generateKey();
    const scan = await scanNotes(key, storeOf(key, [withImage(A, 'share1'), withImage(null, 'share1')]), null);
    const files = [
      file(A, 'share1'),
      file(B, 'share1'),
      file(C, 'share1', { at: now - 1000 }),
      file('44444444-4444-4444-8444-444444444444', 'share1', { settled: false }),
      file('55555555-5555-4555-8555-555555555555', 'gone'),
    ];
    expect(unusedGuestFiles(files, scan, now).map((f) => f.id)).toEqual([B, '55555555-5555-4555-8555-555555555555']);
  });

  it('a note deleted for good uses nothing any more', async () => {
    const key = generateKey();
    const doc = withImage(A, 'share1');
    deleteNoteForever(doc);
    const scan = await scanNotes(key, storeOf(key, [doc]), null);
    expect(unusedGuestFiles([file(A, 'share1')], scan, now).map((f) => f.id)).toEqual([A]);
  });

  it('with a locked note it cannot read, deletes only files of readable live notes', async () => {
    const key = generateKey();
    const vaultKey = generateKey();
    const locked = withImage(C);
    lockNote(locked, vaultKey);
    const store = storeOf(key, [withImage(null, 'share1'), locked]);
    const files = [file(B, 'share1'), file(C, 'old-share')];
    expect(unusedGuestFiles(files, await scanNotes(key, store, null), now).map((f) => f.id)).toEqual([B]);
    // With the vault open its images count as used, and the rest may go.
    expect(unusedGuestFiles([...files, file(A, 'old-share')], await scanNotes(key, store, vaultKey), now).map((f) => f.id)).toEqual([B, A]);
  });
});
