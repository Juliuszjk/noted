import * as Y from 'yjs';
import type { JSONContent } from '@tiptap/core';
import { seal, unseal } from '@noted/crypto';
import {
  buildNoteMeta, CATALOG_ID, decodeNoteMeta, docFromSealed, encodeNoteMeta, getNoteFlag, getNoteNotebooks, getNoteTags,
  getTitleText, isSystemNote, listCatalog, mergingNoteStore, noteBodyJson, refreshStaleNoteMeta, runSyncEngine, sealDoc,
  setNoteFlag, setNoteNotebook, setNoteTag, setNoteTrashed, setTitle,
} from '@noted/sync';
import type { LocalNoteStore, NoteMeta } from '@noted/sync';
import type { NoteRecord } from '@noted/types';
import { applyRewrite } from './edits';
import type { RewriteItem } from './markdown';
import type { openStore } from './store';

// The notes as Claude may see them: every note except the catalog, notes deleted for good,
// locked notes and notes in a protected notebook ("Protected"). Changes are saved like every
// device saves (sealed meta + Yjs state, through mergingNoteStore) and pushed at once; the
// state before each change is kept for undo_last_change.

export const PROTECTED_NOTEBOOKS = (process.env.NOTED_MCP_PROTECTED || 'Protected').split(',').map((s) => s.trim()).filter(Boolean);

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ł/g, 'l').trim();
export const isProtectedName = (name: string) => PROTECTED_NOTEBOOKS.some((p) => fold(p) === fold(name));

export interface NoteInfo {
  id: string;
  meta: NoteMeta;
  updatedAt: number;
}

// What undo puts back.
interface Snapshot {
  title: string;
  body: JSONContent[];
  notebooks: string[];
  tags: string[];
  flags: Record<string, boolean>;
}
const FLAGS = ['pinned', 'favorite', 'archived'] as const;

export class HiddenNoteError extends Error {}

