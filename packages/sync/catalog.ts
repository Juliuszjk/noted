import * as Y from 'yjs';

// Names of notebooks (categories) and tags. They live in one hidden "note" with a fixed id,
// so they are encrypted and synced like every note, with no server change. Notes refer to
// entries by id (note-meta.ts: notebook, tags).
export const CATALOG_ID = 'noted-catalog';

// Notes that are not shown in lists (the catalog).
export const isSystemNote = (id: string): boolean => id === CATALOG_ID;

export interface CatalogEntry {
  id: string;
  name: string;
  createdAt: number;
}

export type CatalogKind = 'notebooks' | 'tags';

const entries = (doc: Y.Doc, kind: CatalogKind): Y.Map<{ name: string; createdAt: number }> => doc.getMap(kind);

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ł/g, 'l').trim();

export const listCatalog = (doc: Y.Doc, kind: CatalogKind): CatalogEntry[] =>
  [...entries(doc, kind).entries()]
    .filter(([, v]) => v && typeof v.name === 'string')
    .map(([id, v]) => ({ id, name: v.name, createdAt: typeof v.createdAt === 'number' ? v.createdAt : 0 }))
    .sort((a, b) => a.name.localeCompare(b.name));

export const findCatalogEntry = (doc: Y.Doc, kind: CatalogKind, name: string): CatalogEntry | undefined =>
  listCatalog(doc, kind).find((e) => fold(e.name) === fold(name));

