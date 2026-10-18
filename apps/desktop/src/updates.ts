import { check } from '@tauri-apps/plugin-updater';
import type { Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { messageDialog, showDialog } from '@noted/ui';
import { RELEASES_PAGE, UPDATE_CHECK_MS } from '@noted/config';

// Only release builds made by GitHub Actions look for updates (VITE_NOTED_UPDATES=1 there):
// a build from source belongs to whoever built it.
export const UPDATES_ON = import.meta.env.VITE_NOTED_UPDATES === '1';

// A version offered and put off ("Later") is not offered again until the app restarts.
let postponed: string | null = null;
let checking = false;

const offer = async (update: Update) => {
  const selfUpdate = await invoke<boolean>('can_self_update').catch(() => false);
  const message = selfUpdate
    ? `You have ${update.currentVersion}. Noted downloads the update and restarts.`
    : `You have ${update.currentVersion}. Download the new version from the releases page (a .deb or .rpm is updated by installing the new package).`;
  const choice = await showDialog({
    title: `Noted ${update.version} is available`,
    message,
    buttons: [
      { label: 'Later', value: 'later' },
      { label: selfUpdate ? 'Update and restart' : 'Open the releases page', value: 'go', style: 'primary' },
    ],
  });
  if (choice !== 'go') { postponed = update.version; return; }
  if (!selfUpdate) { await openUrl(RELEASES_PAGE); return; }
  try {
    await update.downloadAndInstall();
    await relaunch();
  } catch (e) {
    messageDialog('The update failed', e instanceof Error ? e.message : String(e), 'error');
  }
};

// `manual`: Settings > "Check for updates" also reports "up to date" and errors.
export const checkForUpdates = async (manual = false) => {
  if (!UPDATES_ON || checking) return;
  checking = true;
  try {
    const update = await check();
    if (!update) { if (manual) await messageDialog('Noted is up to date', `Version ${await getVersion()}.`); return; }
    if (!manual && update.version === postponed) return;
    await offer(update);
  } catch (e) {
    if (manual) messageDialog('Cannot check for updates', e instanceof Error ? e.message : String(e), 'error');
    else console.warn('Update check failed:', e);
  } finally {
    checking = false;
  }
};

// A first look shortly after the start (sync and the window come first), then twice a day.
export const watchForUpdates = () => {
  if (!UPDATES_ON) return;
  setTimeout(() => { checkForUpdates(); }, 20_000);
  setInterval(() => { checkForUpdates(); }, UPDATE_CHECK_MS);
};
