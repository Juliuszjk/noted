import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { generateKey, seal, unseal } from '@noted/crypto';
import type { NoteRecord } from '@noted/types';
import type { LocalNoteStore } from './engine';
import { sealDoc } from './doc';
import { buildNoteMeta, decodeNoteMeta, encodeNoteMeta, setNoteTrashed, setTitle } from './note-meta';
import { purgeExpiredTrash } from './maintenance';

const DAY = 86_400_000;

describe('trash cleanup', () => {
  it('deletes only notes trashed more than 7 days ago', async () => {
    const key = generateKey();
    const now = 100 * DAY;
    const rows = new Map<string, NoteRecord>();
    const add = (id: string, trashedDaysAgo: number | null) => {
      const doc = new Y.Doc();
      setTitle(doc, id);
      if (trashedDaysAgo !== null) setNoteTrashed(doc, true, now - trashedDaysAgo * DAY);
      rows.set(id, { id, content: seal(key, new TextEncoder().encode(encodeNoteMeta(buildNoteMeta(doc)))), yjs_state: sealDoc(key, doc), updated_at: 1 });
    };
    add('old', 8);
    add('recent', 2);
    add('live', null);
    const store: LocalNoteStore = {
      getAll: async () => [...rows.values()],
      save: async (id, content, yjsState, updatedAt) => { rows.set(id, { id, content, yjs_state: yjsState, updated_at: updatedAt }); },
      updateTimestamp: async () => {},
    };
    expect(await purgeExpiredTrash(key, store, now)).toBe(1);
    const meta = (id: string) => decodeNoteMeta(new TextDecoder().decode(unseal(key, rows.get(id)!.content)));
    expect(meta('old')).toMatchObject({ deleted: true, title: '' });
    expect(rows.get('old')!.updated_at).toBe(now);
    expect(meta('recent').deleted).toBe(false);
    expect(meta('live').deleted).toBe(false);
    expect(await purgeExpiredTrash(key, store, now)).toBe(0);
  });
});
