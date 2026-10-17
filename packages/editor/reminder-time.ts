// Dates of reminders: repeating, quick choices ("Tomorrow morning"), labels. Pure functions
// without Tiptap, so React Native and the sync package can use them too (reminder-time.test.ts).
// A reminder time is a moment (ms since 1970); repeating steps in local time, so a weekly
// reminder stays at 12:00 across a daylight saving change.

export type ReminderRepeat = 'daily' | 'weekly' | 'monthly' | 'yearly';

export const REMINDER_REPEATS: { value: ReminderRepeat | null; label: string }[] = [
  { value: null, label: 'Once' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
];

export const isReminderRepeat = (value: unknown): value is ReminderRepeat =>
  value === 'daily' || value === 'weekly' || value === 'monthly' || value === 'yearly';

// "Morning" and "evening" of the quick choices, "HH:MM" (Settings > Editor).
export interface ReminderTimes {
  morning: string;
  evening: string;
}

export const DEFAULT_REMINDER_TIMES: ReminderTimes = { morning: '07:00', evening: '18:00' };

// "7", "730", "0730", "7:30", "7.30" -> { hours: 7, minutes: 30 }; null when it is not a time.
export const parseClock = (text: string): { hours: number; minutes: number } | null => {
  const clean = text.trim();
  let match = /^(\d{1,2})(?:[:.](\d{2}))?$/.exec(clean);
  if (!match) {
    const digits = /^(\d{1,2})(\d{2})$/.exec(clean);
    if (!digits) return null;
    match = digits;
  }
  const hours = Number(match[1]);
  const minutes = match[2] ? Number(match[2]) : 0;
  return hours < 24 && minutes < 60 ? { hours, minutes } : null;
};

const pad = (n: number) => String(n).padStart(2, '0');

export const formatClock = (date: Date): string => `${pad(date.getHours())}:${pad(date.getMinutes())}`;

// The given day (any time of it) at a "HH:MM" clock time.
export const atClock = (day: Date, clock: string): Date => {
  const time = parseClock(clock) ?? { hours: 9, minutes: 0 };
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), time.hours, time.minutes);
};

const daysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();

// One step of a repeat. Months and years keep the day of the month, clamped to the month's
// length (31 Jan -> 28 Feb).
const step = (date: Date, repeat: ReminderRepeat, times: number): Date => {
  const y = date.getFullYear();
  const m = date.getMonth();
  const d = date.getDate();
  const h = date.getHours();
  const min = date.getMinutes();
  if (repeat === 'daily') return new Date(y, m, d + times, h, min);
  if (repeat === 'weekly') return new Date(y, m, d + 7 * times, h, min);
  const months = repeat === 'monthly' ? times : 12 * times;
  const target = new Date(y, m + months, 1);
  const day = Math.min(d, daysInMonth(target.getFullYear(), target.getMonth()));
  return new Date(target.getFullYear(), target.getMonth(), day, h, min);
};

// First time of a repeating reminder after `after`. Counts steps from the reminder's own
// time, so a monthly reminder on the 31st returns to the 31st after a shorter month.
export const nextOccurrence = (at: number, repeat: ReminderRepeat, after: number): number => {
  const start = new Date(at);
  for (let times = 1; times < 100000; times++) {
    const next = step(start, repeat, times).getTime();
    if (next > after) return next;
  }
  return at;
};

export interface ReminderState {
  at: number;
  repeat: ReminderRepeat | null;
  done: boolean;
}

// "Done": a one-off reminder is ticked off, a repeating one moves to its next time after now
// (missed times in between are skipped).
export const completeReminder = (state: ReminderState, now: number): ReminderState =>
  state.repeat
    ? { ...state, at: nextOccurrence(state.at, state.repeat, Math.max(now, state.at)), done: false }
    : { ...state, done: true };

export interface QuickChoice {
  label: string;
  at: number;
}

// Quick choices of the picker. "This evening" only before the evening time; "Next Monday"
// is never tomorrow (it then says the date after).
export const quickReminderChoices = (now: Date, times: ReminderTimes = DEFAULT_REMINDER_TIMES): QuickChoice[] => {
  const choices: QuickChoice[] = [];
  const inHour = new Date(now.getTime() + 60 * 60 * 1000);
  inHour.setSeconds(0, 0);
  choices.push({ label: 'In 1 hour', at: inHour.getTime() });
  const evening = atClock(now, times.evening);
  if (evening.getTime() > now.getTime() + 15 * 60 * 1000) choices.push({ label: 'This evening', at: evening.getTime() });
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  choices.push({ label: 'Tomorrow morning', at: atClock(tomorrow, times.morning).getTime() });
  const toMonday = ((8 - now.getDay()) % 7) || 7;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (toMonday === 1 ? 8 : toMonday));
  choices.push({ label: 'Next Monday', at: atClock(monday, times.morning).getTime() });
  return choices;
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const dayNumber = (date: Date) => Math.round(new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() / 86400000);

// Short label of a reminder time: "Today 17:00", "Tomorrow 07:00", "Yesterday 09:00",
// "Sun 12:00" (within a week), "20 Oct 09:00", "20 Oct 2027 09:00".
export const formatReminderTime = (at: number, now: Date): string => {
  const date = new Date(at);
  const clock = formatClock(date);
  const days = dayNumber(date) - dayNumber(now);
  if (days === 0) return `Today ${clock}`;
  if (days === 1) return `Tomorrow ${clock}`;
  if (days === -1) return `Yesterday ${clock}`;
  if (days > 1 && days < 7) return `${WEEKDAYS[date.getDay()]} ${clock}`;
  const year = date.getFullYear() === now.getFullYear() ? '' : ` ${date.getFullYear()}`;
  return `${date.getDate()} ${MONTHS[date.getMonth()]}${year} ${clock}`;
};

// Full date for places without a "now" (published pages, exports): "20 Oct 2026 12:00".
export const formatReminderDate = (at: number): string => {
  const date = new Date(at);
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()} ${formatClock(date)}`;
};

export const repeatLabel =(repeat: ReminderRepeat | null): string => REMINDER_REPEATS.find((r) => r.value === repeat)?.label ?? 'Once';

// "20 Oct 2026 12:00 (weekly)".
export const reminderDateLabel = (state: ReminderState): string =>
  `${formatReminderDate(state.at)}${state.repeat ? ` (${repeatLabel(state.repeat).toLowerCase()})` : ''}`;

// Copied / exported text, "» 20 Oct 2026 12:00" (plain text: an emoji or a Nerd Font icon
// would turn into a colour picture or an empty box in other apps).
export const reminderPlainText = (state: ReminderState): string => `» ${reminderDateLabel(state)}`;

export type ReminderStatus = 'done' | 'overdue' | 'today' | 'upcoming';

export const reminderStatus = (state: ReminderState, now: Date): ReminderStatus => {
  if (state.done) return 'done';
  if (state.at <= now.getTime()) return 'overdue';
  return dayNumber(new Date(state.at)) === dayNumber(now) ? 'today' : 'upcoming';
};
