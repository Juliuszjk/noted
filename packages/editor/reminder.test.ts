// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import * as Y from 'yjs';
import { createSchemaExtensions } from './extensions';
import { commitReminderEdit, requestReminderAtSelection, requestReminderEdit, reminderAttrs } from './reminder';
import type { ReminderEditRequest } from './reminder';
import { parseEditorPrefs } from './editor-prefs';
import { exportNote } from './export';

const reminders = (editor: Editor) => {
  const found: ReturnType<typeof reminderAttrs>[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'reminder') found.push(reminderAttrs(node));
  });
  return found;
};

const posOf = (editor: Editor, id: string) => {
  let pos = -1;
  editor.state.doc.descendants((node, p) => {
    if (node.type.name === 'reminder' && node.attrs.id === id) pos = p;
  });
  return pos;
};

describe('reminder chips', () => {
  const setup = () => {
    const requests: ReminderEditRequest[] = [];
    const editor = new Editor({
      extensions: createSchemaExtensions({ ydoc: new Y.Doc(), placeholder: '', onEditReminder: (r) => requests.push(r) }),
    });
    editor.commands.setContent('<p>Call the bank</p>');
    return { editor, requests };
  };

  it('inserts, changes, ticks off and deletes a reminder', () => {
    const { editor, requests } = setup();
    const end = editor.state.doc.content.size - 1;
    expect(requestReminderEdit(editor, { mode: 'insert', pos: end })).toBe(true);
    commitReminderEdit(editor, requests[0], { kind: 'save', at: 1000, repeat: null });
    const [first] = reminders(editor);
    expect(first).toMatchObject({ at: 1000, repeat: null, done: false });
    expect(first.id).toMatch(/^[0-9a-f]{24}$/);

    const edit = (): ReminderEditRequest => ({ mode: 'edit', pos: posOf(editor, first.id), attrs: reminders(editor)[0] });
    commitReminderEdit(editor, edit(), { kind: 'save', at: 2000, repeat: 'weekly' });
    expect(reminders(editor)[0]).toMatchObject({ id: first.id, at: 2000, repeat: 'weekly', done: false });

    commitReminderEdit(editor, edit(), { kind: 'save', at: 2000, repeat: 'weekly', done: true });
    expect(reminders(editor)[0].done).toBe(true);
    // A new time makes it pending again.
    commitReminderEdit(editor, edit(), { kind: 'save', at: 3000, repeat: 'weekly' });
    expect(reminders(editor)[0].done).toBe(false);

    commitReminderEdit(editor, edit(), { kind: 'delete' });
    expect(reminders(editor)).toEqual([]);
    expect(editor.getText()).toContain('Call the bank');
  });

  it('survives HTML, gives pasted copies new ids and exports a date', () => {
    const { editor } = setup();
    editor.commands.setContent('<p>Pay rent <span data-reminder data-id="abc" data-at="1790000000000" data-repeat="monthly"></span></p>');
    expect(reminders(editor)).toEqual([{ id: 'abc', at: 1790000000000, repeat: 'monthly', done: false }]);
    editor.view.pasteHTML(editor.getHTML());
    const ids = reminders(editor).map((r) => r.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(exportNote('Rent', editor.getJSON(), 'text')).toMatch(/» \d+ \w{3} 2026 \d\d:\d\d \(monthly\)/);
  });

  it('the shortcut edits a chip next to the cursor, otherwise adds one', () => {
    const { editor, requests } = setup();
    editor.commands.setContent('<p>Pay <span data-reminder data-id="abc" data-at="1000"></span> rent</p>');
    // "Pay " is 1-4, the chip sits at 5.
    editor.commands.setTextSelection(6);
    requestReminderAtSelection(editor);
    expect(requests.pop()).toMatchObject({ mode: 'edit', pos: 5, attrs: { id: 'abc' } });
    editor.commands.setTextSelection(5);
    requestReminderAtSelection(editor);
    expect(requests.pop()).toMatchObject({ mode: 'edit', pos: 5 });
    editor.commands.setTextSelection(10);
    requestReminderAtSelection(editor);
    expect(requests.pop()).toEqual({ mode: 'insert', pos: 10 });
  });

  it('reads the morning and evening settings', () => {
    expect(parseEditorPrefs('{}')).toMatchObject({ reminderMorning: '07:00', reminderEvening: '18:00' });
    expect(parseEditorPrefs('{"reminderMorning":"6:30","reminderEvening":"nope"}')).toMatchObject({ reminderMorning: '06:30', reminderEvening: '18:00' });
  });
});
