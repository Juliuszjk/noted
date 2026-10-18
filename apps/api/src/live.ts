import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { WebSocketServer, WebSocket } from 'ws';
import type { Server, IncomingMessage } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { db } from './db.js';
import { broadcastPrivate, privateMessageHandlers } from './realtime.js';

// Live published notes (sync/live.ts): instead of a rendered copy, the server keeps the note's
// Yjs state sealed with a key from the link (#fragment), plus the sealed updates sent since,
// and relays new updates and cursors between the readers ("guests") on the public server and
// the owner's devices on the private WebSocket. It sees only opaque bytes. Guests need the
// read token (derived from the link key, and the password when there is one) for anything,
// and the write token to send edits, which only works while the owner allows editing. The
// owner's app checks every guest edit again before merging it into the note.

const ID_PATTERN = /^[A-Za-z0-9_-]{16}$/;
const BLOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
export const MAX_SNAPSHOT_BYTES = 30 * 1024 * 1024;
// One update (a paste can be large), the updates waiting for the owner, the cursor messages.
const MAX_UPDATE_BYTES = 1024 * 1024;
const MAX_QUEUED_BYTES = 20 * 1024 * 1024;
const MAX_AWARENESS_BYTES = 16 * 1024;
const MAX_GUESTS_PER_NOTE = 20;
const MAX_GUESTS = 200;
const JOIN_TIMEOUT_MS = 5000;
const HEARTBEAT_MS = 25000;
// Wrong read tokens per note and minute (a password can only be guessed online, and slowly).
const MAX_BAD_TOKENS_PER_MINUTE = 20;

db.exec(`
  CREATE TABLE IF NOT EXISTS live_shares (
    id TEXT PRIMARY KEY,
    read_hash TEXT NOT NULL,
    write_hash TEXT NOT NULL,
    editable INTEGER NOT NULL,
    password INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER,
    snapshot BLOB NOT NULL,
    snapshot_seq INTEGER NOT NULL,
    blobs TEXT NOT NULL,
    queued_bytes INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS live_updates (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    share_id TEXT NOT NULL,
    data BLOB NOT NULL,
    guest INTEGER NOT NULL,
    at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS live_updates_share ON live_updates (share_id, seq);
`);

interface ShareRow {
  id: string;
  read_hash: string;
  write_hash: string;
  editable: number;
  expires_at: number | null;
  snapshot_seq: number;
  blobs: string;
  queued_bytes: number;
}

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
const sameHash = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
// Tokens arrive as base64 (32 bytes).
const tokenHash = (token: unknown): string | null => {
  if (typeof token !== 'string' || token.length > 64) return null;
  const bytes = Buffer.from(token, 'base64');
  return bytes.length === 32 ? sha256(bytes) : null;
};

// Guests connected per note.
const guests = new Map<string, Set<Guest>>();
let guestCount = 0;
interface Guest { ws: WebSocket; writer: boolean; }

const closeGuests = (id: string, code: number, reason: string) => {
  for (const g of guests.get(id) ?? []) g.ws.close(code, reason);
};

const deleteShare = (id: string): boolean => {
  const removed = db.prepare('DELETE FROM live_shares WHERE id = ?').run(id).changes > 0;
  db.prepare('DELETE FROM live_updates WHERE share_id = ?').run(id);
  if (removed) closeGuests(id, 4404, 'not published');
  return removed;
};

// Called by publish.ts: a static copy replaces the live note and unpublishing removes it.
export const removeLiveShare = (id: string): boolean => deleteShare(id);
export const liveShareExists = (id: string): boolean => !!liveShare(id);

// The share if it is there and not expired (an expired one is deleted on the way).
const liveShare = (id: string): ShareRow | undefined => {
  const row = db.prepare('SELECT id, read_hash, write_hash, editable, expires_at, snapshot_seq, blobs, queued_bytes FROM live_shares WHERE id = ?').get(id) as ShareRow | undefined;
  if (row?.expires_at && row.expires_at <= Date.now()) {
    deleteShare(id);
    console.log(`live: ${id.slice(0, 4)}… expired and was deleted`);
    return undefined;
  }
  return row;
};

