import * as Y from 'yjs';
import { seal } from '@noted/crypto';
import { buildNoteMeta, encodeNoteMeta, docFromSealed, sealDoc, CATALOG_ID } from '@noted/sync';
import type { LocalNoteStore } from '@noted/sync';

// Changes a note's doc outside the editor (flags, trash, notebook, catalog) and stores the
// new sealed state and metadata. An open editor picks the change up through its poll.
export const updateNoteRecord = async <T>(
  masterKey: Uint8Array,
  store: LocalNoteStore,
  id: string,
  change: (doc: Y.Doc) => T,
): Promise<T | undefined> => {
  const record = (await store.getAll()).find((n) => n.id === id);
  // The catalog is created on first use; other notes must exist.
  if (!record && id !== CATALOG_ID) return undefined;
  const doc = record?.yjs_state && record.yjs_state.includes('.') ? docFromSealed(masterKey, record.yjs_state) : new Y.Doc();
  const result = change(doc);
  await store.save(id, seal(masterKey, new TextEncoder().encode(encodeNoteMeta(buildNoteMeta(doc)))), sealDoc(masterKey, doc), Date.now());
  return result;
};
