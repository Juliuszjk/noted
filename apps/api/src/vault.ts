import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { createHash, timingSafeEqual } from 'node:crypto';
import { db } from './db.js';
import { dropSetupCode, prepareSetupCode, setupCodeMatches, setupCodeRequired } from './setup-code.js';

// Single-row table: KDF salt, passphrase verifier and the hash of the auth token.
// The server never sees the passphrase or the master key, and stores only a hash of the token.
db.exec(`
  CREATE TABLE IF NOT EXISTS vault (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    salt TEXT NOT NULL,
    verifier TEXT NOT NULL
  )
`);

// Columns added after the first vaults were created:
//  auth_hash          hash of the auth token
//  key_envelope       the data key sealed with the key of the current passphrase (absent in
//                     vaults whose passphrase was never changed: that key is the data key)
//  recovery_envelope  the data key sealed with the recovery key (via HKDF)
//  recovery_sealed    the recovery key sealed with the data key (so devices can show it again)
//  auth_epoch         grows with "log out from all other devices" (part of the token label)
//  created_at         when the vault was made (unknown for the first one)
const columns = db.prepare('PRAGMA table_info(vault)').all() as { name: string }[];
const addColumn = (name: string, type: string) => {
  if (!columns.some((col) => col.name === name)) db.exec(`ALTER TABLE vault ADD COLUMN ${name} ${type}`);
};
addColumn('auth_hash', 'TEXT');
addColumn('key_envelope', 'TEXT');
addColumn('recovery_envelope', 'TEXT');
addColumn('recovery_sealed', 'TEXT');
addColumn('auth_epoch', 'INTEGER NOT NULL DEFAULT 0');
addColumn('created_at', 'INTEGER');

if (!db.prepare('SELECT 1 FROM vault WHERE id = 1').get()) prepareSetupCode();

// Told when the auth token changes (the WebSocket server drops its connections).
export const authRotatedListeners = new Set<() => void>();

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

// Guards the note routes. Fails closed: no vault or no registered token means no access.
export const requireAuth: MiddlewareHandler = async (c, next) => {
  const row = db.prepare('SELECT auth_hash FROM vault WHERE id = 1').get() as
    | { auth_hash: string | null }
    | undefined;
  const header = c.req.header('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!row?.auth_hash || !token) return c.json({ error: 'Unauthorized' }, 401);

  const expected = Buffer.from(row.auth_hash, 'hex');
  const actual = Buffer.from(hashToken(token), 'hex');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  await next();
};

export const vault = new Hono();

// Public on purpose: a new device needs the salt, the verifier and the envelopes before it can
// derive any key. Everything here is either random or encrypted; like the verifier, the key
// envelope only allows guessing the passphrase offline (Argon2id makes that slow).
vault.get('/', (c) => {
  const row = db.prepare('SELECT salt, verifier, key_envelope, recovery_envelope, auth_epoch, created_at FROM vault WHERE id = 1').get();
  // `setupCode`: creating the vault needs the code from the server's log (setup-code.ts).
  if (!row) return c.json({ error: 'No vault yet', setupCode: setupCodeRequired() }, 404);
  return c.json(row);
});

const sealedPattern = /^[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/;
const isSealed = (v: unknown): v is string => typeof v === 'string' && v.length < 512 && sealedPattern.test(v);

// ---- changes that need the current auth token ----
export const vaultPrivate = new Hono();

// New passphrase: a new salt and the data key sealed with the new passphrase's key.
vaultPrivate.put('/password', async (c) => {
  const { salt, key_envelope } = await c.req.json().catch(() => ({}));
  if (!isNonEmptyString(salt) || salt.length > 64 || !isSealed(key_envelope)) return c.json({ error: 'salt and key_envelope are required' }, 400);
  db.prepare('UPDATE vault SET salt = ?, key_envelope = ? WHERE id = 1').run(salt, key_envelope);
  console.log('vault: passphrase changed');
  return c.json({ success: true });
});

// New recovery key (replaces the old one).
vaultPrivate.put('/recovery', async (c) => {
  const { recovery_envelope, recovery_sealed } = await c.req.json().catch(() => ({}));
  if (!isSealed(recovery_envelope) || !isSealed(recovery_sealed)) return c.json({ error: 'recovery_envelope and recovery_sealed are required' }, 400);
  db.prepare('UPDATE vault SET recovery_envelope = ?, recovery_sealed = ? WHERE id = 1').run(recovery_envelope, recovery_sealed);
  console.log('vault: recovery key replaced');
  return c.json({ success: true });
});

vaultPrivate.get('/recovery', (c) => {
  const row = db.prepare('SELECT recovery_sealed FROM vault WHERE id = 1').get() as { recovery_sealed: string | null } | undefined;
  return c.json({ recovery_sealed: row?.recovery_sealed ?? null });
});

// "Log out from all other devices": the token of the next epoch replaces the current one;
// devices with the old token get 401 and ask for the passphrase again.
vaultPrivate.post('/rotate-auth', async (c) => {
  const { auth_token, epoch } = await c.req.json().catch(() => ({}));
  const row = db.prepare('SELECT auth_epoch FROM vault WHERE id = 1').get() as { auth_epoch: number } | undefined;
  if (!row || !isNonEmptyString(auth_token) || epoch !== row.auth_epoch + 1) return c.json({ error: 'Bad epoch or token' }, 400);
  db.prepare('UPDATE vault SET auth_hash = ?, auth_epoch = ? WHERE id = 1').run(hashToken(auth_token), epoch);
  console.log(`vault: auth rotated to epoch ${epoch}`);
  for (const listener of authRotatedListeners) listener();
  return c.json({ success: true, epoch });
});

// Numbers for the settings' account card (sizes of encrypted data only).
vaultPrivate.get('/stats', (c) => {
  const notes = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(encrypted_yjs) + LENGTH(encrypted_html)), 0) AS bytes FROM server_notes').get() as { n: number; bytes: number };
  const blobs = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM server_blobs').get() as { n: number; bytes: number };
  const published = db.prepare('SELECT COUNT(*) AS n FROM published').get() as { n: number };
  return c.json({ notes: notes.n, noteBytes: notes.bytes, blobs: blobs.n, blobBytes: blobs.bytes, published: published.n });
});

