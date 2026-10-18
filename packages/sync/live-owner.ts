import * as Y from 'yjs';
import { API_URL } from '@noted/config';
import { apiFetch } from './client';
import { fromBase64Url, nextPublishInfo, publishExpired } from './publish';
import type { PublishOptions } from './publish';
import { acceptGuestUpdates, liveKeys, LIVE_ORIGIN, sealUpdate, tokenHash, unsealUpdate } from './live';
import type { LiveKeys } from './live';
import { noteBlobIds, noteBodyJson } from './doc-json';
import type { NotePublish } from './note-meta';

// The owner's side of live published notes (live.ts): every device of the owner merges the
// updates guests send (each checked by acceptGuestUpdates; none while editing is off), sends
// its own edits of the open note to the guests, and, after (re)connecting and while guests
// are busy, uploads a new snapshot of the note so the server can drop the queued updates
// (that also brings guests the edits made while this device was offline).

export interface LiveOwnerHost {
  masterKey: Uint8Array;
  // Sends a message on the private WebSocket; false when it is not connected.
  send: (message: object) => boolean;
  // The note's current doc (the open one, or loaded from storage); null = not on this device.
  readNote: (noteId: string) => Promise<Y.Doc | null>;
  // Applies updates to the note (the open doc in place, or the stored one) with the origin
  // LIVE_ORIGIN (so watchDoc does not send them back) and saves it.
  applyToNote: (noteId: string, updates: Uint8Array[]) => Promise<void>;
  // Newest update this device merged, per live note (kept across restarts).
  getSeq: (shareId: string) => number;
  setSeq: (shareId: string, seq: number) => void;
  // Platforms that derive passwords elsewhere (the phone's WebView) pass the key here.
  passwordKey?: (linkKey: Uint8Array, password: string) => Promise<Uint8Array>;
  // Guests' cursors / presence for the open note (raw awareness update).
  onAwareness?: (noteId: string, update: Uint8Array) => void;
}

interface Share {
  noteId: string;
  info: NotePublish;
  keys: Promise<LiveKeys>;
  // Updates waiting to be merged (in order), and whether a merge is running.
  queue: { seq: number; data: string; guest: boolean }[];
  busy: boolean;
  compactTimer: ReturnType<typeof setTimeout> | null;
}

// After guests changed something: a new snapshot this much later (unless more comes).
const COMPACT_DELAY_MS = 60_000;

const keysFor = (host: LiveOwnerHost, info: NotePublish): Promise<LiveKeys> => {
  const link = fromBase64Url(info.key);
  if (!info.password) return Promise.resolve(liveKeys(link, null));
  if (host.passwordKey) return host.passwordKey(link, info.password).then((key) => liveKeys(link, info.password!, key));
  return Promise.resolve(liveKeys(link, info.password));
};

// Uploads the note as the live note's snapshot (and its settings), covering every update up
// to `snapshotSeq`.
export const putLiveNote = async (masterKey: Uint8Array, info: NotePublish, keys: LiveKeys, doc: Y.Doc, snapshotSeq: number): Promise<void> => {
  if (publishExpired(info)) throw new Error('The link has expired: choose a new expiry date.');
  const res = await apiFetch(`${API_URL}/live/${info.id}`, masterKey, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      readHash: await tokenHash(keys.read),
      writeHash: await tokenHash(keys.write),
      editable: !!info.editable,
      password: !!info.password,
      expiresAt: info.expiresAt ?? null,
      blobs: [...new Set(noteBlobIds(noteBodyJson(doc)))],
      snapshot: sealUpdate(keys, Y.encodeStateAsUpdate(doc)),
      snapshotSeq,
    }),
  }, 60_000);
  if (!res.ok) throw new Error(res.status === 413 ? 'The note is too large to publish (30 MB)' : `Publishing failed (HTTP ${res.status})`);
};

const fetchLiveUpdates = async (masterKey: Uint8Array, id: string, after: number) => {
  const res = await apiFetch(`${API_URL}/live/${id}?after=${after}`, masterKey);
  if (!res.ok) throw new Error(`Live note fetch failed (HTTP ${res.status})`);
  return res.json() as Promise<{ exists: boolean; snapshotSeq?: number; updates?: { seq: number; data: string; guest: boolean }[] }>;
};

