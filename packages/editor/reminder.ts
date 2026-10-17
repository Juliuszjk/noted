import { Node, mergeAttributes } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Fragment, Slice } from '@tiptap/pm/model';
import type { Node as PmNode } from '@tiptap/pm/model';
import { mdiBellOutline, mdiBellCheckOutline, mdiRepeat } from '@mdi/js';
import {
  DEFAULT_REMINDER_TIMES, formatReminderTime, formatReminderDate, isReminderRepeat, reminderStatus, repeatLabel,
  reminderDateLabel, reminderPlainText,
} from './reminder-time';
import type { ReminderRepeat, ReminderState, ReminderTimes } from './reminder-time';

// Reminder chip inside the text ("/reminder"): an inline atom holding its own state, so it
// syncs and merges like the rest of the note. `id` names it for notifications and the
// reminders view; `at` is a moment (ms), `repeat` null = once, `done` ticked off.
// The picker is platform UI (onEdit), like math.

export interface ReminderAttrs extends ReminderState {
  id: string;
}

export type ReminderEditRequest =
  | { mode: 'insert'; pos: number }
  | { mode: 'edit'; pos: number; attrs: ReminderAttrs };

export type ReminderEditHandler = (request: ReminderEditRequest) => void;

type ReminderView = { render: () => void };

interface ReminderStorage {
  // Morning / evening of the quick choices (Settings > Editor).
  times: ReminderTimes;
  // Live chips, re-rendered every minute ("Today" -> overdue) and when the times change.
  views: Set<ReminderView>;
  timer: ReturnType<typeof setInterval> | null;
}

declare module '@tiptap/core' {
  interface Storage {
    reminder: ReminderStorage;
  }
}

// Random id without crypto.randomUUID (the phone's editor page is not a secure context).
export const newReminderId = (): string => {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
};

export const reminderAttrs = (node: PmNode): ReminderAttrs => ({
  id: String(node.attrs.id ?? ''),
  at: Number(node.attrs.at) || 0,
  repeat: isReminderRepeat(node.attrs.repeat) ? node.attrs.repeat : null,
  done: node.attrs.done === true,
});

const SVG_NS = 'http://www.w3.org/2000/svg';

const svg = (path: string) => `<svg width="1em" height="1em" viewBox="0 0 24 24" aria-hidden="true"><path d="${path}" fill="currentColor"/></svg>`;

// Pasted reminders get new ids, so a copy is a reminder of its own.
const freshIds = (fragment: Fragment): Fragment => {
  const nodes: PmNode[] = [];
  fragment.forEach((node) => {
    if (node.type.name === 'reminder') nodes.push(node.type.create({ ...node.attrs, id: newReminderId() }, null, node.marks));
    else nodes.push(node.copy(freshIds(node.content)));
  });
  return Fragment.from(nodes);
};

export const Reminder = Node.create<{ onEdit: ReminderEditHandler | null }, ReminderStorage>({
  name: 'reminder',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addOptions() {
    return { onEdit: null };
  },

  addStorage() {
    return { times: { ...DEFAULT_REMINDER_TIMES }, views: new Set(), timer: null };
  },

  addAttributes() {
    return {
      id: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-id') ?? '',
        renderHTML: (attrs: Record<string, any>) => ({ 'data-id': attrs.id }),
      },
      at: {
        default: 0,
        parseHTML: (el: HTMLElement) => Number(el.getAttribute('data-at')) || 0,
        renderHTML: (attrs: Record<string, any>) => ({ 'data-at': String(attrs.at) }),
      },
      repeat: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-repeat') || null,
        renderHTML: (attrs: Record<string, any>) => (attrs.repeat ? { 'data-repeat': attrs.repeat } : {}),
      },
      done: {
        default: false,
        parseHTML: (el: HTMLElement) => el.hasAttribute('data-done'),
        renderHTML: (attrs: Record<string, any>) => (attrs.done ? { 'data-done': '' } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-reminder]' }];
  },

  // Published pages and HTML exports: a full date (no "Tomorrow" that goes stale).
  renderHTML({ node, HTMLAttributes }) {
    const attrs = reminderAttrs(node);
    return [
      'span',
      mergeAttributes({ 'data-reminder': '', class: `reminder-chip${attrs.done ? ' reminder-chip--done' : ''}` }, HTMLAttributes),
      [`${SVG_NS} svg`, { width: '1em', height: '1em', viewBox: '0 0 24 24', 'aria-hidden': 'true' }, [`${SVG_NS} path`, { d: attrs.done ? mdiBellCheckOutline : mdiBellOutline, fill: 'currentColor' }]],
      ['span', {}, reminderDateLabel(attrs)],
    ];
  },

  renderText({ node }) {
    return reminderPlainText(reminderAttrs(node));
  },

  addNodeView() {
    return ({ node: initial, getPos, editor }) => {
      let node = initial;
      const dom = document.createElement('span');
      dom.className = 'reminder-chip';
      dom.setAttribute('data-reminder', '');
      dom.contentEditable = 'false';
      const storage = this.storage;
      const view: ReminderView = {
        render: () => {
          const attrs = reminderAttrs(node);
          const now = new Date();
          const status = reminderStatus(attrs, now);
          dom.className = `reminder-chip reminder-chip--${status}`;
          // Read by the published copy (publish-html.ts), which shows a full date instead.
          dom.setAttribute('data-at', String(attrs.at));
          if (attrs.repeat) dom.setAttribute('data-repeat', attrs.repeat); else dom.removeAttribute('data-repeat');
          dom.toggleAttribute('data-done', attrs.done);
          dom.title = `${formatReminderDate(attrs.at)} · ${repeatLabel(attrs.repeat)}`;
          dom.innerHTML = `${svg(attrs.done ? mdiBellCheckOutline : mdiBellOutline)}<span></span>${attrs.repeat ? svg(mdiRepeat) : ''}`;
          dom.querySelector('span')!.textContent = formatReminderTime(attrs.at, now);
        },
      };
      const open = (event: Event) => {
        const onEdit = this.options.onEdit;
        const pos = typeof getPos === 'function' ? getPos() : undefined;
        if (!onEdit || !editor.isEditable || typeof pos !== 'number') return;
        event.preventDefault();
        onEdit({ mode: 'edit', pos, attrs: reminderAttrs(node) });
      };
      dom.addEventListener('click', open);
      view.render();
      storage.views.add(view);
      if (!storage.timer) storage.timer = setInterval(() => storage.views.forEach((v) => v.render()), 30 * 1000);
      return {
        dom,
        update: (updated) => {
          if (updated.type !== node.type) return false;
          node = updated;
          view.render();
          return true;
        },
        destroy: () => {
          dom.removeEventListener('click', open);
          storage.views.delete(view);
          if (!storage.views.size && storage.timer) {
            clearInterval(storage.timer);
            storage.timer = null;
          }
        },
      };
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('reminderPaste'),
        props: {
          transformPasted: (slice) => new Slice(freshIds(slice.content), slice.openStart, slice.openEnd),
        },
      }),
    ];
  },
});

