import * as Y from 'yjs';
import { seal, unseal } from '@noted/crypto';

// Origin tag for updates that come from the server rather than local typing.
export const REMOTE_ORIGIN = 'noted-remote';

// Opens a sealed blob with the main key, then with each fallback key. Fallbacks exist only
// to migrate data that an earlier bug encrypted with the wrong key.
function unsealWithFallback(key: Uint8Array, fallbackKeys: Uint8Array[], sealed: string): Uint8Array {
  try {
    return unseal(key, sealed);
  } catch (err) {
    for (const fallback of fallbackKeys) {
      try {
        return unseal(fallback, sealed);
      } catch {
        // try the next key
      }
    }
    throw err;
  }
}

// Decrypts a stored Yjs state into a doc. A null state yields an empty doc.
export function docFromSealed(
  key: Uint8Array,
  sealed: string | null,
  doc: Y.Doc = new Y.Doc(),
  fallbackKeys: Uint8Array[] = [],
): Y.Doc {
  if (sealed) Y.applyUpdate(doc, unsealWithFallback(key, fallbackKeys, sealed), REMOTE_ORIGIN);
  return doc;
}

// Encrypts the full state of a doc for storage and upload.
export function sealDoc(key: Uint8Array, doc: Y.Doc): string {
  return seal(key, Y.encodeStateAsUpdate(doc));
}

export interface MergeResult {
  // localDoc received content it did not have yet.
  changedLocal: boolean;
  // localDoc contains content the remote copy lacks (needs pushing).
  changedRemote: boolean;
}

// Merges the remote copy into localDoc IN PLACE, so a live editor bound to
// localDoc updates immediately. Snapshots are compared instead of state
// vectors because state vectors do not see deletions.
export function mergeRemote(
  key: Uint8Array,
  localDoc: Y.Doc,
  remoteSealed: string | null,
  fallbackKeys: Uint8Array[] = [],
): MergeResult {
  const remoteDoc = docFromSealed(key, remoteSealed, new Y.Doc(), fallbackKeys);
  const localBefore = Y.snapshot(localDoc);
  const remoteSnap = Y.snapshot(remoteDoc);

  Y.applyUpdate(localDoc, Y.encodeStateAsUpdate(remoteDoc), REMOTE_ORIGIN);

  const merged = Y.snapshot(localDoc);
  return {
    changedLocal: !Y.equalSnapshots(localBefore, merged),
    changedRemote: !Y.equalSnapshots(remoteSnap, merged),
  };
}
