import type { JSONContent } from '@tiptap/core';
import { isReminderRepeat, reminderPlainText } from './reminder-time';
import { drawingSvg, strokeData } from './drawing-render';

// Export of a note (the editor's JSON) as Markdown or plain text. Pure functions, tested in
// export.test.ts. Images are encrypted blobs without an address, so they become a placeholder.

export type ExportFormat = 'markdown' | 'text';

interface Ctx {
  format: ExportFormat;
  // Note link targets: id -> current title.
  titles: Record<string, string>;
  // Exported images / files: blob attribute -> path relative to the note ("attachments/…").
  files: Record<string, string>;
  // Copying to the clipboard: every block on its own line (one line break, no blank line).
  tight?: boolean;
}
const fileUrl = (path: string) => `<./${path.replace(/>/g, '%3E')}>`;

const CALLOUT_ALERTS: Record<string, string> = { info: 'NOTE', tip: 'TIP', warning: 'WARNING', danger: 'CAUTION', note: 'NOTE' };

const escapeMd = (text: string) => text.replace(/([\\`*_[\]<|~])/g, '\\$1');

const inline = (nodes: JSONContent[] | undefined, ctx: Ctx): string => (nodes ?? []).map((n) => inlineNode(n, ctx)).join('');

const inlineNode = (node: JSONContent, ctx: Ctx): string => {
  const md = ctx.format === 'markdown';
  switch (node.type) {
    case 'text': {
      const marks = node.marks ?? [];
      const has = (type: string) => marks.some((m) => m.type === type);
      if (!md) return node.text ?? '';
      if (has('code')) return `\`${node.text ?? ''}\``;
      let text = escapeMd(node.text ?? '');
      // Markdown emphasis must hug the text: spaces stay outside of the markers.
      const lead = /^\s*/.exec(text)![0];
      const trail = /\s*$/.exec(text.slice(lead.length))![0];
      let core = text.slice(lead.length, text.length - trail.length);
      if (!core) return text;
      if (has('subscript')) core = `<sub>${core}</sub>`;
      if (has('superscript')) core = `<sup>${core}</sup>`;
      if (has('underline')) core = `<u>${core}</u>`;
      if (has('highlight')) core = `==${core}==`;
      if (has('strike')) core = `~~${core}~~`;
      if (has('italic')) core = `*${core}*`;
      if (has('bold')) core = `**${core}**`;
      const link = marks.find((m) => m.type === 'link');
      if (link?.attrs?.href) core = `[${core}](${String(link.attrs.href).replace(/[()\s]/g, encodeURIComponent)})`;
      text = lead + core + trail;
      return text;
    }
    case 'hardBreak':
      return md ? '  \n' : '\n';
    case 'inlineMath':
      // Copied text keeps the dollars: pasted into a chat, a Markdown file or back into a note
      // it is a formula again.
      return md || ctx.tight ? `$${node.attrs?.latex ?? ''}$` : String(node.attrs?.latex ?? '');
    case 'noteLink': {
      const title = ctx.titles[String(node.attrs?.noteId ?? '')] ?? 'Missing note';
      return md ? `[[${title}]]` : title;
    }
    case 'reminder': {
      const text = reminderPlainText({
        at: Number(node.attrs?.at) || 0, repeat: isReminderRepeat(node.attrs?.repeat) ? node.attrs.repeat : null, done: node.attrs?.done === true,
      });
      return md && node.attrs?.done ? `~~${text}~~` : text;
    }
    case 'image': {
      const alt = escapeMd(String(node.attrs?.alt ?? 'image'));
      const file = ctx.files[String(node.attrs?.blob ?? '')];
      return md ? `![${alt}](${file ? fileUrl(file) : ''})` : '[image]';
    }
    default:
      return inline(node.content, ctx);
  }
};

const indentLines = (text: string, first: string, rest: string) =>
  text.split('\n').map((line, i) => (i === 0 ? first : line ? rest : '') + line).join('\n');

// Children of a container joined as blocks (a blank line between them; tight inside lists).
// Page breaks are left out: only the PDF knows pages.
const blocks = (nodes: JSONContent[] | undefined, ctx: Ctx, tight = false): string =>
  (nodes ?? []).filter((n) => n.type !== 'pageBreak').map((n) => block(n, ctx)).filter((b) => b !== null).join(tight || ctx.tight ? '\n' : '\n\n');

// Following lines of an item are indented by the marker's width; `restWidth` overrides it
// (a task item's content starts after "- ", not after "- [ ] ": deeper is a code block).
const listItems = (node: JSONContent, ctx: Ctx, marker: (i: number, item: JSONContent) => string, restWidth?: number): string =>
  (node.content ?? []).map((item, i) => {
    const m = marker(i, item);
    return indentLines(blocks(item.content, ctx, true), m, ' '.repeat(restWidth ?? m.length));
  }).join('\n');

