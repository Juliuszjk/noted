import * as Y from 'yjs';

// ProseMirror JSON -> the note body (Y.XmlFragment "default"), the way the editor's Yjs binding
// stores it: elements with their (non-null) attributes, runs of text as one Y.XmlText whose
// formatting attributes are the marks. Inverse of doc-json.ts; used by the importer and
// locked notes, without an editor.

type Json = { type?: string; attrs?: Record<string, unknown>; content?: Json[]; text?: string; marks?: { type: string; attrs?: Record<string, unknown> }[] };

const textRun = (nodes: Json[]): Y.XmlText => {
  const text = new Y.XmlText();
  const keys = new Set(nodes.flatMap((n) => (n.marks ?? []).map((m) => m.type)));
  let at = 0;
  for (const n of nodes) {
    const value = n.text ?? '';
    if (!value) continue;
    const format: Record<string, unknown> = {};
    for (const key of keys) format[key] = null;
    for (const m of n.marks ?? []) format[m.type] = m.attrs ?? {};
    text.insert(at, value, format);
    at += value.length;
  }
  return text;
};

const toY = (nodes: Json[]): (Y.XmlElement | Y.XmlText)[] => {
  const out: (Y.XmlElement | Y.XmlText)[] = [];
  let run: Json[] = [];
  const flush = () => {
    if (run.length) out.push(textRun(run));
    run = [];
  };
  for (const node of nodes) {
    if (node.type === 'text') {
      run.push(node);
      continue;
    }
    flush();
    if (!node.type) continue;
    const el = new Y.XmlElement(node.type);
    for (const [key, value] of Object.entries(node.attrs ?? {})) {
      if (value !== null && value !== undefined) el.setAttribute(key, value as string);
    }
    const children = toY(node.content ?? []);
    if (children.length) el.insert(0, children);
    out.push(el);
  }
  flush();
  return out;
};

// Replaces the body of `doc` with `json` (a "doc" node).
export const setNoteBodyJson = (doc: Y.Doc, json: Json, origin?: unknown): void => {
  doc.transact(() => {
    const body = doc.getXmlFragment('default');
    if (body.length) body.delete(0, body.length);
    const nodes = toY(json.content ?? []);
    if (nodes.length) body.insert(0, nodes);
  }, origin);
};

// Appends `blocks` (ProseMirror JSON block nodes) at the end of the note body.
export const appendNoteBlocks = (doc: Y.Doc, blocks: Json[], origin?: unknown): void => {
  doc.transact(() => {
    const body = doc.getXmlFragment('default');
    const nodes = toY(blocks);
    if (nodes.length) body.insert(body.length, nodes);
  }, origin);
};

// "/linkto": puts a link to note `noteId` at the end of `doc` (into its last line when that is
// an empty paragraph). Nothing changes when the note already links there.
export const appendNoteLink = (doc: Y.Doc, noteId: string, origin?: unknown): 'added' | 'already' => {
  const body = doc.getXmlFragment('default');
  const linked = body.createTreeWalker((n) => n instanceof Y.XmlElement && n.nodeName === 'noteLink' && n.getAttribute('noteId') === noteId);
  if (!linked.next().done) return 'already';
  const last = body.length ? body.get(body.length - 1) : null;
  doc.transact(() => {
    const link = new Y.XmlElement('noteLink');
    link.setAttribute('noteId', noteId);
    const emptyLine = last instanceof Y.XmlElement && last.nodeName === 'paragraph'
      && last.toArray().every((child) => child instanceof Y.XmlText && child.length === 0);
    if (emptyLine) (last as Y.XmlElement).insert(last.length, [link]);
    else appendNoteBlocks(doc, [{ type: 'paragraph', content: [{ type: 'noteLink', attrs: { noteId } }] }]);
  }, origin);
  return 'added';
};
