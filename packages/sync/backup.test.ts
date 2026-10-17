import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { unzipSync, strFromU8 } from 'fflate';
import { generateKey, seal } from '@noted/crypto';
import { createBackup, restoreBackup, openBackup, compareBackup, restoreBackupNote } from './backup';
import { exportAllNotes } from './export-all';
import { noteBodyJson, noteBlobIds } from './doc-json';
import { sealDoc } from './doc';
import { buildNoteMeta, encodeNoteMeta, setTitle } from './note-meta';
import type { LocalNoteStore } from './engine';
import type { NoteRecord } from '@noted/types';

const memoryStore = (): LocalNoteStore & { rows: Map<string, NoteRecord> } => {
  const rows = new Map<string, NoteRecord>();
  return {
    rows,
    getAll: async () => [...rows.values()],
    save: async (id, content, yjs_state, updated_at) => { rows.set(id, { id, content, yjs_state, updated_at } as NoteRecord); },
    updateTimestamp: async (id, at) => { const r = rows.get(id); if (r) r.updated_at = at; },
  };
};

const paragraphDoc = (title: string, words: string[]) => {
  const doc = new Y.Doc();
  setTitle(doc, title);
  const frag = doc.getXmlFragment('default');
  for (const w of words) {
    const p = new Y.XmlElement('paragraph');
    const t = new Y.XmlText();
    t.insert(0, w, w === 'bold' ? { bold: true } : undefined);
    p.insert(0, [t]);
    frag.push([p]);
  }
  const img = new Y.XmlElement('image');
  img.setAttribute('blob', 'blob-1:key');
  frag.push([img]);
  return doc;
};

const put = async (store: LocalNoteStore, key: Uint8Array, id: string, doc: Y.Doc) =>
  store.save(id, seal(key, new TextEncoder().encode(encodeNoteMeta(buildNoteMeta(doc)))), sealDoc(key, doc), 1);

describe('note body as JSON', () => {
  it('maps elements, text and marks, and finds blobs', () => {
    const json = noteBodyJson(paragraphDoc('T', ['plain', 'bold']));
    expect(json.content?.[1]).toEqual({ type: 'paragraph', content: [{ type: 'text', text: 'bold', marks: [{ type: 'bold' }] }] });
    expect(noteBlobIds(json)).toEqual(['blob-1']);
  });
});

describe('backups', () => {
  it('restores into an empty store and merges into an edited one', async () => {
    const key = generateKey();
    const a = memoryStore();
    await put(a, key, 'n1', paragraphDoc('One', ['hello']));
    const backup = await createBackup(key, a);

    const b = memoryStore();
    expect(await restoreBackup(key, backup, b)).toEqual({ added: 1, merged: 0, blobs: 0, trashed: 0 });
    // Same content again: nothing to do.
    expect(await restoreBackup(key, backup, b)).toEqual({ added: 0, merged: 0, blobs: 0, trashed: 0 });

    await expect(restoreBackup(generateKey(), backup, b)).rejects.toThrow(/another vault/);
    await expect(restoreBackup(key, '{"x":1}', b)).rejects.toThrow(/not a Noted backup/);
  });

  it('merges: deleted blocks come back into the same note, later edits stay', async () => {
    const key = generateKey();
    const store = memoryStore();
    const doc = paragraphDoc('One', ['keep', 'image below']);
    await put(store, key, 'n1', doc);
    const backup = await createBackup(key, store);
    // Later: the image (last node) is deleted, a word is added, a paragraph is typed.
    const frag = doc.getXmlFragment('default');
    frag.delete(2, 1);
    ((frag.get(0) as Y.XmlElement).get(0) as Y.XmlText).insert(4, ' more');
    const p = new Y.XmlElement('paragraph');
    p.insert(0, [new Y.XmlText('later')]);
    frag.push([p]);
    await put(store, key, 'n1', doc);

    const { docFromSealed } = await import('./doc');
    const after = () => noteBodyJson(docFromSealed(key, store.rows.get('n1')!.yjs_state!));
    expect((await restoreBackup(key, backup, store)).merged).toBe(1);
    const text = JSON.stringify(after());
    expect(noteBlobIds(after())).toEqual(['blob-1']);
    expect(text).toContain('keep more');
    expect(text).toContain('later');
    expect(store.rows.size).toBe(1);
    // Merging again changes nothing.
    expect((await restoreBackup(key, backup, store)).merged).toBe(0);
  });

  it('restores as in the backup, compares, and rolls back', async () => {
    const key = generateKey();
    const store = memoryStore();
    const doc = paragraphDoc('One', ['keep', 'image below']);
    await put(store, key, 'n1', doc);
    await put(store, key, 'n2', paragraphDoc('Two', ['same']));
    const backup = await createBackup(key, store);
    doc.getXmlFragment('default').delete(0, 1);
    await put(store, key, 'n1', doc);
    await put(store, key, 'n3', paragraphDoc('Three', ['new']));

    const file = openBackup(key, backup);
    const diffs = await compareBackup(key, file, store);
    expect(diffs.map((d) => [d.id, d.status]).sort()).toEqual([['n1', 'changed'], ['n3', 'new']]);

    expect(await restoreBackupNote(key, file, 'n1', store, undefined, 'replace')).toBe(true);
    expect((await compareBackup(key, file, store)).map((d) => d.id)).toEqual(['n3']);

    const r = await restoreBackup(key, backup, store, undefined, 'rollback');
    expect(r.trashed).toBe(1);
    expect(await compareBackup(key, file, store)).toEqual([]);
  });

  it('exports all notes as a zip', async () => {
    const key = generateKey();
    const store = memoryStore();
    await put(store, key, 'n1', paragraphDoc('First', ['hello']));
    await put(store, key, 'n2', paragraphDoc('First', ['again']));
    const { zip, count } = await exportAllNotes(key, store, 'markdown');
    expect(count).toBe(2);
    const files = unzipSync(zip);
    expect(Object.keys(files).sort()).toEqual(['First (2).md', 'First.md', 'README.txt']);
    expect(Object.keys(files)[0]).toBe('README.txt');
    expect(strFromU8(files['First.md'])).toContain('# First');
  });
});