const removeExpired = () => {
  const ids = db.prepare('SELECT id FROM live_shares WHERE expires_at IS NOT NULL AND expires_at <= ?').all(Date.now()) as { id: string }[];
  for (const { id } of ids) deleteShare(id);
  if (ids.length) console.log(`live: ${ids.length} expired note${ids.length === 1 ? '' : 's'} deleted`);
};
removeExpired();
setInterval(removeExpired, 10 * 60 * 1000).unref();

const badTokens = new Map<string, { count: number; since: number }>();
// false = too many wrong tokens for this note lately.
const tokenAttemptAllowed = (id: string): boolean => {
  const entry = badTokens.get(id);
  if (!entry || Date.now() - entry.since > 60_000) return true;
  return entry.count < MAX_BAD_TOKENS_PER_MINUTE;
};
const noteBadToken = (id: string) => {
  const entry = badTokens.get(id);
  if (!entry || Date.now() - entry.since > 60_000) badTokens.set(id, { count: 1, since: Date.now() });
  else entry.count++;
};
setInterval(() => {
  for (const [id, entry] of badTokens) if (Date.now() - entry.since > 60_000) badTokens.delete(id);
}, 60_000).unref();

// Checks the read token of a request; null = allowed, else the HTTP status to answer with.
const checkRead = (share: ShareRow | undefined, id: string, token: unknown): 403 | 404 | 429 | null => {
  if (!share) return 404;
  if (!tokenAttemptAllowed(id)) return 429;
  const hash = tokenHash(token);
  if (!hash || !sameHash(hash, share.read_hash)) {
    noteBadToken(id);
    return 403;
  }
  return null;
};

const updatesAfter = (id: string, after: number) =>
  (db.prepare('SELECT seq, data, guest FROM live_updates WHERE share_id = ? AND seq > ? ORDER BY seq').all(id, after) as { seq: number; data: Buffer; guest: number }[])
    .map((u) => ({ seq: u.seq, data: u.data.toString('base64'), guest: u.guest === 1 }));

const lastSeq = (id: string): number => {
  const row = db.prepare('SELECT MAX(seq) AS seq FROM live_updates WHERE share_id = ?').get(id) as { seq: number | null };
  return row.seq ?? 0;
};

// Stores an update and sends it to everyone else on the note (guests and owner devices).
const addUpdate = (id: string, data: Buffer, guest: boolean, except?: WebSocket): number => {
  const seq = Number(db.prepare('INSERT INTO live_updates (share_id, data, guest, at) VALUES (?, ?, ?, ?)').run(id, data, guest ? 1 : 0, Date.now()).lastInsertRowid);
  db.prepare('UPDATE live_shares SET queued_bytes = queued_bytes + ? WHERE id = ?').run(data.length, id);
  const b64 = data.toString('base64');
  const toGuests = JSON.stringify({ type: 'update', seq, data: b64 });
  for (const g of guests.get(id) ?? []) if (g.ws !== except && g.ws.readyState === WebSocket.OPEN) g.ws.send(toGuests);
  broadcastPrivate({ type: 'live', id, seq, data: b64, guest }, except);
  return seq;
};

const relayAwareness = (id: string, data: string, guest: boolean, except?: WebSocket) => {
  const toGuests = JSON.stringify({ type: 'awareness', data });
  for (const g of guests.get(id) ?? []) if (g.ws !== except && g.ws.readyState === WebSocket.OPEN) g.ws.send(toGuests);
  broadcastPrivate({ type: 'liveAwareness', id, data, guest }, except);
};

const isBase64 = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && /^[A-Za-z0-9+/]+=*$/.test(v);
const b64Max = (bytes: number) => Math.ceil(bytes / 3) * 4;

// ---- owner side: private API (/live, behind requireAuth) and the private WebSocket ----
export const livePrivate = new Hono();