export const createNotes = (key: Uint8Array, stores: ReturnType<typeof openStore>, options: { online?: boolean } = {}) => {
  const store: LocalNoteStore & { get(id: string): Promise<NoteRecord | null> } = mergingNoteStore(key, stores.notes);
  const online = options.online ?? true;
  let lastSync = 0;
  let syncError: string | null = null;
  let indexed = false;

  const sync = async (force = false): Promise<string | null> => {
    if (!online) return null;
    if (!force && Date.now() - lastSync < 5_000) return syncError;
    try {
      const result = await runSyncEngine(key, store, null, null);
      syncError = result.failedNotes ? `${result.failedNotes} note(s) could not be synced` : null;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      syncError = message.startsWith('Key mismatch')
        ? 'The saved key does not open this vault: run the setup again.'
        : message === 'Unauthorized'
        ? 'The server does not accept this key any more (logged out from another device?): run the setup again.'
        : `Offline (${message}); working on the local copy.`;
    }
    lastSync = Date.now();
    if (!indexed) {
      indexed = true;
      await refreshStaleNoteMeta(key, store);
    }
    return syncError;
  };

  const metaOf = (record: NoteRecord): NoteMeta => {
    try {
      return decodeNoteMeta(record.content.startsWith('{') ? record.content : new TextDecoder().decode(unseal(key, record.content)));
    } catch {
      return decodeNoteMeta('');
    }
  };
  const docOf = (record: NoteRecord) => (record.yjs_state && record.yjs_state.includes('.') ? docFromSealed(key, record.yjs_state) : new Y.Doc());

  const catalog = async (): Promise<Y.Doc> => {
    const record = await store.get(CATALOG_ID);
    return record ? docOf(record) : new Y.Doc();
  };
  const protectedIds = (cat: Y.Doc) => new Set(listCatalog(cat, 'notebooks').filter((e) => isProtectedName(e.name)).map((e) => e.id));

  // Why Claude may not see a note (null = it may).
  const hiddenReason = (id: string, meta: NoteMeta, prot: Set<string>): string | null => {
    if (isSystemNote(id)) return 'a system note';
    if (meta.deleted) return 'deleted';
    if (meta.locked) return 'locked';
    if (meta.notebooks.some((n) => prot.has(n))) return 'protected';
    return null;
  };

  const list = async (): Promise<NoteInfo[]> => {
    const prot = protectedIds(await catalog());
    return (await store.getAll())
      .map((record) => ({ id: record.id, meta: metaOf(record), updatedAt: record.updated_at }))
      .filter((n) => !hiddenReason(n.id, n.meta, prot))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  };

  // A note Claude may see, with its doc; checked on the doc itself (not only the stored meta).
  const open = async (id: string): Promise<{ doc: Y.Doc; meta: NoteMeta; updatedAt: number }> => {
    const record = await store.get(id);
    if (!record) throw new HiddenNoteError(`No note with id ${id}.`);
    const doc = docOf(record);
    const meta = buildNoteMeta(doc);
    const reason = hiddenReason(id, meta, protectedIds(await catalog()));
    if (reason) throw new HiddenNoteError(reason === 'protected' || reason === 'locked' ? 'This note is not available to Claude.' : `No note with id ${id}.`);
    return { doc, meta, updatedAt: record.updated_at };
  };

  const snapshot = (doc: Y.Doc): Snapshot => ({
    title: getTitleText(doc).toString(),
    body: noteBodyJson(doc).content ?? [],
    notebooks: getNoteNotebooks(doc),
    tags: getNoteTags(doc),
    flags: Object.fromEntries(FLAGS.map((f) => [f, getNoteFlag(doc, f)])),
  });

  const saveDoc = async (id: string, doc: Y.Doc) => {
    const meta = encodeNoteMeta(buildNoteMeta(doc));
    await store.save(id, seal(key, new TextEncoder().encode(meta)), sealDoc(key, doc), Date.now());
  };

  // Saves a changed note (refused when the change would move it out of Claude's reach) and
  // pushes it. `before`: the doc's state before the change, for undo (null = a new note).
  const write = async (id: string, doc: Y.Doc, action: string, before: Snapshot | null): Promise<string | null> => {
    const meta = buildNoteMeta(doc);
    if (hiddenReason(id, meta, protectedIds(await catalog()))) throw new HiddenNoteError('This change would put the note out of reach (protected / locked); not saved.');
    stores.history.add(id, action, seal(key, new TextEncoder().encode(JSON.stringify(before))));
    await saveDoc(id, doc);
    return sync(true);
  };

  const writeCatalog = async (change: (doc: Y.Doc) => void): Promise<void> => {
    const doc = await catalog();
    change(doc);
    await saveDoc(CATALOG_ID, doc);
  };

  // Puts back the note as it was before Claude's last change (of this note, or of any).
  const undo = async (noteId?: string): Promise<{ id: string; action: string; at: number } | null> => {
    const entry = stores.history.last(noteId);
    if (!entry) return null;
    const before = JSON.parse(new TextDecoder().decode(unseal(key, entry.before))) as Snapshot | null;
    const { doc } = await open(entry.noteId);
    if (!before) {
      // Created by Claude: to the trash (never deleted for good).
      setNoteTrashed(doc, true);
    } else {
      setTitle(doc, before.title);
      const current = noteBodyJson(doc).content ?? [];
      const used = new Set<number>();
      const items: RewriteItem[] = before.body.map((json) => {
        const same = current.findIndex((c, i) => !used.has(i) && JSON.stringify(c) === JSON.stringify(json));
        if (same < 0) return { json };
        used.add(same);
        return { keep: same };
      });
      applyRewrite(doc, items, current);
      for (const id of getNoteNotebooks(doc)) if (!before.notebooks.includes(id)) setNoteNotebook(doc, id, false);
      for (const id of before.notebooks) setNoteNotebook(doc, id, true);
      for (const id of getNoteTags(doc)) if (!before.tags.includes(id)) setNoteTag(doc, id, false);
      for (const id of before.tags) setNoteTag(doc, id, true);
      for (const f of FLAGS) setNoteFlag(doc, f, !!before.flags[f]);
    }
    await saveDoc(entry.noteId, doc);
    stores.history.remove(entry.id);
    await sync(true);
    return { id: entry.noteId, action: entry.action, at: entry.at };
  };

  return { sync, list, open, write, writeCatalog, catalog, snapshot, undo, protectedIds };
};

export type Notes = ReturnType<typeof createNotes>;
