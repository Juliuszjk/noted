import * as Y from 'yjs';
import { seal, unseal } from '@noted/crypto';

// Origin for updates applied on behalf of a live editor.
export const EDITOR_ORIGIN = 'noted-editor';

export interface EditorApplyResult {
  // New sealed state to store. Equal to the input when nothing changed.
  sealed: string | null;
  // False when the update added nothing (for example an editor that only rendered).
  changed: boolean;
  // The merged document (e.g. to rebuild the note's metadata).
  doc: Y.Doc;
}

// Applies an incremental Yjs update from an editor on top of the CURRENT stored state, so
// changes that sync wrote while the editor was open are kept (CRDT merge, never overwrite).
export function applyEditorUpdate(
  key: Uint8Array,
  sealedState: string | null,
  update: Uint8Array,
): EditorApplyResult {
  const doc = new Y.Doc();
  if (sealedState) Y.applyUpdate(doc, unseal(key, sealedState));
  const before = Y.snapshot(doc);
  Y.applyUpdate(doc, update, EDITOR_ORIGIN);
  const changed = !Y.equalSnapshots(before, Y.snapshot(doc));
  if (!changed) return { sealed: sealedState, changed: false, doc };
  return { sealed: seal(key, Y.encodeStateAsUpdate(doc)), changed: true, doc };
}
