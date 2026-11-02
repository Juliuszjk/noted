// The real API (apps/api) with an empty database in a temporary folder, on loopback: only the
// tests talk to it and everything is deleted when it stops.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const api = path.resolve(here, '../../api');
const data = mkdtempSync(path.join(tmpdir(), 'noted-release-api-'));
const child = spawn(
  process.execPath,
  ['--import', path.join(here, 'loopback-only.mjs'), '--import', path.join(api, 'node_modules/tsx/dist/loader.mjs'), path.join(api, 'src/index.ts')],
  {
    cwd: data,
    stdio: 'inherit',
    env: {
      ...process.env,
      PORT: process.env.API_PORT ?? '47322',
      PUBLIC_PORT: process.env.PUBLIC_API_PORT ?? '47323',
      NOTED_SETUP_CODE: 'RELEASE-CHECK',
      NOTED_PUBLIC_URL: `http://127.0.0.1:${process.env.PUBLIC_API_PORT ?? '47323'}`,
    },
  },
);
const stop = () => {
  child.kill('SIGTERM');
  rmSync(data, { recursive: true, force: true });
};
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stop(); process.exit(0); });
process.on('exit', stop);
child.on('exit', (code) => process.exit(code ?? 1));