// Makes a note live or updates it: hashes of the tokens, whether guests may edit, expiry, the
// files guests may download, and optionally a new snapshot that covers every update up to
// `snapshotSeq` (those are then deleted). A new live note needs a snapshot.
livePrivate.put(
  '/:id',
  bodyLimit({ maxSize: b64Max(MAX_SNAPSHOT_BYTES) + 1024 * 1024, onError: (c) => c.json({ error: 'Too large' }, 413) }),
  async (c) => {
    const id = c.req.param('id');
    if (!ID_PATTERN.test(id)) return c.json({ error: 'Bad id' }, 400);
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return c.json({ error: 'Bad body' }, 400);
    const { readHash, writeHash, editable, password, expiresAt, snapshot, snapshotSeq, blobs } = body;
    if (typeof readHash !== 'string' || !HASH_PATTERN.test(readHash) || typeof writeHash !== 'string' || !HASH_PATTERN.test(writeHash)) {
      return c.json({ error: 'Bad token hashes' }, 400);
    }
    if (!Array.isArray(blobs) || blobs.length > 10_000 || !blobs.every((b) => typeof b === 'string' && BLOB_ID_PATTERN.test(b))) return c.json({ error: 'Bad blobs' }, 400);
    const expires = typeof expiresAt === 'number' && expiresAt > Date.now() ? Math.round(expiresAt) : null;
    const existing = db.prepare('SELECT read_hash, editable FROM live_shares WHERE id = ?').get(id) as { read_hash: string; editable: number } | undefined;
    const now = Date.now();
    if (snapshot !== undefined) {
      if (!isBase64(snapshot, b64Max(MAX_SNAPSHOT_BYTES))) return c.json({ error: 'Bad snapshot' }, 400);
      const seq = typeof snapshotSeq === 'number' && Number.isInteger(snapshotSeq) && snapshotSeq >= 0 ? snapshotSeq : 0;
      const data = Buffer.from(snapshot, 'base64');
      db.transaction(() => {
        db.prepare(`
          INSERT INTO live_shares (id, read_hash, write_hash, editable, password, expires_at, snapshot, snapshot_seq, blobs, queued_bytes, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
          ON CONFLICT(id) DO UPDATE SET read_hash = excluded.read_hash, write_hash = excluded.write_hash, editable = excluded.editable,
            password = excluded.password,
            expires_at = excluded.expires_at,
            -- Two devices may compact at once: the snapshot that covers more updates stays.
            snapshot = CASE WHEN excluded.snapshot_seq >= live_shares.snapshot_seq THEN excluded.snapshot ELSE live_shares.snapshot END,
            snapshot_seq = MAX(live_shares.snapshot_seq, excluded.snapshot_seq),
            blobs = excluded.blobs, updated_at = excluded.updated_at
        `).run(id, readHash, writeHash, editable ? 1 : 0, password ? 1 : 0, expires, data, seq, JSON.stringify(blobs), now);
        db.prepare('DELETE FROM live_updates WHERE share_id = ? AND seq <= ?').run(id, seq);
        const left = db.prepare('SELECT COALESCE(SUM(LENGTH(data)), 0) AS bytes FROM live_updates WHERE share_id = ?').get(id) as { bytes: number };
        db.prepare('UPDATE live_shares SET queued_bytes = ? WHERE id = ?').run(left.bytes, id);
      })();
      // A static copy under the same link is replaced by the live note.
      db.prepare('DELETE FROM published WHERE id = ?').run(id);
      console.log(`live: ${existing ? 'snapshot of' : 'new'} ${id.slice(0, 4)}… (${data.length} bytes, up to ${seq})`);
    } else {
      if (!existing) return c.json({ error: 'A new live note needs a snapshot' }, 400);
      db.prepare('UPDATE live_shares SET read_hash = ?, write_hash = ?, editable = ?, password = ?, expires_at = ?, blobs = ?, updated_at = ? WHERE id = ?')
        .run(readHash, writeHash, editable ? 1 : 0, password ? 1 : 0, expires, JSON.stringify(blobs), now, id);
    }
    // A new password (other read token) or editing switched off: guests reconnect and are
    // checked again.
    if (existing && (existing.read_hash !== readHash || (existing.editable === 1 && !editable))) closeGuests(id, 4409, 'settings changed');
    else if (existing && !existing.editable && editable) {
      const message = JSON.stringify({ type: 'editable' });
      for (const g of guests.get(id) ?? []) if (g.ws.readyState === WebSocket.OPEN) g.ws.send(message);
    }
    return c.json({ success: true, lastSeq: lastSeq(id) });
  },
);

