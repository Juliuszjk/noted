import * as Battery from 'expo-battery';
import * as IntentLauncher from 'expo-intent-launcher';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { goingAway } from './away';
import { appAlert } from './Dialog';

// Reminders set on another device reach a closed app through the background sync
// (reminder-notifications.ts). Android's battery optimization, and Samsung's Power saving
// with it, blocks that job, so the app asks once to be let off it ("Unrestricted" battery);
// Settings > Sync shows the state and asks again.
const ASKED_KEY = 'noted_battery_asked';
const PACKAGE = Constants.expoConfig?.android?.package ?? 'io.github.juliuszjk.noted';

export const backgroundRestricted = async (): Promise<boolean> => {
  try {
    return await Battery.isBatteryOptimizationEnabledAsync();
  } catch {
    return false;
  }
};

// Android's own "Let the app always run in the background?" dialog; the app's settings page if
// the phone has no such dialog.
export const askUnrestricted = async (): Promise<void> => {
  goingAway();
  try {
    await IntentLauncher.startActivityAsync('android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS', { data: `package:${PACKAGE}` });
  } catch {
    goingAway();
    await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.APPLICATION_DETAILS_SETTINGS, { data: `package:${PACKAGE}` }).catch(() => {});
  }
};

// Once, when the first reminder is waiting and the background sync would be blocked.
export const offerUnrestricted = async (): Promise<void> => {
  try {
    if (SecureStore.getItem(ASKED_KEY)) return;
    if (!(await backgroundRestricted())) return;
    SecureStore.setItem(ASKED_KEY, '1');
  } catch {
    return;
  }
  appAlert(
    'Reminders with the app closed',
    'Reminders set on another device reach this phone through a sync in the background. Android\'s battery saving blocks it, so they would only arrive when you open Noted. Let Noted run in the background? (Settings > Sync, any time.)',
    [{ text: 'Not now', style: 'cancel' }, { text: 'Allow', onPress: () => { void askUnrestricted(); } }],
  );
};
