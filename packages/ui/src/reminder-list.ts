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
