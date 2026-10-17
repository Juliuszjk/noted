import type { Editor } from '@tiptap/core';

// Keyboard shortcuts of the desktop app (Settings > Keyboard shortcuts). Combos are written
// "Ctrl+Shift+K": modifiers in the order Ctrl, Alt, Shift, Super, then the key, taken from the
// physical key (e.code) for letters, digits and punctuation so Shift does not change it.
// Every place that reacts to a shortcut asks `matchesShortcut(event, id)`; the user's changes
// are set by the app with `setShortcutOverrides` (no storage in this package).

export type ShortcutGroup = 'App' | 'Tabs' | 'Note' | 'Formatting';

export interface ShortcutAction {
  id: string;
  label: string;
  group: ShortcutGroup;
  defaults: string[];
}

export const SHORTCUT_ACTIONS: ShortcutAction[] = [
  { id: 'newNote', label: 'New note', group: 'App', defaults: ['Ctrl+N'] },
  { id: 'gotoNote', label: 'Go to note', group: 'App', defaults: ['Ctrl+P'] },
  { id: 'settings', label: 'Settings', group: 'App', defaults: ['Ctrl+,'] },
  { id: 'focusMode', label: 'Focus mode (hide the side columns)', group: 'App', defaults: [] },
  { id: 'noteProperties', label: 'Show / hide note properties', group: 'App', defaults: [] },
  { id: 'syncNow', label: 'Sync now', group: 'App', defaults: [] },
  { id: 'zoomIn', label: 'Zoom the note in', group: 'App', defaults: ['Ctrl+=', 'Ctrl+Shift+=', 'Ctrl+NumpadAdd'] },
  { id: 'zoomOut', label: 'Zoom the note out', group: 'App', defaults: ['Ctrl+-', 'Ctrl+NumpadSubtract'] },
  { id: 'zoomReset', label: 'Reset the zoom', group: 'App', defaults: ['Ctrl+0', 'Ctrl+Numpad0'] },
  { id: 'nextTab', label: 'Next tab', group: 'Tabs', defaults: ['Ctrl+Tab', 'Ctrl+]', 'Ctrl+PageDown'] },
  { id: 'prevTab', label: 'Previous tab', group: 'Tabs', defaults: ['Ctrl+Shift+Tab', 'Ctrl+[', 'Ctrl+PageUp'] },
  { id: 'closeTab', label: 'Close tab', group: 'Tabs', defaults: ['Ctrl+W'] },
  { id: 'historyBack', label: 'Back (previous note)', group: 'Tabs', defaults: ['Alt+ArrowLeft'] },
  { id: 'historyForward', label: 'Forward', group: 'Tabs', defaults: ['Alt+ArrowRight'] },
  { id: 'find', label: 'Find and replace in the note', group: 'Note', defaults: ['Ctrl+F'] },
  { id: 'insertLink', label: 'Insert / edit link', group: 'Note', defaults: ['Ctrl+K'] },
  { id: 'undo', label: 'Undo', group: 'Note', defaults: ['Ctrl+Z'] },
  { id: 'redo', label: 'Redo', group: 'Note', defaults: ['Ctrl+Shift+Z', 'Ctrl+Y'] },
  { id: 'bold', label: 'Bold', group: 'Formatting', defaults: ['Ctrl+B'] },
  { id: 'italic', label: 'Italic', group: 'Formatting', defaults: ['Ctrl+I'] },
  { id: 'underline', label: 'Underline', group: 'Formatting', defaults: ['Ctrl+U'] },
  { id: 'strike', label: 'Strikethrough', group: 'Formatting', defaults: ['Ctrl+Shift+S'] },
  { id: 'code', label: 'Inline code', group: 'Formatting', defaults: ['Ctrl+E'] },
  { id: 'highlight', label: 'Highlight', group: 'Formatting', defaults: ['Ctrl+Shift+H'] },
  // The editor's own Ctrl+, for subscript loses to Settings, so it has no default here.
  { id: 'subscript', label: 'Subscript', group: 'Formatting', defaults: [] },
  { id: 'superscript', label: 'Superscript', group: 'Formatting', defaults: ['Ctrl+.'] },
  { id: 'paragraph', label: 'Normal text', group: 'Formatting', defaults: ['Ctrl+Alt+0'] },
  { id: 'heading1', label: 'Heading 1', group: 'Formatting', defaults: ['Ctrl+Alt+1'] },
  { id: 'heading2', label: 'Heading 2', group: 'Formatting', defaults: ['Ctrl+Alt+2'] },
  { id: 'heading3', label: 'Heading 3', group: 'Formatting', defaults: ['Ctrl+Alt+3'] },
  { id: 'bulletList', label: 'Bullet list', group: 'Formatting', defaults: ['Ctrl+Shift+8'] },
  { id: 'orderedList', label: 'Numbered list', group: 'Formatting', defaults: ['Ctrl+Shift+7'] },
  { id: 'taskList', label: 'Task list', group: 'Formatting', defaults: ['Ctrl+Shift+9'] },
  { id: 'blockquote', label: 'Quote', group: 'Formatting', defaults: ['Ctrl+Shift+B'] },
  { id: 'codeBlock', label: 'Code block', group: 'Formatting', defaults: ['Ctrl+Alt+C'] },
  { id: 'alignLeft', label: 'Align left', group: 'Formatting', defaults: ['Ctrl+Shift+L'] },
  { id: 'alignCenter', label: 'Align center', group: 'Formatting', defaults: ['Ctrl+Shift+E'] },
  { id: 'alignRight', label: 'Align right', group: 'Formatting', defaults: ['Ctrl+Shift+R'] },
  { id: 'alignJustify', label: 'Justify', group: 'Formatting', defaults: ['Ctrl+Shift+J'] },
];

