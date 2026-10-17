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

// Settings shared by every device (for now the default title of new notes), kept in the
// catalog so they are encrypted and synced. null = never set (each device's own value).
export const getSharedTitleTemplate = (doc: Y.Doc): string | null => {
  const value = doc.getMap('prefs').get('titleTemplate');
  return typeof value === 'string' ? value : null;
};

export const setSharedTitleTemplate = (doc: Y.Doc, value: string): void => {
  if (getSharedTitleTemplate(doc) !== value) doc.getMap('prefs').set('titleTemplate', value);
};
