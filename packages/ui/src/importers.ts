import { marked } from 'marked';
import { generateJSON } from '@tiptap/core';
import type { JSONContent } from '@tiptap/core';
import * as Y from 'yjs';
import { unzipSync, strFromU8 } from 'fflate';
import { createSchemaExtensions, normalizeTaskListHtml } from '@noted/editor';

// Settings > Importer: notes from files, parsed into the editor's JSON. Files are handed in
// by the app (desktop: dialogs, dropped files + fs), images are stored by the app
// (`storeImage` returns the image's blob attribute), so this module only reads and converts.
// .zip files are unpacked first.

export type ImportSource = 'markdown' | 'text' | 'html' | 'notesnook';

export interface ImportFile {
  // Path relative to the picked folder (or just the file name), with "/" separators.
  path: string;
  text: () => Promise<string>;
  bytes: () => Promise<Uint8Array>;
}

export interface ImportedNote {
  id: string;
  title: string;
  json: JSONContent;
  tags: string[];
  notebook: string | null;
  created: number | null;
  pinned: boolean;
  archived: boolean;
}

export type StoreImage = (bytes: Uint8Array, name: string) => Promise<string | null>;
// Any other file (attachments: videos, PDFs, ...), stored as it is; returns the blob attribute.
export type StoreFile = (bytes: Uint8Array, name: string, mime: string) => Promise<string | null>;

