import { API_URL, PUBLIC_URL } from './server';

export { API_URL, PUBLIC_URL };
export const SYNC_INTERVAL_MS = 30000;
export const WS_URL = API_URL.replace(/^http/, 'ws') + '/ws';
export const WS_STALE_MS = 60000;
export const REQUEST_TIMEOUT_MS = 8000;
export const MIN_PASSPHRASE_LENGTH = 12;
export const KEY_STORAGE = 'noted_master_key';
export const VERIFIER_STORAGE = 'noted_vault_verifier';
