import * as Y from 'yjs';
import { apiUrl } from '@noted/config';
import { apiFetch } from './client';
import { fromBase64Url, GuestEditsWaiting, nextPublishInfo, publishExpired, toBase64Url } from './publish';
import type { PublishOptions } from './publish';
import { publishPasswordKey } from '@noted/crypto';
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
  // Files the server lets guests download (as of the last snapshot; null = not sent yet), and
  // the pending check whether this device's edits added new ones.
  blobs: Set<string> | null;
  blobTimer: ReturnType<typeof setTimeout> | null;
}

// After guests changed something: a new snapshot this much later (unless more comes).
const COMPACT_DELAY_MS = 60_000;
// After this device's own edits: this much later, a new snapshot if they added an image or
// file (the server only hands guests the files the last snapshot listed).
const BLOB_CHECK_DELAY_MS = 1_500;

const keysFor = (host: LiveOwnerHost, info: NotePublish): Promise<LiveKeys> => {
  const link = fromBase64Url(info.key);
  if (!info.password) return Promise.resolve(liveKeys(link, null));
  if (info.passwordKey) return Promise.resolve(liveKeys(link, info.password, fromBase64Url(info.passwordKey)));
  if (host.passwordKey) return host.passwordKey(link, info.password).then((key) => liveKeys(link, info.password!, key));
  return Promise.resolve(liveKeys(link, info.password));
};

const liveBlobIds = (doc: Y.Doc): Set<string> => new Set(noteBlobIds(noteBodyJson(doc)));

// Uploads the note as the live note's snapshot (and its settings), covering every update up
// to `snapshotSeq`.
export const putLiveNote = async (masterKey: Uint8Array, info: NotePublish, keys: LiveKeys, doc: Y.Doc, snapshotSeq: number): Promise<void> => {
  if (publishExpired(info)) throw new Error('The link has expired: choose a new expiry date.');
  const res = await apiFetch(`${apiUrl()}/live/${info.id}`, masterKey, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      readHash: await tokenHash(keys.read),
      writeHash: await tokenHash(keys.write),
      editable: !!info.editable,
      password: !!info.password,
      expiresAt: info.expiresAt ?? null,
      blobs: [...liveBlobIds(doc)],
      snapshot: sealUpdate(keys, Y.encodeStateAsUpdate(doc)),
      snapshotSeq,
    }),
  }, 60_000);
  if (!res.ok) throw new Error(res.status === 413 ? 'The note is too large to publish (30 MB)' : `Publishing failed (HTTP ${res.status})`);
};

