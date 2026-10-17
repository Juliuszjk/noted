import { mdiChevronLeft, mdiChevronRight } from '@mdi/js';
import {
  REMINDER_REPEATS, MONTH_NAMES, WEEKDAY_SHORT, atClock, completeReminder, formatClock, formatReminderTime, monthGrid, parseClock,
  quickReminderChoices, sameDay,
} from './reminder-time';
import type { ReminderRepeat, ReminderState, ReminderTimes } from './reminder-time';
import type { ReminderCommit } from './reminder';

// The reminder picker: quick choices, a month calendar, time, repeat, and for an existing
// reminder Done / Delete. Plain DOM rendered into a container the platform supplies (the
// desktop's popover, the phone's sheet), so both share it.

const STYLE_ID = 'noted-reminder-picker-style';
const CSS = `
.nrp { display: flex; flex-direction: column; gap: 10px; color: var(--text-main); font: 14px var(--font-sans, sans-serif); }
.nrp button { font: inherit; color: inherit; cursor: pointer; }
.nrp-quick { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; }
.nrp-quick button { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; padding: 7px 10px; border: 1px solid var(--border); border-radius: 8px; background: transparent; text-align: left; }
.nrp-quick button:hover { background: var(--bg-surface); border-color: var(--border-focus); }
.nrp-quick small { color: var(--text-muted); font-size: 12px; }
.nrp-cal-head { display: flex; align-items: center; justify-content: space-between; }
.nrp-cal-head strong { font-weight: 600; }
.nrp-icon { width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; border: none; border-radius: 6px; background: transparent; }
.nrp-icon:hover { background: var(--bg-surface); }
.nrp-icon svg { width: 20px; height: 20px; }
.nrp-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; text-align: center; }
.nrp-grid > span { color: var(--text-muted); font-size: 11px; padding: 2px 0; }
.nrp-grid button { height: 32px; border: 1px solid transparent; border-radius: 6px; background: transparent; }
.nrp-grid button:hover { background: var(--bg-surface); }
.nrp button:focus-visible { outline: 2px solid var(--primary); outline-offset: 1px; }
.nrp-grid button.other { color: var(--text-muted); opacity: 0.6; }
.nrp-grid button.past { opacity: 0.45; }
.nrp-grid button.today { border-color: var(--primary); }
.nrp-grid button.selected { background: var(--primary); color: var(--primary-fg, #fff); opacity: 1; }
.nrp-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.nrp-row > label { color: var(--text-muted); min-width: 52px; }
.nrp-time { width: 80px; padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-surface); color: var(--text-main); font: inherit; outline: none; }
.nrp-time:focus { border-color: var(--primary); }
.nrp-time.invalid { border-color: var(--c-red, #e5484d); }
.nrp-seg { display: flex; flex-wrap: wrap; gap: 4px; }
.nrp-seg button { padding: 5px 9px; border: 1px solid var(--border); border-radius: 999px; background: transparent; font-size: 13px; }
.nrp-seg button.on { background: var(--primary); border-color: var(--primary); color: var(--primary-fg, #fff); }
.nrp-summary { color: var(--text-muted); font-size: 13px; }
.nrp-actions { display: flex; gap: 6px; align-items: center; }
.nrp-actions .nrp-spacer { flex: 1; }
.nrp-btn { padding: 7px 12px; border: 1px solid var(--border); border-radius: 8px; background: transparent; }
.nrp-btn:hover { border-color: var(--border-focus); }
.nrp-btn.primary { background: var(--primary); border-color: var(--primary); color: var(--primary-fg, #fff); }
.nrp-btn.danger { color: var(--c-red, #e5484d); }
.nrp-touch .nrp-grid button { height: 38px; }
.nrp-touch .nrp-actions { position: sticky; bottom: -12px; padding: 8px 0 12px; margin-bottom: -12px; background: var(--bg-surface-high); }
.nrp-touch .nrp-quick button, .nrp-touch .nrp-btn { padding: 10px 12px; }
.nrp-touch .nrp-seg button { padding: 8px 12px; }
`;

