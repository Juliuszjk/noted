// `pnpm verify:release:setup`: downloads Chromium and Firefox into this package's dist/browsers
// (not the user's cache). The only step of the pipeline that uses the network.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { status } = spawnSync(path.join(root, 'node_modules/.bin/playwright'), ['install', 'chromium', 'firefox'], {
  cwd: root,
  stdio: 'inherit',
  // Playwright resolves a relative path against pnpm's starting folder: absolute.
  env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: path.join(root, 'dist/browsers') },
});
process.exit(status ?? 1);
