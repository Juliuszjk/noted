import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import * as BackgroundTask from 'expo-background-task';
import { AppState } from 'react-native';
import { File, Paths } from 'expo-file-system';
import { applyReminderAction } from '@noted/editor/reminder-time';
import type { ReminderAction, ReminderTimes } from '@noted/editor/reminder-time';
import { parseNoticeId, reminderNotices, MISSED_WITHIN_MS } from '@noted/ui/src/reminder-notify';
import { reminderEntries } from '@noted/ui/src/reminder-list';
import type { ReminderNotice } from '@noted/ui/src/reminder-notify';
import type { ReminderEntry } from '@noted/ui/src/reminder-list';
import { unseal } from '@noted/crypto';
import {
  CATALOG_ID, buildNoteMeta, decodeNoteMeta, displayTitle, isSystemNote, docFromSealed, getSharedEditorPrefs, listOwnReminders, mergingNoteStore, runSyncEngine, setAuthEpoch,
  setOwnReminder, updateReminderInDoc,
} from '@noted/sync';
import type { LocalNoteStore } from '@noted/sync';
import { updateNoteRecord } from './note-actions';
import { getEditorPrefs, setSharedPrefsCache } from './prefs';
import { getAuthEpochStored, getMasterKey } from './storage';
import { createExpoStore } from './store';
import { updateReminderWidget } from './reminder-widget';

// Reminder notifications of the phone: every reminder that is not done is a scheduled Android
// alarm (exact, USE_EXACT_ALARM), so it notifies with the app closed. The buttons work without
// opening the app: Android starts the JS bundle headless and runs REMINDER_TASK, which changes
// the reminder in the local database and syncs once. List and pure logic: reminder-notify.ts.
// A closed app learns about reminders set elsewhere through SYNC_TASK, a sync in the
// background about every 15 minutes (Android WorkManager; Samsung may run it less often).

const CHANNEL = 'reminders';
const CATEGORY = 'reminder';
export const REMINDER_TASK = 'noted-reminder-action';
const SYNC_TASK = 'noted-background-sync';
const ACTIONS: ReminderAction[] = ['done', 'hour', 'tomorrow'];

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

let ready: Promise<void> | null = null;
const setup = () => (ready ??= (async () => {
  await Notifications.setNotificationChannelAsync(CHANNEL, {
    name: 'Reminders',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 200, 250],
  });
  await Notifications.setNotificationCategoryAsync(CATEGORY, [
    { identifier: 'done', buttonTitle: 'Done', options: { opensAppToForeground: false } },
    { identifier: 'hour', buttonTitle: 'In 1 hour', options: { opensAppToForeground: false } },
    { identifier: 'tomorrow', buttonTitle: 'Tomorrow', options: { opensAppToForeground: false } },
  ]);
})());

