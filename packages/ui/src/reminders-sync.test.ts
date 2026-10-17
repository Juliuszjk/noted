// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { Editor } from '@tiptap/core';
import { createSchemaExtensions, reminderAttrs } from '@noted/editor';
import { seal } from '@noted/crypto';
import {
  buildNoteMeta, decodeNoteMeta, encodeNoteMeta, deleteOwnReminder, listOwnReminders, refreshStaleNoteMeta, setOwnReminder, updateReminderInDoc, sealDoc,
} from '@noted/sync';
import type { LocalNoteStore } from '@noted/sync';
import type { NoteRecord } from '@noted/types';

const editorWith = (ydoc: Y.Doc, html: string) => {
  const editor = new Editor({ extensions: createSchemaExtensions({ ydoc, placeholder: '' }) });
  editor.commands.setContent(html);
  return editor;
};

const chips = (editor: Editor) => {
  const found: ReturnType<typeof reminderAttrs>[] = [];
  editor.state.doc.descendants((node) => { if (node.type.name === 'reminder') found.push(reminderAttrs(node)); });
  return found;
};

describe('reminders in a note', () => {
  it('indexes chips with the text of their line', () => {
    const ydoc = new Y.Doc();
    editorWith(ydoc, '<h1>Plan</h1><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Pick up the parcel <span data-reminder data-id="r1" data-at="5000" data-repeat="weekly"></span></p></li></ul><p>No chip here</p>');
    const meta = buildNoteMeta(ydoc);
    expect(meta.reminders).toEqual([{ id: 'r1', at: 5000, repeat: 'weekly', done: false, text: 'Pick up the parcel' }]);
    expect(decodeNoteMeta(encodeNoteMeta(meta)).reminders).toEqual(meta.reminders);
    expect(meta.excerpt).toContain('Pick up the parcel');
  });

  it('changes and removes a chip outside the editor, and the editor follows', () => {
    const ydoc = new Y.Doc();
    const editor = editorWith(ydoc, '<p>Call <span data-reminder data-id="r1" data-at="1000"></span> back</p>');
    expect(updateReminderInDoc(ydoc, 'r1', { at: 9000, repeat: 'daily', done: true })).toBe(true);
    expect(chips(editor)).toEqual([{ id: 'r1', at: 9000, repeat: 'daily', done: true, snooze: null }]);
    expect(updateReminderInDoc(ydoc, 'r1', { at: 9000, repeat: null, done: false })).toBe(true);
    expect(chips(editor)).toEqual([{ id: 'r1', at: 9000, repeat: null, done: false, snooze: null }]);
    expect(updateReminderInDoc(ydoc, 'nope', null)).toBe(false);
    expect(updateReminderInDoc(ydoc, 'r1', null)).toBe(true);
    expect(chips(editor)).toEqual([]);
    expect(editor.getText()).toContain('Call');
  });

  it('carries a snooze from a notification into the editor and the meta', () => {
    const ydoc = new Y.Doc();
    const editor = editorWith(ydoc, '<p>Water the plants <span data-reminder data-id="r1" data-at="1000"></span></p>');
    expect(updateReminderInDoc(ydoc, 'r1', { at: 1000, repeat: null, done: false, snooze: 4000 })).toBe(true);
    expect(chips(editor)).toEqual([{ id: 'r1', at: 1000, repeat: null, done: false, snooze: 4000 }]);
    const meta = buildNoteMeta(ydoc);
    expect(meta.reminders).toEqual([{ id: 'r1', at: 1000, repeat: null, done: false, snooze: 4000, text: 'Water the plants' }]);
    expect(decodeNoteMeta(encodeNoteMeta(meta)).reminders).toEqual(meta.reminders);
    updateReminderInDoc(ydoc, 'r1', { at: 1000, repeat: null, done: true, snooze: null });
    expect(chips(editor)[0].snooze).toBeNull();
  });
});

describe('reminders of their own', () => {
  it('are kept in the catalog', () => {
    const catalog = new Y.Doc();
    setOwnReminder(catalog, { id: 'a', text: 'Dentist', at: 100, repeat: null, done: false, created: 1 });
    setOwnReminder(catalog, { id: 'a', text: 'Dentist', at: 200, repeat: 'yearly', done: false, created: 1 });
    expect(listOwnReminders(catalog)).toEqual([{ id: 'a', text: 'Dentist', at: 200, repeat: 'yearly', done: false, created: 1 }]);
    deleteOwnReminder(catalog, 'a');
    expect(listOwnReminders(catalog)).toEqual([]);
  });
});

describe('refreshStaleNoteMeta', () => {
  it('indexes old meta locally without touching the doc or the time', async () => {
    const key = new Uint8Array(32).fill(7);
    const ydoc = new Y.Doc();
    editorWith(ydoc, '<p>Rent <span data-reminder data-id="r1" data-at="1000"></span></p>');
    const { reminders: _, ...oldMeta } = buildNoteMeta(ydoc);
    const yjs = sealDoc(key, ydoc);
    const rows = new Map<string, NoteRecord>([
      ['n1', { id: 'n1', content: seal(key, new TextEncoder().encode(encodeNoteMeta(oldMeta as never))), yjs_state: yjs, updated_at: 42 } as NoteRecord],
    ]);
    const store: LocalNoteStore = {
      getAll: async () => [...rows.values()],
      save: async (id, content, yjs_state, updated_at) => { rows.set(id, { ...rows.get(id)!, content, yjs_state, updated_at }); },
      updateTimestamp: async () => {},
    };
    expect(await refreshStaleNoteMeta(key, store)).toBe(1);
    expect(rows.get('n1')!.updated_at).toBe(42);
    expect(rows.get('n1')!.yjs_state).toBe(yjs);
    expect(await refreshStaleNoteMeta(key, store)).toBe(0);
  });
});
