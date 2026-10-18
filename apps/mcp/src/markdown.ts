import { generateJSON } from '@tiptap/core';
import type { JSONContent } from '@tiptap/core';
import { marked } from 'marked';
import * as Y from 'yjs';
import { exportNote } from '@noted/editor/export';
import { createSchemaExtensions } from '@noted/editor/extensions';
import { normalizeTaskListHtml } from '@noted/editor/markdown-paste';
import { isReminderRepeat, reminderPlainText } from '@noted/editor/reminder-time';

// A note body as Markdown for Claude, and Markdown from Claude back into the body, without
// losing what Markdown cannot hold. Images, drawings and files become tokens on a line of
// their own ("⟦image 1⟧"), reminder chips and note links inline tokens ("⟦reminder 1: …⟧",
// "⟦link 1: Title⟧"); a rewrite puts the original nodes back where the tokens are. A block
// whose Markdown did not change keeps its original node (colours, highlights, alignment, ...);
// only changed blocks are made from Markdown. Needs a DOM (dom.ts) for the HTML parser.

export type BlockKind = 'image' | 'drawing' | 'file';
export type InlineKind = 'reminder' | 'link';

const BLOCK_KINDS: Record<string, BlockKind> = { image: 'image', drawing: 'drawing', attachment: 'file' };
const INLINE_KINDS: Record<string, InlineKind> = { reminder: 'reminder', noteLink: 'link' };

export const TOKEN = /⟦(image|drawing|file|reminder|link) (\d+)(?::[^⟧]*)?⟧/g;
const TOKEN_ONLY = /^⟦(image|drawing|file) (\d+)(?::[^⟧]*)?⟧$/;

export interface NoteView {
  // The body as Markdown (blocks separated by blank lines).
  markdown: string;
  // The top-level blocks: their Markdown ('' for an empty line) and original node.
  blocks: { md: string; json: JSONContent }[];
  // Token name ("image 1", "reminder 2") -> original node.
  nodes: Map<string, JSONContent>;
}

// How a note link shows: the target's title, or null when Claude may not see the target.
export type LinkTitle = (noteId: string) => string | null;

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const textNode = (text: string): JSONContent => ({ type: 'text', text });

const blockLabel = (node: JSONContent): string => {
  if (node.type === 'attachment') return String(node.attrs?.name ?? 'file');
  if (node.type === 'image') return String(node.attrs?.alt ?? '');
  return '';
};

export const renderBody = (body: JSONContent, linkTitle: LinkTitle): NoteView => {
  const nodes = new Map<string, JSONContent>();
  const counts: Record<string, number> = {};
  const name = (kind: string, node: JSONContent) => {
    counts[kind] = (counts[kind] ?? 0) + 1;
    const key = `${kind} ${counts[kind]}`;
    nodes.set(key, clone(node));
    return key;
  };
  const tokenFor = (node: JSONContent): string | null => {
    const block = node.type ? BLOCK_KINDS[node.type] : undefined;
    if (block) {
      const label = blockLabel(node);
      return `⟦${name(block, node)}${label ? `: ${label.replace(/⟧/g, '')}` : ''}⟧`;
    }
    const inline = node.type ? INLINE_KINDS[node.type] : undefined;
    if (inline === 'reminder') {
      const state = { at: Number(node.attrs?.at) || 0, repeat: isReminderRepeat(node.attrs?.repeat) ? node.attrs!.repeat : null, done: node.attrs?.done === true };
      return `⟦${name(inline, node)}: ${reminderPlainText(state)}${state.done ? ' (done)' : ''}⟧`;
    }
    if (inline === 'link') {
      const title = linkTitle(String(node.attrs?.noteId ?? ''));
      return `⟦${name(inline, node)}: ${(title ?? 'protected note').replace(/⟧/g, '')}⟧`;
    }
    return null;
  };
  // A copy with the special nodes as text: block ones as a line of their own.
  const strip = (node: JSONContent): JSONContent => {
    const token = tokenFor(node);
    if (token) return node.type && BLOCK_KINDS[node.type] ? { type: 'paragraph', content: [textNode(token)] } : textNode(token);
    return node.content ? { ...node, content: node.content.map(strip) } : node;
  };
  const blocks = (body.content ?? []).map((json) => {
    const md = exportNote('', { type: 'doc', content: [strip(json)] }, 'markdown').trim();
    return { md, json };
  });
  return { markdown: blocks.map((b) => b.md).filter(Boolean).join('\n\n'), blocks, nodes };
};

// ---- Markdown -> nodes ----

const CALLOUT_VARIANTS: Record<string, string> = { NOTE: 'info', INFO: 'info', TIP: 'tip', IMPORTANT: 'info', WARNING: 'warning', CAUTION: 'danger', DANGER: 'danger' };

const escapeAttr = (text: string) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