// Morning / evening of the picker's quick choices.
export const setReminderTimes = (editor: Editor, times: ReminderTimes): void => {
  const storage = editor.storage.reminder;
  if (storage) storage.times = { ...times };
};

export const getReminderTimes = (editor: Editor): ReminderTimes => editor.storage.reminder?.times ?? { ...DEFAULT_REMINDER_TIMES };

// Asks the platform UI for the picker. Returns false when this editor has none.
export const requestReminderEdit = (editor: Editor, request: ReminderEditRequest): boolean => {
  const extension = editor.extensionManager.extensions.find((e) => e.name === 'reminder');
  const onEdit = extension?.options.onEdit as ReminderEditHandler | null | undefined;
  if (!onEdit) return false;
  onEdit(request);
  return true;
};

// The keyboard shortcut: a selected chip, or one right next to the cursor, opens for editing;
// otherwise a new reminder goes at the cursor.
export const requestReminderAtSelection = (editor: Editor): boolean => {
  const { selection } = editor.state;
  const selected = (selection as { node?: PmNode }).node;
  if (selected?.type.name === 'reminder') return requestReminderEdit(editor, { mode: 'edit', pos: selection.from, attrs: reminderAttrs(selected) });
  const $pos = selection.$head;
  if ($pos.nodeAfter?.type.name === 'reminder') return requestReminderEdit(editor, { mode: 'edit', pos: $pos.pos, attrs: reminderAttrs($pos.nodeAfter) });
  if ($pos.nodeBefore?.type.name === 'reminder') {
    return requestReminderEdit(editor, { mode: 'edit', pos: $pos.pos - $pos.nodeBefore.nodeSize, attrs: reminderAttrs($pos.nodeBefore) });
  }
  return requestReminderEdit(editor, { mode: 'insert', pos: selection.to });
};

export type ReminderCommit =
  | { kind: 'save'; at: number; repeat: ReminderRepeat | null; done?: boolean }
  | { kind: 'delete' };

// Applies the picker's result: a new chip (with a space after it), changed or removed one.
export const commitReminderEdit = (editor: Editor, request: ReminderEditRequest, commit: ReminderCommit): void => {
  const chain = editor.chain().focus();
  if (request.mode === 'insert') {
    if (commit.kind === 'delete') return void chain.run();
    const attrs: ReminderAttrs = { id: newReminderId(), at: commit.at, repeat: commit.repeat, done: false };
    chain.insertContentAt(request.pos, [{ type: 'reminder', attrs }, { type: 'text', text: ' ' }]).run();
    return;
  }
  const node = editor.state.doc.nodeAt(request.pos);
  if (!node || node.type.name !== 'reminder' || node.attrs.id !== request.attrs.id) return void chain.run();
  if (commit.kind === 'delete') {
    chain.deleteRange({ from: request.pos, to: request.pos + node.nodeSize }).run();
    return;
  }
  const done = commit.done ?? (commit.at !== request.attrs.at ? false : request.attrs.done);
  chain.command(({ tr }) => {
    tr.setNodeMarkup(request.pos, undefined, { ...node.attrs, at: commit.at, repeat: commit.repeat, done });
    return true;
  }).run();
};
