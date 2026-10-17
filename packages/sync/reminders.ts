import * as Y from 'yjs';
import { seal, unseal } from '@noted/crypto';
import { isReminderRepeat } from '@noted/editor/reminder-time';
import type { ReminderState } from '@noted/editor/reminder-time';
import { buildNoteMeta, decodeNoteMeta, encodeNoteMeta } from './note-meta';
import { docFromSealed } from './doc';
import type { LocalNoteStore } from './engine';

// Reminders outside the editor: changing a reminder chip inside a note's doc (the Reminders
// view, notifications), reminders of their own (no note) in the catalog, and the one-time
// indexing of old note meta.

const BODY_KEY = 'default';

const findReminder = (node: Y.XmlFragment | Y.XmlElement, id: string): { parent: Y.XmlFragment | Y.XmlElement; index: number; element: Y.XmlElement } | null => {
  const children = node.toArray();
  for (let index = 0; index < children.length; index++) {
    const child = children[index];
    if (!(child instanceof Y.XmlElement)) continue;
    if (child.nodeName === 'reminder' && child.getAttribute('id') === id) return { parent: node, index, element: child };
    const found = findReminder(child, id);
    if (found) return found;
  }
  return null;
};

// Changes the reminder chip `id` in a note (null = removes it). The attributes are written
// the way the editor's Yjs binding stores them (absent = null / false). False when the note
// has no such reminder.
export const updateReminderInDoc = (doc: Y.Doc, id: string, change: ReminderState | null, origin?: unknown): boolean => {
  const found = findReminder(doc.getXmlFragment(BODY_KEY), id);
  if (!found) return false;
  doc.transact(() => {
    if (!change) {
      found.parent.delete(found.index, 1);
      return;
    }
    const { element } = found;
    element.setAttribute('at', change.at as unknown as string);
    if (change.repeat) element.setAttribute('repeat', change.repeat);
    else element.removeAttribute('repeat');
    element.setAttribute('done', change.done as unknown as string);
    if (change.snooze) element.setAttribute('snooze', change.snooze as unknown as string);
    else element.removeAttribute('snooze');
  }, origin);
  return true;
};

// ---- reminders of their own, kept in the catalog (Y.Map `reminders`: id -> value) ----

export interface OwnReminder extends ReminderState {
  id: string;
  text: string;
  created: number;
}

const ownMap = (catalog: Y.Doc): Y.Map<unknown> => catalog.getMap('reminders');

export const listOwnReminders = (catalog: Y.Doc): OwnReminder[] => {
  const list: OwnReminder[] = [];
  ownMap(catalog).forEach((value, id) => {
    if (!value || typeof value !== 'object') return;
    const data = value as Record<string, unknown>;
    if (typeof data.at !== 'number') return;
    list.push({
      id,
      text: typeof data.text === 'string' ? data.text : '',
      at: data.at,
      repeat: isReminderRepeat(data.repeat) ? data.repeat : null,
      done: data.done === true,
      ...(typeof data.snooze === 'number' && data.snooze > 0 ? { snooze: data.snooze } : {}),
      created: typeof data.created === 'number' ? data.created : 0,
    });
  });
  return list;
};

// Only the known fields are stored (callers may pass a whole list entry).
export const setOwnReminder = (catalog: Y.Doc, reminder: OwnReminder): void => {
  const { id, text, at, repeat, done, created, snooze } = reminder;
  ownMap(catalog).set(id, { text, at, repeat, done, created, ...(snooze ? { snooze } : {}) });
};

export const deleteOwnReminder = (catalog: Y.Doc, id: string): void => {
  ownMap(catalog).delete(id);
};

// ---- meta saved before reminders were indexed ----

// The `content` column is sealed in the database; an app may hand over already opened rows.
const openContent = (masterKey: Uint8Array, content: string | null): string | null => {
  if (!content || content.startsWith('{')) return content;
  try {
    return new TextDecoder().decode(unseal(masterKey, content));
  } catch {
    return content;
  }
};

// Rebuilds the meta of notes whose stored meta has no `reminders` yet (saved by an older
// version). Only the local `content` column changes: the doc and the timestamp stay, so
// nothing is uploaded again (another device indexes its own copy the same way).
// Returns how many notes were updated.
export const refreshStaleNoteMeta = async (masterKey: Uint8Array, store: LocalNoteStore): Promise<number> => {
  let updated = 0;
  for (const record of await store.getAll()) {
    if (!record.yjs_state || !record.yjs_state.includes('.')) continue;
    try {
      const plain = openContent(masterKey, record.content);
      const meta = decodeNoteMeta(plain);
      if (meta.reminders || meta.deleted) continue;
      const fresh = buildNoteMeta(docFromSealed(masterKey, record.yjs_state));
      await store.save(record.id, seal(masterKey, new TextEncoder().encode(encodeNoteMeta(fresh))), record.yjs_state, record.updated_at);
      updated++;
    } catch {
      // A note that cannot be opened keeps its old meta.
    }
  }
  return updated;
};