const ensureStyle = () => {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.append(style);
};

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const iconButton = (path: string, label: string, run: () => void) => {
  const b = el('button', 'nrp-icon');
  b.type = 'button';
  b.title = label;
  b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}" fill="currentColor"/></svg>`;
  b.addEventListener('click', run);
  return b;
};

export interface ReminderPickerOptions {
  // The reminder being edited; absent for a new one.
  initial?: ReminderState;
  times: ReminderTimes;
  onCommit: (commit: ReminderCommit) => void;
  onCancel: () => void;
  // Bigger targets for fingers (the phone).
  touch?: boolean;
}

export interface ReminderPickerHandle {
  focusTime: () => void;
  // Keyboard: the selected day of the calendar (arrows move it, Enter saves).
  focusDay: () => void;
  save: () => void;
}

export const renderReminderPicker = (container: HTMLElement, options: ReminderPickerOptions): ReminderPickerHandle => {
  ensureStyle();
  const now = new Date();
  const initial = options.initial;
  // New reminders start tomorrow morning.
  const start = initial ? new Date(initial.at) : atClock(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1), options.times.morning);
  let day = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  let shown = new Date(day.getFullYear(), day.getMonth(), 1);
  let repeat: ReminderRepeat | null = initial?.repeat ?? null;

  const root = el('div', `nrp${options.touch ? ' nrp-touch' : ''}`);

  // Quick choices save at once (with the repeat chosen below); on an existing reminder they
  // work as "snooze".
  const quick = el('div', 'nrp-quick');
  for (const choice of quickReminderChoices(now, options.times)) {
    const b = el('button');
    b.type = 'button';
    b.append(el('span', '', choice.label), el('small', '', formatReminderTime(choice.at, now)));
    b.addEventListener('click', () => options.onCommit({ kind: 'save', at: choice.at, repeat, done: false }));
    quick.append(b);
  }

  const calHead = el('div', 'nrp-cal-head');
  const monthLabel = el('strong');
  calHead.append(
    iconButton(mdiChevronLeft, 'Previous month', () => { shown = new Date(shown.getFullYear(), shown.getMonth() - 1, 1); renderGrid(); }),
    monthLabel,
    iconButton(mdiChevronRight, 'Next month', () => { shown = new Date(shown.getFullYear(), shown.getMonth() + 1, 1); renderGrid(); }),
  );
  const grid = el('div', 'nrp-grid');

  const time = el('input', 'nrp-time');
  time.value = formatClock(start);
  time.inputMode = 'numeric';
  time.placeholder = 'HH:MM';
  time.setAttribute('aria-label', 'Time');
  const timeRow = el('div', 'nrp-row');
  timeRow.append(el('label', '', 'Time'), time);

  const seg = el('div', 'nrp-seg');
  const repeatRow = el('div', 'nrp-row');
  repeatRow.append(el('label', '', 'Repeat'), seg);
  const renderRepeat = () => {
    seg.replaceChildren();
    for (const option of REMINDER_REPEATS) {
      const b = el('button', option.value === repeat ? 'on' : '', option.label);
      b.type = 'button';
      b.addEventListener('click', () => { repeat = option.value; renderRepeat(); renderSummary(); });
      seg.append(b);
    }
  };

  const summary = el('div', 'nrp-summary');
  const chosen = (): number | null => {
    const clock = parseClock(time.value);
    if (!clock) return null;
    return new Date(day.getFullYear(), day.getMonth(), day.getDate(), clock.hours, clock.minutes).getTime();
  };
  const renderSummary = () => {
    const at = chosen();
    time.classList.toggle('invalid', at === null);
    summary.textContent = at === null ? 'Type a time, e.g. 7:30' : `${formatReminderTime(at, new Date())}${repeat ? ` · ${REMINDER_REPEATS.find((r) => r.value === repeat)!.label.toLowerCase()}` : ''}`;
  };
  time.addEventListener('input', renderSummary);

  // Calendar keys: arrows move a day / week, PageUp / PageDown a month, Enter saves. Only the
  // selected day is in the Tab order.
  let selectedButton: HTMLButtonElement | null = null;
  const moveDay = (to: Date, focus: boolean) => {
    day = to;
    if (to.getMonth() !== shown.getMonth() || to.getFullYear() !== shown.getFullYear()) shown = new Date(to.getFullYear(), to.getMonth(), 1);
    renderGrid();
    renderSummary();
    if (focus) selectedButton?.focus();
  };
  grid.addEventListener('keydown', (event) => {
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (event.key in step) {
      event.preventDefault();
      moveDay(new Date(day.getFullYear(), day.getMonth(), day.getDate() + step[event.key]), true);
    } else if (event.key === 'PageUp' || event.key === 'PageDown') {
      event.preventDefault();
      const months = event.key === 'PageUp' ? -1 : 1;
      const target = new Date(day.getFullYear(), day.getMonth() + months, 1);
      const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
      moveDay(new Date(target.getFullYear(), target.getMonth(), Math.min(day.getDate(), last)), true);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      save();
    }
  });

  const renderGrid = () => {
    monthLabel.textContent = `${MONTH_NAMES[shown.getMonth()]} ${shown.getFullYear()}`;
    grid.replaceChildren(...WEEKDAY_SHORT.map((d) => el('span', '', d)));
    selectedButton = null;
    for (const cell of monthGrid(shown, new Date())) {
      const date = cell.date;
      const classes = [
        cell.inMonth ? '' : 'other',
        cell.past ? 'past' : '',
        cell.today ? 'today' : '',
        sameDay(date, day) ? 'selected' : '',
      ].filter(Boolean).join(' ');
      const b = el('button', classes, String(date.getDate()));
      b.type = 'button';
      b.tabIndex = sameDay(date, day) ? 0 : -1;
      if (sameDay(date, day)) selectedButton = b;
      b.addEventListener('click', () => moveDay(date, document.activeElement === b));
      grid.append(b);
    }
    // Another month shown with the arrows above: its first day takes the Tab stop.
    if (!selectedButton) grid.querySelector<HTMLButtonElement>('button:not(.other)')?.setAttribute('tabindex', '0');
  };

  const save = () => {
    const at = chosen();
    if (at === null) return void time.focus();
    options.onCommit({ kind: 'save', at, repeat });
  };

  const actions = el('div', 'nrp-actions');
  const button = (label: string, className: string, run: () => void) => {
    const b = el('button', `nrp-btn ${className}`, label);
    b.type = 'button';
    b.addEventListener('click', run);
    return b;
  };
  if (initial) {
    actions.append(button('Delete', 'danger', () => options.onCommit({ kind: 'delete' })));
    if (initial.done) actions.append(button('Not done', '', () => options.onCommit({ kind: 'save', at: initial.at, repeat: initial.repeat, done: false })));
    else {
      const done = button(initial.repeat ? 'Done, next' : 'Done', '', () => {
        const next = completeReminder({ ...initial, repeat }, Date.now());
        options.onCommit({ kind: 'save', at: next.at, repeat: next.repeat, done: next.done });
      });
      if (initial.repeat) done.title = 'Moves the reminder to its next time';
      actions.append(done);
    }
  }
  actions.append(el('span', 'nrp-spacer'), button('Cancel', '', options.onCancel), button('Save', 'primary', save));

  root.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target === time) { event.preventDefault(); save(); }
    else if (event.key === 'Escape') { event.preventDefault(); options.onCancel(); }
  });

  root.append(quick, calHead, grid, timeRow, repeatRow, summary, actions);
  renderRepeat();
  renderGrid();
  renderSummary();
  container.replaceChildren(root);
  return {
    focusTime: () => { time.focus(); time.select(); },
    focusDay: () => selectedButton?.focus(),
    save,
  };
};
