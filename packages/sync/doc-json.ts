import * as Y from 'yjs';

// The note body (Y.XmlFragment "default", written by the editor's Yjs binding) as ProseMirror
// JSON, without an editor or a DOM, so React Native can export notes too. Same mapping as
// y-prosemirror: elements -> nodes with their attributes, text deltas -> text nodes whose
// attributes are marks (a mark that may occur several times is stored as "name--hash").

type Json = { type: string; attrs?: Record<string, unknown>; content?: Json[]; text?: string; marks?: { type: string; attrs?: Record<string, unknown> }[] };

const markName = (key: string) => key.split('--')[0];

const element = (el: Y.XmlElement): Json => {
  const attrs = el.getAttributes() as Record<string, unknown>;
  const content = children(el);
  return { type: el.nodeName, ...(Object.keys(attrs).length ? { attrs } : {}), ...(content.length ? { content } : {}) };
};

const text = (t: Y.XmlText): Json[] => (t.toDelta() as { insert: unknown; attributes?: Record<string, unknown> }[])
  .filter((d) => typeof d.insert === 'string' && d.insert.length > 0)
  .map((d) => {
    const marks = Object.entries(d.attributes ?? {}).map(([key, value]) => {
      const attrs = value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
      return { type: markName(key), ...(attrs && Object.keys(attrs).length ? { attrs } : {}) };
    });
    return { type: 'text', text: d.insert as string, ...(marks.length ? { marks } : {}) };
  });

const children = (parent: Y.XmlFragment | Y.XmlElement): Json[] => parent.toArray().flatMap((child) => {
  if (child instanceof Y.XmlElement) return [element(child)];
  if (child instanceof Y.XmlText) return text(child);
  return [];
});

export const noteBodyJson = (doc: Y.Doc): Json => ({ type: 'doc', content: children(doc.getXmlFragment('default')) });

// Blob ids (images, attachments) referenced by a note body.
export const noteBlobIds = (json: Json): string[] => {
  const ids: string[] = [];
  const walk = (node: Json) => {
    const blob = node.attrs?.blob;
    if (typeof blob === 'string' && blob.includes(':')) ids.push(blob.split(':')[0]);
    node.content?.forEach(walk);
  };
  walk(json);
  return ids;
};

// Files and images of a note body, in document order (note properties "Attachments").
export interface NoteAttachment {
  kind: 'file' | 'image';
  // "<id>:<key>" as stored in the node.
  blob: string;
  name: string;
  size: number | null;
}
export const noteAttachments = (json: Json): NoteAttachment[] => {
  const out: NoteAttachment[] = [];
  let images = 0;
  const walk = (node: Json) => {
    const blob = node.attrs?.blob;
    if (typeof blob === 'string' && blob.includes(':')) {
      if (node.type === 'attachment') {
        const size = Number(node.attrs?.size);
        out.push({ kind: 'file', blob, name: String(node.attrs?.name || 'File'), size: Number.isFinite(size) ? size : null });
      } else if (node.type === 'image') {
        images++;
        const alt = node.attrs?.alt;
        out.push({ kind: 'image', blob, name: typeof alt === 'string' && alt ? alt : `Image ${images}`, size: null });
      }
    }
    node.content?.forEach(walk);
  };
  walk(json);
  return out;
};

// Plain text of a note body (search): blocks separated by new lines.
export const noteBodyText = (json: Json): string => {
  const parts: string[] = [];
  const walk = (node: Json) => {
    if (typeof node.text === 'string') parts.push(node.text);
    else if (node.type === 'hardBreak') parts.push('\n');
    const latex = node.attrs?.latex;
    if (typeof latex === 'string') parts.push(latex);
    node.content?.forEach(walk);
    if (node.content && node.type !== 'doc' && !['text', 'hardBreak'].includes(node.type ?? '')) parts.push('\n');
  };
  walk(json);
  return parts.join('').replace(/\n{2,}/g, '\n').trim();
};
