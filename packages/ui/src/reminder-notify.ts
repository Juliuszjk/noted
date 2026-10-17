import { formatClock, reminderDue } from '@noted/editor/reminder-time';
import { reminderLabel } from './reminder-list';
import type { ReminderEntry } from './reminder-list';

// Notifications of reminders (desktop: Rust timer + D-Bus, phone: scheduled Android alarms).
// Pure, shared by both apps (reminder-notify.test.ts). Each device notifies on its own; a
// button pressed on one changes the reminder, which syncs and clears the other's notification.

export interface ReminderNotice {
  // "<entry key>@<due>": a snoozed or repeating reminder gets a new notice for each time.
  id: string;
  key: string;
  noteId: string | null;
  due: number;
  title: string;
  body: string;
}

export const noticeId = (key: string, due: number): string => `${key}@${due}`;

export const parseNoticeId = (id: string): { key: string; due: number } | null => {
  const at = id.lastIndexOf('@');
  const due = Number(id.slice(at + 1));
  return at > 0 && Number.isFinite(due) ? { key: id.slice(0, at), due } : null;
};

// Reminders missed while the app was closed still notify when it starts, if this recent.
export const MISSED_WITHIN_MS = 12 * 60 * 60 * 1000;

// Notices of reminders that are not done, due after `now - missedWithin`, soonest first
// (Android keeps a limited number of alarms: `limit`).
export const reminderNotices = (
  entries: ReminderEntry[], now: number, { missedWithin = MISSED_WITHIN_MS, limit = 50 } = {},
): ReminderNotice[] =>
  entries
    .filter((entry) => !entry.done && reminderDue(entry) > now - missedWithin)
    .map((entry) => {
      const due = reminderDue(entry);
      const when = formatClock(new Date(due));
      const note = entry.noteId && entry.text ? entry.noteTitle || 'Untitled' : null;
      return {
        id: noticeId(entry.key, due),
        key: entry.key,
        noteId: entry.noteId,
        due,
        title: reminderLabel(entry),
        body: note ? `${when} · ${note}` : when,
      };
    })
    .sort((a, b) => a.due - b.due)
    .slice(0, limit);