export const createLiveOwner = (host: LiveOwnerHost) => {
  const shares = new Map<string, Share>();
  const byNote = new Map<string, string>();
  let online = false;

  // Merges the queued updates of a live note, one batch at a time.
  const drain = async (share: Share) => {
    if (share.busy || !share.queue.length) return;
    share.busy = true;
    try {
      while (share.queue.length) {
        const batch = share.queue.splice(0);
        const keys = await share.keys;
        const doc = await host.readNote(share.noteId);
        if (!doc) break;
        const fresh = batch.filter((u) => u.seq > host.getSeq(share.info.id));
        if (!fresh.length) continue;
        // Own devices' updates go in as they are, guests' only when allowed and harmless.
        const decoded: { update: Uint8Array; guest: boolean }[] = [];
        for (const u of fresh) {
          try {
            decoded.push({ update: unsealUpdate(keys, u.data), guest: u.guest });
          } catch {
            console.warn('Live note: an update did not open (wrong key?)');
          }
        }
        const own = decoded.filter((d) => !d.guest).map((d) => d.update);
        const fromGuests = share.info.editable ? decoded.filter((d) => d.guest).map((d) => d.update) : [];
        const { accepted, refused } = fromGuests.length ? acceptGuestUpdates(doc, fromGuests) : { accepted: [], refused: 0 };
        if (refused) console.warn(`Live note: ${refused} guest change${refused === 1 ? '' : 's'} refused (outside the title and the text)`);
        const updates = [...own, ...accepted];
        if (updates.length) await host.applyToNote(share.noteId, updates);
        host.setSeq(share.info.id, Math.max(host.getSeq(share.info.id), ...fresh.map((u) => u.seq)));
        if (fresh.some((u) => u.guest)) compactSoon(share);
      }
    } catch (e) {
      console.warn('Live note: merging failed:', e);
    } finally {
      share.busy = false;
    }
  };

  // Catches up with the server, then uploads a fresh snapshot.
  const compact = async (share: Share) => {
    if (share.compactTimer) clearTimeout(share.compactTimer);
    share.compactTimer = null;
    try {
      const pending = await fetchLiveUpdates(host.masterKey, share.info.id, host.getSeq(share.info.id));
      if (!pending.exists) return;
      share.queue.push(...(pending.updates ?? []));
      await drain(share);
      const doc = await host.readNote(share.noteId);
      if (!doc) return;
      await putLiveNote(host.masterKey, share.info, await share.keys, doc, host.getSeq(share.info.id));
    } catch (e) {
      console.warn('Live note: snapshot failed:', e);
    }
  };

  const compactSoon = (share: Share) => {
    if (share.compactTimer) clearTimeout(share.compactTimer);
    share.compactTimer = setTimeout(() => compact(share), COMPACT_DELAY_MS);
  };

  return {
    // The live notes on this device (notes whose publish info says live), after loading notes
    // and whenever that may have changed.
    setShares(list: { noteId: string; info: NotePublish }[]) {
      const wanted = new Map(list.filter((s) => s.info.live && !publishExpired(s.info)).map((s) => [s.info.id, s]));
      for (const [id, share] of shares) {
        const next = wanted.get(id);
        if (!next || next.info.key !== share.info.key || next.info.password !== share.info.password) {
          if (share.compactTimer) clearTimeout(share.compactTimer);
          shares.delete(id);
          byNote.delete(share.noteId);
        } else {
          share.info = next.info;
        }
      }
      for (const [id, s] of wanted) {
        if (shares.has(id)) continue;
        const share: Share = { noteId: s.noteId, info: s.info, keys: keysFor(host, s.info), queue: [], busy: false, compactTimer: null };
        shares.set(id, share);
        byNote.set(s.noteId, id);
        // Made live on another device: catch up with what guests did since.
        if (online) compact(share);
      }
    },

    // The private WebSocket is (again) ready: catch up and send snapshots.
    connected() {
      online = true;
      for (const share of shares.values()) compact(share);
    },
    disconnected() {
      online = false;
    },
    // Newest update this device merged.
    seq: (shareId: string) => host.getSeq(shareId),

    // Messages from the private WebSocket; true = handled.
    handleMessage(msg: { type?: string; id?: string; seq?: number; data?: string; guest?: boolean }): boolean {
      if (msg.type !== 'live' && msg.type !== 'liveAwareness') return false;
      const share = msg.id ? shares.get(msg.id) : undefined;
      if (!share || typeof msg.data !== 'string') return true;
      if (msg.type === 'live' && typeof msg.seq === 'number') {
        share.queue.push({ seq: msg.seq, data: msg.data, guest: msg.guest === true });
        drain(share);
      } else if (msg.type === 'liveAwareness' && host.onAwareness) {
        share.keys.then((keys) => {
          try {
            host.onAwareness!(share.noteId, unsealUpdate(keys, msg.data!));
          } catch {
            // not ours
          }
        });
      }
      return true;
    },

    // Sends this device's edits of an open note to its guests; returns the detach function.
    watchDoc(noteId: string, doc: Y.Doc): () => void {
      const onUpdate = (update: Uint8Array, origin: unknown) => {
        if (origin === LIVE_ORIGIN) return;
        const id = byNote.get(noteId);
        const share = id ? shares.get(id) : undefined;
        if (!share) return;
        share.keys.then((keys) => host.send({ type: 'liveUpdate', id: share.info.id, data: sealUpdate(keys, update) }));
      };
      doc.on('update', onUpdate);
      return () => doc.off('update', onUpdate);
    },

    // This device's cursor / presence in an open live note (raw awareness update).
    sendAwareness(noteId: string, update: Uint8Array) {
      const id = byNote.get(noteId);
      const share = id ? shares.get(id) : undefined;
      if (share) share.keys.then((keys) => host.send({ type: 'liveAwareness', id: share.info.id, data: sealUpdate(keys, update) }));
    },

    isLive: (noteId: string) => byNote.has(noteId),
  };
};

export type LiveOwner = ReturnType<typeof createLiveOwner>;

// Publishes a note live (or changes the settings of its live link). The link of an earlier
// publish stays. `lastSeq`: the newest update this device merged (0 for a new live note).
export const publishLive = async (
  masterKey: Uint8Array, doc: Y.Doc, earlier: NotePublish | null, options: PublishOptions & { editable: boolean },
  lastSeq: number, passwordKey?: (linkKey: Uint8Array, password: string) => Promise<Uint8Array>,
): Promise<NotePublish> => {
  const info: NotePublish = { ...nextPublishInfo(earlier, { ...options, selfDestruct: false, autoUpdate: false }), live: true, editable: options.editable };
  const link = fromBase64Url(info.key);
  const keys = info.password ? liveKeys(link, info.password, passwordKey ? await passwordKey(link, info.password) : undefined) : liveKeys(link, null);
  await putLiveNote(masterKey, info, keys, doc, lastSeq);
  return info;
};