const cellText = (cell: JSONContent, ctx: Ctx) =>
  blocks(cell.content, ctx, true).replace(/\n+/g, ctx.format === 'markdown' ? '<br>' : ' ');

const block = (node: JSONContent, ctx: Ctx): string => {
  const md = ctx.format === 'markdown';
  switch (node.type) {
    case 'paragraph':
      return inline(node.content, ctx);
    case 'heading': {
      const text = inline(node.content, ctx);
      return md ? `${'#'.repeat(Number(node.attrs?.level ?? 1))} ${text}` : text;
    }
    case 'blockquote':
      return indentLines(blocks(node.content, ctx), '> ', '> ').replace(/^$/gm, '>');
    case 'callout': {
      const body = blocks(node.content, ctx);
      if (!md) return body;
      const alert = CALLOUT_ALERTS[String(node.attrs?.variant ?? 'info')] ?? 'NOTE';
      return [`> [!${alert}]`, ...body.split('\n').map((l) => (l ? `> ${l}` : '>'))].join('\n');
    }
    case 'bulletList':
      return listItems(node, ctx, () => (md ? '- ' : '• '));
    case 'orderedList': {
      const start = Number(node.attrs?.start ?? 1);
      return listItems(node, ctx, (i) => `${start + i}. `);
    }
    case 'taskList':
      return listItems(node, ctx, (_, item) => (md ? (item.attrs?.checked ? '- [x] ' : '- [ ] ') : item.attrs?.checked ? '☑ ' : '☐ '), md ? 2 : undefined);
    case 'codeBlock': {
      const code = (node.content ?? []).map((t) => t.text ?? '').join('');
      if (!md) return code;
      const fence = code.includes('```') ? '~~~' : '```';
      return `${fence}${node.attrs?.language ?? ''}\n${code}\n${fence}`;
    }
    case 'horizontalRule':
      return md ? '---' : '────────';
    case 'blockMath':
      return md || ctx.tight ? `$$\n${node.attrs?.latex ?? ''}\n$$` : String(node.attrs?.latex ?? '');
    case 'image':
      return inlineNode(node, ctx);
    case 'attachment': {
      const name = String(node.attrs?.name ?? 'file');
      const file = ctx.files[String(node.attrs?.blob ?? '')];
      if (md && file) return `[${escapeMd(name)}](${fileUrl(file)} "${name.replace(/"/g, "'")}")`;
      return md ? `*Attachment: ${escapeMd(name)}*` : `[Attachment: ${name}]`;
    }
    case 'drawing': {
      // Markdown allows HTML: the drawing goes in as an inline SVG.
      if (!md) return '[drawing]';
      const strokes = (node.content ?? []).filter((c) => c.type === 'drawingStroke').map((c) => strokeData(c.attrs ?? {}));
      return drawingSvg(node.attrs?.height, strokes);
    }
    case 'table': {
      const rows = (node.content ?? []).map((row) => (row.content ?? []).map((cell) => cellText(cell, ctx)));
      if (!rows.length) return '';
      if (!md) return rows.map((r) => r.join('\t')).join('\n');
      const width = Math.max(...rows.map((r) => r.length));
      const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? '').join(' | ')} |`;
      return [line(rows[0]), `|${' --- |'.repeat(width)}`, ...rows.slice(1).map(line)].join('\n');
    }
    default:
      return node.content ? blocks(node.content, ctx) : inlineNode(node, ctx);
  }
};

// The whole note: the title as the first heading (Markdown) or line (text), then the body.
export const exportNote = (title: string, doc: JSONContent, format: ExportFormat, titles: Record<string, string> = {}, files: Record<string, string> = {}): string => {
  const ctx: Ctx = { format, titles, files };
  const body = blocks(doc.content, ctx).replace(/\n{3,}/g, '\n\n').trim();
  const head = title.trim() ? (format === 'markdown' ? `# ${escapeMd(title.trim())}` : title.trim()) : '';
  return `${[head, body].filter(Boolean).join('\n\n')}\n`;
};

// A file name for the exported note (no path separators or characters Android rejects).
export const exportFileName = (title: string, extension: string): string => {
  const base = title.trim().replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return `${base || 'Untitled'}.${extension}`;
};

// Plain text of copied content (the clipboard's text/plain): blocks one per line like in the
// note, lists with their markers. `inlineOnly` = content from inside one text block.
export const clipboardText = (nodes: JSONContent[], titles: Record<string, string> = {}, inlineOnly = false): string => {
  const ctx: Ctx = { format: 'text', titles, files: {}, tight: true };
  return inlineOnly ? inline(nodes, ctx) : blocks(nodes, ctx);
};
