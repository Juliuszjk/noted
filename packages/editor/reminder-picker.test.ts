// @vitest-environment happy-dom
import { it, expect } from 'vitest';
import { renderReminderPicker } from './reminder-picker';
import type { ReminderCommit } from './reminder';

it('moves the day with the arrow keys and saves with Enter', () => {
  const container = document.createElement('div');
  document.body.append(container);
  const commits: ReminderCommit[] = [];
  const at = new Date(2026, 9, 30, 7, 30).getTime();
  const picker = renderReminderPicker(container, {
    initial: { at, repeat: null, done: false },
    times: { morning: '07:00', evening: '18:00' },
    onCommit: (c) => commits.push(c),
    onCancel: () => {},
  });
  picker.focusDay();
  const key = (k: string) => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  expect(document.activeElement?.textContent).toBe('30');
  key('ArrowRight');
  expect(document.activeElement?.textContent).toBe('31');
  key('ArrowRight'); // into November
  expect(document.activeElement?.textContent).toBe('1');
  expect(container.querySelector('.nrp-cal-head strong')?.textContent).toBe('November 2026');
  key('ArrowUp');
  key('Enter');
  expect(commits).toEqual([{ kind: 'save', at: new Date(2026, 9, 25, 7, 30).getTime(), repeat: null }]);
  // Only one day is a Tab stop.
  expect(container.querySelectorAll('.nrp-grid button[tabindex="0"]').length).toBe(1);
});