// Create-once: overwriting the salt would lock every device out of its notes.
// A vault set up from a backup (new or replaced server) also brings its sealed keys, its
// creation time and the auth epoch of the device that sets it up.
vault.put('/', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { salt, verifier, auth_token } = body;
  if (![salt, verifier, auth_token].every(isNonEmptyString)) {
    return c.json({ error: 'salt, verifier and auth_token are required' }, 400);
  }
  const optionalSealed = (v: unknown) => (v === undefined || v === null ? null : isSealed(v) ? v : undefined);
  const keyEnvelope = optionalSealed(body.key_envelope);
  const recoveryEnvelope = optionalSealed(body.recovery_envelope);
  const recoverySealed = optionalSealed(body.recovery_sealed);
  const epoch = body.auth_epoch === undefined ? 0 : body.auth_epoch;
  const createdAt = typeof body.created_at === 'number' && body.created_at > 0 ? body.created_at : Date.now();
  if (keyEnvelope === undefined || recoveryEnvelope === undefined || recoverySealed === undefined || !Number.isInteger(epoch) || epoch < 0 || salt.length > 64 || !isSealed(verifier)) {
    return c.json({ error: 'Bad vault fields' }, 400);
  }
  if (!setupCodeMatches(c.req.header('X-Setup-Code'))) {
    // Slows down guessing (the code has ~59 bits anyway).
    await new Promise((r) => setTimeout(r, 1000));
    return c.json({ error: 'Wrong setup code' }, 403);
  }
  const result = db
    .prepare('INSERT OR IGNORE INTO vault (id, salt, verifier, auth_hash, key_envelope, recovery_envelope, recovery_sealed, auth_epoch, created_at) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(salt, verifier, hashToken(auth_token), keyEnvelope, recoveryEnvelope, recoverySealed, epoch, createdAt);
  if (result.changes > 0 && (keyEnvelope || body.created_at)) console.log('vault: set up from a backup');
  if (result.changes === 0) return c.json({ error: 'Vault already exists' }, 409);
  dropSetupCode();
  return c.json({ success: true }, 201);
});

// Set-once: lets a vault created before auth existed register its token.
// The client only calls this after proving that its key matches the vault verifier.
vault.put('/auth', async (c) => {
  const { auth_token } = await c.req.json().catch(() => ({}));
  if (!isNonEmptyString(auth_token)) return c.json({ error: 'auth_token is required' }, 400);

  const row = db.prepare('SELECT auth_hash FROM vault WHERE id = 1').get() as
    | { auth_hash: string | null }
    | undefined;
  if (!row) return c.json({ error: 'No vault yet' }, 404);
  if (row.auth_hash) return c.json({ error: 'Auth token already registered' }, 409);

  db.prepare('UPDATE vault SET auth_hash = ? WHERE id = 1 AND auth_hash IS NULL').run(hashToken(auth_token));
  return c.json({ success: true });
});

// Same check as requireAuth, for callers outside Hono (the WebSocket handshake).
export const isValidToken = (token: string): boolean => {
  const row = db.prepare('SELECT auth_hash FROM vault WHERE id = 1').get() as
    | { auth_hash: string | null }
    | undefined;
  if (!row?.auth_hash || !token) return false;
  const expected = Buffer.from(row.auth_hash, 'hex');
  const actual = Buffer.from(hashToken(token), 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};
