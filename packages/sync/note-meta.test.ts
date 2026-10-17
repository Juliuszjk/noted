import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { buildNoteMeta, decodeNoteMeta, displayTitle, encodeNoteMeta, getTitleText, setTitle } from './note-meta';

// Builds a body like y-prosemirror stores it: paragraph(text) + paragraph(text, noteLink).
const docWithBody = () => {
  const doc = new Y.Doc();
  const body = doc.getXmlFragment('default');
  const p1 = new Y.XmlElement('paragraph');
  p1.insert(0, [new Y.XmlText('Hello world')]);
  const p2 = new Y.XmlElement('paragraph');
  const link = new Y.XmlElement('noteLink');
  link.setAttribute('noteId', 'note-b');
  p2.insert(0, [new Y.XmlText('see'), link]);
  body.insert(0, [p1, p2]);
  return doc;
};

describe('note meta', () => {
  it('reads title, plain text excerpt and linked note ids', () => {
    const doc = docWithBody();
    setTitle(doc, '  Plan  ');
    expect(buildNoteMeta(doc)).toMatchObject({ title: 'Plan', excerpt: 'Hello world see', links: ['note-b'], pinned: false, created: null, tags: [] });
  });

  it('round-trips through the stored JSON', () => {
    const meta = { title: 'A', excerpt: 'b', links: ['x', 'y'], pinned: true, created: 123, favorite: true, archived: false, trashedAt: 5, deleted: false, notebooks: ['n1'], tags: ['t1'], locked: true, published: true };
    expect(decodeNoteMeta(encodeNoteMeta(meta))).toEqual(meta);
  });

  it('reads the single notebook of older meta', () => {
    expect(decodeNoteMeta(JSON.stringify({ v: 1, title: 'A', notebook: 'n1' })).notebooks).toEqual(['n1']);
  });

  it('treats old HTML previews as an excerpt without a title', () => {
    expect(decodeNoteMeta('<p>Old <b>note</b></p>')).toMatchObject({ title: '', excerpt: 'Old note', links: [], pinned: false, created: null, tags: [] });
    expect(decodeNoteMeta('')).toMatchObject({ title: '', excerpt: '', links: [], deleted: false });
    expect(displayTitle(decodeNoteMeta('<p>Old note</p>'))).toBe('Old note');
    expect(displayTitle(decodeNoteMeta(''))).toBe('Untitled');
  });

  it('edits the title minimally so concurrent edits merge', () => {
    const a = new Y.Doc();
    setTitle(a, 'Shopping list');
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    setTitle(a, 'My shopping list');
    setTitle(b, 'Shopping list 2');
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    expect(getTitleText(a).toString()).toBe('My shopping list 2');
    expect(getTitleText(b).toString()).toBe('My shopping list 2');
  });
});

import { getNoteFont, setNoteFont } from './note-meta';

describe('note font', () => {
  it('defaults to null, stores serif/mono and syncs between docs', () => {
    const a = new Y.Doc();
    expect(getNoteFont(a)).toBeNull();
    setNoteFont(a, 'serif');
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(getNoteFont(b)).toBe('serif');
    setNoteFont(b, null);
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    expect(getNoteFont(a)).toBeNull();
  });
});

import { setNotePinned, markNoteCreated, getNoteCreated } from './note-meta';

describe('pinned and created', () => {
  it('end up in the meta; the first creation time wins', () => {
    const doc = new Y.Doc();
    setNotePinned(doc, true);
    markNoteCreated(doc, 1000);
    markNoteCreated(doc, 2000);
    expect(getNoteCreated(doc)).toBe(1000);
    expect(buildNoteMeta(doc)).toMatchObject({ pinned: true, created: 1000 });
    setNotePinned(doc, false);
    expect(buildNoteMeta(doc).pinned).toBe(false);
  });
});

import { setNoteFlag, setNoteTrashed, deleteNoteForever, setNoteNotebook, setNoteTag, getNoteTags, getNoteNotebooks, getNoteSettings } from './note-meta';

describe('note properties', () => {
  it('flags, notebook and tags end up in the meta', () => {
    const doc = new Y.Doc();
    setNoteFlag(doc, 'favorite', true);
    setNoteFlag(doc, 'archived', true);
    setNoteNotebook(doc, 'nb-1', true);
    setNoteTag(doc, 'tag-b', true);
    setNoteTag(doc, 'tag-a', true);
    setNoteTrashed(doc, true, 42);
    expect(buildNoteMeta(doc)).toMatchObject({ favorite: true, archived: true, notebooks: ['nb-1'], tags: ['tag-a', 'tag-b'], trashedAt: 42 });
    setNoteTrashed(doc, false);
    setNoteTag(doc, 'tag-b', false);
    expect(buildNoteMeta(doc)).toMatchObject({ trashedAt: null, tags: ['tag-a'] });
  });

  it('a note is in several notebooks; an old single notebook is kept when adding more', () => {
    const doc = new Y.Doc();
    getNoteSettings(doc).set('notebook', 'old');
    expect(getNoteNotebooks(doc)).toEqual(['old']);
    setNoteNotebook(doc, 'new', true);
    expect(getNoteNotebooks(doc)).toEqual(['new', 'old']);
    expect(getNoteSettings(doc).get('notebook')).toBeUndefined();
    setNoteNotebook(doc, 'old', false);
    expect(getNoteNotebooks(doc)).toEqual(['new']);
  });

  it('removing the old single notebook works too', () => {
    const doc = new Y.Doc();
    getNoteSettings(doc).set('notebook', 'old');
    setNoteNotebook(doc, 'old', false);
    expect(getNoteNotebooks(doc)).toEqual([]);
  });

  it('tags added on two devices at once both survive', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    setNoteTag(a, 'x', true);
    setNoteTag(b, 'y', true);
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    expect(getNoteTags(a)).toEqual(['x', 'y']);
  });

  it('deleting for good empties the note on every device', () => {
    const a = docWithBody();
    setTitle(a, 'Secret');
    setNoteTag(a, 't', true);
    markNoteCreated(a, 7);
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    deleteNoteForever(b);
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    expect(buildNoteMeta(a)).toMatchObject({ title: '', excerpt: '', links: [], tags: [], deleted: true, created: 7 });
  });
});
