import { reminderDue, reminderStatus } from '@noted/editor/reminder-time';
import type { ReminderState } from '@noted/editor/reminder-time';
import type { NoteReminder, OwnReminder } from '@noted/sync';

// The Reminders view (desktop list column, phone list): reminder chips of notes and reminders
// of their own, in sections. Pure, shared by both apps (reminder-list.test.ts).

export interface ReminderEntry extends ReminderState {
  // Unique in the list: "<noteId>/<id>" or "own/<id>".
  key: string;
  id: string;
  // The note holding the chip; null for a reminder of its own.
  noteId: string | null;
  // The chip's line, or the reminder's own text.
  text: string;
  // Title of the note (shown under the text).
  noteTitle: string | null;
}

export interface ReminderNoteSource {
  id: string;
  title: string;
  reminders?: NoteReminder[];
  trashedAt?: number | null;
}

export const reminderEntries = (notes: ReminderNoteSource[], own: OwnReminder[]): ReminderEntry[] => {
  const entries: ReminderEntry[] = [];
  for (const note of notes) {
    if (note.trashedAt) continue;
    for (const r of note.reminders ?? []) {
      entries.push({ key: `${note.id}/${r.id}`, id: r.id, noteId: note.id, text: r.text, noteTitle: note.title, at: r.at, repeat: r.repeat, done: r.done, snooze: r.snooze ?? null });
    }
  }
  for (const r of own) entries.push({ key: `own/${r.id}`, id: r.id, noteId: null, text: r.text, noteTitle: null, at: r.at, repeat: r.repeat, done: r.done, snooze: r.snooze ?? null });
  return entries;
};

export type ReminderSectionKind = 'overdue' | 'today' | 'upcoming' | 'done';

export interface ReminderSection {
  kind: ReminderSectionKind;
  title: string;
  items: ReminderEntry[];
}

const TITLES: Record<ReminderSectionKind, string> = { overdue: 'Overdue', today: 'Today', upcoming: 'Upcoming', done: 'Done' };
// Done reminders shown (the most recent ones).
const DONE_LIMIT = 50;

// Overdue (oldest first), Today, Upcoming (soonest first), Done (latest first). Empty sections
// are left out. `query` filters by text and note title.
export const reminderSections = (entries: ReminderEntry[], now: Date, query = ''): ReminderSection[] => {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (e: ReminderEntry) => words.every((w) => `${e.text} ${e.noteTitle ?? ''}`.toLowerCase().includes(w));
  const groups: Record<ReminderSectionKind, ReminderEntry[]> = { overdue: [], today: [], upcoming: [], done: [] };
  for (const entry of entries) if (matches(entry)) groups[reminderStatus(entry, now)].push(entry);
  const byDue = (a: ReminderEntry, b: ReminderEntry) => reminderDue(a) - reminderDue(b);
  groups.overdue.sort(byDue);
  groups.today.sort(byDue);
  groups.upcoming.sort(byDue);
  groups.done = groups.done.sort((a, b) => b.at - a.at).slice(0, DONE_LIMIT);
  return (Object.keys(groups) as ReminderSectionKind[])
    .filter((kind) => groups[kind].length)
    .map((kind) => ({ kind, title: TITLES[kind], items: groups[kind] }));
};

// Count shown in the navigation: reminders due now or today (not done).
export const dueReminderCount = (entries: ReminderEntry[], now: Date): number =>
  entries.filter((e) => { const s = reminderStatus(e, now); return s === 'overdue' || s === 'today'; }).length;

// Label of an entry: its text, or the note's title for a chip on an empty line.
export const reminderLabel = (entry: ReminderEntry): string => entry.text || entry.noteTitle || 'Reminder';

// The home screen widget's groups: Overdue, Today, Tomorrow, then by calendar week / month
// (weeks start on Monday, local time). Not done only, soonest first; empty groups left out.
export interface ReminderGroup {
  title: string;
  overdue: boolean;
  items: ReminderEntry[];
}
export const reminderGroups = (entries: ReminderEntry[], now: Date): ReminderGroup[] => {
  const day = (offset: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset).getTime();
  // Monday of the week `n` weeks from this one.
  const week = (n: number) => day(7 * n - ((now.getDay() + 6) % 7));
  const month = (n: number) => new Date(now.getFullYear(), now.getMonth() + n, 1).getTime();
  // [title, due before]
  const bounds: [string, number][] = [
    ['Today', day(1)], ['Tomorrow', day(2)], ['This week', week(1)], ['Next week', week(2)],
    ['This month', month(1)], ['Next month', month(2)], ['Later', Infinity],
  ];
  const groups: ReminderGroup[] = [];
  const add = (title: string, entry: ReminderEntry) => {
    let group = groups.find((g) => g.title === title);
    if (!group) groups.push(group = { title, overdue: title === 'Overdue', items: [] });
    group.items.push(entry);
  };
  const open = entries.filter((e) => !e.done).sort((a, b) => reminderDue(a) - reminderDue(b));
  for (const entry of open) {
    const due = reminderDue(entry);
    if (reminderStatus(entry, now) === 'overdue') add('Overdue', entry);
    else add(bounds.find(([, before]) => due < before)![0], entry);
  }
  return groups;
};
