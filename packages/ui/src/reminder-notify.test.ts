import { describe, expect, it } from 'vitest';
import { applyReminderAction } from '@noted/editor/reminder-time';
import { noticeId, parseNoticeId, reminderNotices } from './reminder-notify';
import type { ReminderEntry } from './reminder-list';

const at = (d: string) => new Date(d).getTime();
const entry = (over: Partial<ReminderEntry>): ReminderEntry => ({
  key: 'n1/r1', id: 'r1', noteId: 'n1', text: 'Buy milk', noteTitle: 'Shopping', at: at('2026-10-20T12:00'), repeat: null, done: false, ...over,
});

describe('reminderNotices', () => {
  const now = at('2026-10-20T10:00');

  it('lists reminders not done, soonest first, with the snoozed time', () => {
    const list = reminderNotices([
      entry({ key: 'a', at: at('2026-10-21T09:00') }),
      entry({ key: 'b', at: at('2026-10-20T08:00'), snooze: at('2026-10-20T11:00') }),
      entry({ key: 'c', done: true }),
    ], now);
    expect(list.map((n) => n.key)).toEqual(['b', 'a']);
    expect(list[0]).toMatchObject({ due: at('2026-10-20T11:00'), title: 'Buy milk', body: '11:00 · Shopping' });
  });

  it('keeps recently missed reminders only', () => {
    const list = reminderNotices([
      entry({ key: 'old', at: at('2026-10-19T09:00') }),
      entry({ key: 'missed', at: at('2026-10-20T07:00') }),
    ], now);
    expect(list.map((n) => n.key)).toEqual(['missed']);
  });

  it('a reminder of its own has no note in the body', () => {
    const [notice] = reminderNotices([entry({ key: 'own/x', noteId: null, noteTitle: null, text: 'Call mum' })], now);
    expect(notice).toMatchObject({ title: 'Call mum', body: '12:00', noteId: null });
  });

  it('round-trips notice ids', () => {
    expect(parseNoticeId(noticeId('n1/r1', 123))).toEqual({ key: 'n1/r1', due: 123 });
    expect(parseNoticeId('nothing')).toBeNull();
  });
});

describe('applyReminderAction', () => {
  const now = at('2026-10-20T12:05');
  const state = { at: at('2026-10-20T12:00'), repeat: null, done: false };

  it('done ticks a one-off reminder off', () => {
    expect(applyReminderAction(state, 'done', state.at, now)).toMatchObject({ done: true, snooze: null });
  });

  it('done moves a repeating reminder on from its own time, ending the snooze', () => {
    const daily = { ...state, repeat: 'daily' as const, snooze: at('2026-10-20T13:00') };
    expect(applyReminderAction(daily, 'done', daily.snooze, at('2026-10-20T13:01'))).toEqual({
      at: at('2026-10-21T12:00'), repeat: 'daily', done: false, snooze: null,
    });
  });

  it('snoozes for an hour or to tomorrow morning, keeping the time', () => {
    expect(applyReminderAction(state, 'hour', state.at, now)).toMatchObject({ at: state.at, snooze: now + 3600_000 });
    expect(applyReminderAction(state, 'tomorrow', state.at, now, { morning: '07:30', evening: '18:00' }))
      .toMatchObject({ at: state.at, snooze: at('2026-10-21T07:30') });
  });

  it('ignores a button of an old notification', () => {
    expect(applyReminderAction({ ...state, done: true }, 'done', state.at, now)).toBeNull();
    expect(applyReminderAction({ ...state, snooze: now + 1000 }, 'hour', state.at, now)).toBeNull();
    expect(applyReminderAction({ ...state, at: state.at + 60_000 }, 'done', state.at, now)).toBeNull();
  });
});
