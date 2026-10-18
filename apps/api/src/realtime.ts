import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import type { MiddlewareHandler } from 'hono';
import { isValidToken, authRotatedListeners } from './vault.js';

// Realtime channel: the server only says "note X changed". Clients then run the
// normal (encrypted) sync, so the server still never sees any plaintext. Live published notes
// (live.ts) also pass their sealed updates and cursors through here.

const AUTH_TIMEOUT_MS = 5000;
const HEARTBEAT_MS = 25000;
// Room for a sealed live update (live.ts: 1 MB, base64).
const MAX_MESSAGE_BYTES = 1500 * 1024;

// Only clients that passed the token handshake are in this set.
const authed = new Set<WebSocket>();

// To every connected device (except the one a message came from).
export const broadcastPrivate = (message: object, except?: WebSocket) => {
  const payload = JSON.stringify(message);
  for (const ws of authed) {
    if (ws !== except && ws.readyState === WebSocket.OPEN) ws.send(payload);
  }
};
const broadcast = (message: object) => broadcastPrivate(message);

// Messages from devices after the handshake (live.ts).
export const privateMessageHandlers = new Set<(ws: WebSocket, msg: Record<string, unknown>) => void>();

// Hono middleware: after a successful note write, tell every connected client.
export const notifyOnWrite: MiddlewareHandler = async (c, next) => {
  await next();
  if (c.req.method === 'POST' && c.res.status < 300) {
    const id = decodeURIComponent(c.req.path.split('/').pop() ?? '');
    broadcast({ type: 'changed', id });
  }
};

// A new auth token (other devices logged out): every connection goes; this device reconnects
// with the new token, the others get 4401 and ask for the passphrase.
authRotatedListeners.add(() => {
  for (const ws of authed) ws.close(4401, 'logged out');
  authed.clear();
});

export function attachRealtime(server: Server): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  const alive = new WeakMap<WebSocket, boolean>();

  server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    if (pathname !== '/ws') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws) => {
    alive.set(ws, true);
    ws.on('pong', () => alive.set(ws, true));

    // Browsers cannot set headers on a WebSocket, so the token arrives as the first message
    // (not in the URL, which could end up in logs).
    const authTimer = setTimeout(() => ws.close(4401, 'auth timeout'), AUTH_TIMEOUT_MS);
    ws.once('message', (data) => {
      clearTimeout(authTimer);
      let token = '';
      try {
        const msg = JSON.parse(data.toString());
        if (msg?.type === 'auth' && typeof msg.token === 'string') token = msg.token;
      } catch {
        // malformed first message: falls through to rejection
      }
      if (!isValidToken(token)) {
        ws.close(4401, 'unauthorized');
        return;
      }
      authed.add(ws);
      ws.send(JSON.stringify({ type: 'ready' }));
      ws.on('message', (raw) => {
        if (!authed.has(ws)) return;
        let msg: unknown;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (msg && typeof msg === 'object') for (const handler of privateMessageHandlers) handler(ws, msg as Record<string, unknown>);
      });
    });

    ws.on('close', () => {
      clearTimeout(authTimer);
      authed.delete(ws);
    });
    ws.on('error', () => ws.terminate());
  });

  // Drop dead connections (e.g. a laptop that lost Tailscale) and give clients a
  // regular message so they can detect a dead server too.
  setInterval(() => {
    for (const ws of wss.clients) {
      if (alive.get(ws) === false) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
      if (authed.has(ws)) ws.send(JSON.stringify({ type: 'hb' }));
    }
  }, HEARTBEAT_MS);
}
