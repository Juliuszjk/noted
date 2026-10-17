// Layout preferences of this device (not synced): kept in localStorage, which may be empty or
// unavailable, so every read falls back to the defaults.
import type { NoteSort, NoteView, NoteGrouping } from '@noted/ui';

export interface Prefs {
  view: NoteView;
  // Order inside the list (edited / created / title) and how the Notes view is grouped below
  // Pinned and Recent (note-groups.ts).
  sort: NoteSort;
  grouping: NoteGrouping;
  // Folded / unfolded groups and branches of the list (flipped against their defaults).
  listFolds: string[];
  // Note properties panel open.
  propsOpen: boolean;
  // Columns: navigation and note list, each can be hidden and resized.
  navHidden: boolean;
  // Navigation shown as a narrow rail of icons.
  navCompact: boolean;
  listHidden: boolean;
  navWidth: number;
  listWidth: number;
  // Note properties panel on the right.
  propsWidth: number;
  fullWidth: boolean;
  focusMode: boolean;
  zoom: number;
  toolbar: 'top' | 'floating';
  // The table menu floats at the table, or is a row under the toolbar.
  tableMenu: 'floating' | 'toolbar';
  // The drawing menu floats at the drawing, or under the toolbar (over the note).
  drawingMenu: 'floating' | 'toolbar';
  tabs: string[];
  activeTab: string | null;
}

const KEY = 'noted_ui_prefs';
// The note properties panel: narrower than this cuts its rows.
export const PROPS_MIN_WIDTH = 250;
export const PROPS_MAX_WIDTH = 560;

const DEFAULTS: Prefs = { view: { kind: 'notes' }, sort: 'edited', grouping: 'notebook', listFolds: [], propsOpen: false, navHidden: false, navCompact: false, listHidden: false, navWidth: 236, listWidth: 290, propsWidth: 300, fullWidth: false, focusMode: false, zoom: 1, toolbar: 'top', tableMenu: 'floating', drawingMenu: 'floating', tabs: [], activeTab: null };

export const loadPrefs = (): Prefs => {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    const view = data.view && typeof data.view.kind === 'string' ? data.view : DEFAULTS.view;
    return {
      view: ['notes', 'favorites', 'archive', 'trash', 'tree', 'published'].includes(view.kind) || (['notebook', 'tag'].includes(view.kind) && typeof view.id === 'string') ? view : DEFAULTS.view,
      // "By notebook" / "By tag" used to be sorts: now groupings, sorted by last edit.
      sort: ['edited', 'created', 'title'].includes(data.sort) ? data.sort : 'edited',
      grouping: ['notebook', 'tag', 'az', 'date'].includes(data.grouping) ? data.grouping
        : data.sort === 'tag' ? 'tag' : 'notebook',
      listFolds: Array.isArray(data.listFolds) ? data.listFolds.filter((k: unknown) => typeof k === 'string').slice(-500) : [],
      propsOpen: data.propsOpen === true,
      navHidden: data.navHidden === true,
      navCompact: data.navCompact === true,
      listHidden: data.listHidden === true,
      navWidth: typeof data.navWidth === 'number' ? Math.min(520, Math.max(120, data.navWidth)) : 236,
      listWidth: typeof data.listWidth === 'number' ? Math.min(520, Math.max(100, data.listWidth)) : 290,
      propsWidth: typeof data.propsWidth === 'number' ? Math.min(PROPS_MAX_WIDTH, Math.max(PROPS_MIN_WIDTH, data.propsWidth)) : 300,
      fullWidth: data.fullWidth === true,
      focusMode: data.focusMode === true,
      zoom: typeof data.zoom === 'number' && data.zoom >= 0.5 && data.zoom <= 2 ? data.zoom : 1,
      toolbar: data.toolbar === 'floating' ? 'floating' : 'top',
      tableMenu: data.tableMenu === 'toolbar' ? 'toolbar' : 'floating',
      drawingMenu: data.drawingMenu === 'toolbar' ? 'toolbar' : 'floating',
      tabs: Array.isArray(data.tabs) ? data.tabs.filter((t: unknown) => typeof t === 'string') : [],
      activeTab: typeof data.activeTab === 'string' ? data.activeTab : null,
    };
  } catch {
    return { ...DEFAULTS };
  }
};

export const savePrefs = (prefs: Prefs): void => {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Not fatal: the layout just resets next time.
  }
};

// Settings > Keyboard shortcuts: the user's changes to the default keys (this device).
const SHORTCUTS_KEY = 'noted_shortcuts';
export const loadShortcutOverrides = (): Record<string, string[]> => {
  try {
    const parsed = JSON.parse(localStorage.getItem(SHORTCUTS_KEY) ?? '{}');
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, string[]> = {};
    for (const [id, keys] of Object.entries(parsed)) {
      if (Array.isArray(keys) && keys.every((k) => typeof k === 'string')) out[id] = keys as string[];
    }
    return out;
  } catch {
    return {};
  }
};
export const saveShortcutOverrides = (overrides: Record<string, string[]>) => {
  try { localStorage.setItem(SHORTCUTS_KEY, JSON.stringify(overrides)); } catch { /* not saved */ }
};
