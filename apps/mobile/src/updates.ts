import Constants from 'expo-constants';
import { Linking } from 'react-native';
import { LATEST_RELEASE_API, RELEASES_PAGE, UPDATE_CHECK_MS } from '@noted/config';
import { appAlert } from './Dialog';

// Only the release APK built by GitHub Actions looks for new versions (an APK built from
// source belongs to whoever built it). Android cannot replace the app by itself: the dialog
// opens the new APK's download, Android installs it over this one (same signing key).
export const UPDATES_ON = process.env.EXPO_PUBLIC_NOTED_UPDATES === '1';
export const APP_VERSION = Constants.expoConfig?.version ?? '';

const parts = (v: string) => v.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
const newer = (a: string, b: string) => {
  const x = parts(a), y = parts(b);
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
};

// Put off with "Later": not offered again until the app starts again.
let postponed: string | null = null;
let checking = false;

// `manual`: Settings > "Check for updates" also reports "up to date" and errors.
export const checkForUpdates = async (manual = false) => {
  if (!UPDATES_ON || checking) return;
  checking = true;
  try {
    const res = await fetch(LATEST_RELEASE_API, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    const release = await res.json() as { tag_name?: string; assets?: { name: string; browser_download_url: string }[] };
    const version = (release.tag_name ?? '').replace(/^v/, '');
    if (!version || !newer(version, APP_VERSION)) {
      if (manual) appAlert('Noted is up to date', `Version ${APP_VERSION}.`);
      return;
    }
    if (!manual && version === postponed) return;
    const apk = release.assets?.find((a) => a.name.endsWith('.apk'))?.browser_download_url ?? RELEASES_PAGE;
    appAlert(`Noted ${version} is available`, `You have ${APP_VERSION}. Download the new APK and open it: Android installs it over this one, your notes stay.`, [
      { text: 'Later', style: 'cancel', onPress: () => { postponed = version; } },
      { text: 'Download', onPress: () => { void Linking.openURL(apk); } },
    ]);
  } catch (e) {
    if (manual) appAlert('Cannot check for updates', e instanceof Error ? e.message : String(e));
    else console.warn('Update check failed:', e);
  } finally {
    checking = false;
  }
};

// A first look shortly after the start, then twice a day while the app runs.
export const watchForUpdates = (): (() => void) => {
  if (!UPDATES_ON) return () => {};
  const first = setTimeout(() => { void checkForUpdates(); }, 20_000);
  const timer = setInterval(() => { void checkForUpdates(); }, UPDATE_CHECK_MS);
  return () => { clearTimeout(first); clearInterval(timer); };
};
