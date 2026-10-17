import { it, expect } from 'vitest';
import * as Y from 'yjs';
import type { NoteRecord } from '@noted/types';
import { mergingNoteStore } from './merging-store';
import { sealDoc, docFromSealed } from './doc';
import type { LocalNoteStore } from './engine';

const key = new Uint8Array(32).fill(7);
const memoryStore = (): LocalNoteStore & { rows: Map<string, NoteRecord> } => {
  const rows = new Map<string, NoteRecord>();
  return {
    rows,
    getAll: async () => [...rows.values()],
    save: async (id, content, yjs_state, updated_at) => { rows.set(id, { id, content, yjs_state, updated_at } as NoteRecord); },
    updateTimestamp: async () => {},
  };
};
const textOf = (sealed: string) => docFromSealed(key, sealed).getText('t').toString();

it('a save made from an older state keeps what was stored meanwhile', async () => {
  const raw = memoryStore();
  const store = mergingNoteStore(key, raw);
  const base = new Y.Doc();
  base.getText('t').insert(0, 'hello');
  await store.save('n', '', sealDoc(key, base), 1);

  // The sync engine read the note, then waited for the server...
  const engineDoc = docFromSealed(key, raw.rows.get('n')!.yjs_state);
  // ...while the editor stored new text.
  const editorDoc = docFromSealed(key, raw.rows.get('n')!.yjs_state);
  editorDoc.getText('t').insert(5, ' world');
  await store.save('n', '', sealDoc(key, editorDoc), 2);
  // The engine writes its (remote) change on the old state.
  engineDoc.getText('t').insert(0, '> ');
  await store.save('n', '', sealDoc(key, engineDoc), 3);

  expect(textOf(raw.rows.get('n')!.yjs_state)).toBe('> hello world');
  expect(raw.rows.get('n')!.content).not.toBe('');
});

it('saves that run at the same time are applied one after another', async () => {
  const raw = memoryStore();
  const store = mergingNoteStore(key, raw);
  const docs = ['a', 'b', 'c'].map((s) => { const d = new Y.Doc(); d.getText('t').insert(0, s); return d; });
  await Promise.all(docs.map((d, i) => store.save('n', '', sealDoc(key, d), i)));
  expect(textOf(raw.rows.get('n')!.yjs_state).split('').sort().join('')).toBe('abc');
});
