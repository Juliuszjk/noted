// Bundles the release harness (harness/main.tsx) into dist/harness/, and copies the phone's
// real WebView pages next to it, so the tests load exactly what the APK ships.
import { build } from 'esbuild';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(root, '../..');
const out = path.join(root, 'dist/harness');
const stub = path.join(repo, 'apps/web/src/config-stub.ts');

// Like the live page: a personal server address (packages/config/server.ts) never gets in.
const noServerAddresses = {
  name: 'no-server-addresses',
  setup(b) {
    b.onResolve({ filter: /^\.\/server(\.ts)?$/ }, (args) => (args.importer.includes(`${path.sep}config${path.sep}`) ? { path: stub } : undefined));
  },
};

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
await build({
  entryPoints: { harness: path.join(root, 'harness/main.tsx') },
  bundle: true,
  format: 'iife',
  target: 'es2020',
  outdir: out,
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  loader: { '.woff2': 'dataurl', '.woff': 'empty', '.ttf': 'empty' },
  plugins: [noServerAddresses],
  logLevel: 'warning',
});
// The layout measurements, on their own, for pages that are not the harness (the phone's PDF page).
await build({
  stdin: { contents: "import { sheetSummary } from './measure'; window.__measure = { sheetSummary };", resolveDir: path.join(root, 'harness'), loader: 'ts' },
  bundle: true,
  format: 'iife',
  target: 'es2020',
  outfile: path.join(out, 'measure.js'),
  logLevel: 'warning',
});
const css = readFileSync(path.join(root, 'harness/harness.css'), 'utf8');
writeFileSync(path.join(out, 'harness.css'), `${readFileSync(path.join(out, 'harness.css'), 'utf8')}\n${css}`);
copyFileSync(path.join(root, 'harness/index.html'), path.join(out, 'index.html'));

// The phone's pages, unwrapped from their generated TypeScript modules.
const pages = [['src/editorHtml.generated.ts', 'phone-editor.html'], ['src/pdfHtml.generated.ts', 'phone-pdf.html']];
for (const [source, name] of pages) {
  const file = path.join(repo, 'apps/mobile', source);
  if (!existsSync(file)) throw new Error(`${source} is missing: run pnpm --filter mobile run build:editor`);
  const text = readFileSync(file, 'utf8');
  const start = text.indexOf(' = ') + 3;
  writeFileSync(path.join(out, name), JSON.parse(text.slice(start, text.lastIndexOf(';'))));
}
console.log('harness built in dist/harness/');
