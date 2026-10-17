import { describe, it, expect } from 'vitest';
import { dueReminderCount, reminderEntries, reminderGroups, reminderLabel, reminderSections } from './reminder-list';

const local = (d: number, h: number) => new Date(2026, 9, d, h).getTime();
const now = new Date(2026, 9, 17, 12);

const notes = [
  { id: 'n1', title: 'Shopping', reminders: [
    { id: 'a', at: local(17, 9), repeat: null, done: false, text: 'Pick up the parcel' },
    { id: 'b', at: local(17, 18), repeat: null, done: false, text: '' },
  ] },
  { id: 'n2', title: 'Old', trashedAt: 1, reminders: [{ id: 'c', at: local(16, 9), repeat: null, done: false, text: 'Trashed' }] },
  { id: 'n3', title: 'No reminders' },
];
const own = [
  { id: 'x', text: 'Dentist', at: local(20, 8), repeat: 'yearly' as const, done: false, created: 1 },
  { id: 'y', text: 'Call mum', at: local(15, 8), repeat: null, done: true, created: 1 },
];

describe('reminder list', () => {
  const entries = reminderEntries(notes, own);

  it('collects chips of live notes and own reminders', () => {
    expect(entries.map((e) => e.key)).toEqual(['n1/a', 'n1/b', 'own/x', 'own/y']);
    expect(reminderLabel(entries[1])).toBe('Shopping');
  });

  it('sorts them into sections', () => {
    const sections = reminderSections(entries, now);
    expect(sections.map((s) => [s.kind, s.items.map((i) => i.id)])).toEqual([
      ['overdue', ['a']], ['today', ['b']], ['upcoming', ['x']], ['done', ['y']],
    ]);
    expect(dueReminderCount(entries, now)).toBe(2);
  });

  it('filters by text and note title', () => {
    expect(reminderSections(entries, now, 'shop').flatMap((s) => s.items.map((i) => i.id))).toEqual(['a', 'b']);
    expect(reminderSections(entries, now, 'dentist').flatMap((s) => s.items.map((i) => i.id))).toEqual(['x']);
  });
});

describe('widget groups', () => {
  const entry = (id: string, at: number, done = false) => ({ key: `own/${id}`, id, noteId: null, text: id, noteTitle: null, at, repeat: null, done, snooze: null });
  // Saturday 17 October 2026, noon.
  it('groups by overdue, day, week and month', () => {
    const groups = reminderGroups([
      entry('late', local(17, 9)), entry('today', local(17, 18)), entry('tomorrow', local(18, 9)),
      entry('monday', local(19, 9)), entry('week2', local(27, 9)), entry('month', local(30, 9)),
      entry('nov', new Date(2026, 10, 3, 9).getTime()), entry('dec', new Date(2026, 11, 3, 9).getTime()),
      entry('done', local(17, 18), true),
    ], now);
    expect(groups.map((g) => [g.title, g.items.map((i) => i.id)])).toEqual([
      ['Overdue', ['late']], ['Today', ['today']], ['Tomorrow', ['tomorrow']], ['Next week', ['monday']],
      ['This month', ['week2', 'month']], ['Next month', ['nov']], ['Later', ['dec']],
    ]);
  });
});
