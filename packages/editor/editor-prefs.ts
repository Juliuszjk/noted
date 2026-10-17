import { Extension, InputRule } from '@tiptap/core';
import type { Editor } from '@tiptap/core';

// Settings > Editor (kept per device): default title, default font and size, symbol
// ligatures, spell checking.

export * from './editor-prefs-lite';

// ---- symbol ligatures ----
const LIGATURES: [RegExp, string][] = [
  [/<->$/, '↔'], [/←>$/, '↔'],
  [/<=>$/, '⇔'], [/≤>$/, '⇔'],
  [/->$/, '→'], [/<-$/, '←'],
  [/=>$/, '⇒'],
  [/!=$/, '≠'], [/<=$/, '≤'], [/>=$/, '≥'],
  [/\+-$/, '±'], [/\.\.\.$/, '…'],
];

export const SymbolLigatures = Extension.create<Record<string, never>, { enabled: boolean }>({
  name: 'symbolLigatures',
  addStorage() {
    return { enabled: true };
  },
  addInputRules() {
    const storage = this.storage;
    return LIGATURES.map(([find, replace]) => new InputRule({
      find,
      handler: ({ state, range }) => {
        if (!storage.enabled) return null;
        const $from = state.doc.resolve(range.from);
        // Never inside code.
        if ($from.parent.type.spec.code || state.schema.marks.code?.isInSet($from.marks())) return null;
        state.tr.insertText(replace, range.from, range.to);
      },
    }));
  },
});

export const setLigatures = (editor: Editor, on: boolean) => {
  const storage = (editor.storage as unknown as Record<string, { enabled: boolean } | undefined>).symbolLigatures;
  if (storage) storage.enabled = on;
};
