import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { generateKey } from '@noted/crypto';
import { acceptGuestUpdates, liveKeys, sealUpdate, tokenHash, unsealUpdate } from './live';
import { setNoteFlag, setTitle, getTitleText } from './note-meta';

// A note and a guest's copy of it; returns the guest's update for `edit`.
const setup = () => {
  const note = new Y.Doc();
  setTitle(note, 'Shopping');
  const p = new Y.XmlElement('paragraph');
  p.insert(0, [new Y.XmlText('milk')]);
  note.getXmlFragment('default').insert(0, [p]);
  setNoteFlag(note, 'pinned', true);
  const guest = new Y.Doc();
  Y.applyUpdate(guest, Y.encodeStateAsUpdate(note));
  const change = (edit: (doc: Y.Doc) => void): Uint8Array => {
    const before = Y.encodeStateVector(guest);
    edit(guest);
    return Y.encodeStateAsUpdate(guest, before);
  };
  return { note, guest, change };
};

describe('live notes', () => {
  it('seals updates so only the same link opens them', () => {
    const link = generateKey();
    const keys = liveKeys(link, null);
    const sealed = sealUpdate(keys, new Uint8Array([1, 2, 3]));
    expect([...unsealUpdate(liveKeys(link, null), sealed)]).toEqual([1, 2, 3]);
    expect(() => unsealUpdate(liveKeys(generateKey(), null), sealed)).toThrow();
    expect(liveKeys(link, 'secret').read).not.toBe(keys.read);
  });

  it('hashes tokens like the server (SHA-256 of the bytes, hex)', async () => {
    const hash = await tokenHash(liveKeys(generateKey(), null).read);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('accepts guest edits of the title and the body', () => {
    const { note, change } = setup();
    const a = change((g) => setTitle(g, 'Shopping list'));
    const b = change((g) => ((g.getXmlFragment('default').get(0) as Y.XmlElement).get(0) as Y.XmlText).insert(4, ', eggs'));
    const { accepted, refused } = acceptGuestUpdates(note, [a, b]);
    expect(refused).toBe(0);
    for (const u of accepted) Y.applyUpdate(note, u);
    expect(getTitleText(note).toString()).toBe('Shopping list');
    expect(note.getXmlFragment('default').toString()).toContain('milk, eggs');
  });

  it('refuses guest changes to settings, tags or notebooks and what builds on them', () => {
    const { note, change } = setup();
    const deleting = change((g) => g.getMap('settings').set('deleted', true));
    const unpinning = change((g) => g.getMap('settings').delete('pinned'));
    const tagging = change((g) => g.getMap('tags').set('x', true));
    // Later edits of the same guest build on the refused ones (Yjs needs them in order).
    const later = change((g) => setTitle(g, 'Ok'));
    // Another guest's edit is fine.
    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(note));
    const sv = Y.encodeStateVector(other);
    other.getXmlFragment('default').insert(1, [new Y.XmlElement('paragraph')]);
    const fine = Y.encodeStateAsUpdate(other, sv);
    const { accepted, refused } = acceptGuestUpdates(note, [deleting, unpinning, fine, tagging, later]);
    expect(refused).toBe(4);
    expect(accepted).toEqual([fine]);
    expect(note.getMap('settings').get('pinned')).toBe(true);
  });

  it('refuses garbage', () => {
    const { note } = setup();
    expect(acceptGuestUpdates(note, [new Uint8Array([9, 9, 9, 9])]).refused).toBe(1);
  });
});
