// Copy to server.ts (ignored by git). Optional default server for a build: devices without a
// stored address start with it instead of asking (see index.ts). Empty = ask on the first screen,
// e.g. 'http://localhost:3000' for `pnpm --filter api run dev` on this machine.
// Private API (sync, blobs, account).
export const API_URL = '';
// Public server for published notes (apps/api/src/publish.ts); servers also report it (GET /info).
export const PUBLIC_URL = '';
