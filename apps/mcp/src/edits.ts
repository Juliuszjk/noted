import * as Y from 'yjs';
import type { JSONContent } from '@tiptap/core';
import { jsonToY } from '@noted/sync/json-to-y';
import { NOTE_LINK, type RewriteItem } from './markdown';

// Changes of a note body made in the Yjs doc itself, touching only what changes, so concurrent
// edits on other devices merge as usual and everything else (images, drawings, formatting)
// stays as it is.

const body = (doc: Y.Doc) => doc.getXmlFragment('default');

const LISTS = new Set(['bulletList', 'orderedList', 'taskList']);

// Plain text of a node (atoms left out).
export const plainText = (node: Y.XmlElement | Y.XmlText | Y.XmlFragment): string => {
  if (node instanceof Y.XmlText) return deltaText(node);
  return node.toArray().map((child) => (child instanceof Y.XmlElement || child instanceof Y.XmlText ? plainText(child) : '')).join(
    node instanceof Y.XmlElement && ['paragraph', 'heading', 'codeBlock'].includes(node.nodeName) ? '' : '\n',
  );
};
const deltaText = (text: Y.XmlText): string =>
  (text.toDelta() as { insert: unknown }[]).map((d) => (typeof d.insert === 'string' ? d.insert : '')).join('');

const texts = (node: Y.XmlFragment | Y.XmlElement): Y.XmlText[] => node.toArray().flatMap((child) => {
  if (child instanceof Y.XmlText) return [child];
  if (child instanceof Y.XmlElement) return texts(child);
  return [];
});

// The formatting of the character at `index` (or of the one before, at the end).
const formatAt = (text: Y.XmlText, index: number): Record<string, unknown> | undefined => {
  let at = 0;
  let last: Record<string, unknown> | undefined;
  for (const d of text.toDelta() as { insert: unknown; attributes?: Record<string, unknown> }[]) {
    const length = typeof d.insert === 'string' ? d.insert.length : 1;
    if (index < at + length) return d.attributes;
    last = d.attributes;
    at += length;
  }
  return last;
};

// Puts a note link in place of `length` characters at `index`: the text after them moves to a
// new Y.XmlText behind the link (inline nodes are siblings of the text runs).
const insertLink = (text: Y.XmlText, index: number, length: number, noteId: string) => {
  const parent = text.parent as Y.XmlElement;
  // (A Y.XmlText not in a doc yet reports length 0, so count by hand.)
  const tail = new Y.XmlText();
  let tailLength = 0;
  let at = 0;
  for (const d of text.toDelta() as { insert: unknown; attributes?: Record<string, unknown> }[]) {
    if (typeof d.insert !== 'string') continue;
    const rest = d.insert.slice(Math.max(index + length - at, 0));
    if (rest) tail.insert(tailLength, rest, d.attributes ?? {});
    tailLength += rest.length;
    at += d.insert.length;
  }
  text.delete(index, text.length - index);
  const link = new Y.XmlElement('noteLink');
  link.setAttribute('noteId', noteId);
  const position = parent.toArray().indexOf(text);
  if (!text.length) parent.delete(position, 1);
  parent.insert(text.length ? position + 1 : position, tailLength ? [link, tail] : [link]);
};

// Replaces `find` with `replace` inside lines of text (not across a reminder or link). Every
// occurrence when `all`, otherwise `find` must occur once. "[[Title]]" in `replace` becomes a
// link when `resolveTitle` knows the title; the ones it does not know are returned in `unlinked`.
export const replaceText = (doc: Y.Doc, find: string, replace: string, all = false, resolveTitle: (title: string) => string | null = () => null): { count: number; unlinked: string[] } | { error: string } => {
  if (!find) return { error: 'The text to find is empty.' };
  if (find.includes('\n') || replace.includes('\n')) return { error: 'replace_text works inside one line; use rewrite_note or insert for several lines.' };
  const hits: { text: Y.XmlText; index: number }[] = [];
  for (const text of texts(body(doc))) {
    const value = deltaText(text);
    for (let i = value.indexOf(find); i >= 0; i = value.indexOf(find, i + find.length)) hits.push({ text, index: i });
  }
  if (!hits.length) return { error: `"${find}" is not in the note (text across a reminder, link or line break cannot be matched).` };
  if (hits.length > 1 && !all) return { error: `"${find}" occurs ${hits.length} times: give more text around it, or set all: true.` };
  const links = [...replace.matchAll(NOTE_LINK)].map((m) => ({ at: m.index ?? 0, length: m[0].length, title: m[1].trim(), id: resolveTitle(m[1].trim()) }));
  doc.transact(() => {
    // From the end, so earlier hits keep their text and index.
    for (const { text, index } of hits.reverse()) {
      const format = formatAt(text, index);
      text.delete(index, find.length);
      if (replace) text.insert(index, replace, format ? { ...format } : {});
      // Code holds only text: "[[...]]" there stays literal.
      if (format?.code || (text.parent as Y.XmlElement | null)?.nodeName === 'codeBlock') continue;
      for (const link of [...links].reverse()) if (link.id) insertLink(text, index + link.at, link.length, link.id);
    }
  });
  return { count: hits.length, unlinked: links.filter((l) => !l.id).map((l) => l.title) };
};

