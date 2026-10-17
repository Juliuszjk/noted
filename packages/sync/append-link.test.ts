import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { appendNoteLink, setNoteBodyJson } from './json-to-y';
import { buildNoteMeta } from './note-meta';
import { noteBodyJson } from './doc-json';

describe('appendNoteLink', () => {
  it('adds a paragraph with the link at the end', () => {
    const doc = new Y.Doc();
    setNoteBodyJson(doc, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }] });
    expect(appendNoteLink(doc, 'abc')).toBe('added');
    expect(buildNoteMeta(doc).links).toEqual(['abc']);
    const json = noteBodyJson(doc) as any;
    expect(json.content).toHaveLength(2);
    expect(json.content[1]).toMatchObject({ type: 'paragraph', content: [{ type: 'noteLink', attrs: { noteId: 'abc' } }] });
  });

  it('uses a trailing empty line and does not link twice', () => {
    const doc = new Y.Doc();
    setNoteBodyJson(doc, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hi' }] }, { type: 'paragraph' }] });
    expect(appendNoteLink(doc, 'abc')).toBe('added');
    expect((noteBodyJson(doc) as any).content).toHaveLength(2);
    expect(appendNoteLink(doc, 'abc')).toBe('already');
    expect((noteBodyJson(doc) as any).content).toHaveLength(2);
  });
});
