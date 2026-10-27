// Checks the message protocol between React Native (src/EditorScreen.tsx) and the editor page
// (editor/*.ts): every message type one side sends must be handled by the other. A rewrite
// once dropped handlers without any error (the feature just stopped working); this catches it.
// Run by `build:editor`; fails with a list of the unmatched types.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const pageFiles = readdirSync(join(root, 'editor'))
  // kdf.ts and pdf.ts are separate pages (src/KdfRunner.tsx, src/PdfPane.tsx).
  .filter((f) => f.endsWith('.ts') && f !== 'kdf.ts' && f !== 'pdf.ts' && !f.endsWith('.d.ts'))
  .map((f) => `editor/${f}`);

const collect = (text, re) => new Set([...text.matchAll(re)].map((m) => m[1]));
// Sent: object literals `type: 'x'`, and string unions of a `type` parameter
// (`(type: 'init' | 'remote')`, `(type: 'openFile' | 'saveFile', …)`).
const sent = (text) => {
  const out = collect(text, /\btype:\s*'(\w+)'/g);
  for (const m of text.matchAll(/\(type:\s*((?:'\w+'\s*\|\s*)+'\w+')/g)) {
    for (const t of m[1].matchAll(/'(\w+)'/g)) out.add(t[1]);
  }
  return out;
};
const handled = (text) => collect(text, /\bmsg\.type\s*===\s*'(\w+)'/g);
// Comments mention types too ("{type: 'reply'}").
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const rn = code(read('src/EditorScreen.tsx'));
const page = pageFiles.map((f) => code(read(f))).join('\n');

// Types that are not messages between the two sides (other `type:` fields in the same files).
const NOT_MESSAGES = new Set([
  // Tiptap / ProseMirror node types and other `type:` fields of the page.
  'image', 'attachment', 'doc', 'paragraph', 'text', 'noteLink', 'heading', 'bulletList', 'orderedList', 'taskList',
  'listItem', 'taskItem', 'table', 'tableRow', 'tableCell', 'tableHeader', 'codeBlock', 'blockquote', 'callout',
  'inlineMath', 'blockMath', 'horizontalRule', 'hardBreak', 'link',
]);

const problems = [];
const compare = (from, to, sentSet, handledSet) => {
  for (const type of [...sentSet].sort()) {
    if (!NOT_MESSAGES.has(type) && !handledSet.has(type)) problems.push(`${from} sends '${type}' but ${to} does not handle it`);
  }
};
const rnSent = sent(rn);
const pageSent = sent(page);
const rnHandled = handled(rn);
const pageHandled = handled(page);
compare('React Native', 'the page', rnSent, pageHandled);
compare('the page', 'React Native', pageSent, rnHandled);
// The other way round: handlers nothing sends any more (dead code or a lost sender).
for (const type of [...pageHandled].sort()) if (!rnSent.has(type)) problems.push(`the page handles '${type}' but React Native never sends it`);
for (const type of [...rnHandled].sort()) if (!pageSent.has(type)) problems.push(`React Native handles '${type}' but the page never sends it`);

if (problems.length) {
  console.error(`Editor message check failed:\n  ${problems.join('\n  ')}\n(scripts/check-messages.mjs; add real non-message types to NOT_MESSAGES)`);
  process.exit(1);
}
console.log(`messages ok: ${rnSent.size} React Native -> page, ${pageSent.size} page -> React Native`);
