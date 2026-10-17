import React, { useMemo, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { mdiChevronLeft, mdiChevronRight } from '@mdi/js';
import {
  REMINDER_REPEATS, MONTH_NAMES, WEEKDAY_SHORT, atClock, completeReminder, formatClock, formatReminderTime, monthGrid, parseClock,
  quickReminderChoices, repeatLabel, sameDay,
} from '@noted/editor/reminder-time';
import type { ReminderRepeat, ReminderState, ReminderTimes } from '@noted/editor/reminder-time';
import { T, Icon, themed } from './ui';

export type ReminderSheetResult = { state: ReminderState; text: string } | { delete: true };

// The reminder picker of the Reminders view (the editor page has its own, reminder-picker.ts,
// built from the same functions): text for a reminder of its own, quick choices, a month
// calendar, time, repeat; Done / Delete for an existing one.
export function ReminderSheet({ title, initial, text, times, onResult, onClose }: {
  title: string;
  initial?: ReminderState;
  // Text of a reminder of its own; undefined = a chip in a note (no text field).
  text?: string;
  times: ReminderTimes;
  onResult: (result: ReminderSheetResult) => void;
  onClose: () => void;
}) {
  const now = useMemo(() => new Date(), []);
  const start = initial ? new Date(initial.at) : atClock(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1), times.morning);
  const [label, setLabel] = useState(text ?? '');
  const [day, setDay] = useState(new Date(start.getFullYear(), start.getMonth(), start.getDate()));
  const [shown, setShown] = useState(new Date(start.getFullYear(), start.getMonth(), 1));
  const [time, setTime] = useState(formatClock(start));
  const [repeat, setRepeat] = useState<ReminderRepeat | null>(initial?.repeat ?? null);
  const [missingText, setMissingText] = useState(false);

  const clock = parseClock(time);
  const at = clock ? new Date(day.getFullYear(), day.getMonth(), day.getDate(), clock.hours, clock.minutes).getTime() : null;

  const finish = (state: ReminderState) => {
    if (text !== undefined && !label.trim()) return setMissingText(true);
    onResult({ state, text: label.trim() });
    onClose();
  };
  const save = () => {
    if (at === null) return;
    finish({ at, repeat, done: initial && at === initial.at ? initial.done : false });
  };

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <KeyboardAvoidingView behavior="padding" style={styles.sheet}>
        <View style={styles.handle} />
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 8 }}>
          {text !== undefined ? (
            <TextInput
              value={label}
              onChangeText={(v) => { setLabel(v); setMissingText(false); }}
              placeholder="Remind me to…"
              placeholderTextColor={T.on_surface_variant}
              style={[styles.input, missingText && { borderColor: T.error }]}
            />
          ) : null}
          <View style={styles.quick}>
            {quickReminderChoices(now, times).map((choice) => (
              <TouchableOpacity key={choice.label} style={styles.quickItem} onPress={() => finish({ at: choice.at, repeat, done: false })}>
                <Text style={styles.quickLabel}>{choice.label}</Text>
                <Text style={styles.quickSub}>{formatReminderTime(choice.at, now)}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.calHead}>
            <TouchableOpacity onPress={() => setShown(new Date(shown.getFullYear(), shown.getMonth() - 1, 1))} style={styles.calNav} accessibilityLabel="Previous month">
              <Icon path={mdiChevronLeft} size={24} />
            </TouchableOpacity>
            <Text style={styles.calTitle}>{MONTH_NAMES[shown.getMonth()]} {shown.getFullYear()}</Text>
            <TouchableOpacity onPress={() => setShown(new Date(shown.getFullYear(), shown.getMonth() + 1, 1))} style={styles.calNav} accessibilityLabel="Next month">
              <Icon path={mdiChevronRight} size={24} />
            </TouchableOpacity>
          </View>
          <View style={styles.grid}>
            {WEEKDAY_SHORT.map((d) => <Text key={d} style={styles.weekday}>{d}</Text>)}
            {monthGrid(shown, now).map((cell) => {
              const selected = sameDay(cell.date, day);
              return (
                <TouchableOpacity
                  key={cell.date.getTime()}
                  style={[styles.dayCell, cell.today && styles.today, selected && styles.selected]}
                  onPress={() => {
                    setDay(cell.date);
                    if (!cell.inMonth) setShown(new Date(cell.date.getFullYear(), cell.date.getMonth(), 1));
                  }}
                >
                  <Text style={[styles.dayText, !cell.inMonth && { opacity: 0.45 }, cell.past && !selected && { opacity: 0.5 }, selected && { color: T.on_primary }]}>
                    {cell.date.getDate()}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Time</Text>
            <TextInput
              value={time}
              onChangeText={setTime}
              onEndEditing={() => { if (clock) setTime(`${String(clock.hours).padStart(2, '0')}:${String(clock.minutes).padStart(2, '0')}`); }}
              keyboardType="numbers-and-punctuation"
              maxLength={5}
              style={[styles.input, styles.time, !clock && { borderColor: T.error }]}
            />
          </View>
          <Text style={[styles.rowLabel, { marginTop: 14, marginBottom: 8 }]}>Repeat</Text>
          <View>
            <View style={styles.chips}>
              {REMINDER_REPEATS.map((option) => (
                <TouchableOpacity key={option.label} style={[styles.chip, option.value === repeat && styles.chipOn]} onPress={() => setRepeat(option.value)}>
                  <Text style={[styles.chipText, option.value === repeat && { color: T.on_primary }]}>{option.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <Text style={styles.summary}>
            {at === null ? 'Type a time, e.g. 7:30' : `${formatReminderTime(at, new Date())}${repeat ? ` · ${repeatLabel(repeat).toLowerCase()}` : ''}`}
          </Text>
        </ScrollView>
        <View style={styles.actions}>
          {initial ? (
            <>
              <TouchableOpacity style={styles.button} onPress={() => { onResult({ delete: true }); onClose(); }}>
                <Text style={[styles.buttonText, { color: T.error }]}>Delete</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.button}
                onPress={() => finish(initial.done ? { ...initial, done: false } : completeReminder({ ...initial, repeat }, Date.now()))}
              >
                <Text style={styles.buttonText}>{initial.done ? 'Not done' : initial.repeat ? 'Done, next' : 'Done'}</Text>
              </TouchableOpacity>
            </>
          ) : null}
          <View style={{ flex: 1 }} />
          <TouchableOpacity style={styles.button} onPress={onClose}>
            <Text style={styles.buttonText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.button, styles.primary, at === null && { opacity: 0.5 }]} onPress={save} disabled={at === null}>
            <Text style={[styles.buttonText, { color: T.on_primary }]}>Save</Text>
          </TouchableOpacity>
        </View>
        {/* Keeps the buttons above Android's gesture bar (KeyboardAvoidingView owns the
            sheet's own bottom padding). */}
        <View style={{ height: 44 }} />
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = themed(() => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { maxHeight: '92%', backgroundColor: T.surface_container_high, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  handle: { width: 48, height: 5, borderRadius: 3, backgroundColor: T.outline, opacity: 0.6, alignSelf: 'center', marginTop: 10, marginBottom: 6 },
  title: { fontSize: 18, fontWeight: 'bold', color: T.on_surface, paddingHorizontal: 20, paddingVertical: 8 },
  input: { borderWidth: 1, borderColor: T.outline_variant, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: T.on_surface, fontSize: 16, marginBottom: 12 },
  quick: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  quickItem: { width: '48.5%', borderWidth: 1, borderColor: T.outline_variant, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  quickLabel: { color: T.on_surface, fontSize: 15 },
  quickSub: { color: T.on_surface_variant, fontSize: 13, marginTop: 2 },
  calHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  calNav: { padding: 8 },
  calTitle: { color: T.on_surface, fontSize: 16, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  weekday: { width: `${100 / 7}%`, textAlign: 'center', color: T.on_surface_variant, fontSize: 12, paddingVertical: 4 },
  dayCell: { width: `${100 / 7}%`, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: 'transparent' },
  today: { borderColor: T.primary },
  selected: { backgroundColor: T.primary },
  dayText: { color: T.on_surface, fontSize: 15 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10 },
  rowLabel: { color: T.on_surface_variant, fontSize: 15, width: 60 },
  time: { width: 90, marginBottom: 0, textAlign: 'center' },
  chips: { flexDirection: 'row', gap: 6 },
  chip: { flex: 1, alignItems: 'center', borderWidth: 1, borderColor: T.outline_variant, borderRadius: 999, paddingVertical: 8 },
  chipOn: { backgroundColor: T.primary, borderColor: T.primary },
  chipText: { color: T.on_surface, fontSize: 14 },
  summary: { color: T.on_surface_variant, fontSize: 13, marginTop: 10 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 10 },
  button: { borderWidth: 1, borderColor: T.outline_variant, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  primary: { backgroundColor: T.primary, borderColor: T.primary },
  buttonText: { color: T.on_surface, fontSize: 15, fontWeight: '600' },
}));
