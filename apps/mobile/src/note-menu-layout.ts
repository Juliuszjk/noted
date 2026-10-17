import * as SecureStore from 'expo-secure-store';
import {
  mdiPin, mdiStarOutline, mdiArchiveArrowDownOutline, mdiPencilOffOutline, mdiLockOutline, mdiSpellcheck, mdiBookOutline,
  mdiPound, mdiVectorLink, mdiContentCopy, mdiShareVariantOutline, mdiContentDuplicate, mdiMagnify, mdiExportVariant,
  mdiPaperclip, mdiHistory, mdiWeb,
} from '@mdi/js';

// Settings > Note menu: which switches and actions the note menu shows, and in what order
// (this phone only). "Move to trash" (or Restore / Delete forever in the trash) always comes last.

export interface MenuItemDef {
  id: string;
  label: string;
  icon: string;
}

export const MENU_TOGGLES: MenuItemDef[] = [
  { id: 'pinned', label: 'Pin', icon: mdiPin },
  { id: 'favorite', label: 'Favorite', icon: mdiStarOutline },
  { id: 'archived', label: 'Archive', icon: mdiArchiveArrowDownOutline },
  { id: 'readOnly', label: 'Read only', icon: mdiPencilOffOutline },
  { id: 'lock', label: 'Lock', icon: mdiLockOutline },
  { id: 'spellcheck', label: 'Spell check', icon: mdiSpellcheck },
];

export const MENU_ACTIONS: MenuItemDef[] = [
  { id: 'notebook', label: 'Add to notebook', icon: mdiBookOutline },
  { id: 'tag', label: 'Add tag', icon: mdiPound },
  { id: 'links', label: 'Links', icon: mdiVectorLink },
  { id: 'copy', label: 'Copy', icon: mdiContentCopy },
  { id: 'share', label: 'Share', icon: mdiShareVariantOutline },
  { id: 'duplicate', label: 'Duplicate', icon: mdiContentDuplicate },
  { id: 'find', label: 'Find in note', icon: mdiMagnify },
  { id: 'export', label: 'Export', icon: mdiExportVariant },
  { id: 'files', label: 'Attached files', icon: mdiPaperclip },
  { id: 'history', label: 'History', icon: mdiHistory },
  { id: 'publish', label: 'Publish', icon: mdiWeb },
];

export interface NoteMenuLayout {
  // Shown items in order; the others are hidden.
  toggles: string[];
  actions: string[];
}

const KEY = 'noted_note_menu_layout';
export const DEFAULT_NOTE_MENU: NoteMenuLayout = { toggles: MENU_TOGGLES.map((i) => i.id), actions: MENU_ACTIONS.map((i) => i.id) };

const clean = (ids: unknown, known: MenuItemDef[]): string[] | null => {
  if (!Array.isArray(ids)) return null;
  const valid = new Set(known.map((i) => i.id));
  return [...new Set(ids.filter((id): id is string => typeof id === 'string' && valid.has(id)))];
};

let layout: NoteMenuLayout = (() => {
  try {
    const d = JSON.parse(SecureStore.getItem(KEY) ?? 'null');
    return { toggles: clean(d?.toggles, MENU_TOGGLES) ?? DEFAULT_NOTE_MENU.toggles, actions: clean(d?.actions, MENU_ACTIONS) ?? DEFAULT_NOTE_MENU.actions };
  } catch {
    return DEFAULT_NOTE_MENU;
  }
})();

export const getNoteMenuLayout = (): NoteMenuLayout => layout;

export const setNoteMenuLayout = (next: NoteMenuLayout | null) => {
  layout = next ?? DEFAULT_NOTE_MENU;
  if (next) SecureStore.setItem(KEY, JSON.stringify(next));
  else SecureStore.deleteItemAsync(KEY).catch(() => {});
};
