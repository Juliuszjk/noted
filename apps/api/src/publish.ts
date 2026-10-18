import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { db } from './db.js';
import { VIEWER_JS } from './viewer.generated.js';
import { LIVE_JS } from './live.generated.js';
import { liveBlob, liveInitial, liveNeedsPassword, liveShareExists, removeLiveShare } from './live.js';

// Published notes ("monographs"): the client seals a rendered copy of a note with a random
// key that exists only in the link's #fragment, so this server stores opaque bytes and never
// sees the text. Writing needs the vault's auth token (private API, Tailscale only); reading
// goes through a separate public server (publicApp) that offers nothing else.

export const MAX_PUBLISHED_BYTES = 30 * 1024 * 1024;
// Random ids made by the client (12 bytes, base64url).
const ID_PATTERN = /^[A-Za-z0-9_-]{16}$/;

db.exec(`
  CREATE TABLE IF NOT EXISTS published (
    id TEXT PRIMARY KEY,
    data BLOB NOT NULL,
    size INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )
`);
// "Self destruct": the copy is deleted after it was read once.
const columns = db.prepare('PRAGMA table_info(published)').all() as { name: string }[];
if (!columns.some((c) => c.name === 'once')) db.exec('ALTER TABLE published ADD COLUMN once INTEGER NOT NULL DEFAULT 0');
// Link expiry (ms since 1970; null = never): an expired copy is deleted and answers like a
// missing one.
if (!columns.some((c) => c.name === 'expires_at')) db.exec('ALTER TABLE published ADD COLUMN expires_at INTEGER');

const MAX_EXPIRY_MS = 5 * 365 * 24 * 60 * 60 * 1000;
const removeExpired = () => {
  const removed = db.prepare('DELETE FROM published WHERE expires_at IS NOT NULL AND expires_at <= ?').run(Date.now()).changes;
  if (removed) console.log(`publish: ${removed} expired cop${removed === 1 ? 'y' : 'ies'} deleted`);
};
removeExpired();
setInterval(removeExpired, 10 * 60 * 1000).unref();

// The row of a copy that is there and not expired (an expired one is deleted on the way).
const liveRow = <T,>(columns: string, id: string): T | undefined => {
  const row = db.prepare(`SELECT ${columns}, expires_at FROM published WHERE id = ?`).get(id) as (T & { expires_at: number | null }) | undefined;
  if (row?.expires_at && row.expires_at <= Date.now()) {
    db.prepare('DELETE FROM published WHERE id = ?').run(id);
    console.log(`publish: ${id.slice(0, 4)}… expired and was deleted`);
    return undefined;
  }
  return row;
};

// Mounted at /publish behind requireAuth.
export const publishPrivate = new Hono();

publishPrivate.put(
  '/:id',
  bodyLimit({ maxSize: MAX_PUBLISHED_BYTES, onError: (c) => c.json({ error: 'Too large' }, 413) }),
  async (c) => {
    const id = c.req.param('id');
    if (!ID_PATTERN.test(id)) return c.json({ error: 'Bad id' }, 400);
    const data = Buffer.from(await c.req.arrayBuffer());
    // Format header (3) + nonce (24) + tag (16) is the smallest valid copy.
    if (data.length <= 43) return c.json({ error: 'Empty' }, 400);
    const once = c.req.header('X-Self-Destruct') === '1' ? 1 : 0;
    const expiresHeader = Number(c.req.header('X-Expires-At') ?? '');
    const expiresAt = Number.isFinite(expiresHeader) && expiresHeader > Date.now() && expiresHeader < Date.now() + MAX_EXPIRY_MS ? Math.round(expiresHeader) : null;
    db.prepare(`
      INSERT INTO published (id, data, size, updated_at, once, expires_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET data = excluded.data, size = excluded.size, updated_at = excluded.updated_at, once = excluded.once, expires_at = excluded.expires_at
    `).run(id, data, data.length, Date.now(), once, expiresAt);
    // A live note under the same link becomes this copy.
    removeLiveShare(id);
    // Ids are shortened in the log; the key is never sent to the server.
    console.log(`publish: stored ${id.slice(0, 4)}… (${data.length} bytes${once ? ', self destruct' : ''}${expiresAt ? `, expires ${new Date(expiresAt).toISOString()}` : ''})`);
    return c.json({ success: true, id });
  },
);