// Returns the entry with this name (case and accents ignored), creating it if needed.
export const ensureCatalogEntry = (doc: Y.Doc, kind: CatalogKind, name: string, newId: () => string): CatalogEntry => {
  const clean = name.trim().replace(/^#/, '').trim();
  if (!clean) throw new Error('Empty name');
  const existing = findCatalogEntry(doc, kind, clean);
  if (existing) return existing;
  const entry = { id: newId(), name: clean, createdAt: Date.now() };
  entries(doc, kind).set(entry.id, { name: entry.name, createdAt: entry.createdAt });
  return entry;
};

export const renameCatalogEntry = (doc: Y.Doc, kind: CatalogKind, id: string, name: string): void => {
  const current = entries(doc, kind).get(id);
  const clean = name.trim();
  if (current && clean) entries(doc, kind).set(id, { ...current, name: clean });
};

// Notes keep the id; without an entry it is simply not shown.
export const removeCatalogEntry = (doc: Y.Doc, kind: CatalogKind, id: string): void => {
  entries(doc, kind).delete(id);
};

// Sub-notebooks: a notebook may sit inside another one. The parent of each notebook is a key
// of its own Y.Map `notebookParents` (notebook id -> parent id), not part of the entry value:
// versions without sub-notebooks rewrite entry values (rename) without knowing the field, and a
// rename on one device and a move on another must both survive the merge. Those versions
// never read this map, so they simply show every notebook at the top level, and notes keep
// their notebook ids either way. A parent that no longer exists (deleted on such a device) or a
// loop (two devices moving notebooks into each other at once) is read as top level.
const parentsMap = (doc: Y.Doc): Y.Map<string> => doc.getMap('notebookParents');

export interface NotebookNode extends CatalogEntry {
  parent: string | null;
  depth: number;
  // Names from the top-level notebook down to this one.
  path: string[];
}

// The parent of every notebook as it is shown: only existing notebooks, loops cut (in a loop,
// the notebook with the smallest id becomes top level, the same on every device).
export const notebookParents = (doc: Y.Doc): Map<string, string | null> => {
  const ids = new Set(listCatalog(doc, 'notebooks').map((e) => e.id));
  const raw = parentsMap(doc);
  const parents = new Map<string, string | null>();
  for (const id of ids) {
    const p = raw.get(id);
    parents.set(id, typeof p === 'string' && p !== id && ids.has(p) ? p : null);
  }
  for (const start of ids) {
    const path: string[] = [];
    const seen = new Set<string>();
    let at: string | null = start;
    while (at !== null && !seen.has(at)) {
      seen.add(at);
      path.push(at);
      at = parents.get(at) ?? null;
    }
    if (at === null) continue;
    const loop = path.slice(path.indexOf(at));
    parents.set([...loop].sort()[0], null);
  }
  return parents;
};

// Notebooks as a tree, depth first: top level by name, children by name under their parent.
export const listNotebookTree = (doc: Y.Doc): NotebookNode[] => {
  const entries = listCatalog(doc, 'notebooks');
  const parents = notebookParents(doc);
  const children = new Map<string | null, CatalogEntry[]>();
  for (const e of entries) {
    const p = parents.get(e.id) ?? null;
    children.set(p, [...(children.get(p) ?? []), e]);
  }
  const out: NotebookNode[] = [];
  const walk = (parent: string | null, depth: number, path: string[]) => {
    for (const e of children.get(parent) ?? []) {
      const node = { ...e, parent, depth, path: [...path, e.name] };
      out.push(node);
      walk(e.id, depth + 1, node.path);
    }
  };
  walk(null, 0, []);
  return out;
};

// The notebook and every notebook below it.
export const notebookSubtree = (nodes: { id: string; parent: string | null }[], id: string): Set<string> => {
  const out = new Set([id]);
  for (let grew = true; grew;) {
    grew = false;
    for (const n of nodes) if (n.parent && out.has(n.parent) && !out.has(n.id)) { out.add(n.id); grew = true; }
  }
  return out;
};

// Full names like "Studia / Semestr 5 / Algorithms".
export const NOTEBOOK_PATH_SEPARATOR = ' / ';
export const notebookPathNames = (nodes: NotebookNode[]): Map<string, string> =>
  new Map(nodes.map((n) => [n.id, n.path.join(NOTEBOOK_PATH_SEPARATOR)]));

// Moves a notebook under `parent` (null = top level). Refused (false) for itself or a notebook
// below it.
export const setNotebookParent = (doc: Y.Doc, id: string, parent: string | null): boolean => {
  if (!entries(doc, 'notebooks').has(id)) return false;
  if (parent !== null) {
    if (!entries(doc, 'notebooks').has(parent)) return false;
    const nodes = [...notebookParents(doc)].map(([nid, p]) => ({ id: nid, parent: p }));
    if (notebookSubtree(nodes, id).has(parent)) return false;
  }
  const map = parentsMap(doc);
  if (parent === null) { if (map.has(id)) map.delete(id); } else if (map.get(id) !== parent) map.set(id, parent);
  return true;
};

const childNamed = (doc: Y.Doc, parent: string | null, name: string): CatalogEntry | undefined => {
  const parents = notebookParents(doc);
  return listCatalog(doc, 'notebooks').find((e) => (parents.get(e.id) ?? null) === parent && fold(e.name) === fold(name));
};

// A notebook with this name directly inside `parent` (null = top level), created if missing.
// A name like "A/B" is a path below `parent`: B inside A, each level created if missing.
export const ensureChildNotebook = (doc: Y.Doc, parent: string | null, name: string, newId: () => string): CatalogEntry => {
  const path = splitNotebookPath(name);
  if (!path.length) throw new Error('Empty name');
  let at: CatalogEntry | null = null;
  for (const part of path) at = childNotebook(doc, at?.id ?? parent, part, newId);
  return at!;
};

const childNotebook = (doc: Y.Doc, parent: string | null, clean: string, newId: () => string): CatalogEntry => {
  const existing = childNamed(doc, parent, clean);
  if (existing) return existing;
  let created: CatalogEntry | undefined;
  doc.transact(() => {
    created = { id: newId(), name: clean, createdAt: Date.now() };
    entries(doc, 'notebooks').set(created.id, { name: created.name, createdAt: created.createdAt });
    if (parent !== null) parentsMap(doc).set(created.id, parent);
  });
  return created!;
};

// "Linux/TODO" -> ["Linux", "TODO"].
export const splitNotebookPath = (path: string): string[] => path.split('/').map((s) => s.trim()).filter(Boolean);

// Finds the notebook of a path without changing anything: `found` = the notebooks that exist,
// from the top (may be shorter than the path). The first name is looked up at the top level,
// else anywhere when only one notebook has it ("Semestr 5/Algorithms").
export const resolveNotebookPath = (doc: Y.Doc, path: string[]): CatalogEntry[] => {
  const found: CatalogEntry[] = [];
  if (!path.length) return found;
  const first = childNamed(doc, null, path[0]) ?? (() => {
    const hits = listCatalog(doc, 'notebooks').filter((e) => fold(e.name) === fold(path[0]));
    return hits.length === 1 ? hits[0] : undefined;
  })();
  if (!first) return found;
  found.push(first);
  for (const name of path.slice(1)) {
    const next = childNamed(doc, found[found.length - 1].id, name);
    if (!next) break;
    found.push(next);
  }
  return found;
};

// The notebook of a path like ["Linux", "TODO"], creating the missing levels (a first name
// found nowhere, or in several places but not at the top level, is created at the top level).
export const ensureNotebookPath = (doc: Y.Doc, path: string[], newId: () => string): CatalogEntry => {
  if (!path.length) throw new Error('Empty name');
  const found = resolveNotebookPath(doc, path);
  let at: CatalogEntry | null = found[found.length - 1] ?? null;
  for (const name of path.slice(found.length)) at = childNotebook(doc, at?.id ?? null, name, newId);
  return at!;
};

// Deletes a notebook; its sub-notebooks move up into its parent. Returns that parent (null =
// top level) so the caller can move the notebook's notes there too.
export const removeNotebook = (doc: Y.Doc, id: string): string | null => {
  const parents = notebookParents(doc);
  const parent = parents.get(id) ?? null;
  doc.transact(() => {
    const map = parentsMap(doc);
    for (const [child, p] of parents) {
      if (p !== id) continue;
      if (parent === null) map.delete(child);
      else map.set(child, parent);
    }
    map.delete(id);
    entries(doc, 'notebooks').delete(id);
  });
  return parent;
};

// Editor settings shared by every device (default title, morning / evening of reminders),
// kept in the catalog so they are encrypted and synced. A key never set = each device's own
// value.
export const SHARED_EDITOR_PREFS = ['titleTemplate', 'reminderMorning', 'reminderEvening'] as const;
export type SharedEditorPrefKey = (typeof SHARED_EDITOR_PREFS)[number];
export type SharedEditorPrefs = Partial<Record<SharedEditorPrefKey, string>>;

export const getSharedEditorPrefs = (doc: Y.Doc): SharedEditorPrefs => {
  const prefs = doc.getMap('prefs');
  const shared: SharedEditorPrefs = {};
  for (const key of SHARED_EDITOR_PREFS) {
    const value = prefs.get(key);
    if (typeof value === 'string') shared[key] = value;
  }
  return shared;
};

export const setSharedEditorPrefs = (doc: Y.Doc, patch: SharedEditorPrefs): void => {
  const prefs = doc.getMap('prefs');
  for (const key of SHARED_EDITOR_PREFS) {
    const value = patch[key];
    if (typeof value === 'string' && prefs.get(key) !== value) prefs.set(key, value);
  }
};

// The changed shared keys between two sets of editor settings.
export const sharedPrefsChange = (before: Record<SharedEditorPrefKey, string>, after: Record<SharedEditorPrefKey, string>): SharedEditorPrefs | null => {
  const patch: SharedEditorPrefs = {};
  for (const key of SHARED_EDITOR_PREFS) if (before[key] !== after[key]) patch[key] = after[key];
  return Object.keys(patch).length ? patch : null;
};

export const getSharedTitleTemplate = (doc: Y.Doc): string | null => getSharedEditorPrefs(doc).titleTemplate ?? null;

export const setSharedTitleTemplate = (doc: Y.Doc, value: string): void => setSharedEditorPrefs(doc, { titleTemplate: value });
