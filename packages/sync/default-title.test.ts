import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { applyDefaultTitle, getTitleText, setTitle, markNoteCreated } from './note-meta';

const withText = (text: string) => {
  const doc = new Y.Doc();
  markNoteCreated(doc);
  const p = new Y.XmlElement('paragraph');
  const t = new Y.XmlText();
  t.insert(0, text);
  p.insert(0, [t]);
  doc.getXmlFragment('default').push([p]);
  return doc;
};

describe('default title', () => {
  it('titles an untitled note with text once', () => {
    const doc = withText('hello');
    expect(applyDefaultTitle(doc, 'Note $date$')).toBe(true);
    expect(getTitleText(doc).toString()).toMatch(/^Note \d{4}-\d{2}-\d{2}$/);
    setTitle(doc, '');
    expect(applyDefaultTitle(doc, 'Note $date$')).toBe(false);
  });
  it('leaves empty notes, titled notes and the "off" setting alone', () => {
    expect(applyDefaultTitle(withText('  '), 'Note')).toBe(false);
    expect(applyDefaultTitle(withText('x'), '')).toBe(false);
    const titled = withText('x');
    setTitle(titled, 'Mine');
    expect(applyDefaultTitle(titled, 'Note')).toBe(false);
  });
});
