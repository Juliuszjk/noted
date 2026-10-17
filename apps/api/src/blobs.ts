import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { db } from './db.js';

// Encrypted blobs (images, attachments). Each one is sealed on the client with its own random
// key, which lives only inside the encrypted note, so the server stores opaque bytes and
// learns nothing but their size. Blobs are immutable: an id is written once.

export const MAX_BLOB_BYTES = 30 * 1024 * 1024;

db.exec(`
  CREATE TABLE IF NOT EXISTS server_blobs (
    id TEXT PRIMARY KEY,
    data BLOB NOT NULL,
    size INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )
`);

// Client-generated UUIDs only, so ids can never be paths or anything else surprising.
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const blobs = new Hono();

// Ids, sizes and dates of every blob, for the client's clean-up of blobs no note uses any more
// (only a client can tell: the references live inside the encrypted notes).
blobs.get('/', (c) => c.json(db.prepare('SELECT id, size, created_at FROM server_blobs').all()));

blobs.delete('/:id', (c) => {
  const id = c.req.param('id');
  if (!ID_PATTERN.test(id)) return c.json({ error: 'Bad blob id' }, 400);
  const removed = db.prepare('DELETE FROM server_blobs WHERE id = ?').run(id).changes;
  return c.json({ success: true, removed: removed > 0 });
});

blobs.get('/:id', (c) => {
  const id = c.req.param('id');
  if (!ID_PATTERN.test(id)) return c.json({ error: 'Bad blob id' }, 400);
  const row = db.prepare('SELECT data FROM server_blobs WHERE id = ?').get(id) as { data: Buffer } | undefined;
  if (!row) return c.json({ error: 'Blob not found' }, 404);
  return c.body(new Uint8Array(row.data), 200, {
    'Content-Type': 'application/octet-stream',
    // Immutable and encrypted: safe to cache forever on the client.
    'Cache-Control': 'private, max-age=31536000, immutable',
  });
});

blobs.put(
  '/:id',
  bodyLimit({ maxSize: MAX_BLOB_BYTES, onError: (c) => c.json({ error: 'Blob too large' }, 413) }),
  async (c) => {
    const id = c.req.param('id');
    if (!ID_PATTERN.test(id)) return c.json({ error: 'Bad blob id' }, 400);
    const data = Buffer.from(await c.req.arrayBuffer());
    // Nonce (24) + Poly1305 tag (16) is the smallest valid sealed blob.
    if (data.length <= 40) return c.json({ error: 'Empty blob' }, 400);
    // Write-once; a retry of an upload that already arrived is fine.
    const result = db
      .prepare('INSERT OR IGNORE INTO server_blobs (id, data, size, created_at) VALUES (?, ?, ?, ?)')
      .run(id, data, data.length, Date.now());
    return c.json({ success: true, id, created: result.changes > 0 }, result.changes > 0 ? 201 : 200);
  },
);
