import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  ensureCatalogEntry, listCatalog, renameCatalogEntry, removeCatalogEntry, getSharedEditorPrefs, setSharedEditorPrefs, getSharedTitleTemplate,
  setSharedTitleTemplate, sharedPrefsChange, listNotebookTree, setNotebookParent, ensureNotebookPath, ensureChildNotebook, removeNotebook,
  notebookParents, resolveNotebookPath, splitNotebookPath, notebookSubtree,
} from './catalog';

let n = 0;
const newId = () => `id-${++n}`;

describe('catalog', () => {
  it('reuses entries by name, ignoring case, accents and a leading #', () => {
    const doc = new Y.Doc();
    const a = ensureCatalogEntry(doc, 'tags', 'Analiza', newId);
    const b = ensureCatalogEntry(doc, 'tags', '#analiza', newId);
    expect(b.id).toBe(a.id);
    ensureCatalogEntry(doc, 'notebooks', 'Studia', newId);
    ensureCatalogEntry(doc, 'notebooks', 'Łódź', newId);
    expect(ensureCatalogEntry(doc, 'notebooks', 'lodz', newId).name).toBe('Łódź');
    expect(listCatalog(doc, 'notebooks').map((e) => e.name)).toEqual(['Łódź', 'Studia']);
    expect(() => ensureCatalogEntry(doc, 'tags', '  # ', newId)).toThrow();
  });

  it('renames and removes; notebooks created on two devices merge', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    const x = ensureCatalogEntry(a, 'notebooks', 'X', newId);
    ensureCatalogEntry(b, 'notebooks', 'Y', newId);
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    renameCatalogEntry(a, 'notebooks', x.id, 'Xx');
    expect(listCatalog(a, 'notebooks').map((e) => e.name)).toEqual(['Xx', 'Y']);
    removeCatalogEntry(a, 'notebooks', x.id);
    expect(listCatalog(a, 'notebooks').map((e) => e.name)).toEqual(['Y']);
  });
});

describe('shared editor settings', () => {
  it('keeps the default title and reminder times, and finds what changed', () => {
    const doc = new Y.Doc();
    expect(getSharedEditorPrefs(doc)).toEqual({});
    setSharedEditorPrefs(doc, { reminderMorning: '06:30' });
    setSharedTitleTemplate(doc, 'Note $date$');
    expect(getSharedEditorPrefs(doc)).toEqual({ reminderMorning: '06:30', titleTemplate: 'Note $date$' });
    expect(getSharedTitleTemplate(doc)).toBe('Note $date$');
    const before = { titleTemplate: '', reminderMorning: '07:00', reminderEvening: '18:00' };
    expect(sharedPrefsChange(before, { ...before })).toBeNull();
    expect(sharedPrefsChange(before, { ...before, reminderEvening: '19:00' })).toEqual({ reminderEvening: '19:00' });
  });
});

