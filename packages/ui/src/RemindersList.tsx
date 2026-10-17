import { useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import {
  mdiChevronDoubleLeft, mdiMagnify, mdiPlus, mdiCheckboxBlankCircleOutline, mdiCheckCircle, mdiRepeat, mdiNoteTextOutline,
  mdiBellOutline, mdiBellPlusOutline, mdiBellSleepOutline,
} from '@mdi/js';
import { completeReminder, formatReminderTime, reminderDue, reminderStatus } from '@noted/editor/reminder-time';
import type { ReminderState, ReminderTimes } from '@noted/editor/reminder-time';
import type { ReminderCommit } from '@noted/editor';
import { Icon } from './Icon';
import { IconBtn } from './menu-parts';
import { ReminderPopover } from './ReminderPopover';
import type { ReminderAnchor } from './ReminderPopover';
import { reminderLabel, reminderSections } from './reminder-list';
import type { ReminderEntry } from './reminder-list';

const STATUS_COLOR = { overdue: 'var(--c-red)', today: 'var(--primary)', upcoming: 'var(--text-muted)', done: 'var(--text-muted)' } as const;

type Editing = { anchor: ReminderAnchor; entry: ReminderEntry | null };

// The "Reminders" view of the note list column: reminder chips of every note and reminders of
// their own, in sections (reminder-list.ts). The circle ticks a reminder off (a repeating one
// moves to its next time); a click opens the note (own reminders open the picker), the bell
// changes the time; "+" adds a reminder of its own.
export function RemindersList({ entries, times, onOpenNote, onChange, onCreate, onHide }: {
  entries: ReminderEntry[];
  times: ReminderTimes;
  onOpenNote: (noteId: string, newTab: boolean) => void;
  // New state of a reminder (null = delete); `text` only for reminders of their own.
  onChange: (entry: ReminderEntry, state: ReminderState | null, text?: string) => void;
  onCreate: (text: string, state: ReminderState) => void;
  onHide?: () => void;
}) {
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Editing | null>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  // "Today" turns into "Overdue" while the list is open.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30 * 1000);
    return () => clearInterval(timer);
  }, []);
  const sections = useMemo(() => reminderSections(entries, now, query), [entries, now, query]);

  const anchorOf = (e: ReactMouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, left: rect.left };
  };
  const toggleDone = (entry: ReminderEntry) => {
    onChange(entry, entry.done ? { at: entry.at, repeat: entry.repeat, done: false } : completeReminder(entry, Date.now()));
  };
  const commit = (entry: ReminderEntry | null, result: ReminderCommit, text: string) => {
    if (result.kind === 'delete') {
      if (entry) onChange(entry, null);
      return;
    }
    const state = { at: result.at, repeat: result.repeat, done: result.done ?? (entry && result.at === entry.at ? entry.done : false) };
    if (entry) onChange(entry, state, entry.noteId ? undefined : text);
    else onCreate(text, state);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <style>{'.reminder-row:hover { background-color: var(--bg-surface-high); } .reminder-row .reminder-row-time { opacity: 0; } .reminder-row:hover .reminder-row-time { opacity: 1; }'}</style>
      <div ref={headerRef} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '8px 8px 0 12px' }}>
        <span style={{ flex: 1, fontSize: 15, fontWeight: 700 }}>Reminders</span>
        <IconBtn icon={mdiPlus} title="New reminder" onClick={() => {
          const rect = headerRef.current!.getBoundingClientRect();
          setEditing({ anchor: { top: rect.top, bottom: rect.bottom, left: rect.left + 8 }, entry: null });
        }} />
        {onHide && <IconBtn icon={mdiChevronDoubleLeft} title="Hide note list" onClick={onHide} />}
      </div>
      <div style={{ padding: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px', height: 32, borderRadius: 8, backgroundColor: 'var(--bg-surface-high)', color: 'var(--text-muted)' }}>
          <Icon path={mdiMagnify} size={16} />
          <input
            value={query}
            placeholder="Search reminders"
            onChange={(e) => setQuery(e.target.value)}
            style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', color: 'var(--text-main)', fontSize: 13 }}
          />
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '0 8px 12px' }}>
        {sections.length === 0 && (
          <div style={{ padding: '12px 8px', fontSize: 12, color: 'var(--text-muted)', display: 'flex', gap: 8, lineHeight: 1.5 }}>
            <Icon path={mdiBellOutline} size={16} />
            <span>{query.trim() ? 'No reminder matches.' : 'No reminders yet. Type /reminder in a note, press Ctrl+Alt+R, or add one with +.'}</span>
          </div>
        )}
        {sections.map((section) => (
          <div key={section.kind}>
            <div style={{ margin: '12px 8px 4px', fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: section.kind === 'overdue' ? 'var(--c-red)' : 'var(--text-muted)' }}>
              {section.title} <span style={{ opacity: 0.7 }}>{section.items.length}</span>
            </div>
            {section.items.map((entry) => {
              const status = reminderStatus(entry, now);
              return (
                <div
                  key={entry.key}
                  className="reminder-row"
                  onClick={(e) => {
                    if (entry.noteId) onOpenNote(entry.noteId, e.ctrlKey || e.metaKey);
                    else setEditing({ anchor: anchorOf(e), entry });
                  }}
                  onAuxClick={(e) => { if (e.button === 1 && entry.noteId) onOpenNote(entry.noteId, true); }}
                  style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '7px 6px', borderRadius: 8, cursor: 'pointer' }}
                >
                  <button
                    type="button"
                    title={entry.done ? 'Not done' : entry.repeat ? 'Done (moves to the next time)' : 'Done'}
                    onClick={(e) => { e.stopPropagation(); toggleDone(entry); }}
                    style={{ border: 'none', background: 'transparent', padding: 0, marginTop: 1, cursor: 'pointer', color: entry.done ? 'var(--primary)' : 'var(--text-muted)', display: 'flex' }}
                  >
                    <Icon path={entry.done ? mdiCheckCircle : mdiCheckboxBlankCircleOutline} size={18} />
                  </button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 13, lineHeight: 1.35, color: entry.done ? 'var(--text-muted)' : 'var(--text-main)', textDecoration: entry.done ? 'line-through' : undefined,
                      overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                    }}>
                      {reminderLabel(entry)}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2, fontSize: 11, color: 'var(--text-muted)', minWidth: 0 }}>
                      <span style={{ color: STATUS_COLOR[status], fontWeight: status === 'overdue' || status === 'today' ? 600 : 400, whiteSpace: 'nowrap' }}>
                        {formatReminderTime(reminderDue(entry), now)}
                      </span>
                      {entry.snooze && !entry.done && <span title="Snoozed" style={{ display: 'flex' }}><Icon path={mdiBellSleepOutline} size={12} /></span>}
                      {entry.repeat && <Icon path={mdiRepeat} size={12} />}
                      {entry.noteId && entry.text && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 3, minWidth: 0 }}>
                          <Icon path={mdiNoteTextOutline} size={12} />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.noteTitle || 'Untitled'}</span>
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    title="Change the time"
                    className="reminder-row-time"
                    onClick={(e) => { e.stopPropagation(); setEditing({ anchor: anchorOf(e), entry }); }}
                    style={{ border: 'none', background: 'transparent', padding: 2, cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', borderRadius: 4 }}
                  >
                    <Icon path={mdiBellPlusOutline} size={16} />
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {editing && (
        <ReminderPopover
          key={editing.entry?.key ?? 'new'}
          anchor={editing.anchor}
          title={editing.entry ? (editing.entry.noteId ? `Reminder in “${editing.entry.noteTitle || 'Untitled'}”` : 'Reminder') : 'New reminder'}
          initial={editing.entry ?? undefined}
          times={times}
          text={editing.entry?.noteId ? undefined : editing.entry?.text ?? ''}
          onCommit={(result, text) => commit(editing.entry, result, text)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