// Index of the top-level block whose text contains `anchor` (must be one).
export const findBlock = (doc: Y.Doc, anchor: string): { index: number } | { error: string } => {
  const blocks = body(doc).toArray();
  const found = blocks.flatMap((b, index) => (b instanceof Y.XmlElement && plainText(b).includes(anchor) ? [index] : []));
  if (!found.length) return { error: `No block contains "${anchor}".` };
  if (found.length > 1) return { error: `"${anchor}" is in ${found.length} blocks: give more text.` };
  return { index: found[0] };
};

// Inserts blocks at a top-level position. Items of a list that lands right after a list of the
// same kind join that list.
export const insertBlocks = (doc: Y.Doc, index: number, blocks: JSONContent[]): void => {
  if (!blocks.length) return;
  doc.transact(() => {
    const fragment = body(doc);
    let rest = blocks;
    const before = index > 0 ? fragment.get(index - 1) : null;
    const first = rest[0];
    if (before instanceof Y.XmlElement && first.type && LISTS.has(first.type) && before.nodeName === first.type && first.content?.length) {
      before.insert(before.length, jsonToY(first.content));
      rest = rest.slice(1);
    }
    if (rest.length) fragment.insert(index, jsonToY(rest));
  });
};

// Ticks / unticks the task whose text contains `text` (must be one).
export const setTaskDone = (doc: Y.Doc, text: string, done: boolean): { ok: true } | { error: string } => {
  const items: Y.XmlElement[] = [];
  const walk = (node: Y.XmlFragment | Y.XmlElement) => {
    for (const child of node.toArray()) {
      if (!(child instanceof Y.XmlElement)) continue;
      if (child.nodeName === 'taskItem') {
        // The item's own line, not its nested items.
        const own = child.toArray().find((c) => c instanceof Y.XmlElement && c.nodeName === 'paragraph');
        if (own instanceof Y.XmlElement && plainText(own).includes(text)) items.push(child);
      }
      walk(child);
    }
  };
  walk(body(doc));
  if (!items.length) return { error: `No task contains "${text}".` };
  if (items.length > 1) return { error: `"${text}" is in ${items.length} tasks: give more text.` };
  doc.transact(() => items[0].setAttribute('checked', done as unknown as string));
  return { ok: true };
};

// Longest run of kept blocks that stay in their order (they are left alone; the rest is
// deleted and inserted).
const stayingInOrder = (indices: number[]): Set<number> => {
  const tails: number[] = [];
  const tailAt: number[] = [];
  const prev: number[] = new Array(indices.length).fill(-1);
  indices.forEach((value, i) => {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid] < value) lo = mid + 1;
      else hi = mid;
    }
    tails[lo] = value;
    tailAt[lo] = i;
    prev[i] = lo > 0 ? tailAt[lo - 1] : -1;
  });
  const keep = new Set<number>();
  for (let i = tails.length ? tailAt[tails.length - 1] : -1; i >= 0; i = prev[i]) keep.add(indices[i]);
  return keep;
};

// Applies a parsed rewrite: originals kept in order stay untouched, everything else is
// replaced.
export const applyRewrite = (doc: Y.Doc, items: RewriteItem[], originals: JSONContent[]): void => {
  const kept = items.flatMap((item) => ('keep' in item ? [item.keep] : []));
  const stay = stayingInOrder(kept);
  doc.transact(() => {
    const fragment = body(doc);
    for (let i = fragment.length - 1; i >= 0; i--) if (!stay.has(i)) fragment.delete(i, 1);
    let at = 0;
    const pending: JSONContent[] = [];
    const flush = () => {
      if (!pending.length) return;
      fragment.insert(at, jsonToY(pending));
      at += pending.length;
      pending.length = 0;
    };
    for (const item of items) {
      if ('keep' in item && stay.has(item.keep)) {
        flush();
        at++;
        stay.delete(item.keep);
      } else pending.push('keep' in item ? originals[item.keep] : item.json);
    }
    flush();
    if (!fragment.length) fragment.insert(0, [new Y.XmlElement('paragraph')]);
  });
};