describe('sub-notebooks', () => {
  const tree = (doc: Y.Doc) => listNotebookTree(doc).map((n) => `${'  '.repeat(n.depth)}${n.name}`);

  it('builds a tree, refuses moving a notebook into itself or below it', () => {
    const doc = new Y.Doc();
    const studia = ensureCatalogEntry(doc, 'notebooks', 'Studia', newId);
    const s5 = ensureChildNotebook(doc, studia.id, 'Semestr 5', newId);
    const algo = ensureChildNotebook(doc, s5.id, 'Algorithms', newId);
    ensureCatalogEntry(doc, 'notebooks', 'Linux', newId);
    expect(tree(doc)).toEqual(['Linux', 'Studia', '  Semestr 5', '    Algorithms']);
    expect(listNotebookTree(doc).find((n) => n.id === algo.id)?.path).toEqual(['Studia', 'Semestr 5', 'Algorithms']);
    expect(setNotebookParent(doc, studia.id, algo.id)).toBe(false);
    expect(setNotebookParent(doc, studia.id, studia.id)).toBe(false);
    expect(setNotebookParent(doc, algo.id, null)).toBe(true);
    expect(tree(doc)).toEqual(['Algorithms', 'Linux', 'Studia', '  Semestr 5']);
    // Same name under another parent is another notebook.
    const lab4 = ensureChildNotebook(doc, studia.id, 'Algorithms', newId);
    expect(lab4.id).not.toBe(algo.id);
    expect(ensureChildNotebook(doc, studia.id, 'algorithms', newId).id).toBe(lab4.id);
    const nodes = listNotebookTree(doc);
    expect([...notebookSubtree(nodes, studia.id)].sort()).toEqual([studia.id, s5.id, lab4.id].sort());
  });

  it('creates a typed path below a parent and never reuses a nested notebook at the top', () => {
    const doc = new Y.Doc();
    const studia = ensureChildNotebook(doc, null, 'Studia', newId);
    const lab = ensureChildNotebook(doc, studia.id, 'Semestr 5 / Lab', newId);
    expect(listNotebookTree(doc).find((n) => n.id === lab.id)?.path).toEqual(['Studia', 'Semestr 5', 'Lab']);
    const top = ensureChildNotebook(doc, null, 'Lab', newId);
    expect(top.id).not.toBe(lab.id);
    expect(listNotebookTree(doc).find((n) => n.id === top.id)?.depth).toBe(0);
    expect(ensureChildNotebook(doc, null, 'Studia/Semestr 5/Lab', newId).id).toBe(lab.id);
  });

  it('resolves and creates paths', () => {
    const doc = new Y.Doc();
    const linux = ensureCatalogEntry(doc, 'notebooks', 'Linux', newId);
    expect(splitNotebookPath(' Linux / TODO ')).toEqual(['Linux', 'TODO']);
    const todo = ensureNotebookPath(doc, ['linux', 'TODO'], newId);
    expect(notebookParents(doc).get(todo.id)).toBe(linux.id);
    expect(ensureNotebookPath(doc, ['Linux', 'todo'], newId).id).toBe(todo.id);
    // A first name only found deeper, when it is the only one.
    expect(resolveNotebookPath(doc, ['TODO']).map((e) => e.id)).toEqual([todo.id]);
    const deep = ensureNotebookPath(doc, ['A', 'B', 'C'], newId);
    expect(listNotebookTree(doc).find((n) => n.id === deep.id)?.path).toEqual(['A', 'B', 'C']);
    // One name: reused anywhere (as before sub-notebooks).
    expect(ensureNotebookPath(doc, ['b'], newId).name).toBe('B');
  });

  it('resolves a bare name like the first name of a path', () => {
    const doc = new Y.Doc();
    const x = ensureCatalogEntry(doc, 'notebooks', 'X', newId);
    const y = ensureCatalogEntry(doc, 'notebooks', 'Y', newId);
    const inX = ensureChildNotebook(doc, x.id, 'Notes', newId);
    // Only one, deeper: reused, by a bare name and as the first name of a path.
    expect(ensureNotebookPath(doc, ['notes'], newId).id).toBe(inX.id);
    const sub = ensureNotebookPath(doc, ['Notes', 'Sub'], newId);
    expect(notebookParents(doc).get(sub.id)).toBe(inX.id);
    // Two deeper ones: neither is guessed; a new one is made at the top level.
    ensureChildNotebook(doc, y.id, 'Notes', newId);
    const top = ensureNotebookPath(doc, ['Notes'], newId);
    expect([inX.id, x.id, y.id]).not.toContain(top.id);
    expect(notebookParents(doc).get(top.id)).toBe(null);
    // A top-level one wins over the deeper ones.
    expect(ensureNotebookPath(doc, ['notes'], newId).id).toBe(top.id);
  });

  it('deleting a notebook moves its sub-notebooks up', () => {
    const doc = new Y.Doc();
    const a = ensureCatalogEntry(doc, 'notebooks', 'A', newId);
    const b = ensureChildNotebook(doc, a.id, 'B', newId);
    ensureChildNotebook(doc, b.id, 'C', newId);
    expect(removeNotebook(doc, b.id)).toBe(a.id);
    expect(tree(doc)).toEqual(['A', '  C']);
    expect(removeNotebook(doc, a.id)).toBe(null);
    expect(tree(doc)).toEqual(['C']);
  });

  it('survives old versions and concurrent moves', () => {
    const a = new Y.Doc();
    const x = ensureCatalogEntry(a, 'notebooks', 'X', newId);
    const y = ensureCatalogEntry(a, 'notebooks', 'Y', newId);
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    // Two devices nest them into each other at the same time: a loop, cut the same way on both.
    setNotebookParent(a, x.id, y.id);
    setNotebookParent(b, y.id, x.id);
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(tree(a)).toEqual(tree(b));
    expect(listNotebookTree(a)).toHaveLength(2);
    // An old version renames the parent (rewrites the entry value) and deletes the child's
    // parent entry: the rename keeps the tree, a missing parent means top level.
    const c = new Y.Doc();
    const p = ensureCatalogEntry(c, 'notebooks', 'Parent', newId);
    const k = ensureChildNotebook(c, p.id, 'Kid', newId);
    renameCatalogEntry(c, 'notebooks', p.id, 'Parent 2');
    expect(tree(c)).toEqual(['Parent 2', '  Kid']);
    removeCatalogEntry(c, 'notebooks', p.id);
    expect(tree(c)).toEqual(['Kid']);
    expect(notebookParents(c).get(k.id)).toBe(null);
  });
});