// Notices already scheduled or shown (a file: kept across restarts). A missed reminder the
// phone learns about late (synced after its time) is shown once, the rest never twice.
const handledFile = () => new File(Paths.document, 'reminder-notices.json');
const readHandled = (): Set<string> => {
  try {
    const file = handledFile();
    const list = file.exists ? JSON.parse(file.textSync()) : [];
    return new Set(Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
};
const writeHandled = (handled: Set<string>) => {
  const oldest = Date.now() - MISSED_WITHIN_MS;
  const list = [...handled].filter((id) => (parseNoticeId(id)?.due ?? 0) > oldest);
  try {
    const file = handledFile();
    if (!file.exists) file.create();
    file.write(JSON.stringify(list));
  } catch (e) {
    console.warn('Reminder notices not kept:', e);
  }
};

const content = (notice: ReminderNotice): Notifications.NotificationContentInput => ({
  title: notice.title,
  body: notice.body,
  data: { notice: notice.id, noteId: notice.noteId },
  categoryIdentifier: CATEGORY,
  sound: true,
});

// Asks for the notification permission once (Android 13+), when there is something to notify.
const allowed = async (): Promise<boolean> => {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  return (await Notifications.requestPermissionsAsync()).granted;
};

let running: Promise<void> = Promise.resolve();

// Makes the scheduled alarms and the shown notifications match the reminders: new ones are
// scheduled, changed / done ones cancelled and their notifications removed.
export const syncReminderNotifications = (notices: ReminderNotice[]): Promise<void> => {
  running = running.then(async () => {
    await setup();
    const wanted = new Map(notices.map((n) => [n.id, n]));
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    for (const s of scheduled) if (!wanted.has(s.identifier)) await Notifications.cancelScheduledNotificationAsync(s.identifier);
    for (const shown of await Notifications.getPresentedNotificationsAsync()) {
      const id = shown.request.content.data?.notice;
      if (typeof id === 'string' && !wanted.has(id)) await Notifications.dismissNotificationAsync(shown.request.identifier);
    }
    if (!notices.length || !(await allowed())) return;
    const handled = readHandled();
    const already = new Set(scheduled.map((s) => s.identifier));
    const now = Date.now();
    for (const notice of notices) {
      if (already.has(notice.id)) continue;
      if (notice.due > now) {
        await Notifications.scheduleNotificationAsync({
          identifier: notice.id,
          content: content(notice),
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: notice.due, channelId: CHANNEL },
        });
      } else if (!handled.has(notice.id)) {
        await Notifications.scheduleNotificationAsync({ identifier: notice.id, content: content(notice), trigger: { channelId: CHANNEL } });
      } else continue;
      handled.add(notice.id);
    }
    writeHandled(handled);
  }).catch((e) => console.warn('Reminder notifications:', e));
  return running;
};

// The reminders straight from the database (background tasks and the widget have no list screen).
export const entriesFromStore = async (masterKey: Uint8Array, store: LocalNoteStore): Promise<ReminderEntry[]> => {
  const all = await store.getAll();
  const notes = all.filter((n) => !isSystemNote(n.id) && n.content && n.content.includes('.')).flatMap((n) => {
    try {
      const meta = decodeNoteMeta(new TextDecoder().decode(unseal(masterKey, n.content!)));
      return meta.deleted ? [] : [{ id: n.id, title: displayTitle(meta), reminders: meta.reminders, trashedAt: meta.trashedAt }];
    } catch {
      return [];
    }
  });
  const catalog = all.find((n) => n.id === CATALOG_ID)?.yjs_state;
  const own = catalog ? listOwnReminders(docFromSealed(masterKey, catalog)) : [];
  return reminderEntries(notes, own);
};
// Alarms and the home screen widget after the database changed with no list screen open.
const followStore = async (masterKey: Uint8Array, store: LocalNoteStore) => {
  const entries = await entriesFromStore(masterKey, store);
  await syncReminderNotifications(reminderNotices(entries, Date.now()));
  await updateReminderWidget(entries);
};

// ---- buttons ----

const timesFrom = (masterKey: Uint8Array, catalogState: string | null | undefined): ReminderTimes => {
  if (catalogState) {
    try {
      setSharedPrefsCache(getSharedEditorPrefs(docFromSealed(masterKey, catalogState)));
    } catch {
      // Default times.
    }
  }
  const prefs = getEditorPrefs();
  return { morning: prefs.reminderMorning, evening: prefs.reminderEvening };
};

// Applies a button to the reminder the notice is for. False when the reminder has changed
// since (done or moved elsewhere), or is gone.
export const applyNoticeAction = async (masterKey: Uint8Array, store: LocalNoteStore, noticeId: string, action: ReminderAction): Promise<boolean> => {
  const notice = parseNoticeId(noticeId);
  if (!notice) return false;
  const slash = notice.key.indexOf('/');
  const scope = notice.key.slice(0, slash);
  const id = notice.key.slice(slash + 1);
  const all = await store.getAll();
  const times = timesFrom(masterKey, all.find((n) => n.id === CATALOG_ID)?.yjs_state);
  const now = Date.now();
  if (scope === 'own') {
    const changed = await updateNoteRecord(masterKey, store, CATALOG_ID, (doc) => {
      const own = listOwnReminders(doc).find((r) => r.id === id);
      const next = own && applyReminderAction(own, action, notice.due, now, times);
      if (!own || !next) return false;
      setOwnReminder(doc, { ...own, ...next });
      return true;
    });
    return changed === true;
  }
  const record = all.find((n) => n.id === scope);
  if (!record?.yjs_state) return false;
  const chip = buildNoteMeta(docFromSealed(masterKey, record.yjs_state)).reminders?.find((r) => r.id === id);
  const next = chip && applyReminderAction(chip, action, notice.due, now, times);
  if (!next) return false;
  await updateNoteRecord(masterKey, store, scope, (doc) => updateReminderInDoc(doc, id, next));
  return true;
};

const noticeOf = (response: Notifications.NotificationResponse): string | null => {
  const data = response.notification?.request?.content?.data as Record<string, unknown> | undefined;
  if (typeof data?.notice === 'string') return data.notice;
  const identifier = response.notification?.request?.identifier;
  return typeof identifier === 'string' && parseNoticeId(identifier) ? identifier : null;
};

// The running app (NotesScreen) applies buttons pressed while it is open and reloads after
// the background task changed something.
type AppHandlers = { apply: (noticeId: string, action: ReminderAction) => Promise<void>; changed: () => void; open: (noticeId: string) => void };
let appHandlers: AppHandlers | null = null;
let pendingOpen: string | null = null;

export const attachReminderHandlers = (handlers: AppHandlers): (() => void) => {
  appHandlers = handlers;
  if (pendingOpen) { handlers.open(pendingOpen); pendingOpen = null; }
  return () => { if (appHandlers === handlers) appHandlers = null; };
};

// Taps and buttons while the app runs (with the app in the background Android runs the
// task instead, see below).
Notifications.addNotificationResponseReceivedListener((response) => {
  const noticeId = noticeOf(response);
  if (!noticeId) return;
  const action = response.actionIdentifier;
  if (action === Notifications.DEFAULT_ACTION_IDENTIFIER) {
    if (appHandlers) appHandlers.open(noticeId);
    else pendingOpen = noticeId;
    return;
  }
  if (AppState.currentState !== 'active' || !ACTIONS.includes(action as ReminderAction)) return;
  void Notifications.dismissNotificationAsync(response.notification.request.identifier);
  void appHandlers?.apply(noticeId, action as ReminderAction);
});

// A tap that started the app.
void Notifications.getLastNotificationResponseAsync().then((response) => {
  if (!response || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
  const noticeId = noticeOf(response);
  if (!noticeId) return;
  if (appHandlers) appHandlers.open(noticeId);
  else pendingOpen = noticeId;
});

// Opens the database the way the app does (headless: no screen holds it).
export const openStore = async () => {
  const masterKey = await getMasterKey();
  if (!masterKey) return null;
  setAuthEpoch(await getAuthEpochStored());
  const { store } = await createExpoStore();
  return { masterKey, store: mergingNoteStore(masterKey, store) };
};

// Sync with the app closed, then alarms for what changed. With the app running it does the
// sync itself (one writer).
const backgroundSync = async () => {
  if (appHandlers) {
    appHandlers.changed();
    return;
  }
  const opened = await openStore();
  if (!opened) return;
  await runSyncEngine(opened.masterKey, opened.store, null, null);
  await followStore(opened.masterKey, opened.store);
};

// A notification button or the widget's circle: the running app applies it itself (one
// writer); closed, the database is opened here, the reminder changed and synced once so other
// devices follow.
export const runNoticeAction = async (noticeId: string, action: ReminderAction): Promise<void> => {
  if (appHandlers) {
    await appHandlers.apply(noticeId, action);
    return;
  }
  const opened = await openStore();
  if (!opened) return;
  const { masterKey, store } = opened;
  if (await applyNoticeAction(masterKey, store, noticeId, action)) {
    // A snoozed reminder needs its new alarm.
    await followStore(masterKey, store);
    await runSyncEngine(masterKey, store, null, null).catch((e) => console.warn('Reminder sync:', e));
  }
};

// A button pressed with the app in the background or closed (runs headless when closed).
TaskManager.defineTask<Notifications.NotificationTaskPayload>(REMINDER_TASK, async ({ data }) => {
  const response = data as Notifications.NotificationResponse;
  const action = response?.actionIdentifier;
  const noticeId = response && noticeOf(response);
  if (!noticeId || !ACTIONS.includes(action as ReminderAction)) return;
  try {
    const identifier = response.notification?.request?.identifier;
    if (identifier) await Notifications.dismissNotificationAsync(identifier);
    await runNoticeAction(noticeId, action as ReminderAction);
  } catch (e) {
    console.warn('Reminder action:', e);
  }
});
void Notifications.registerTaskAsync(REMINDER_TASK).catch((e) => console.warn('Reminder task:', e));

TaskManager.defineTask(SYNC_TASK, async () => {
  try {
    await backgroundSync();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (e) {
    console.warn('Background sync:', e);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});
void BackgroundTask.registerTaskAsync(SYNC_TASK, { minimumInterval: 15 }).catch((e) => console.warn('Sync task:', e));
