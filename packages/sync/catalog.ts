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