// Shortcuts that cannot be changed (shown read-only in the settings).
export const FIXED_SHORTCUTS: { label: string; keys: string }[] = [
  { label: 'Open tab 1-8 / the last tab', keys: 'Ctrl+1 … Ctrl+8 / Ctrl+9' },
  { label: 'Zoom the note', keys: 'Ctrl + mouse wheel' },
  { label: 'Magnify the note', keys: 'Touchpad pinch' },
  { label: 'Slash menu / note link', keys: '/  and  [[' },
  { label: 'Indent / outdent', keys: 'Tab / Shift+Tab' },
  { label: 'Select all (code block first)', keys: 'Ctrl+A' },
  { label: 'Paste as plain text', keys: 'Ctrl+Shift+V' },
];

export type ShortcutOverrides = Record<string, string[]>;

let overrides: ShortcutOverrides = {};
export const setShortcutOverrides = (next: ShortcutOverrides) => { overrides = next; };
export const getShortcutOverrides = (): ShortcutOverrides => overrides;

const byId = new Map(SHORTCUT_ACTIONS.map((a) => [a.id, a]));

export const shortcutKeys = (id: string, map: ShortcutOverrides = overrides): string[] =>
  map[id] ?? byId.get(id)?.defaults ?? [];

const CODE_KEYS: Record<string, string> = {
  BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=', Comma: ',', Period: '.', Slash: '/',
  Backslash: '\\', Semicolon: ';', Quote: "'", Backquote: '`', Space: 'Space',
};

// The combo of a key press, or null for a lone modifier.
export const comboOf = (e: KeyboardEvent | React.KeyboardEvent): string | null => {
  if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'OS', 'Super'].includes(e.key)) return null;
  const code = e.code;
  const key = /^Key[A-Z]$/.test(code) ? code.slice(3)
    : /^Digit\d$/.test(code) ? code.slice(5)
    : CODE_KEYS[code] ?? (/^(Numpad|F\d)/.test(code) ? code : e.key.length === 1 ? e.key.toUpperCase() : e.key);
  const parts: string[] = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey) parts.push('Super');
  parts.push(key);
  return parts.join('+');
};

export const matchesShortcut = (e: KeyboardEvent | React.KeyboardEvent, id: string): boolean => {
  const combo = comboOf(e);
  return !!combo && shortcutKeys(id).includes(combo);
};

// The other action using `combo` (null = free).
export const shortcutConflict = (combo: string, exceptId: string, map: ShortcutOverrides = overrides): ShortcutAction | null =>
  SHORTCUT_ACTIONS.find((a) => a.id !== exceptId && shortcutKeys(a.id, map).includes(combo)) ?? null;

// Readable form ("Ctrl+ArrowLeft" -> "Ctrl+←").
export const formatCombo = (combo: string): string => combo
  .replace('ArrowLeft', '←').replace('ArrowRight', '→').replace('ArrowUp', '↑').replace('ArrowDown', '↓')
  .replace('NumpadAdd', 'Num +').replace('NumpadSubtract', 'Num −').replace(/Numpad(\d)/, 'Num $1');

// Editor commands. They run only for actions the user changed: unchanged ones are left to the
// editor's own keymaps (identical keys).
const EDITOR_COMMANDS: Record<string, (editor: Editor) => boolean> = {
  undo: (e) => e.commands.undo(),
  redo: (e) => e.commands.redo(),
  bold: (e) => e.chain().focus().toggleBold().run(),
  italic: (e) => e.chain().focus().toggleItalic().run(),
  underline: (e) => e.chain().focus().toggleUnderline().run(),
  strike: (e) => e.chain().focus().toggleStrike().run(),
  code: (e) => e.chain().focus().toggleCode().run(),
  highlight: (e) => e.chain().focus().toggleHighlight().run(),
  subscript: (e) => e.chain().focus().toggleSubscript().run(),
  superscript: (e) => e.chain().focus().toggleSuperscript().run(),
  paragraph: (e) => e.chain().focus().setParagraph().run(),
  heading1: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(),
  heading2: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
  heading3: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(),
  bulletList: (e) => e.chain().focus().toggleBulletList().run(),
  orderedList: (e) => e.chain().focus().toggleOrderedList().run(),
  taskList: (e) => e.chain().focus().toggleTaskList().run(),
  blockquote: (e) => e.chain().focus().toggleBlockquote().run(),
  codeBlock: (e) => e.chain().focus().toggleCodeBlock().run(),
  alignLeft: (e) => e.chain().focus().setTextAlign('left').run(),
  alignCenter: (e) => e.chain().focus().setTextAlign('center').run(),
  alignRight: (e) => e.chain().focus().setTextAlign('right').run(),
  alignJustify: (e) => e.chain().focus().setTextAlign('justify').run(),
};

// Key press inside the editor: runs a changed editor shortcut, and swallows an editor default
// key that now belongs to nothing (so the old key stops working). True = handled.
export const handleEditorShortcut = (editor: Editor, e: KeyboardEvent): boolean => {
  const combo = comboOf(e);
  if (!combo) return false;
  for (const id of Object.keys(EDITOR_COMMANDS)) {
    if (!overrides[id]) continue;
    if (overrides[id].includes(combo)) {
      EDITOR_COMMANDS[id](editor);
      return true;
    }
  }
  for (const id of Object.keys(EDITOR_COMMANDS)) {
    if (overrides[id] && byId.get(id)!.defaults.includes(combo) && !shortcutConflict(combo, '')) return true;
  }
  return false;
};
