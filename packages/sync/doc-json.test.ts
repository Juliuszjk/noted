import { it, expect } from 'vitest';
import * as Y from 'yjs';
import { setNoteBodyJson } from './json-to-y';
import { noteBodyJson, noteAttachments } from './doc-json';

it('lists the files and images of a note in order', () => {
  const doc = new Y.Doc();
  setNoteBodyJson(doc, {
    type: 'doc',
    content: [
      { type: 'image', attrs: { blob: 'a:k1' } },
      { type: 'paragraph', content: [{ type: 'text', text: 'x' }] },
      { type: 'attachment', attrs: { blob: 'b:k2', name: 'book.pdf', size: 1200, mime: 'application/pdf' } },
      { type: 'image', attrs: { blob: 'c:k3', alt: 'Cat' } },
      { type: 'image', attrs: { src: 'data:image/png;base64,AAA' } },
    ],
  });
  expect(noteAttachments(noteBodyJson(doc))).toEqual([
    { kind: 'image', blob: 'a:k1', name: 'Image 1', size: null },
    { kind: 'file', blob: 'b:k2', name: 'book.pdf', size: 1200 },
    { kind: 'image', blob: 'c:k3', name: 'Cat', size: null },
  ]);
});