const MIME: Record<string, string> = {
  pdf: 'application/pdf', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav',
  ogg: 'audio/ogg', zip: 'application/zip', txt: 'text/plain', csv: 'text/csv', doc: 'application/msword', epub: 'application/epub+zip',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
const mimeOf = (name: string) => MIME[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
const attachmentHtml = (blob: string, name: string, size: number, mime: string) =>
  `<div data-attachment="" data-blob="${escapeHtml(blob)}" data-name="${escapeHtml(name)}" data-size="${size}" data-mime="${escapeHtml(mime)}">${escapeHtml(name)}</div>`;
// Exported file names may carry an id prefix (Notesnook: "9f86349a57ef5b38-name.png").
const displayName = (path: string) => baseName(decodeURIComponent(path)).replace(/^[0-9a-f]{16}-/, '');
const isLocalTarget = (target: string) => !/^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(target);

// Images and files next to the notes, stored once each however often they are referenced.
// Files referenced by the notes but not among the picked ones (e.g. a note file picked alone,
// without its "attachments" folder).
export interface ImportReport {
  missing: string[];
  // Called before each note file is read (progress and logs in Settings > Importer).
  onFile?: (path: string) => void;
}

// The note files among `files` for a source (what the progress counts).
export const noteFilesFor = (source: ImportSource, files: ImportFile[]): ImportFile[] =>
  files.filter((f) => (source === 'markdown' ? /\.(md|markdown|mdown)$/i : source === 'text' ? /\.txt$/i : source === 'html' ? /\.html?$/i : /\.(md|markdown|mdown|html?|txt)$/i).test(f.path));

const fileStore = (files: ImportFile[], storeImage: StoreImage, storeFile?: StoreFile, report?: ImportReport) => {
  const byName = new Map(files.map((f) => [baseName(f.path).toLowerCase(), f]));
  const stored = new Map<string, Promise<string | null>>();
  const lookup = (target: string) => byName.get(baseName(decodeURIComponent(target)).toLowerCase());
  const find = (target: string) => {
    const file = lookup(target);
    if (!file && report && isLocalTarget(target) && /^\.{0,2}\/|^attachments\//.test(target) && !report.missing.includes(target)) report.missing.push(target);
    return file;
  };
  const store = (target: string, image: boolean) => {
    const file = find(target);
    if (!file) return Promise.resolve(null);
    const key = `${image}:${file.path}`;
    if (!stored.has(key)) {
      const name = displayName(file.path);
      stored.set(key, file.bytes().then((bytes) => (image ? storeImage(bytes, name) : storeFile?.(bytes, name, mimeOf(name)) ?? null)).catch(() => null));
    }
    return stored.get(key)!;
  };
  // HTML for a referenced image / file (null = not found among the files).
  const imageHtml = async (target: string, alt: string, width?: string | null, height?: string | null): Promise<string | null> => {
    const blob = await store(target, true);
    if (!blob) return null;
    return `<img data-blob="${escapeHtml(blob)}" alt="${escapeHtml(alt || displayName(target))}"${width ? ` width="${escapeHtml(width)}"` : ''}${height ? ` height="${escapeHtml(height)}"` : ''}>`;
  };
  const fileHtml = async (target: string): Promise<string | null> => {
    const file = find(target);
    if (!file || !storeFile) return null;
    const blob = await store(target, false);
    if (!blob) return null;
    const name = displayName(file.path);
    return attachmentHtml(blob, name, (await file.bytes()).length, mimeOf(name));
  };
  return { find, imageHtml, fileHtml };
};

const IMAGE = /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i;
const extensions = () => createSchemaExtensions({ ydoc: new Y.Doc(), placeholder: '' });
const baseName = (path: string) => path.split('/').pop() ?? path;
const stem = (path: string) => baseName(path).replace(/\.[^.]+$/, '');
const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const newId = () => crypto.randomUUID();

const normalizeHtml = normalizeTaskListHtml;

const toJson = (html: string): JSONContent => generateJSON(normalizeHtml(html), extensions());

// ---- Markdown (and Obsidian vaults) ----
const frontMatter = (text: string): { data: Record<string, string | string[]>; body: string } => {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { data: {}, body: text };
  const data: Record<string, string | string[]> = {};
  let listKey: string | null = null;
  for (const line of m[1].split(/\r?\n/)) {
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && listKey) {
      (data[listKey] as string[]).push(item[1].trim().replace(/^["']|["']$/g, ''));
      continue;
    }
    const kv = /^([\w-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, key, raw] = kv;
    if (raw === '') { data[key.toLowerCase()] = []; listKey = key.toLowerCase(); continue; }
    listKey = null;
    const value = raw.trim();
    data[key.toLowerCase()] = value.startsWith('[') ? value.slice(1, -1).split(',').map((v) => v.trim().replace(/^["']|["']$/g, '')).filter(Boolean) : value.replace(/^["']|["']$/g, '');
  }
  return { data, body: text.slice(m[0].length) };
};

const asList = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? v.split(/[,\s]+/) : []).map((t) => t.replace(/^#/, '').trim()).filter(Boolean);

// Markdown keeps no empty paragraphs; Notesnook writes each as two more blank lines. Runs of
// blank lines (outside code) become that many empty paragraphs again.
const keepBlankLines = (md: string): string => {
  const out: string[] = [];
  let blank = 0;
  let fence = false;
  for (const line of md.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (!fence && line.trim() === '') { blank++; continue; }
    if (blank > 0) {
      out.push('');
      const empty = out.length > 1 ? Math.floor((blank - 1) / 2) : 0;
      for (let i = 0; i < empty; i++) out.push('<p></p>', '');
    }
    blank = 0;
    out.push(line);
  }
  return out.join('\n');
};

export const importMarkdown = async (files: ImportFile[], storeImage: StoreImage, storeFile?: StoreFile, report?: ImportReport): Promise<ImportedNote[]> => {
  const assets = fileStore(files, storeImage, storeFile, report);
  const notesFiles = files.filter((f) => /\.(md|markdown|mdown)$/i.test(f.path));
  // Ids first, so [[links]] can point to notes imported in the same run. One id per FILE: two
  // notes may share a name in different folders (Notesnook: "Zakupy" in two notebooks).
  // [[Name]] links go to the first note with that name.
  const fileIds = new Map(notesFiles.map((f) => [f.path, newId()]));
  const ids = new Map<string, string>();
  for (const f of notesFiles) {
    const key = stem(f.path).toLowerCase();
    if (!ids.has(key)) ids.set(key, fileIds.get(f.path)!);
  }
  const image = async (target: string, alt: string): Promise<string> => {
    const name = baseName(decodeURIComponent(target)).toLowerCase();
    if (/^https?:\/\//i.test(target)) return `<img src="${escapeHtml(target)}" alt="${escapeHtml(alt)}">`;
    const file = assets.find(target);
    if (!file || !IMAGE.test(name)) return escapeHtml(alt || target);
    return (await assets.imageHtml(target, alt)) ?? escapeHtml(alt || target);
  };

  const notes: ImportedNote[] = [];
  for (const file of notesFiles) {
    report?.onFile?.(file.path);
    const { data, body } = frontMatter(await file.text());
    let md = body;
    const tags = new Set(asList(data.tags ?? data.tag));
    // Obsidian: #tags in the text (outside code), [[links]] and ![[embeds]].
    md.replace(/```[\s\S]*?```|`[^`]*`/g, '').replace(/(^|\s)#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/gu, (_m, _s, tag: string) => { tags.add(tag); return ''; });
    const embeds: [string, string][] = [];
    for (const m of md.matchAll(/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)) embeds.push([m[0], await image(m[1].trim(), '')]);
    // ![alt](path) and ![alt](<path with spaces> "title").
    for (const m of md.matchAll(/!\[([^\]]*)\]\((?:<([^>]+)>|([^)\s]+))(?:\s+"[^"]*")?\)/g)) embeds.push([m[0], await image(m[2] ?? m[3], m[1])]);
    for (const [from, to] of embeds) md = md.split(from).join(to);
    // Links to files next to the note (attachments): the files themselves.
    const fileLinks: [string, string][] = [];
    for (const m of md.matchAll(/\[([^\]]*)\]\((?:<([^>]+)>|([^)\s]+))(?:\s+"[^"]*")?\)/g)) {
      const target = m[2] ?? m[3];
      if (!isLocalTarget(target) || !assets.find(target)) continue;
      const html = IMAGE.test(target) ? await assets.imageHtml(target, m[1]) : await assets.fileHtml(target);
      if (html) fileLinks.push([m[0], html]);
    }
    for (const [from, to] of fileLinks) md = md.split(from).join(to);
    md = md.replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_m, target: string, alias?: string) => {
      const id = ids.get(target.trim().toLowerCase());
      return id ? `<span data-note-link="" data-note-id="${id}"></span>` : escapeHtml(alias ?? target);
    });
    // The first heading is the title when there is no other.
    // The first heading is the title when there is no other, and is dropped when it repeats
    // the front matter's title (Notesnook writes both).
    let title = typeof data.title === 'string' ? data.title : '';
    const h1 = /^\s*#\s+(.+?)\s*(\r?\n|$)/.exec(md);
    if (h1 && (!title || h1[1].trim() === title.trim())) {
      title = h1[1].trim();
      md = md.slice(h1[0].length);
    }
    const createdText = data.created ?? data.created_at ?? data.date;
    const created = typeof createdText === 'string' ? Date.parse(createdText) : NaN;
    const folders = file.path.split('/').slice(0, -1);
    notes.push({
      id: fileIds.get(file.path)!,
      title: title || stem(file.path),
      json: toJson(await marked.parse(keepBlankLines(md), { gfm: true, breaks: false })),
      tags: [...tags],
      notebook: folders[0] ?? null,
      created: Number.isNaN(created) ? null : created,
      pinned: data.pinned === 'true',
      archived: false,
    });
  }
  return notes;
};

// ---- plain text and HTML files ----
// Plain text: one paragraph per line, spaces and tabs at the start kept (indentation), built
// as JSON directly (HTML parsing would collapse the whitespace). Lines that look like list
// items ("- ", "* ", "• ", "1. ") or checkboxes ("[ ]", "[x]", "☐", "☑", "✓") become lists and
// task lists, nested by their indentation.
type TextItem = { kind: 'task' | 'bullet' | 'number'; indent: number; checked: boolean; text: string };

const TASK_LINE = /^([ \t]*)(?:[-*•]\s+)?(?:\[([ xX✓✔])\]|([☐☑☒✓✔✅]))\s?(.*)$/;
const BULLET_LINE = /^([ \t]*)[-*•]\s+(.*)$/;
const NUMBER_LINE = /^([ \t]*)\d+[.)]\s+(.*)$/;
const indentWidth = (ws: string) => ws.replace(/\t/g, '    ').length;

const listItem = (line: string): TextItem | null => {
  const task = TASK_LINE.exec(line);
  if (task) {
    const mark = task[2] ?? task[3];
    return { kind: 'task', indent: indentWidth(task[1]), checked: !!mark && mark !== ' ' && mark !== '☐', text: task[4] };
  }
  const bullet = BULLET_LINE.exec(line);
  if (bullet) return { kind: 'bullet', indent: indentWidth(bullet[1]), checked: false, text: bullet[2] };
  const number = NUMBER_LINE.exec(line);
  if (number) return { kind: 'number', indent: indentWidth(number[1]), checked: false, text: number[2] };
  return null;
};

// Web addresses in the text become links.
// Notesnook's text export writes a link as "text [address]" (the word before it is linked).
const URL_IN_TEXT = /(\S+) \[((?:https?:\/\/)?[\w-]+(?:\.[\w-]+)+[^\s\]]*)\]|https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]]/g;
const inline = (text: string): JSONContent[] => {
  const out: JSONContent[] = [];
  let at = 0;
  for (const m of text.matchAll(URL_IN_TEXT)) {
    if (m.index! > at) out.push({ type: 'text', text: text.slice(at, m.index) });
    if (m[1]) {
      const href = /^https?:\/\//i.test(m[2]) ? m[2] : `https://${m[2]}`;
      out.push({ type: 'text', text: m[1], marks: [{ type: 'link', attrs: { href } }] });
    } else out.push({ type: 'text', text: m[0], marks: [{ type: 'link', attrs: { href: m[0] } }] });
    at = m.index! + m[0].length;
  }
  if (at < text.length) out.push({ type: 'text', text: text.slice(at) });
  return out;
};
const paragraph = (text: string): JSONContent => (text ? { type: 'paragraph', content: inline(text) } : { type: 'paragraph' });

const buildLists = (items: TextItem[]): JSONContent[] => {
  const out: JSONContent[] = [];
  let i = 0;
  while (i < items.length) {
    const base = items[i].indent;
    const kind = items[i].kind;
    const entries: JSONContent[] = [];
    while (i < items.length && items[i].indent === base && items[i].kind === kind) {
      const item = items[i++];
      const children: TextItem[] = [];
      while (i < items.length && items[i].indent > base) children.push(items[i++]);
      const content = [paragraph(item.text), ...buildLists(children)];
      entries.push(kind === 'task' ? { type: 'taskItem', attrs: { checked: item.checked }, content } : { type: 'listItem', content });
    }
    out.push({ type: kind === 'task' ? 'taskList' : kind === 'bullet' ? 'bulletList' : 'orderedList', content: entries });
  }
  return out;
};

export const textToJson = (text: string): JSONContent => {
  const content: JSONContent[] = [];
  let run: TextItem[] = [];
  const flush = () => { if (run.length) content.push(...buildLists(run)); run = []; };
  // Blank lines: one separates paragraphs, every two more are an empty paragraph (that is how
  // Notesnook writes empty lines into text files).
  let blank = 0;
  for (const line of text.replace(/\r\n?/g, '\n').replace(/\s+$/, '').split('\n')) {
    if (line.trim() === '') { blank++; continue; }
    if (blank > 0) {
      flush();
      if (content.length) for (let i = 0; i < Math.floor(blank / 2); i++) content.push({ type: 'paragraph' });
      blank = 0;
    }
    const item = listItem(line);
    if (item) { run.push(item); continue; }
    flush();
    content.push(paragraph(line.replace(/^[ \t]+/, (ws) => ws.replace(/ {4}/g, '\t'))));
  }
  flush();
  return { type: 'doc', content };
};

export const importText = async (files: ImportFile[], report?: ImportReport): Promise<ImportedNote[]> => Promise.all(files.filter((f) => /\.txt$/i.test(f.path)).map(async (f) => {
  report?.onFile?.(f.path);
  let text = await f.text();
  // Notesnook's text export starts with the title on its own line.
  const first = /^([^\n]*)\n/.exec(text);
  if (first && first[1].trim() === stem(f.path).trim()) text = text.slice(first[0].length).replace(/^\s*\n/, '');
  return { id: newId(), title: stem(f.path), json: textToJson(text), tags: [], notebook: f.path.split('/').slice(0, -1)[0] ?? null, created: null, pinned: false, archived: false };
}));

export const importHtml = async (files: ImportFile[], storeImage: StoreImage, storeFile?: StoreFile, report?: ImportReport): Promise<ImportedNote[]> => {
  const assets = fileStore(files, storeImage, storeFile, report);
  const notes: ImportedNote[] = [];
  for (const f of files.filter((x) => /\.html?$/i.test(x.path))) {
    report?.onFile?.(f.path);
    const doc = new DOMParser().parseFromString(await f.text(), 'text/html');
    // Notesnook wraps images in an inline span; the image is a block of its own here.
    doc.querySelectorAll('span.image-container').forEach((span) => span.replaceWith(...Array.from(span.childNodes)));
    for (const img of [...doc.querySelectorAll('img')]) {
      const src = img.getAttribute('src') ?? '';
      if (/^(https?:|data:)/i.test(src)) continue;
      const html = await assets.imageHtml(src, img.getAttribute('alt') ?? '', img.getAttribute('width'), img.getAttribute('height'));
      if (html) img.outerHTML = html; else img.remove();
    }
    // Links to files next to the note (attachments): the files themselves, as their own block.
    for (const a of [...doc.querySelectorAll('a[href]')]) {
      const href = a.getAttribute('href') ?? '';
      if (!isLocalTarget(href) || !assets.find(href)) continue;
      const html = IMAGE.test(href) ? await assets.imageHtml(href, a.textContent ?? '') : await assets.fileHtml(href);
      if (!html) continue;
      const block = a.parentElement && a.parentElement.tagName === 'P' && a.parentElement.textContent?.trim() === a.textContent?.trim() ? a.parentElement : a;
      block.outerHTML = html;
    }
    const h1 = doc.querySelector('h1');
    const title = doc.title.trim() || h1?.textContent?.trim() || stem(f.path);
    if (h1 && h1.textContent?.trim() === title) h1.remove();
    notes.push({ id: newId(), title, json: toJson(doc.body.innerHTML), tags: [], notebook: f.path.split('/').slice(0, -1)[0] ?? null, created: null, pinned: false, archived: false });
  }
  return notes;
};

// ---- Notesnook ("Export all notes" as Markdown, HTML or text: a zip or its folder) ----
export const importNotesnook = async (files: ImportFile[], storeImage: StoreImage, storeFile?: StoreFile, report?: ImportReport): Promise<ImportedNote[]> => [
  ...await importMarkdown(files, storeImage, storeFile, report),
  ...await importHtml(files, storeImage, storeFile, report),
  ...await importText(files, report),
];

// .zip files become the files inside them (paths inside the zip, so its folders become notebooks).
export const expandZips = async (files: ImportFile[]): Promise<ImportFile[]> => {
  const out: ImportFile[] = [];
  for (const f of files) {
    if (!/\.zip$/i.test(f.path)) { out.push(f); continue; }
    const entries = unzipSync(await f.bytes());
    for (const [name, data] of Object.entries(entries)) {
      if (name.endsWith('/') || name.startsWith('__MACOSX/') || baseName(name).startsWith('.')) continue;
      out.push({ path: name, text: async () => strFromU8(data), bytes: async () => data });
    }
  }
  return out;
};

export const IMPORT_SOURCES: { id: ImportSource; label: string; files: string; description: string; extensions: string[] }[] = [
  { id: 'markdown', label: 'Markdown', files: 'Markdown files', description: 'Folders become notebooks; front matter, #tags, [[links]] (Obsidian) and images next to the files are kept.', extensions: ['md', 'markdown', 'mdown'] },
  { id: 'text', label: 'Plain text', files: 'text files', description: 'Each file becomes a note; folders become notebooks.', extensions: ['txt'] },
  { id: 'html', label: 'HTML', files: 'HTML files', description: 'Images next to the files are imported too; folders become notebooks.', extensions: ['html', 'htm'] },
  { id: 'notesnook', label: 'Notesnook', files: 'a Notesnook export', description: 'In Notesnook: Settings > Backup & export > Export all notes (Markdown, HTML or Text). Pick the zip it saves. Notebooks, tags, pins and images come along.', extensions: ['md', 'markdown', 'html', 'htm', 'txt'] },
];

export const parseImport = async (source: ImportSource, picked: ImportFile[], storeImage: StoreImage, storeFile?: StoreFile, report?: ImportReport): Promise<ImportedNote[]> => {
  const files = await expandZips(picked);
  switch (source) {
    case 'markdown': return importMarkdown(files, storeImage, storeFile, report);
    case 'text': return importText(files, report);
    case 'html': return importHtml(files, storeImage, storeFile, report);
    case 'notesnook': return importNotesnook(files, storeImage, storeFile, report);
  }
};
