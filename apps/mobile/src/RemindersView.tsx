import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, SectionList, StyleSheet } from 'react-native';
import { mdiCheckboxBlankCircleOutline, mdiCheckCircle, mdiRepeat, mdiNoteTextOutline, mdiBellPlusOutline } from '@mdi/js';
import { completeReminder, formatReminderTime, reminderStatus } from '@noted/editor/reminder-time';
import type { ReminderState, ReminderTimes } from '@noted/editor/reminder-time';
import { reminderLabel, reminderSections } from '@noted/ui/src/reminder-list';
import type { ReminderEntry } from '@noted/ui/src/reminder-list';
import { T, Icon } from './ui';
import { ReminderSheet } from './ReminderSheet';

// The Reminders view of the phone (desktop: RemindersList.tsx): reminder chips of every note
// and reminders of their own, in sections. The circle ticks one off, a tap opens the note (own
// reminders open the picker), the bell changes the time; `creating` shows the picker for a
// new reminder of its own (the + button).
export function RemindersView({ entries, query, times, creating, onCreated, onOpenNote, onChange, onCreate }: {
  entries: ReminderEntry[];
  query: string;
  times: ReminderTimes;
  creating: boolean;
  onCreated: () => void;
  onOpenNote: (noteId: string) => void;
  onChange: (entry: ReminderEntry, state: ReminderState | null, text?: string) => void;
  onCreate: (text: string, state: ReminderState) => void;
}) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30 * 1000);
    return () => clearInterval(timer);
  }, []);
  const [editing, setEditing] = useState<ReminderEntry | null>(null);
  const sections = useMemo(
    () => reminderSections(entries, now, query).map((s) => ({ key: s.kind, title: s.title, kind: s.kind, data: s.items })),
    [entries, now, query],
  );
  const statusColor = (entry: ReminderEntry) => {
    const status = reminderStatus(entry, now);
    return status === 'overdue' ? T.error : status === 'today' ? T.primary : T.on_surface_variant;
  };

  return (
    <>
      <SectionList
        sections={sections}
        keyExtractor={(entry) => entry.key}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => (
          <View style={styles.header}>
            <Text style={[styles.headerText, section.kind === 'overdue' && { color: T.error }]}>{section.title}</Text>
            <Text style={styles.headerCount}>{section.data.length}</Text>
          </View>
        )}
        renderItem={({ item: entry }) => (
          <TouchableOpacity style={styles.row} onPress={() => (entry.noteId ? onOpenNote(entry.noteId) : setEditing(entry))} onLongPress={() => setEditing(entry)} delayLongPress={350}>
            <TouchableOpacity
              hitSlop={10}
              accessibilityLabel={entry.done ? 'Not done' : 'Done'}
              onPress={() => onChange(entry, entry.done ? { at: entry.at, repeat: entry.repeat, done: false } : completeReminder(entry, Date.now()))}
            >
              <Icon path={entry.done ? mdiCheckCircle : mdiCheckboxBlankCircleOutline} size={24} color={entry.done ? T.primary : T.on_surface_variant} />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={[styles.text, entry.done && styles.done]} numberOfLines={2}>{reminderLabel(entry)}</Text>
              <View style={styles.sub}>
                <Text style={[styles.when, { color: statusColor(entry) }]}>{formatReminderTime(entry.at, now)}</Text>
                {entry.repeat ? <Icon path={mdiRepeat} size={14} color={T.on_surface_variant} /> : null}
                {entry.noteId && entry.text ? (
                  <>
                    <Icon path={mdiNoteTextOutline} size={14} color={T.on_surface_variant} />
                    <Text style={styles.note} numberOfLines={1}>{entry.noteTitle || 'Untitled'}</Text>
                  </>
                ) : null}
              </View>
            </View>
            <TouchableOpacity hitSlop={10} onPress={() => setEditing(entry)} accessibilityLabel="Change the time" style={{ padding: 4 }}>
              <Icon path={mdiBellPlusOutline} size={22} color={T.on_surface_variant} />
            </TouchableOpacity>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>{query.trim() ? 'No reminder matches' : 'No reminders yet. Type /reminder in a note, or add one with +.'}</Text>
        }
        contentContainerStyle={{ paddingBottom: 96 }}
      />
      {editing ? (
        <ReminderSheet
          title={editing.noteId ? `Reminder in “${editing.noteTitle || 'Untitled'}”` : 'Reminder'}
          initial={editing}
          text={editing.noteId ? undefined : editing.text}
          times={times}
          onResult={(result) => {
            if ('delete' in result) onChange(editing, null);
            else onChange(editing, result.state, editing.noteId ? undefined : result.text);
          }}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {creating ? (
        <ReminderSheet
          title="New reminder"
          text=""
          times={times}
          onResult={(result) => { if (!('delete' in result)) onCreate(result.text, result.state); }}
          onClose={onCreated}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 4 },
  headerText: { fontSize: 13, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', color: T.primary },
  headerCount: { fontSize: 13, color: T.on_surface_variant },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  text: { fontSize: 16, color: T.on_surface },
  done: { color: T.on_surface_variant, textDecorationLine: 'line-through' },
  sub: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  when: { fontSize: 13, fontWeight: '600' },
  note: { flex: 1, fontSize: 13, color: T.on_surface_variant },
  empty: { color: T.on_surface_variant, textAlign: 'center', marginTop: 40, paddingHorizontal: 32, lineHeight: 22 },
});
