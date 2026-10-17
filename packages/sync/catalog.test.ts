import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  ensureCatalogEntry, listCatalog, renameCatalogEntry, removeCatalogEntry, getSharedEditorPrefs, setSharedEditorPrefs, getSharedTitleTemplate,
  setSharedTitleTemplate, sharedPrefsChange,
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
