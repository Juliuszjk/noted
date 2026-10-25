import { describe, it, expect, vi, afterEach } from 'vitest';
import * as Y from 'yjs';
import { createLiveOwner, afterLiveCatchUp } from './live-owner';
import { GuestEditsWaiting } from './publish';
import { liveKeys, sealUpdate, unsealUpdate, LIVE_ORIGIN } from './live';
import { setTitle, getTitleText } from './note-meta';
import type { NotePublish } from './note-meta';
import { setServerAddress } from '@noted/config';

// Requests go to a stubbed fetch; any address will do (builds may have no default).
setServerAddress({ api: 'http://test.invalid', public: '' });

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

  it('takes a note made live on this device at once, and lets it go when unpublished', async () => {
    const { doc, sent, owner, flush } = setup(true);
    owner.setShares([]);
    owner.sendUpdate('n1', new Uint8Array([0, 0]));
    await flush();
    expect(sent).toHaveLength(0);
    owner.updateShare('n1', info(true));
    owner.watchDoc('n1', doc);
    setTitle(doc, 'Live now');
    await flush();
    expect(sent).toHaveLength(1);
    owner.updateShare('n1', null);
    setTitle(doc, 'Not any more');
    await flush();
    expect(sent).toHaveLength(1);
  });

  describe('files', () => {
    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    });

    it('sends a new snapshot listing an image this device added, so guests can load it', async () => {
      vi.useFakeTimers();
      const puts: { blobs: string[] }[] = [];
      vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'PUT') {
          puts.push(JSON.parse(init.body as string));
          return new Response('{}', { status: 200 });
        }
        return new Response(JSON.stringify({ exists: true, updates: [] }), { status: 200 });
      }));
      const { doc, owner } = setup(true);
      owner.connected();
      await vi.advanceTimersByTimeAsync(10);
      expect(puts).toHaveLength(1);
      expect(puts[0].blobs).toEqual([]);

      owner.watchDoc('n1', doc);
      const image = new Y.XmlElement('blobImage');
      image.setAttribute('blob', 'img1:a2V5');
      doc.getXmlFragment('default').insert(0, [image]);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(puts).toHaveLength(2);
      expect(puts[1].blobs).toEqual(['img1']);

      // Typing without new files: no more snapshots.
      setTitle(doc, 'Typing');
      await vi.advanceTimersByTimeAsync(2_000);
      expect(puts).toHaveLength(2);
    });
  });

  it('merges the waiting guest edits before a live link goes, and tries again when more came', async () => {
    const { doc, owner, seqs, guestEdit } = setup(true);
    const first = guestEdit((g) => setTitle(g, 'One'));
    const second = guestEdit((g) => setTitle(g, 'Two'));
    let served = [{ seq: 3, data: first, guest: true }];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ exists: true, snapshotSeq: 0, updates: served }))));
    const calls: (number | undefined)[] = [];
    await afterLiveCatchUp(owner, 'n1', info(true), async (after) => {
      calls.push(after);
      // The server saw one more guest edit meanwhile: refuses once.
      if (calls.length === 1) {
        served = [{ seq: 3, data: first, guest: true }, { seq: 4, data: second, guest: true }];
        throw new GuestEditsWaiting();
      }
    });
    expect(calls).toEqual([3, 4]);
    expect(getTitleText(doc).toString()).toBe('Two');
    expect(seqs.get('abcdefghijklmnop')).toBe(4);
  });

  it('gives up after a few refusals, and runs at once for links that are not live', async () => {
    const { owner } = setup(true);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ exists: true, snapshotSeq: 0, updates: [] }))));
    const refuse = vi.fn(async () => { throw new GuestEditsWaiting(); });
    await expect(afterLiveCatchUp(owner, 'n1', info(true), refuse)).rejects.toBeInstanceOf(GuestEditsWaiting);
    expect(refuse).toHaveBeenCalledTimes(3);
    const plain = vi.fn(async (after?: number) => after);
    expect(await afterLiveCatchUp(owner, 'n1', { ...info(true), live: false }, plain)).toBeUndefined();
  });
});
