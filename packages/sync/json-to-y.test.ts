import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { setNoteBodyJson } from './json-to-y';
import { noteBodyJson } from './doc-json';

describe('JSON into the note body', () => {
  it('round-trips nodes, attributes and marks', () => {
    const json = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Title' }] },
        { type: 'paragraph', content: [
          { type: 'text', text: 'plain ' },
          { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
          { type: 'text', text: ' link', marks: [{ type: 'link', attrs: { href: 'https://a.b' } }] },
          { type: 'noteLink', attrs: { noteId: 'n1' } },
          { type: 'text', text: ' end' },
        ] },
        { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'done' }] }] }] },
      ],
    };
    const doc = new Y.Doc();
    setNoteBodyJson(doc, json);
    expect(noteBodyJson(doc)).toEqual(json);
    // Replacing again leaves only the new body.
    setNoteBodyJson(doc, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'new' }] }] });
    expect(noteBodyJson(doc).content).toEqual([{ type: 'paragraph', content: [{ type: 'text', text: 'new' }] }]);
  });
});
