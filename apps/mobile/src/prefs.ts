import * as SecureStore from 'expo-secure-store';
import { parseEditorPrefs } from '@noted/editor/editor-prefs-lite';
import { parseToolbarConfig } from '@noted/editor/toolbar-items';
import type { EditorPrefs } from '@noted/editor/editor-prefs-lite';
import type { SharedEditorPrefs } from '@noted/sync';
import type { ToolbarConfig } from '@noted/editor/toolbar-items';

// Settings > Editor and Settings > Toolbar of this phone; open notes get changes at once.
const EDITOR_KEY = 'noted_editor_prefs';
const TOOLBAR_KEY = 'noted_toolbar_mobile';
const TABLE_TOOLBAR_KEY = 'noted_toolbar_mobile_table';

const read = (key: string) => {
  try {
    return SecureStore.getItem(key);
  } catch {
    return null;
  }
};

let editorPrefs: EditorPrefs = parseEditorPrefs(read(EDITOR_KEY));
let toolbarConfig: ToolbarConfig | null = parseToolbarConfig(read(TOOLBAR_KEY));
// The extra buttons while the cursor is in a table (Settings > Toolbar > Table).
let tableToolbarConfig: ToolbarConfig | null = parseToolbarConfig(read(TABLE_TOOLBAR_KEY));
const listeners = new Set<() => void>();

// The default title and the reminder times are shared by all devices (kept in the synced
// catalog, set by NotesScreen).
let sharedPrefs: SharedEditorPrefs = {};

export const getEditorPrefs = (): EditorPrefs => parseEditorPrefs(JSON.stringify({ ...editorPrefs, ...sharedPrefs }));

export const setSharedPrefsCache = (value: SharedEditorPrefs) => {
  if (JSON.stringify(value) === JSON.stringify(sharedPrefs)) return;
  sharedPrefs = value;
  listeners.forEach((l) => l());
};
export const getToolbarConfig = () => toolbarConfig;
export const getTableToolbarConfig = () => tableToolbarConfig;

export const setEditorPrefs = (prefs: EditorPrefs) => {
  editorPrefs = prefs;
  SecureStore.setItem(EDITOR_KEY, JSON.stringify(prefs));
  listeners.forEach((l) => l());
};

export const setToolbarConfig = (config: ToolbarConfig | null) => {
  toolbarConfig = config;
  SecureStore.setItem(TOOLBAR_KEY, JSON.stringify(config));
  listeners.forEach((l) => l());
};

export const setTableToolbarConfig = (config: ToolbarConfig | null) => {
  tableToolbarConfig = config;
  SecureStore.setItem(TABLE_TOOLBAR_KEY, JSON.stringify(config));
  listeners.forEach((l) => l());
};

export const onPrefsChange = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
