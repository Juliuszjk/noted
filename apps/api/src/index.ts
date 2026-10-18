import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { db } from './db.js';
import { vault, vaultPrivate, requireAuth } from './vault.js';
import { attachRealtime, notifyOnWrite } from './realtime.js';
import { blobs } from './blobs.js';
import { publishPrivate, publicApp } from './publish.js';
import { livePrivate, attachLiveSockets } from './live.js';
import type { Server } from 'node:http';
import { startDailyBackups } from './backups.js';

const app = new Hono();

// Allow connections from Tauri (localhost/app) and Expo
app.use('/*', cors());

app.route('/vault', vault);
// Passphrase change, recovery key, logging out other devices, storage numbers.
app.use('/account/*', requireAuth);
app.route('/account', vaultPrivate);

// Everything below needs the auth token derived from the vault key.
app.use('/notes', requireAuth);
app.use('/notes/*', requireAuth);
app.use('/notes/*', notifyOnWrite);
app.use('/blobs', requireAuth);
app.use('/blobs/*', requireAuth);
app.route('/blobs', blobs);
app.use('/publish/*', requireAuth);
app.route('/publish', publishPrivate);
app.use('/live/*', requireAuth);
app.route('/live', livePrivate);

app.get('/', (c) => {
  return c.text('Noted Zero-Knowledge API is running!');
});

// Lets an app check that an address is a Noted server, and learn where published notes are
// read (the public server's address as people reach it, e.g. behind a proxy or a tunnel).
app.get('/info', (c) => c.json({ app: 'noted', version: 1, publicUrl: process.env.NOTED_PUBLIC_URL ?? '' }));

// GET /notes - Returns only metadata (IDs and timestamps) for sync comparison
app.get('/notes', (c) => {
  try {
    const stmt = db.prepare('SELECT id, updated_at FROM server_notes ORDER BY updated_at DESC');
    const notes = stmt.all();
    return c.json(notes);
  } catch (error) {
    console.error(error);
    return c.json({ error: 'Failed to fetch notes metadata' }, 500);
  }
});

// GET /notes/:id - Returns the specific encrypted blobs for a note
app.get('/notes/:id', (c) => {
  const id = c.req.param('id');
  try {
    const stmt = db.prepare('SELECT * FROM server_notes WHERE id = ?');
    const note = stmt.get(id);
    
    if (!note) return c.json({ error: 'Note not found' }, 404);
    return c.json(note);
  } catch (error) {
    console.error(error);
    return c.json({ error: 'Failed to fetch note' }, 500);
  }
});

// POST /notes/:id - Upserts the encrypted blobs from the client
app.post('/notes/:id', async (c) => {
  const id = c.req.param('id');
  
  try {
    const body = await c.req.json();
    const { encrypted_html, encrypted_yjs, updated_at } = body;

    // Strict validation: Reject if data is missing
    if (!encrypted_html || !encrypted_yjs || !updated_at) {
      return c.json({ error: 'Missing required encrypted fields' }, 400);
    }

    const stmt = db.prepare(`
      INSERT INTO server_notes (id, encrypted_html, encrypted_yjs, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        encrypted_html = excluded.encrypted_html,
        encrypted_yjs = excluded.encrypted_yjs,
        updated_at = excluded.updated_at
    `);

    stmt.run(id, encrypted_html, encrypted_yjs, updated_at);

    return c.json({ success: true, id, updated_at });
  } catch (error) {
    console.error(error);
    return c.json({ error: 'Failed to save encrypted note' }, 500);
  }
});

// DELETE /notes/:id - Storage clean-up: removes a note that was deleted for good (the client
// only asks for notes whose encrypted content is such a tombstone).
app.delete('/notes/:id', (c) => {
  const removed = db.prepare('DELETE FROM server_notes WHERE id = ?').run(c.req.param('id')).changes;
  return c.json({ success: true, removed: removed > 0 });
});

const port = process.env.PORT ? parseInt(process.env.PORT) : 3000;
console.log(`Zero-Knowledge API is listening on port ${port}`);

const server = serve({
  fetch: app.fetch,
  port,
  hostname: '0.0.0.0'
});

attachRealtime(server as Server);

// A copy of the database every night (kept: the newest 7), in the data volume.
startDailyBackups();

// Published notes, readable by anyone with the link. A separate server on its own port that
// only serves the viewer and sealed bytes; Docker binds it to 127.0.0.1 and a proxy or tunnel
// exposes just this port over HTTPS. The API above stays private (VPN or its own proxy).
const publicPort = process.env.PUBLIC_PORT ? parseInt(process.env.PUBLIC_PORT) : 3001;
const publicServer = serve({ fetch: publicApp.fetch, port: publicPort, hostname: '0.0.0.0' });
// Live published notes: guests' WebSocket (/p/:id/ws).
attachLiveSockets(publicServer as Server);
console.log(`Published notes are served on port ${publicPort}`);
