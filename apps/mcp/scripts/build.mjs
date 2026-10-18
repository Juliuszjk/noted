// Bundles the MCP server into dist/noted-mcp.mjs (workspace packages included). happy-dom and
// resvg stay outside: they are dependencies of this app, found next to the bundle.
import { build } from 'esbuild';
import { chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('..', import.meta.url));
const outfile = `${here}dist/noted-mcp.mjs`;
await build({
  entryPoints: [`${here}src/index.ts`],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['happy-dom', '@resvg/resvg-wasm'],
  loader: { '.css': 'empty' },
  banner: { js: "#!/usr/bin/env node\nimport { createRequire as __noted_require } from 'node:module'; const require = __noted_require(import.meta.url);" },
  logLevel: 'warning',
});
chmodSync(outfile, 0o755);
console.log(`wrote ${outfile}`);
