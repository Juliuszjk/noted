import { readTextFile, BaseDirectory } from '@tauri-apps/plugin-fs';
import { resolveTheme, themeToCssVars, THEME_PRESETS } from '@noted/theme';
import type { ThemeColors, ThemeMode } from '@noted/theme';

// System colours on Linux: matugen writes `theme.json` (Material 3 roles, template
// ~/.config/matugen/templates/noted-theme.json, with the current scheme and both the light and
// the dark one) into the app config dir whenever the wallpaper changes. The file is polled,
// so the app recolours itself without a restart. Settings > Appearance picks auto / light /
// dark (kept on this device).
const THEME_FILE = 'theme.json';
const POLL_MS = 3000;
const MODE_KEY = 'noted_theme_mode';

export const applyTheme = (theme: ThemeColors): void => {
  const root = document.documentElement;
  for (const [name, value] of Object.entries(themeToCssVars(theme))) root.style.setProperty(name, value);
};

export const getThemeMode = (): ThemeMode => {
  try {
    const value = localStorage.getItem(MODE_KEY);
    return value === 'light' || value === 'dark' || THEME_PRESETS.some((p) => p.id === value) ? value! : 'auto';
  } catch {
    return 'auto';
  }
};

let refresh: (() => void) | null = null;

export const setThemeMode = (mode: ThemeMode): void => {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    // Not kept; applies until the app restarts.
  }
  refresh?.();
};

export const watchSystemTheme = (): (() => void) => {
  let fileText: string | null = null;
  let applied = '';
  const dark = window.matchMedia('(prefers-color-scheme: dark)');
  const apply = () => {
    const theme = resolveTheme(getThemeMode(), fileText, dark.matches);
    const key = JSON.stringify(theme);
    if (key === applied) return;
    applied = key;
    applyTheme(theme);
  };
  const check = async () => {
    let text: string | null = null;
    try {
      text = await readTextFile(THEME_FILE, { baseDir: BaseDirectory.AppConfig });
    } catch {
      // No file yet (matugen has not run since the template was added): built-in colours.
    }
    fileText = text;
    apply();
  };
  refresh = apply;
  check();
  const timer = setInterval(check, POLL_MS);
  window.addEventListener('focus', check);
  dark.addEventListener('change', apply);
  return () => {
    clearInterval(timer);
    window.removeEventListener('focus', check);
    dark.removeEventListener('change', apply);
    refresh = null;
  };
};
