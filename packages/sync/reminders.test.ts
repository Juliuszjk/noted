import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { renewReminderIds, updateReminderInDoc } from './reminders';
import { lockNote, readLockedBody } from './locked';

const reminder = (id: string) => {
  const element = new Y.XmlElement('reminder');
  element.setAttribute('id', id);
  element.setAttribute('at', 1000 as unknown as string);
  return element;
};

const reminderIds = (doc: Y.Doc): string[] => {
  const ids: string[] = [];
  const walk = (node: Y.XmlFragment | Y.XmlElement) => node.toArray().forEach((child) => {
    if (!(child instanceof Y.XmlElement)) return;
    if (child.nodeName === 'reminder') ids.push(child.getAttribute('id') as string);
    else walk(child);
  });
  walk(doc.getXmlFragment('default'));
  return ids;
};

describe('renewReminderIds', () => {
  it('gives a copy new reminder ids, so changing it leaves the original alone', () => {
    const original = new Y.Doc();
    const paragraph = new Y.XmlElement('paragraph');
    paragraph.insert(0, [new Y.XmlText('Call '), reminder('a1')]);
    const item = new Y.XmlElement('listItem');
    const inner = new Y.XmlElement('paragraph');
    inner.insert(0, [reminder('b2')]);
    item.insert(0, [inner]);
    original.getXmlFragment('default').insert(0, [paragraph, item]);

    const copy = new Y.Doc();
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(original));
    renewReminderIds(copy);

    const ids = reminderIds(copy);
    expect(ids).toHaveLength(2);
    expect(ids).not.toContain('a1');
    expect(ids).not.toContain('b2');
    expect(new Set(ids).size).toBe(2);
    expect(reminderIds(original)).toEqual(['a1', 'b2']);
    expect(updateReminderInDoc(copy, 'a1', null)).toBe(false);
  });

  it('renews the ids inside a locked note\'s sealed body with the vault key', () => {
    const vaultKey = new Uint8Array(32).fill(7);
    const doc = new Y.Doc();
    const paragraph = new Y.XmlElement('paragraph');
    paragraph.insert(0, [reminder('a1')]);
    doc.getXmlFragment('default').insert(0, [paragraph]);
    lockNote(doc, vaultKey);
    const idsIn = (d: Y.Doc) => JSON.stringify(readLockedBody(d, vaultKey)).match(/"id":"[^"]+"/g);

    const closed = new Y.Doc();
    Y.applyUpdate(closed, Y.encodeStateAsUpdate(doc));
    renewReminderIds(closed);
    expect(idsIn(closed)).toEqual(['"id":"a1"']);

    renewReminderIds(doc, vaultKey);
    expect(idsIn(doc)).toHaveLength(1);
    expect(idsIn(doc)).not.toEqual(['"id":"a1"']);
  });
});
