import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import { sealUpdate, unsealUpdate } from '@noted/sync/live';
import type { LiveGuestMessage, LiveInitial, LiveKeys } from '@noted/sync/live';

// A guest's connection to a live published note (apps/api/src/live.ts): the note's doc is
// built from the sealed snapshot and updates, then kept in step over the WebSocket. Edits
// are sent sealed (merged into one update every SEND_MS) and kept until the server
// acknowledged them, so a dropped connection loses nothing; cursors go the same way.

export type LiveStatus = 'online' | 'connecting' | 'offline' | 'gone' | 'denied' | 'full';

const REMOTE = 'live-remote';
const SEND_MS = 150;
const AWARENESS_MS = 120;

export type InitialResult = { ok: true; initial: LiveInitial } | { ok: false; status: number };

export const fetchInitial = async (id: string, keys: LiveKeys): Promise<InitialResult> => {
  const res = await fetch(`/p/${id}/live`, { headers: { 'X-Live-Read': keys.read }, cache: 'no-store' });
  if (!res.ok) return { ok: false, status: res.status };
  return { ok: true, initial: await res.json() };
};

export const fetchNeedsPassword = async (id: string): Promise<boolean | null> => {
  const res = await fetch(`/p/${id}/live/info`, { cache: 'no-store' });
  if (!res.ok) return null;
  return (await res.json()).password === true;
};

export interface LiveSession {
  doc: Y.Doc;
  awareness: Awareness;
  editable: () => boolean;
  status: () => LiveStatus;
  // Pending edits not yet stored on the server.
  unsaved: () => boolean;
  // A change here could not be sent (see afterTransaction below): reload.
  broken: () => boolean;
  onChange: (fn: () => void) => () => void;
  close: () => void;
}