const fetchLiveUpdates = async (masterKey: Uint8Array, id: string, after: number) => {
  const res = await apiFetch(`${apiUrl()}/live/${id}?after=${after}`, masterKey);
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
      const blobs = liveBlobIds(doc);
      await putLiveNote(host.masterKey, share.info, await share.keys, doc, host.getSeq(share.info.id));
      share.blobs = blobs;
    } catch (e) {
      console.warn('Live note: snapshot failed:', e);
    }
  };

  const compactSoon = (share: Share) => {
    if (share.compactTimer) clearTimeout(share.compactTimer);
    share.compactTimer = setTimeout(() => compact(share), COMPACT_DELAY_MS);
  };

  // This device changed the note: a new snapshot soon if a new image / file came in, so guests
  // can load it (the upload itself runs with the next sync, started when the file was added).
  const checkBlobsSoon = (share: Share) => {
    if (share.blobTimer) clearTimeout(share.blobTimer);
    share.blobTimer = setTimeout(async () => {
      share.blobTimer = null;
      if (!online || !shares.has(share.info.id)) return;
      try {
        const doc = await host.readNote(share.noteId);
        if (!doc) return;
        const known = share.blobs;
        if (known && [...liveBlobIds(doc)].every((id) => known.has(id))) return;
        await compact(share);
      } catch (e) {
        console.warn('Live note: checking files failed:', e);
      }
    }, BLOB_CHECK_DELAY_MS);
  };

  const forget = (id: string) => {
    const share = shares.get(id);
    if (!share) return;
    if (share.compactTimer) clearTimeout(share.compactTimer);
    if (share.blobTimer) clearTimeout(share.blobTimer);
    shares.delete(id);
    byNote.delete(share.noteId);
  };
  const add = (noteId: string, info: NotePublish) => {
    const share: Share = { noteId, info, keys: keysFor(host, info), queue: [], busy: false, compactTimer: null, blobs: null, blobTimer: null };
    shares.set(info.id, share);
    byNote.set(noteId, info.id);
    // Made live on another device: catch up with what guests did since.
    if (online) compact(share);
  };

  return {
    // One note's publish settings changed on this device (null: not published): takes effect
    // at once, before the note list knows (setShares follows later).
    updateShare(noteId: string, info: NotePublish | null) {
      const id = byNote.get(noteId);
      const current = id ? shares.get(id) : undefined;
      const live = info?.live && !publishExpired(info) ? info : null;
      if (current && (!live || live.id !== current.info.id || live.key !== current.info.key || live.password !== current.info.password)) forget(current.info.id);
      if (!live) return;
      const kept = shares.get(live.id);
      if (kept) kept.info = live;
      else add(noteId, live);
    },

    // The live notes on this device (notes whose publish info says live), after loading notes
    // and whenever that may have changed.
    setShares(list: { noteId: string; info: NotePublish }[]) {
      const wanted = new Map(list.filter((s) => s.info.live && !publishExpired(s.info)).map((s) => [s.info.id, s]));
      for (const [id, share] of shares) {
        const next = wanted.get(id);
        if (!next || next.info.key !== share.info.key || next.info.password !== share.info.password) forget(id);
        else share.info = next.info;
      }
      for (const [id, s] of wanted) if (!shares.has(id)) add(s.noteId, s.info);
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
        checkBlobsSoon(share);
      };
      doc.on('update', onUpdate);
      return () => doc.off('update', onUpdate);
    },

    // An edit of the note made on this device (platforms without the note's doc at hand).
    sendUpdate(noteId: string, update: Uint8Array) {
      const id = byNote.get(noteId);
      const share = id ? shares.get(id) : undefined;
      if (!share) return;
      share.keys.then((keys) => host.send({ type: 'liveUpdate', id: share.info.id, data: sealUpdate(keys, update) }));
      checkBlobsSoon(share);
    },

    // This device's cursor / presence in an open live note (raw awareness update).
    sendAwareness(noteId: string, update: Uint8Array) {
      const id = byNote.get(noteId);
      const share = id ? shares.get(id) : undefined;
      if (share) share.keys.then((keys) => host.send({ type: 'liveAwareness', id: share.info.id, data: sealUpdate(keys, update) }));
    },

    isLive: (noteId: string) => byNote.has(noteId),

    // Merges every guest edit the server holds for this note's live link (before the link is
    // removed or replaced); returns the newest merged update, null when the note is not live here.
    async catchUp(noteId: string): Promise<number | null> {
      const id = byNote.get(noteId);
      const share = id ? shares.get(id) : undefined;
      if (!share) return null;
      const pending = await fetchLiveUpdates(host.masterKey, share.info.id, host.getSeq(share.info.id));
      if (pending.exists) share.queue.push(...(pending.updates ?? []));
      // A merge that is running takes the queue along; wait for it.
      while (share.busy || share.queue.length) {
        await drain(share);
        if (share.busy) await new Promise((r) => setTimeout(r, 50));
      }
      return host.getSeq(share.info.id);
    },
  };
};

export type LiveOwner = ReturnType<typeof createLiveOwner>;

// Removing a live note or replacing it with a static copy drops the guest edits the server
// still queues for it. So this device merges them first and passes the newest merged update
// to `action` (as `after`); the server refuses while newer guest edits wait, and then this
// merges again and retries a few times (GuestEditsWaiting when it gives up: nothing changed).
export const afterLiveCatchUp = async <T>(
  owner: LiveOwner | null | undefined, noteId: string, info: NotePublish | null, action: (after?: number) => Promise<T>,
): Promise<T> => {
  if (!info?.live || !owner) return action();
  for (let attempt = 0; ; attempt++) {
    const seq = (await owner.catchUp(noteId)) ?? owner.seq(info.id);
    try {
      return await action(seq);
    } catch (e) {
      if (!(e instanceof GuestEditsWaiting) || attempt >= 2) throw e;
    }
  }
};

// Publishes a note live (or changes the settings of its live link). The link of an earlier
// publish stays. `lastSeq`: the newest update this device merged (0 for a new live note).
export const publishLive = async (
  masterKey: Uint8Array, doc: Y.Doc, earlier: NotePublish | null, options: PublishOptions & { editable: boolean },
  lastSeq: number, passwordKey?: (linkKey: Uint8Array, password: string) => Promise<Uint8Array>,
): Promise<NotePublish> => {
  const info: NotePublish = { ...nextPublishInfo(earlier, { ...options, selfDestruct: false, autoUpdate: false }), live: true, editable: options.editable };
  const link = fromBase64Url(info.key);
  let keys = liveKeys(link, null);
  if (info.password) {
    const derived = earlier?.passwordKey && earlier.password === info.password && earlier.key === info.key ? fromBase64Url(earlier.passwordKey)
      : passwordKey ? await passwordKey(link, info.password) : publishPasswordKey(link, info.password);
    info.passwordKey = toBase64Url(derived);
    keys = liveKeys(link, info.password, derived);
  }
  await putLiveNote(masterKey, info, keys, doc, lastSeq);
  return info;
};