// Outside code: $$…$$ blocks and $…$ / ==…== inline become the HTML the editor reads.
const preprocess = (md: string): string => {
  const out: string[] = [];
  const lines = md.split('\n');
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const open = /^\s*(```|~~~)/.exec(line);
    if (fence) {
      out.push(line);
      if (open && line.trim().startsWith(fence)) fence = null;
      continue;
    }
    if (open) {
      fence = open[1];
      out.push(line);
      continue;
    }
    if (line.trim() === '$$') {
      const end = lines.findIndex((l, j) => j > i && l.trim() === '$$');
      if (end > i) {
        out.push(`<div data-type="block-math" data-latex="${escapeAttr(lines.slice(i + 1, end).join('\n'))}"></div>`);
        i = end;
        continue;
      }
    }
    const single = /^\s*\$\$(.+)\$\$\s*$/.exec(line);
    if (single) {
      out.push(`<div data-type="block-math" data-latex="${escapeAttr(single[1].trim())}"></div>`);
      continue;
    }
    // Inline code keeps its dollars and equals signs.
    out.push(line.split(/(`[^`]*`)/).map((part, k) => (k % 2 ? part : part
      .replace(/(^|[^\\$])\$(?![\s$])([^$\n]+?)(?<![\s\\])\$(?!\d)/g, (_, pre, latex) => `${pre}<span data-type="inline-math" data-latex="${escapeAttr(latex)}"></span>`)
      .replace(/==(?=\S)([^=\n]+?)(?<=\S)==/g, '<mark>$1</mark>'))).join(''));
  }
  return out.join('\n');
};

// GitHub alerts ("> [!NOTE]") as callouts.
const callouts = (html: string): string => {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  for (const quote of [...doc.querySelectorAll('blockquote')]) {
    const first = quote.firstElementChild;
    const m = first?.tagName === 'P' ? /^\s*\[!(\w+)\]\s*/.exec(first.innerHTML) : null;
    if (!m || !CALLOUT_VARIANTS[m[1].toUpperCase()]) continue;
    first!.innerHTML = first!.innerHTML.slice(m[0].length);
    if (!first!.textContent?.trim() && !first!.querySelector('*')) first!.remove();
    const box = doc.createElement('div');
    box.setAttribute('data-type', 'callout');
    box.setAttribute('data-variant', CALLOUT_VARIANTS[m[1].toUpperCase()]);
    box.innerHTML = quote.innerHTML;
    quote.replaceWith(box);
  }
  return doc.body.innerHTML;
};

let schemaExtensions: ReturnType<typeof createSchemaExtensions> | null = null;
const extensions = () => (schemaExtensions ??= createSchemaExtensions({ ydoc: new Y.Doc(), placeholder: '' }));

// Markdown -> block nodes (plain Markdown, tokens stay text).
export const markdownBlocks = (md: string): JSONContent[] => {
  if (!md.trim()) return [];
  const html = normalizeTaskListHtml(marked.parse(preprocess(md), { gfm: true, breaks: false, async: false }) as string);
  return (generateJSON(callouts(html), extensions()).content ?? []) as JSONContent[];
};

export interface Restore {
  nodes: Map<string, JSONContent>;
  // Exact title -> note id, for "[[Title]]" links Claude writes ([] when unknown).
  resolveTitle: (title: string) => string | null;
  used: Map<string, number>;
  errors: string[];
}

const splitText = (text: string, ctx: Restore, inParagraph: boolean): JSONContent[] => {
  const out: JSONContent[] = [];
  let last = 0;
  const pattern = new RegExp(`${TOKEN.source}|\\[\\[([^\\]\\n]+)\\]\\]`, 'g');
  for (const m of text.matchAll(pattern)) {
    const at = m.index ?? 0;
    let node: JSONContent | null = null;
    if (m[1]) {
      const key = `${m[1]} ${m[2]}`;
      const original = ctx.nodes.get(key);
      if (!original) ctx.errors.push(`Unknown token ⟦${key}⟧ (only tokens from read_note can be used).`);
      else if (BLOCK_KINDS[original.type ?? ''] && !inParagraph) ctx.errors.push(`⟦${key}⟧ must be on a line of its own.`);
      else {
        ctx.used.set(key, (ctx.used.get(key) ?? 0) + 1);
        node = clone(original);
      }
    } else if (m[3]) {
      const id = ctx.resolveTitle(m[3].trim());
      if (id) node = { type: 'noteLink', attrs: { noteId: id } };
    }
    if (!node) continue;
    if (at > last) out.push(textNode(text.slice(last, at)));
    out.push(node);
    last = at + m[0].length;
  }
  if (last === 0) return [textNode(text)];
  if (last < text.length) out.push(textNode(text.slice(last)));
  return out;
};

