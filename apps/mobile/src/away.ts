import * as SecureStore from 'expo-secure-store';

// App lock "after time in the background" must not count the times Noted itself sends the
// user to another screen and expects them back: a file or folder picker, the share menu, a
// file opened in another app. Those calls say so first (goingAway); a background that starts
// within a few seconds after that does not lock the app.
let awayAt = 0;
export const goingAway = () => { awayAt = Date.now(); };
export const backgroundWasIntended = (): boolean => Date.now() - awayAt < 4000;

// A reload of the app for new colours (theme, wallpaper) is not a new start: no lock screen
// right after it.
const RELOAD_PASS_KEY = 'noted_reload_unlocked';
export const markReloadUnlocked = () => {
  try { SecureStore.setItem(RELOAD_PASS_KEY, String(Date.now())); } catch { /* no pass, the lock shows */ }
};
export const consumeReloadPass = (): boolean => {
  try {
    const at = Number(SecureStore.getItem(RELOAD_PASS_KEY) ?? 0);
    if (at) SecureStore.deleteItemAsync(RELOAD_PASS_KEY).catch(() => {});
    return at > 0 && Date.now() - at < 15_000;
  } catch {
    return false;
  }
};