// The updates after `after` (to merge them into the note) and the newest sequence number.
livePrivate.get('/:id', (c) => {
  const id = c.req.param('id');
  if (!ID_PATTERN.test(id)) return c.json({ error: 'Bad id' }, 400);
  const share = liveShare(id);
  if (!share) return c.json({ exists: false });
  const after = Math.max(Number(c.req.query('after') ?? 0) || 0, 0);
  return c.json({ exists: true, snapshotSeq: share.snapshot_seq, updates: updatesAfter(id, after), guests: guests.get(id)?.size ?? 0 });
});

livePrivate.delete('/:id', (c) => {
  const id = c.req.param('id');
  if (!ID_PATTERN.test(id)) return c.json({ error: 'Bad id' }, 400);
  const removed = deleteShare(id);
  console.log(`live: ${id.slice(0, 4)}… unpublished${removed ? '' : ' (was not there)'}`);
  return c.json({ success: true });
});

// Owner devices send their edits and cursors over the private WebSocket.
privateMessageHandlers.add((ws, msg) => {
  if (msg.type !== 'liveUpdate' && msg.type !== 'liveAwareness') return;
  const id = msg.id;
  if (typeof id !== 'string' || !ID_PATTERN.test(id) || !liveShare(id)) return;
  if (msg.type === 'liveUpdate') {
    if (!isBase64(msg.data, b64Max(MAX_UPDATE_BYTES))) return;
    const seq = addUpdate(id, Buffer.from(msg.data, 'base64'), false, ws);
    if (typeof msg.ref === 'number') ws.send(JSON.stringify({ type: 'liveAck', id, ref: msg.ref, seq }));
  } else if (isBase64(msg.data, b64Max(MAX_AWARENESS_BYTES))) {
    relayAwareness(id, msg.data, false, ws);
  }
});

// ---- public side (publish.ts mounts these on the public server) ----

// Before the key is used: does the link need a password too? (Like a published copy's header.)
export const liveNeedsPassword = (id: string): boolean | null => {
  if (!liveShare(id)) return null;
  const row = db.prepare('SELECT password FROM live_shares WHERE id = ?').get(id) as { password: number };
  return row.password === 1;
};

// Everything a guest needs to start: the snapshot and the updates after it.
export const liveInitial = (id: string, readToken: string | undefined): { status: 403 | 404 | 429 } | { body: object } => {
  const share = liveShare(id);
  const denied = checkRead(share, id, readToken);
  if (denied) return { status: denied };
  const row = db.prepare('SELECT snapshot FROM live_shares WHERE id = ?').get(id) as { snapshot: Buffer };
  return { body: { editable: share!.editable === 1, snapshot: row.snapshot.toString('base64'), snapshotSeq: share!.snapshot_seq, updates: updatesAfter(id, share!.snapshot_seq) } };
};

// A file of the note (only those the owner listed for it); the bytes stay sealed with the
// file's own key, which is inside the note.
export const liveBlob = (id: string, blobId: string, readToken: string | undefined): { status: 400 | 403 | 404 | 429 } | { data: Buffer } => {
  if (!BLOB_ID_PATTERN.test(blobId)) return { status: 400 };
  const share = liveShare(id);
  const denied = checkRead(share, id, readToken);
  if (denied) return { status: denied };
  if (!(JSON.parse(share!.blobs) as string[]).includes(blobId)) return { status: 404 };
  const row = db.prepare('SELECT data FROM server_blobs WHERE id = ?').get(blobId) as { data: Buffer } | undefined;
  return row ? { data: row.data } : { status: 404 };
};