// Puts the original nodes back in place of their tokens. Block tokens inside a paragraph split
// it (the node goes between the parts).
const restoreIn = (nodes: JSONContent[], ctx: Restore): JSONContent[] => nodes.flatMap((node): JSONContent[] => {
  if (node.type === 'text') {
    const parts = splitText(node.text ?? '', ctx, false);
    return parts.map((p) => (p.type === 'text' && node.marks ? { ...p, marks: node.marks } : p));
  }
  if (node.type === 'paragraph' && node.content) {
    const pieces: JSONContent[] = [];
    let run: JSONContent[] = [];
    let split = false;
    const flush = () => {
      if (run.some((n) => n.type !== 'text' || n.text?.trim())) {
        // Text next to a node that split the paragraph loses its spaces there.
        if (split) {
          const first = run[0];
          const last = run[run.length - 1];
          if (first.type === 'text') run[0] = { ...first, text: first.text!.trimStart() };
          if (last.type === 'text') run[run.length - 1] = { ...run[run.length - 1], text: run[run.length - 1].text!.trimEnd() };
        }
        pieces.push({ ...node, content: run.filter((n) => n.type !== 'text' || n.text) });
      }
      run = [];
    };
    for (const child of node.content) {
      if (child.type !== 'text') {
        run.push(...restoreIn([child], ctx));
        continue;
      }
      for (const part of splitText(child.text ?? '', ctx, true)) {
        if (part.type && BLOCK_KINDS[part.type]) {
          split = true;
          flush();
          pieces.push(part);
        } else run.push(part.type === 'text' && child.marks ? { ...part, marks: child.marks } : part);
      }
    }
    flush();
    return pieces.length ? pieces : [{ ...node, content: undefined }];
  }
  return node.content ? [{ ...node, content: restoreIn(node.content, ctx) }] : [node];
});

export type RewriteItem = { keep: number } | { json: JSONContent };

// Claude's Markdown for the whole body -> blocks: unchanged ones by index of the original,
// the rest as new nodes. Fails when an image / drawing / file / reminder of the note is missing
// (unless named in `remove`) or a token is unknown / repeated.
export const parseRewrite = (view: NoteView, markdown: string, resolveTitle: (title: string) => string | null, remove: string[] = []): { items: RewriteItem[] } | { error: string } => {
  const ctx: Restore = { nodes: view.nodes, resolveTitle, used: new Map(), errors: [] };
  const unchanged = new Map<string, number[]>();
  view.blocks.forEach((b, i) => {
    if (b.md) unchanged.set(b.md, [...(unchanged.get(b.md) ?? []), i]);
  });
  const items: RewriteItem[] = [];
  for (const token of marked.lexer(markdown, { gfm: true })) {
    const raw = token.raw.trim();
    if (!raw) continue;
    const same = unchanged.get(raw);
    if (same?.length) {
      const index = same.shift()!;
      items.push({ keep: index });
      // Its tokens count as used.
      for (const m of view.blocks[index].md.matchAll(TOKEN)) ctx.used.set(`${m[1]} ${m[2]}`, (ctx.used.get(`${m[1]} ${m[2]}`) ?? 0) + 1);
      continue;
    }
    const only = TOKEN_ONLY.exec(raw);
    if (only) {
      const key = `${only[1]} ${only[2]}`;
      const original = view.nodes.get(key);
      if (!original) ctx.errors.push(`Unknown token ⟦${key}⟧ (only tokens from read_note can be used).`);
      else {
        ctx.used.set(key, (ctx.used.get(key) ?? 0) + 1);
        items.push({ json: clone(original) });
      }
      continue;
    }
    for (const json of restoreIn(markdownBlocks(raw), ctx)) items.push({ json });
  }
  for (const [key, count] of ctx.used) {
    if (count > 1 && key.startsWith('reminder')) ctx.errors.push(`⟦${key}⟧ is used ${count} times; a reminder can only be in one place.`);
  }
  const missing = [...view.nodes.keys()].filter((key) => !ctx.used.has(key) && !key.startsWith('link') && !remove.includes(key));
  if (missing.length) ctx.errors.push(`Missing: ${missing.map((k) => `⟦${k}⟧`).join(', ')}. Keep every token, or list it in "remove" to delete it.`);
  if (ctx.errors.length) return { error: ctx.errors.join('\n') };
  return { items };
};

// New content (create / append / insert): Markdown -> block nodes, "[[Title]]" links resolved;
// tokens are not allowed (they belong to one note).
export const newBlocks = (markdown: string, resolveTitle: (title: string) => string | null): { blocks: JSONContent[] } | { error: string } => {
  const ctx: Restore = { nodes: new Map(), resolveTitle, used: new Map(), errors: [] };
  const blocks = restoreIn(markdownBlocks(markdown), ctx);
  return ctx.errors.length ? { error: ctx.errors.join('\n') } : { blocks };
};
