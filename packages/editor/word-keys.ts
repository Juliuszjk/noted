import { Extension } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

type CharClass = 'space' | 'word' | 'punct';
const classOf = (ch: string): CharClass => (/\s/.test(ch) ? 'space' : /[\p{L}\p{N}_]/u.test(ch) ? 'word' : 'punct');

// Ctrl+arrows jump like code editors: a run of letters/digits and a run of punctuation
// (`(`, `,`, `="`) are separate stops, where the browser glues punctuation to the next word.
// Within one text block; at its edge the browser's own move crosses to the next block.
const moveByWord = (view: EditorView, dir: -1 | 1, extend: boolean): boolean => {
  const { state } = view;
  if (!(state.selection instanceof TextSelection)) return false;
  const $head = state.selection.$head;
  if (!$head.parent.isTextblock) return false;
  // Every inline atom counts as one character, so text offsets match document positions.
  const text = $head.parent.textBetween(0, $head.parent.content.size, undefined, '￼');
  let i = $head.parentOffset;
  const at = (k: number) => text[dir > 0 ? k : k - 1];
  const inside = (k: number) => (dir > 0 ? k < text.length : k > 0);
  if (!inside(i)) return false;
  while (inside(i) && classOf(at(i)) === 'space') i += dir;
  if (inside(i)) {
    const cls = classOf(at(i));
    while (inside(i) && classOf(at(i)) === cls) i += dir;
  }
  const head = $head.start() + i;
  const anchor = extend ? state.selection.anchor : head;
  view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, anchor, head)).scrollIntoView());
  return true;
};

export const WordKeys = Extension.create({
  name: 'wordKeys',
  addKeyboardShortcuts() {
    return {
      'Ctrl-ArrowLeft': () => moveByWord(this.editor.view, -1, false),
      'Ctrl-ArrowRight': () => moveByWord(this.editor.view, 1, false),
      'Ctrl-Shift-ArrowLeft': () => moveByWord(this.editor.view, -1, true),
      'Ctrl-Shift-ArrowRight': () => moveByWord(this.editor.view, 1, true),
    };
  },
});
