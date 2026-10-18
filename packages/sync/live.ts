import * as Y from 'yjs';
import { deriveLiveKeys, publishPasswordKey, sealBytes, unsealBytes, bytesToBase64, base64ToBytes } from '@noted/crypto';

// Live published notes, the parts both sides share (the guest page in the public server and
// the owner's apps; owner-only code is in live-owner.ts). The note's Yjs state and every
// update after it are sealed with a key derived from the link key (and the password), so the
// server relays and stores opaque bytes (apps/api/src/live.ts). Guests may only change the
// title and the body: the owner's app checks each of their updates before merging it.

export interface LiveKeys {
  content: Uint8Array;
  // Base64 tokens guests send, and their SHA-256 (hex) the owner registers on the server.
  read: string;
  write: string;
}

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
export const tokenHash = async (token: string): Promise<string> =>
  hex(await globalThis.crypto.subtle.digest('SHA-256', base64ToBytes(token) as BufferSource));

// `linkKey` = the key in the link; with a password this runs PBKDF2 (pass `passwordKey` when
// the platform derived it elsewhere, e.g. the phone's WebView).
export const liveKeys = (linkKey: Uint8Array, password: string | null, passwordKey?: Uint8Array): LiveKeys => {
  const key = password ? passwordKey ?? publishPasswordKey(linkKey, password) : linkKey;
  const { content, read, write } = deriveLiveKeys(key);
  return { content, read: bytesToBase64(read), write: bytesToBase64(write) };
};

export const sealUpdate = (keys: Pick<LiveKeys, 'content'>, update: Uint8Array): string => bytesToBase64(sealBytes(keys.content, update));
export const unsealUpdate = (keys: Pick<LiveKeys, 'content'>, data: string): Uint8Array => unsealBytes(keys.content, base64ToBytes(data));

// Origin of changes that came from the live note (not sent back there).
export const LIVE_ORIGIN = 'noted-live';

// The parts of a note guests may not touch: everything but `title` and the body.
const protectedState = (doc: Y.Doc): string => JSON.stringify({
  settings: doc.getMap('settings').toJSON(),
  tags: doc.getMap('tags').toJSON(),
  notebooks: doc.getMap('notebooks').toJSON(),
});

const hasPending = (doc: Y.Doc): boolean => !!doc.store.pendingStructs || !!doc.store.pendingDs;

// Guest updates (in the order the server numbered them) that may go into the note: each is
// tried on a copy, and one that changes the note's settings, tags or notebooks, or cannot be
// applied (it builds on a refused one), is refused. Returns the accepted ones.
export const acceptGuestUpdates = (doc: Y.Doc, updates: Uint8Array[]): { accepted: Uint8Array[]; refused: number } => {
  const accepted: Uint8Array[] = [];
  let refused = 0;
  const base = Y.encodeStateAsUpdate(doc);
  const fresh = () => {
    const copy = new Y.Doc({ gc: false });
    Y.applyUpdate(copy, base);
    for (const u of accepted) Y.applyUpdate(copy, u);
    return copy;
  };
  let copy = fresh();
  const before = protectedState(copy);
  for (const update of updates) {
    let ok = true;
    try {
      Y.applyUpdate(copy, update);
      ok = !hasPending(copy) && protectedState(copy) === before;
    } catch {
      ok = false;
    }
    if (ok) {
      accepted.push(update);
    } else {
      refused++;
      copy.destroy();
      copy = fresh();
    }
  }
  copy.destroy();
  return { accepted, refused };
};

// Messages of the guests' WebSocket (apps/api/src/live.ts).
export type LiveGuestMessage =
  | { type: 'joined'; editable: boolean; updates: { seq: number; data: string }[] }
  | { type: 'update'; seq: number; data: string }
  | { type: 'ack'; seq: number; ref: number | null }
  | { type: 'awareness'; data: string }
  | { type: 'editable' }
  | { type: 'error'; error: string; ref?: number };

// What the public server answers on GET /p/:id/live.
export interface LiveInitial {
  editable: boolean;
  snapshot: string;
  snapshotSeq: number;
  updates: { seq: number; data: string }[];
}
