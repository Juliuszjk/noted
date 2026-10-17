import { describe, it, expect } from 'vitest';
import {
  parseClock, nextOccurrence, completeReminder, quickReminderChoices, formatReminderTime, reminderStatus,
} from './reminder-time';

const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();

describe('parseClock', () => {
  it('reads the usual ways of writing a time', () => {
    expect(parseClock('7')).toEqual({ hours: 7, minutes: 0 });
    expect(parseClock('7:30')).toEqual({ hours: 7, minutes: 30 });
    expect(parseClock('07.05')).toEqual({ hours: 7, minutes: 5 });
    expect(parseClock('730')).toEqual({ hours: 7, minutes: 30 });
    expect(parseClock('1730')).toEqual({ hours: 17, minutes: 30 });
  });

  it('rejects what is not a time', () => {
    expect(parseClock('')).toBeNull();
    expect(parseClock('24:00')).toBeNull();
    expect(parseClock('7:60')).toBeNull();
    expect(parseClock('abc')).toBeNull();
  });
});

describe('nextOccurrence', () => {
  it('steps days and weeks', () => {
    const at = local(2026, 10, 18, 12);
    expect(nextOccurrence(at, 'daily', at)).toBe(local(2026, 10, 19, 12));
    expect(nextOccurrence(at, 'weekly', local(2026, 10, 30))).toBe(local(2026, 11, 1, 12));
  });

  it('keeps the day of the month after a shorter month', () => {
    const at = local(2026, 1, 31, 9);
    expect(nextOccurrence(at, 'monthly', at)).toBe(local(2026, 2, 28, 9));
    expect(nextOccurrence(at, 'monthly', local(2026, 2, 28, 10))).toBe(local(2026, 3, 31, 9));
    expect(nextOccurrence(local(2028, 2, 29, 9), 'yearly', local(2028, 3, 1))).toBe(local(2029, 2, 28, 9));
  });

  it('keeps the local time across a daylight saving change', () => {
    const at = local(2026, 10, 18, 12);
    expect(new Date(nextOccurrence(at, 'weekly', local(2026, 10, 26))).getHours()).toBe(12);
  });
});

describe('completeReminder', () => {
  it('ticks off a one-off reminder', () => {
    expect(completeReminder({ at: 1, repeat: null, done: false }, 5)).toEqual({ at: 1, repeat: null, done: true });
  });

  it('moves a repeating one past now, skipping missed times', () => {
    const at = local(2026, 10, 10, 8);
    const next = completeReminder({ at, repeat: 'daily', done: false }, local(2026, 10, 17, 9));
    expect(next).toEqual({ at: local(2026, 10, 18, 8), repeat: 'daily', done: false });
  });

  it('moves a repeating one done early to the next time', () => {
    const at = local(2026, 10, 20, 8);
    expect(completeReminder({ at, repeat: 'weekly', done: false }, local(2026, 10, 17)).at).toBe(local(2026, 10, 27, 8));
  });
});

describe('quickReminderChoices', () => {
  const times = { morning: '07:00', evening: '18:00' };

  it('offers this evening only before the evening', () => {
    const afternoon = quickReminderChoices(new Date(2026, 9, 17, 14, 12, 40), times);
    expect(afternoon.map((c) => c.label)).toEqual(['In 1 hour', 'This evening', 'Tomorrow morning', 'Next Monday']);
    expect(afternoon[0].at).toBe(local(2026, 10, 17, 15, 12));
    expect(afternoon[1].at).toBe(local(2026, 10, 17, 18));
    expect(afternoon[2].at).toBe(local(2026, 10, 18, 7));
    expect(afternoon[3].at).toBe(local(2026, 10, 19, 7));
    expect(quickReminderChoices(new Date(2026, 9, 17, 19), times).map((c) => c.label)).not.toContain('This evening');
  });

  it('never makes next Monday tomorrow', () => {
    const sunday = quickReminderChoices(new Date(2026, 9, 18, 10), times);
    expect(sunday.find((c) => c.label === 'Next Monday')!.at).toBe(local(2026, 10, 26, 7));
    const monday = quickReminderChoices(new Date(2026, 9, 19, 10), times);
    expect(monday.find((c) => c.label === 'Next Monday')!.at).toBe(local(2026, 10, 26, 7));
  });
});

describe('formatReminderTime', () => {
  const now = new Date(2026, 9, 17, 14);

  it('names near days and dates further away', () => {
    expect(formatReminderTime(local(2026, 10, 17, 17), now)).toBe('Today 17:00');
    expect(formatReminderTime(local(2026, 10, 18, 7), now)).toBe('Tomorrow 07:00');
    expect(formatReminderTime(local(2026, 10, 16, 9, 5), now)).toBe('Yesterday 09:05');
    expect(formatReminderTime(local(2026, 10, 21, 12), now)).toBe('Wed 12:00');
    expect(formatReminderTime(local(2026, 10, 30, 12), now)).toBe('30 Oct 12:00');
    expect(formatReminderTime(local(2027, 1, 2, 12), now)).toBe('2 Jan 2027 12:00');
  });
});

describe('reminderStatus', () => {
  const now = new Date(2026, 9, 17, 14);
  it('tells overdue, today, upcoming and done apart', () => {
    expect(reminderStatus({ at: local(2026, 10, 17, 13), repeat: null, done: false }, now)).toBe('overdue');
    expect(reminderStatus({ at: local(2026, 10, 17, 20), repeat: null, done: false }, now)).toBe('today');
    expect(reminderStatus({ at: local(2026, 10, 18, 7), repeat: null, done: false }, now)).toBe('upcoming');
    expect(reminderStatus({ at: local(2026, 10, 17, 13), repeat: null, done: true }, now)).toBe('done');
  });
});
