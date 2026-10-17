import * as Y from 'yjs';
import { seal, unseal } from '@noted/crypto';
import type { NoteRecord } from '@noted/types';
import type { LocalNoteStore } from './engine';
import { buildNoteMeta, encodeNoteMeta } from './note-meta';

// A local note store whose `save` never loses what is already stored. Every writer (the editor,
// the sync engine, note actions) reads a note, works on it and writes it back; the sync engine
// even waits for the server in between. A plain save then overwrote edits stored meanwhile
// (on the phone: text typed while a slow sync ran was gone). Here each save is merged with the
// stored state first (Yjs: the union of both, deletions included) and saves run one at a time,
// so reading and writing inside a save cannot interleave.

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

// The stored state merged into the incoming one; null when the incoming state already has it all.
export const mergeStoredState = (key: Uint8Array, stored: string | null | undefined, incoming: string): { yjs: string; content: string } | null => {
  if (!stored || stored === incoming || !stored.includes('.') || !incoming.includes('.')) return null;
  try {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, unseal(key, incoming));
    const before = Y.encodeStateAsUpdate(doc);
    Y.applyUpdate(doc, unseal(key, stored));
    const after = Y.encodeStateAsUpdate(doc);
    if (sameBytes(before, after)) return null;
    return { yjs: seal(key, after), content: seal(key, new TextEncoder().encode(encodeNoteMeta(buildNoteMeta(doc)))) };
  } catch (e) {
    // A state that cannot be read is not merged (the incoming one is written as it is).
    console.warn('Could not merge the stored note state:', e);
    return null;
  }
};

export const mergingNoteStore = (key: Uint8Array, store: LocalNoteStore & { get?(id: string): Promise<NoteRecord | null> }): LocalNoteStore & { get(id: string): Promise<NoteRecord | null> } => {
  let chain: Promise<unknown> = Promise.resolve();
  const oneAtATime = <T,>(work: () => Promise<T>): Promise<T> => {
    const run = chain.then(work, work);
    chain = run.catch(() => {});
    return run;
  };
  const current = async (id: string) => (store.get ? store.get(id) : (await store.getAll()).find((n) => n.id === id) ?? null);
  return {
    getAll: () => store.getAll(),
    get: (id) => current(id),
    updateTimestamp: (id, updatedAt) => oneAtATime(() => store.updateTimestamp(id, updatedAt)),
    remove: store.remove ? (id) => oneAtATime(() => store.remove!(id)) : undefined,
    save: (id, content, yjsState, updatedAt) => oneAtATime(async () => {
      const merged = mergeStoredState(key, (await current(id))?.yjs_state, yjsState);
      await store.save(id, merged?.content ?? content, merged?.yjs ?? yjsState, updatedAt);
    }),
  };
};
