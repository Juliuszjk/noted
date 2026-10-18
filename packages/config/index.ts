import { API_URL as DEFAULT_API_URL, PUBLIC_URL as DEFAULT_PUBLIC_URL } from './server';

// The server this device talks to: chosen on the first screen and kept by each app (desktop
// localStorage, phone SecureStore, MCP a file) through `configureServerStorage`. A build may
// carry a default (server.ts, not in git) for devices that have none stored yet; public builds
// have none ('').
export interface ServerAddress {
  // Private API (sync, blobs, account).
  api: string;
  // Public server of published notes ('' = this server publishes nothing). Reported by the
  // server itself (GET /info, `NOTED_PUBLIC_URL`).
  public: string;
}

export const SERVER_STORAGE = 'noted_server';

let current: ServerAddress = { api: DEFAULT_API_URL, public: DEFAULT_PUBLIC_URL };
let store: ((text: string) => void) | null = null;

export const apiUrl = (): string => current.api;
export const publicUrl = (): string => current.public;
export const wsUrl = (): string => current.api.replace(/^http/, 'ws') + '/ws';
export const hasServer = (): boolean => current.api !== '';
export const serverAddress = (): ServerAddress => current;

const parseAddress = (text: string | null): ServerAddress | null => {
  try {
    const value = JSON.parse(text ?? '');
    return typeof value?.api === 'string' && typeof value?.public === 'string' ? { api: value.api, public: value.public } : null;
  } catch {
    return null;
  }
};

// Reads the stored address (keeps the build default without one) and remembers how to store
// later changes. A build default is stored at once, so a later build without one keeps it.
export function configureServerStorage(load: () => string | null, save: (text: string) => void): void {
  store = save;
  const stored = parseAddress(load());
  if (stored) current = stored;
  else if (current.api) save(JSON.stringify(current));
}

export function setServerAddress(address: ServerAddress): void {
  current = { api: address.api, public: address.public };
  store?.(JSON.stringify(current));
}

// What a person typed as the server address -> base URL, or null. Without a scheme an IP
// address or localhost (Tailscale, home network) means http, a host name https.
export function normalizeServerUrl(text: string): string | null {
  let value = text.trim();
  if (!value) return null;
  if (!/^https?:\/\//i.test(value)) {
    const host = value.split(/[/:]/)[0];
    const plain = host === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[');
    value = `${plain ? 'http' : 'https'}://${value}`;
  }
  try {
    const url = new URL(value);
    if (url.search || url.hash) return null;
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

export const SYNC_INTERVAL_MS = 30000;
export const WS_STALE_MS = 60000;
export const REQUEST_TIMEOUT_MS = 8000;
export const MIN_PASSPHRASE_LENGTH = 12;
export const KEY_STORAGE = 'noted_master_key';
export const VERIFIER_STORAGE = 'noted_vault_verifier';
