import { describe, it, expect, vi, afterEach } from 'vitest';
import * as Y from 'yjs';
import { generateKey, createVerifier, bytesToBase64, seal } from '@noted/crypto';
import { runSyncEngine } from './engine';
import type { LocalNoteStore } from './engine';
import { sealDoc } from './doc';
import { buildNoteMeta, encodeNoteMeta, setTitle, deleteNoteForever } from './note-meta';
import type { NoteRecord } from '@noted/types';
import { setServerAddress } from '@noted/config';

// Requests go to a stubbed fetch; any address will do (builds may have no default).
setServerAddress({ api: 'http://test.invalid', public: '' });

afterEach(() => vi.unstubAllGlobals());

describe('sync engine', () => {
  it('drops a tombstone the server no longer has instead of uploading it', async () => {
    const key = generateKey();
    const v = createVerifier(key);
    const posted: string[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url.endsWith('/vault')) return new Response(JSON.stringify({ verifier: `${bytesToBase64(v.nonce)}.${bytesToBase64(v.ciphertext)}` }));
      if (url.endsWith('/vault/auth')) return new Response('{}');
      if (url.endsWith('/notes') && (!init?.method || init.method === 'GET')) return new Response('[]');
      if (init?.method === 'POST') { posted.push(url.split('/').pop()!); return new Response('{}'); }
      return new Response('{}', { status: 404 });
    });
    const rows = new Map<string, NoteRecord>();
    const save = (id: string, doc: Y.Doc) => rows.set(id, { id, content: seal(key, new TextEncoder().encode(encodeNoteMeta(buildNoteMeta(doc)))), yjs_state: sealDoc(key, doc), updated_at: 1 } as NoteRecord);
    const live = new Y.Doc();
    setTitle(live, 'Live');
    save('live', live);
    const gone = new Y.Doc();
    setTitle(gone, 'Gone');
    deleteNoteForever(gone);
    save('gone', gone);
    const store: LocalNoteStore = {
      getAll: async () => [...rows.values()],
      save: async () => {},
      updateTimestamp: async () => {},
      remove: async (id) => { rows.delete(id); },
    };
    await runSyncEngine(key, store, null, null);
    expect(posted).toEqual(['live']);
    expect([...rows.keys()]).toEqual(['live']);
  });
});