export const openLiveSession = (id: string, keys: LiveKeys, initial: LiveInitial, wantsToEdit: boolean): LiveSession => {
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  const listeners = new Set<() => void>();
  const changed = () => listeners.forEach((fn) => fn());
  let editable = initial.editable && wantsToEdit;
  let status: LiveStatus = 'connecting';
  let lastSeq = initial.snapshotSeq;

  const apply = (data: string, seq?: number) => {
    try {
      Y.applyUpdate(doc, unsealUpdate(keys, data), REMOTE);
    } catch (e) {
      console.warn('A live update did not open:', e);
    }
    if (seq && seq > lastSeq) lastSeq = seq;
  };
  apply(initial.snapshot);
  for (const u of initial.updates) apply(u.data, u.seq);

  // Edits to send, and those sent but not acknowledged yet (by ref).
  let pending: Uint8Array[] = [];
  const unacked = new Map<number, Uint8Array>();
  let nextRef = 1;
  let sendTimer: ReturnType<typeof setTimeout> | null = null;
  let ws: WebSocket | null = null;
  let joined = false;
  let closed = false;
  let attempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const send = (message: object) => {
    if (ws && joined && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  };

  const flush = () => {
    sendTimer = null;
    if (!pending.length || !joined || !editable) return;
    const update = pending.length === 1 ? pending[0] : Y.mergeUpdates(pending);
    pending = [];
    const ref = nextRef++;
    unacked.set(ref, update);
    send({ type: 'update', ref, data: sealUpdate(keys, update) });
    changed();
  };
  const flushSoon = () => {
    if (!sendTimer) sendTimer = setTimeout(flush, SEND_MS);
  };

  // A local change outside the title and the body would make the owner's app refuse it and
  // everything after it (Yjs keeps each client's changes in order): such a change stops
  // sending, and the page asks to reload. The editor here offers no way to make one.
  let broken = false;
  const protectedTypes = new Set<unknown>([doc.getMap('settings'), doc.getMap('tags'), doc.getMap('notebooks')]);
  doc.on('afterTransaction', (tr: Y.Transaction) => {
    if (tr.local && !broken && [...tr.changed.keys()].some((type) => protectedTypes.has(type))) {
      broken = true;
      console.warn('Live note: a change outside the note text was made here; it cannot be sent');
      changed();
    }
  });
  doc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin === REMOTE || !editable || broken) return;
    pending.push(update);
    changed();
    flushSoon();
  });

  // Only the local cursor is sent (others' states come from them).
  let awarenessTimer: ReturnType<typeof setTimeout> | null = null;
  const sendAwareness = () => {
    awarenessTimer = null;
    if (!editable) return;
    send({ type: 'awareness', data: sealUpdate(keys, encodeAwarenessUpdate(awareness, [doc.clientID])) });
  };
  awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    if (origin !== REMOTE && [...added, ...updated, ...removed].includes(doc.clientID) && !awarenessTimer) {
      awarenessTimer = setTimeout(sendAwareness, AWARENESS_MS);
    }
    changed();
  });

  const setStatus = (next: LiveStatus) => {
    if (status === next) return;
    status = next;
    changed();
  };

  const reconnect = (delay?: number) => {
    if (closed || retryTimer) return;
    const wait = delay ?? Math.min(30_000, 1000 * 2 ** attempt++);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      connect();
    }, wait);
  };

  const connect = () => {
    if (closed) return;
    setStatus('connecting');
    joined = false;
    const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/p/${id}/ws`);
    ws = socket;
    socket.onopen = () => socket.send(JSON.stringify({ type: 'join', read: keys.read, ...(wantsToEdit ? { write: keys.write } : {}), after: lastSeq }));
    socket.onmessage = (ev) => {
      let msg: LiveGuestMessage;
      try {
        msg = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      if (msg.type === 'joined') {
        joined = true;
        attempt = 0;
        editable = msg.editable && wantsToEdit;
        for (const u of msg.updates) apply(u.data, u.seq);
        setStatus('online');
        // What the last connection did not get acknowledged goes again (Yjs ignores doubles).
        pending = [...unacked.values(), ...pending];
        unacked.clear();
        flush();
        sendAwareness();
        changed();
      } else if (msg.type === 'update') {
        apply(msg.data, msg.seq);
      } else if (msg.type === 'ack') {
        if (msg.ref !== null) unacked.delete(msg.ref);
        if (msg.seq > lastSeq) lastSeq = msg.seq;
        changed();
      } else if (msg.type === 'awareness') {
        try {
          applyAwarenessUpdate(awareness, unsealUpdate(keys, msg.data), REMOTE);
        } catch {
          // a cursor that does not open: ignore
        }
      } else if (msg.type === 'editable') {
        // The owner allowed editing: join again as a writer.
        socket.close();
      } else if (msg.type === 'error' && msg.error === 'full') {
        // The owner's devices have not taken the waiting edits yet: try again later.
        if (msg.ref !== undefined && unacked.has(msg.ref)) {
          pending.unshift(unacked.get(msg.ref)!);
          unacked.delete(msg.ref);
        }
        setStatus('full');
        setTimeout(flushSoon, 30_000);
      } else if (msg.type === 'error') {
        // "slow down": the next batch goes a little later.
        setTimeout(flushSoon, 1000);
      }
    };
    socket.onclose = (ev) => {
      if (ws !== socket) return;
      ws = null;
      joined = false;
      // Awareness of the others is stale now; they come back with the next connection.
      removeAwarenessStates(awareness, [...awareness.getStates().keys()].filter((c) => c !== doc.clientID), REMOTE);
      if (ev.code === 4404) return setStatus('gone');
      if (ev.code === 4403) return setStatus('denied');
      if (ev.code === 4410) {
        location.reload();
        return;
      }
      setStatus('offline');
      reconnect(ev.code === 4409 ? 300 : undefined);
    };
    socket.onerror = () => socket.close();
  };
  connect();

  // Leaving: tell the others the cursor is gone.
  const leave = () => {
    awareness.setLocalState(null);
    if (awarenessTimer) clearTimeout(awarenessTimer);
    sendAwareness();
  };
  window.addEventListener('pagehide', leave);
  window.addEventListener('online', () => {
    if (!ws && retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
      attempt = 0;
      connect();
    }
  });

  return {
    doc,
    awareness,
    editable: () => editable,
    status: () => status,
    unsaved: () => pending.length > 0 || unacked.size > 0,
    broken: () => broken,
    onChange: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    close: () => {
      closed = true;
      leave();
      ws?.close();
    },
  };
};