// Whether the copy is still there (a self-destructing one is gone once it was read), so the
// apps can show the note as not published any more.
publishPrivate.get('/:id', (c) => {
  const id = c.req.param('id');
  if (!ID_PATTERN.test(id)) return c.json({ error: 'Bad id' }, 400);
  return c.json({ exists: !!liveRow<{ updated_at: number }>('updated_at', id) || liveShareExists(id) });
});

publishPrivate.delete('/:id', (c) => {
  const id = c.req.param('id');
  if (!ID_PATTERN.test(id)) return c.json({ error: 'Bad id' }, 400);
  const removed = db.prepare('DELETE FROM published WHERE id = ?').run(id).changes + (removeLiveShare(id) ? 1 : 0);
  console.log(`publish: unpublished ${id.slice(0, 4)}…${removed ? '' : ' (was not there)'}`);
  return c.json({ success: true });
});

// ---- public server: the viewer page and the sealed bytes, nothing else ----
const COMMON_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
  'Cross-Origin-Resource-Policy': 'same-origin',
};
// The decrypted note is shown in a sandboxed srcdoc frame (no scripts there); the page itself
// runs only /viewer.js and talks only to this origin.
const PAGE_CSP = [
  "default-src 'none'", "script-src 'self'", "connect-src 'self'", "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:", "font-src data:", "frame-src 'self'", "base-uri 'none'", "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Noted</title>
<style>
  html, body { margin: 0; height: 100%; background: #fff; color: #1b1b1f; font-family: system-ui, sans-serif; }
  @media (prefers-color-scheme: dark) { html, body { background: #141218; color: #e6e0e9; } }
  #status { padding: 40px 20px; text-align: center; opacity: 0.7; }
  #note { display: none; width: 100%; height: 100%; border: 0; }
  #unlock { display: none; max-width: 340px; margin: 18vh auto 0; padding: 0 20px; text-align: center; }
  #unlock h1 { font-size: 20px; margin: 0 0 8px; }
  #unlock p { opacity: 0.7; font-size: 14px; margin: 0 0 16px; }
  #unlock input { width: 100%; box-sizing: border-box; padding: 10px 12px; font-size: 16px; border-radius: 10px;
    border: 1px solid #9a9aa3; background: transparent; color: inherit; }
  #unlock button { margin-top: 10px; width: 100%; padding: 10px; font-size: 15px; font-weight: 600; border: 0;
    border-radius: 10px; background: #6750a4; color: #fff; cursor: pointer; }
  #unlock .error { color: #d93025; font-size: 13px; min-height: 18px; margin-top: 8px; }
</style>
</head>
<body>
<div id="status">Opening…</div>
<form id="unlock"><h1>Password protected</h1><p>This note needs a password to open.</p>
<input id="password" type="password" autocomplete="off" placeholder="Password"><button type="submit">Open</button>
<div class="error" id="unlock-error"></div></form>
<iframe id="note" title="Published note" sandbox="allow-popups allow-popups-to-escape-sandbox"></iframe>
<script src="/viewer.js"></script>
</body>
</html>`;

// A live note (live.ts): the editor page (/live.js) instead of the viewer. Like the viewer it
// talks only to this origin (the WebSocket included) and loads nothing from elsewhere.
const LIVE_CSP = [
  "default-src 'none'", "script-src 'self'", "connect-src 'self'", "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:", "font-src data:", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
].join('; ');

const LIVE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, interactive-widget=resizes-content">
<meta name="robots" content="noindex, nofollow">
<title>Noted</title>
</head>
<body>
<div id="app"><div class="live-status">Opening…</div></div>
<script src="/live.js"></script>
</body>
</html>`;

export const publicApp = new Hono();

publicApp.get('/', (c) => c.text('Noted', 200, COMMON_HEADERS));

publicApp.get('/viewer.js', (c) => c.body(VIEWER_JS, 200, {
  ...COMMON_HEADERS,
  'Content-Type': 'application/javascript; charset=utf-8',
  'Cache-Control': 'public, max-age=300',
}));

publicApp.get('/live.js', (c) => c.body(LIVE_JS, 200, {
  ...COMMON_HEADERS,
  'Content-Type': 'application/javascript; charset=utf-8',
  'Cache-Control': 'public, max-age=300',
}));

// A link whose copy is gone gets a plain "not published" page, not the viewer.
const GONE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>Not published</title>
<style>html,body{margin:0;background:#fff;color:#1b1b1f;font-family:system-ui,sans-serif}
@media (prefers-color-scheme: dark){html,body{background:#141218;color:#e6e0e9}}
p{padding:40px 20px;text-align:center;opacity:.7}</style></head><body><p>This note is not published.</p></body></html>`;

publicApp.get('/p/:id', (c) => {
  const id = c.req.param('id');
  if (!ID_PATTERN.test(id)) return c.text('Not found', 404, COMMON_HEADERS);
  if (liveShareExists(id)) {
    return c.body(LIVE_HTML, 200, {
      ...COMMON_HEADERS,
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': LIVE_CSP,
      'X-Frame-Options': 'DENY',
      'Cache-Control': 'no-store',
    });
  }
  // Only whether it exists: reading the data (and a self destruct) happens in /data.
  if (!liveRow<{ id: string }>('id', id)) {
    return c.body(GONE_HTML, 404, { ...COMMON_HEADERS, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'", 'Cache-Control': 'no-store' });
  }
  return c.body(PAGE_HTML, 200, {
    ...COMMON_HEADERS,
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': PAGE_CSP,
    'X-Frame-Options': 'DENY',
    'Cache-Control': 'no-store',
  });
});

publicApp.get('/p/:id/data', (c) => {
  const id = c.req.param('id');
  if (!ID_PATTERN.test(id)) return c.text('Not found', 404, COMMON_HEADERS);
  const row = liveRow<{ data: Buffer; once: number }>('data, once', id);
  if (!row) return c.text('Not found', 404, COMMON_HEADERS);
  if (row.once) {
    db.prepare('DELETE FROM published WHERE id = ?').run(id);
    console.log(`publish: ${id.slice(0, 4)}… was read once and deleted (self destruct)`);
  }
  return c.body(new Uint8Array(row.data), 200, {
    ...COMMON_HEADERS,
    'Content-Type': 'application/octet-stream',
    'Cache-Control': 'no-store',
    ...(row.once ? { 'X-Self-Destructed': '1' } : {}),
  });
});

// Live note: the sealed state and updates, for the read token (header, never the URL).
publicApp.get('/p/:id/live', (c) => {
  const id = c.req.param('id');
  if (!ID_PATTERN.test(id)) return c.text('Not found', 404, COMMON_HEADERS);
  const result = liveInitial(id, c.req.header('X-Live-Read'));
  if ('status' in result) return c.text('Not allowed', result.status, COMMON_HEADERS);
  return c.json(result.body, 200, { ...COMMON_HEADERS, 'Cache-Control': 'no-store' });
});

publicApp.get('/p/:id/live/info', (c) => {
  const id = c.req.param('id');
  const password = ID_PATTERN.test(id) ? liveNeedsPassword(id) : null;
  if (password === null) return c.text('Not found', 404, COMMON_HEADERS);
  return c.json({ password }, 200, { ...COMMON_HEADERS, 'Cache-Control': 'no-store' });
});

publicApp.get('/p/:id/blob/:blob', (c) => {
  const id = c.req.param('id');
  if (!ID_PATTERN.test(id)) return c.text('Not found', 404, COMMON_HEADERS);
  const result = liveBlob(id, c.req.param('blob'), c.req.header('X-Live-Read'));
  if ('status' in result) return c.text('Not allowed', result.status, COMMON_HEADERS);
  return c.body(new Uint8Array(result.data), 200, { ...COMMON_HEADERS, 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' });
});

publicApp.notFound((c) => c.text('Not found', 404, COMMON_HEADERS));
