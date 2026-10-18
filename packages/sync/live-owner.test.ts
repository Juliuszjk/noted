import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { createLiveOwner } from './live-owner';
import { liveKeys, sealUpdate, unsealUpdate, LIVE_ORIGIN } from './live';
import { setTitle, getTitleText } from './note-meta';
import type { NotePublish } from './note-meta';

const KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
const info = (editable: boolean): NotePublish => ({ id: 'abcdefghijklmnop', key: KEY, at: 1, live: true, editable });
const keys = () => liveKeys(Uint8Array.from({ length: 32 }, (_, i) => i), null);

const setup = (editable: boolean) => {
  const doc = new Y.Doc();
  setTitle(doc, 'Note');
  const sent: any[] = [];
  const seqs = new Map<string, number>();
  const owner = createLiveOwner({
    masterKey: new Uint8Array(32),
    send: (m) => { sent.push(m); return true; },
    readNote: async (id) => (id === 'n1' ? doc : null),
    applyToNote: async (_id, updates) => { doc.transact(() => updates.forEach((u) => Y.applyUpdate(doc, u)), LIVE_ORIGIN); },
    getSeq: (id) => seqs.get(id) ?? 0,
    setSeq: (id, seq) => seqs.set(id, seq),
  });
  owner.setShares([{ noteId: 'n1', info: info(editable) }]);
  const guest = new Y.Doc();
  Y.applyUpdate(guest, Y.encodeStateAsUpdate(doc));
  const guestEdit = (edit: (d: Y.Doc) => void) => {
    const sv = Y.encodeStateVector(guest);
    edit(guest);
    return sealUpdate(keys(), Y.encodeStateAsUpdate(guest, sv));
  };
  const flush = () => new Promise((r) => setTimeout(r, 10));
  return { doc, sent, seqs, owner, guestEdit, flush };
};

describe('live owner', () => {
  it('merges guest edits of an editable note and remembers how far it got', async () => {
    const { doc, owner, seqs, guestEdit, flush } = setup(true);
    owner.handleMessage({ type: 'live', id: 'abcdefghijklmnop', seq: 5, data: guestEdit((g) => setTitle(g, 'Guest title')), guest: true });
    await flush();
    expect(getTitleText(doc).toString()).toBe('Guest title');
    expect(seqs.get('abcdefghijklmnop')).toBe(5);
  });

  it('ignores guest edits while editing is off and refuses changes to settings', async () => {
    const off = setup(false);
    off.owner.handleMessage({ type: 'live', id: 'abcdefghijklmnop', seq: 1, data: off.guestEdit((g) => setTitle(g, 'X')), guest: true });
    await off.flush();
    expect(getTitleText(off.doc).toString()).toBe('Note');

    const on = setup(true);
    on.owner.handleMessage({ type: 'live', id: 'abcdefghijklmnop', seq: 1, data: on.guestEdit((g) => g.getMap('settings').set('deleted', true)), guest: true });
    await on.flush();
    expect(on.doc.getMap('settings').get('deleted')).toBeUndefined();
  });

  it('sends local edits, not merged ones', async () => {
    const { doc, sent, owner, guestEdit, flush } = setup(true);
    owner.watchDoc('n1', doc);
    setTitle(doc, 'Mine');
    await flush();
    expect(sent).toHaveLength(1);
    const copy = new Y.Doc();
    Y.applyUpdate(copy, unsealUpdate(keys(), sent[0].data));
    expect(sent[0].type).toBe('liveUpdate');
    owner.handleMessage({ type: 'live', id: 'abcdefghijklmnop', seq: 2, data: guestEdit((g) => g.getXmlFragment('default').insert(0, [new Y.XmlElement('paragraph')])), guest: true });
    await flush();
    expect(sent).toHaveLength(1);
  });
});
