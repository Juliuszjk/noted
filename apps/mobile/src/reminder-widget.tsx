import React from 'react';
import { FlexWidget, ListWidget, SvgWidget, TextWidget, requestWidgetUpdate } from 'react-native-android-widget';
import { mdiCheckboxBlankCircleOutline, mdiPlus, mdiRepeat } from '@mdi/js';
import { formatReminderTime, reminderDue, reminderStatus } from '@noted/editor/reminder-time';
import { noticeId } from '@noted/ui/src/reminder-notify';
import { reminderGroups, reminderLabel } from '@noted/ui/src/reminder-list';
import type { ReminderEntry } from '@noted/ui/src/reminder-list';
import { T, refreshTheme } from './ui';

// Home screen widget "Reminders": overdue, today's and upcoming reminders in the app's colours.
// Grouped as Overdue / Today / Tomorrow / This week / ... (reminderGroups). A row opens its note (or the Reminders view), the circle marks it done, + adds one. Drawn by
// Android from this JSX (react-native-android-widget); the task in reminder-widget-task.tsx
// draws it when Android asks, the app and the background tasks when reminders change.
// Taps open noted:// links (NotesScreen handles them).
export const REMINDER_WIDGET = 'Reminders';
export const DONE_CLICK = 'reminder-done';

const svg = (path: string, color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="${path}" fill="${color}"/></svg>`;

const hex = (color: string) => color as `#${string}`;

export function ReminderWidget({ entries, now }: { entries: ReminderEntry[]; now: Date }) {
  const groups = reminderGroups(entries, now);
  const count = groups.reduce((n, g) => n + g.items.length, 0);
  return (
    <FlexWidget style={{ height: 'match_parent', width: 'match_parent', flexDirection: 'column', backgroundColor: hex(T.surface_container), borderRadius: 24, padding: 12 }}>
      <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center', paddingBottom: 6 }}>
        <FlexWidget clickAction="OPEN_URI" clickActionData={{ uri: 'noted://reminders' }} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', paddingLeft: 4 }}>
          <TextWidget text="Reminders" style={{ fontSize: 16, fontWeight: '600', color: hex(T.on_surface) }} />
          <TextWidget text={count ? `  ${count}` : ''} style={{ fontSize: 14, color: hex(T.on_surface_variant) }} />
        </FlexWidget>
        <SvgWidget svg={svg(mdiPlus, T.on_primary_container)} clickAction="OPEN_URI" clickActionData={{ uri: 'noted://reminders/new' }} accessibilityLabel="New reminder"
          style={{ height: 32, width: 32, padding: 6, borderRadius: 16, backgroundColor: hex(T.primary_container) }} />
      </FlexWidget>
      {count ? (
        <ListWidget style={{ height: 'match_parent', width: 'match_parent' }}>
          {groups.flatMap((group) => [
            <FlexWidget key={`group:${group.title}`} style={{ width: 'match_parent', paddingTop: 8, paddingBottom: 2, paddingLeft: 4 }}>
              <TextWidget text={group.title.toUpperCase()} style={{ fontSize: 11, fontWeight: '700', letterSpacing: 0.06, color: hex(group.overdue ? T.error : T.primary) }} />
            </FlexWidget>,
            ...group.items.map((entry) => {
              const due = reminderDue(entry);
              const status = reminderStatus(entry, now);
              const color = status === 'overdue' ? T.error : status === 'today' ? T.primary : T.on_surface_variant;
              return (
                <FlexWidget key={entry.key} clickAction="OPEN_URI" clickActionData={{ uri: entry.noteId ? `noted://note/${entry.noteId}` : 'noted://reminders' }}
                  style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center', paddingVertical: 6 }}>
                  <SvgWidget svg={svg(mdiCheckboxBlankCircleOutline, T.on_surface_variant)} clickAction={DONE_CLICK} clickActionData={{ notice: noticeId(entry.key, due) }}
                    accessibilityLabel="Done" style={{ height: 36, width: 36, padding: 7 }} />
                  <FlexWidget style={{ flex: 1, flexDirection: 'column', paddingLeft: 4 }}>
                    <TextWidget text={reminderLabel(entry)} maxLines={1} truncate="END" style={{ fontSize: 14, color: hex(T.on_surface) }} />
                    <FlexWidget style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <TextWidget text={formatReminderTime(due, now)} style={{ fontSize: 12, color: hex(color) }} />
                      {entry.repeat ? <SvgWidget svg={svg(mdiRepeat, T.on_surface_variant)} style={{ height: 12, width: 12, marginLeft: 4 }} /> : <TextWidget text="" />}
                      <TextWidget text={entry.noteId && entry.text ? `  ${entry.noteTitle || 'Untitled'}` : ''} maxLines={1} truncate="END" style={{ fontSize: 12, color: hex(T.on_surface_variant) }} />
                    </FlexWidget>
                  </FlexWidget>
                </FlexWidget>
              );
            })])}
        </ListWidget>
      ) : (
        <FlexWidget clickAction="OPEN_URI" clickActionData={{ uri: 'noted://reminders' }} style={{ height: 'match_parent', width: 'match_parent', alignItems: 'center', justifyContent: 'center' }}>
          <TextWidget text="No reminders" style={{ fontSize: 14, color: hex(T.on_surface_variant) }} />
        </FlexWidget>
      )}
    </FlexWidget>
  );
}

// Draws every Reminders widget on the home screen again (none placed: nothing to do).
export const updateReminderWidget = (entries: ReminderEntry[]): Promise<void> => {
  refreshTheme();
  return requestWidgetUpdate({
    widgetName: REMINDER_WIDGET,
    renderWidget: () => <ReminderWidget entries={entries} now={new Date()} />,
  }).catch((e) => console.warn('Reminder widget:', e));
};
