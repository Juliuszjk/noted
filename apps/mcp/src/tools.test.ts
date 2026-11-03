// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { generateKey, seal } from '@noted/crypto';
import {
  buildNoteMeta, CATALOG_ID, docFromSealed, encodeNoteMeta, ensureCatalogEntry, ensureChildNotebook, getNoteCreatedBy, listNotebookTree, lockNote,
  sealDoc, setNoteBodyJson, setNoteNotebook, setTitle,
} from '@noted/sync';
import { createNotes } from './notes';
import { blobCache, openStore } from './store';
import { registerTools } from './tools';

const key = generateKey();

type Stores = ReturnType<typeof openStore>;
const put = async (stores: Stores, id: string, doc: Y.Doc, at = Date.now()) =>
  stores.notes.save(id, seal(key, new TextEncoder().encode(encodeNoteMeta(buildNoteMeta(doc)))), sealDoc(key, doc), at);

const note = (title: string, body: string, notebooks: string[] = []) => {
  const doc = new Y.Doc();
  setTitle(doc, title);
  setNoteBodyJson(doc, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: body }] }] });
  for (const id of notebooks) setNoteNotebook(doc, id, true);
  return doc;
};

let stores: Stores;
let client: Client;
let ids: Record<string, string>;

const call = async (name: string, args: Record<string, unknown> = {}) => {
  const result = await client.callTool({ name, arguments: args }) as { content: { type: string; text?: string }[]; isError?: boolean };
  return { text: result.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n'), isError: !!result.isError, content: result.content };
};

beforeEach(async () => {
  stores = openStore(':memory:');
  const catalog = new Y.Doc();
  const secret = ensureCatalogEntry(catalog, 'notebooks', 'Protected', () => 'nb-secret');
  const school = ensureCatalogEntry(catalog, 'notebooks', 'Studia', () => 'nb-school');
  const bank = ensureChildNotebook(catalog, secret.id, 'Bank', () => 'nb-bank');
  await put(stores, CATALOG_ID, catalog);
  await put(stores, 'n-bank', note('PIN', 'tajny pin', [bank.id]), 5);
  ids = { lecture: 'n-lecture', secret: 'n-secret', locked: 'n-locked' };
  await put(stores, ids.lecture, note('Wykład 3', 'Grafy: wierzchołki i krawędzie', [school.id]), 2);
  await put(stores, ids.secret, note('Hasła', 'tajne rzeczy', [secret.id]), 3);
  const locked = note('Pamiętnik', 'x');
  lockNote(locked, generateKey());
  await put(stores, ids.locked, locked, 4);
  const notes = createNotes(key, stores, { online: false });
  const server = new McpServer({ name: 'noted', version: 'test' });
  registerTools(server, notes, key, blobCache('/nonexistent'));
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  client = new Client({ name: 'test', version: '1' });
  await client.connect(b);
});

describe('MCP tools', () => {
  it('never shows protected or locked notes', async () => {
    const list = await call('list_notes');
    expect(list.text).toContain('Wykład 3');
    expect(list.text).not.toContain('Hasła');
    expect(list.text).not.toContain('Pamiętnik');
    expect((await call('list_notes', { query: 'tajne' })).text).toBe('No notes found.');
    for (const id of [ids.secret, ids.locked]) {
      const read = await call('read_note', { id });
      expect(read.isError).toBe(true);
      expect(read.text).not.toContain('tajne');
      expect((await call('append_to_note', { id, markdown: 'x' })).isError).toBe(true);
    }
    expect((await call('list_notebooks_tags')).text).not.toContain('Protected');
    expect((await call('create_note', { title: 'x', markdown: 'y', notebooks: ['protected'] })).isError).toBe(true);
    expect((await call('update_note_properties', { id: ids.lecture, add_notebooks: ['Protected'] })).isError).toBe(true);
  });

  it('creates, edits, rewrites and undoes', async () => {
    const created = await call('create_note', { title: 'Zakupy', markdown: '- [ ] mleko\n- [ ] chleb', tags: ['dom'] });
    const id = /id: ([\w-]+)/.exec(created.text)![1];
    expect((await call('set_task_done', { id, task: 'mleko' })).isError).toBe(false);
    await call('append_to_note', { id, markdown: '- [ ] masło' });
    let read = await call('read_note', { id });
    expect(read.text).toContain('- [x] mleko\n- [ ] chleb\n- [ ] masło');
    expect(read.text).toContain('#dom');

    expect((await call('replace_text', { id: ids.lecture, find: 'krawędzie', replace: 'krawędzie (edges)' })).isError).toBe(false);
    expect((await call('rewrite_note', { id: ids.lecture, markdown: '# Wykład 3\n\n## Grafy\n\n- wierzchołki\n- krawędzie' })).text).toMatch(/Rewritten/);
    read = await call('read_note', { id: ids.lecture });
    expect(read.text).toContain('## Grafy\n\n- wierzchołki\n- krawędzie');
    expect((await call('undo_last_change', { id: ids.lecture })).isError).toBe(false);
    expect((await call('read_note', { id: ids.lecture })).text).toContain('Grafy: wierzchołki i krawędzie (edges)');
    expect((await call('undo_last_change', { id: ids.lecture })).isError).toBe(false);
    expect((await call('read_note', { id: ids.lecture })).text).toMatch(/Grafy: wierzchołki i krawędzie$/);
  });

  it('sets, lists and completes reminders', async () => {
    const own = await call('add_reminder', { at: '2030-01-05 18:00', text: 'Oddać projekt' });
    expect(own.text).toMatch(/key: own\//);
    const chip = await call('add_reminder', { at: '2030-01-06', note_id: ids.lecture, after_text: 'Grafy' });
    expect(chip.isError).toBe(false);
    let list = await call('list_reminders');
    expect(list.text).toContain('Oddać projekt');
    expect(list.text).toContain('in note "Wykład 3"');
    expect(list.text).toMatch(/Sat, 5 Jan 2030 18:00/);
    expect((await call('read_note', { id: ids.lecture })).text).toMatch(/krawędzie ⟦reminder 1: » [^⟧]+⟧/);
    const keyOf = (t: string, text: string) => new RegExp(`${text}.*key: (\\S+)`).exec(t)![1];
    expect((await call('update_reminder', { key: keyOf(list.text, 'Oddać'), done: true })).text).toBe('Done.');
    expect((await call('update_reminder', { key: keyOf(list.text, 'Wykład'), snooze_until: '2030-01-07 08:00' })).text).toMatch(/Due Mon, 7 Jan 2030 08:00/);
    list = await call('list_reminders');
    expect(list.text).not.toContain('Oddać projekt');
    expect(list.text).toContain('snoozed');
  });

  it('shows a drawing as a picture', async () => {
    const doc = new Y.Doc();
    setTitle(doc, 'Szkic');
    setNoteBodyJson(doc, { type: 'doc', content: [{ type: 'drawing', attrs: { height: 200 }, content: [{ type: 'drawingStroke', attrs: { points: '1:AAAA', color: null, size: 4, tool: 'pen' } }] }] });
    await put(stores, 'n-draw', doc);
    const read = await call('read_note', { id: 'n-draw', images: true });
    expect(read.text).toContain('⟦drawing 1⟧');
    expect(read.content.some((c) => c.type === 'image')).toBe(true);
  });

  it('marks notes it creates and works with sub-notebooks as paths', async () => {
    const created = await call('create_note', { title: 'TODO', markdown: 'x', notebooks: ['Studia/Semestr 5/Algorithms'] });
    const id = /id: ([\w-]+)/.exec(created.text)![1];
    const record = await stores.notes.get(id);
    expect(getNoteCreatedBy(docFromSealed(key, record!.yjs_state))).toBe('claude');
    const catalog = docFromSealed(key, (await stores.notes.get(CATALOG_ID))!.yjs_state);
    expect(listNotebookTree(catalog).find((e) => e.name === 'Algorithms')?.path).toEqual(['Studia', 'Semestr 5', 'Algorithms']);
    expect((await call('read_note', { id })).text).toContain('notebooks: Studia/Semestr 5/Algorithms');
    const tree = (await call('list_notebooks_tags')).text;
    expect(tree).toContain('- Studia (1, 2 with sub-notebooks)\n  - Semestr 5 (0, 1 with sub-notebooks)\n    - Algorithms (1)');
    expect((await call('list_notes', { notebook: 'Studia' })).text).toContain('TODO');
    expect((await call('list_notes', { notebook: 'Semestr 5/Algorithms' })).text).not.toContain('Wykład 3');
    // The same path again reuses the notebooks; a name alone finds a sub-notebook.
    await call('update_note_properties', { id: ids.lecture, add_notebooks: ['studia/semestr 5'] });
    expect((await call('read_note', { id: ids.lecture })).text).toMatch(/notebooks: .*Studia\/Semestr 5/);
    await call('update_note_properties', { id: ids.lecture, remove_notebooks: ['Semestr 5'] });
    expect((await call('read_note', { id: ids.lecture })).text).not.toContain('Semestr 5');
  });

  it('marks an existing note as Claude\'s and moves notebooks', async () => {
    await call('update_note_properties', { id: ids.lecture, created_by_claude: true });
    const state = async () => docFromSealed(key, (await stores.notes.get(ids.lecture))!.yjs_state);
    expect(getNoteCreatedBy(await state())).toBe('claude');
    await call('update_note_properties', { id: ids.lecture, created_by_claude: false });
    expect(getNoteCreatedBy(await state())).toBe(null);
    await call('create_note', { title: 'S3', markdown: 'x', notebooks: ['Uni/Semestr 3/Java'] });
    expect((await call('move_notebook', { notebook: 'Uni/Semestr 3', into: 'Uni/Rok 2' })).text).toBe('Moved.');
    expect((await call('list_notes', { notebook: 'Uni/Rok 2/Semestr 3/Java' })).text).toContain('S3');
    expect((await call('move_notebook', { notebook: 'Uni', into: 'Uni/Rok 2' })).isError).toBe(true);
    expect((await call('move_notebook', { notebook: 'Uni', into: 'Uni/Nowy' })).isError).toBe(true);
    expect((await call('list_notebooks_tags')).text).not.toContain('Nowy');
    expect((await call('move_notebook', { notebook: 'Uni/Rok 2', into: 'Protected' })).isError).toBe(true);
    await call('move_notebook', { notebook: 'Uni/Rok 2', into: '' });
    expect((await call('list_notebooks_tags')).text).toMatch(/^- Rok 2 /m);
  });

  it('asks for a path when several sub-notebooks share a name', async () => {
    await call('create_note', { title: 'A', markdown: 'x', notebooks: ['Semestr 5/Lab'] });
    await call('create_note', { title: 'B', markdown: 'x', notebooks: ['Semestr 6/Lab'] });
    const ambiguous = await call('list_notes', { notebook: 'Lab' });
    expect(ambiguous.isError).toBe(true);
    expect(ambiguous.text).toContain('"Semestr 5/Lab"');
    expect((await call('create_note', { title: 'C', markdown: 'x', notebooks: ['Lab'] })).isError).toBe(true);
    expect((await call('list_notes', { notebook: 'Semestr 6/Lab' })).text).toContain('B');
    await call('create_note', { title: 'D', markdown: 'x', notebooks: ['Studia/Lab/X'] });
    expect((await call('create_note', { title: 'E', markdown: 'x', notebooks: ['Lab/X'] })).isError).toBe(true);
  });

  it('hides notebooks inside a protected one', async () => {
    expect((await call('list_notes')).text).not.toContain('PIN');
    expect((await call('read_note', { id: 'n-bank' })).isError).toBe(true);
    expect((await call('list_notebooks_tags')).text).not.toContain('Bank');
    for (const name of ['Bank', 'Protected/Bank', 'Protected/New']) {
      expect((await call('create_note', { title: 'x', markdown: 'y', notebooks: [name] })).isError).toBe(true);
    }
    const catalog = docFromSealed(key, (await stores.notes.get(CATALOG_ID))!.yjs_state);
    expect(listNotebookTree(catalog).map((e) => e.name)).not.toContain('New');
  });
});