// Token bucket per connection: `rate` messages a second, bursts up to `burst`.
const bucket = (rate: number, burst: number) => {
  let tokens = burst;
  let at = Date.now();
  return () => {
    const now = Date.now();
    tokens = Math.min(burst, tokens + ((now - at) / 1000) * rate);
    at = now;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
};

// WebSocket /p/:id/ws on the public server. First message: {type:'join', read, write?, after}.
export function attachLiveSockets(server: Server): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: b64Max(MAX_UPDATE_BYTES) + 1024 });
  const alive = new WeakMap<WebSocket, boolean>();

  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    const match = /^\/p\/([A-Za-z0-9_-]{16})\/ws$/.exec(pathname);
    if (!match || guestCount >= MAX_GUESTS || (guests.get(match[1])?.size ?? 0) >= MAX_GUESTS_PER_NOTE) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, match[1]));
  });

  wss.on('connection', (ws: WebSocket, id: string) => {
    guestCount++;
    alive.set(ws, true);
    ws.on('pong', () => alive.set(ws, true));
    let guest: Guest | null = null;
    const updates = bucket(20, 60);
    const cursors = bucket(30, 60);
    const joinTimer = setTimeout(() => ws.close(4401, 'join timeout'), JOIN_TIMEOUT_MS);

    ws.on('message', (raw) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        ws.close(4400, 'bad message');
        return;
      }
      if (!guest) {
        clearTimeout(joinTimer);
        const share = liveShare(id);
        const denied = msg.type === 'join' ? checkRead(share, id, msg.read) : 403;
        if (denied) {
          ws.close(denied === 404 ? 4404 : denied === 429 ? 4429 : 4403, 'denied');
          return;
        }
        const writeHash = tokenHash(msg.write);
        guest = { ws, writer: share!.editable === 1 && !!writeHash && sameHash(writeHash, share!.write_hash) };
        let set = guests.get(id);
        if (!set) guests.set(id, set = new Set());
        set.add(guest);
        const after = typeof msg.after === 'number' && msg.after > 0 ? msg.after : share!.snapshot_seq;
        // Fell behind a newer snapshot: start again from the initial data.
        if (after < share!.snapshot_seq) {
          ws.close(4410, 'reload');
          return;
        }
        ws.send(JSON.stringify({ type: 'joined', editable: guest.writer, updates: updatesAfter(id, after) }));
        return;
      }
      if (msg.type === 'update') {
        if (!guest.writer || !isBase64(msg.data, b64Max(MAX_UPDATE_BYTES))) return;
        const share = liveShare(id);
        if (!share?.editable) return;
        if (!updates()) {
          ws.send(JSON.stringify({ type: 'error', error: 'slow down' }));
          return;
        }
        const data = Buffer.from(msg.data, 'base64');
        if (share.queued_bytes + data.length > MAX_QUEUED_BYTES) {
          ws.send(JSON.stringify({ type: 'error', error: 'full', ref: msg.ref }));
          return;
        }
        const seq = addUpdate(id, data, true, ws);
        ws.send(JSON.stringify({ type: 'ack', seq, ref: typeof msg.ref === 'number' ? msg.ref : null }));
      } else if (msg.type === 'awareness') {
        if (!isBase64(msg.data, b64Max(MAX_AWARENESS_BYTES)) || !cursors()) return;
        relayAwareness(id, msg.data, true, ws);
      }
    });

    ws.on('close', () => {
      clearTimeout(joinTimer);
      guestCount--;
      if (guest) {
        const set = guests.get(id);
        set?.delete(guest);
        if (set && !set.size) guests.delete(id);
      }
    });
    ws.on('error', () => ws.terminate());
  });

  setInterval(() => {
    for (const ws of wss.clients) {
      if (alive.get(ws) === false) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, HEARTBEAT_MS).unref();
}
