import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';

// Words the keyboard changed while committing them ("samem" -> "samemu" on the space): the
// page remembers what was typed, so a tap on the word offers it back above the keyboard.
// The keyboard's own suggestion strip belongs to the keyboard; Android's spelling popup over
// the word is what Chromium shows instead (and cannot be styled).
// `swap`: the typed word put back, offering the keyboard's word again only until the caret leaves it.
export interface Correction { from: number; to: number; word: string; typed: string; swap?: boolean }

const KEEP = 30;

export function trackCorrections(editor: Editor, onChange: () => void) {
  let list: Correction[] = [];
  // The composition's text when the current key was pressed, and as it ends.
  let atKey = '';
  let current = '';
  const dom = editor.view.dom;
  dom.addEventListener('compositionstart', () => { atKey = ''; current = ''; });
  dom.addEventListener('keydown', () => { atKey = current; });
  dom.addEventListener('compositionupdate', (e) => { current = (e as CompositionEvent).data ?? ''; });
  dom.addEventListener('compositionend', (e) => {
    const word = (e as CompositionEvent).data ?? '';
    const typed = atKey;
    atKey = current = '';
    // Changed within the key that committed it: the keyboard's doing, not the user's typing.
    if (!typed || !word || typed === word || !/\p{L}/u.test(word)) return;
    // ProseMirror reads the composition a moment later; the space after it may be in by then.
    setTimeout(() => {
      const { doc, selection } = editor.state;
      for (const to of [selection.head, selection.head - 1]) {
        const from = to - word.length;
        if (from < 0 || doc.textBetween(from, to) !== word) continue;
        list = [...list.filter((c) => c.to <= from || c.from >= to), { from, to, word, typed }].slice(-KEEP);
        onChange();
        return;
      }
    }, 30);
  });
  // Positions follow every change; a word edited since is forgotten.
  editor.on('transaction', ({ transaction: tr }) => {
    if (!list.length) return;
    const doc = tr.doc;
    if (tr.docChanged) {
      list = list
        .map((c) => ({ ...c, from: tr.mapping.map(c.from, 1), to: tr.mapping.map(c.to, -1) }))
        .filter((c) => c.to - c.from === c.word.length && doc.textBetween(c.from, c.to) === c.word);
    }
    const { head } = tr.selection;
    list = list.filter((c) => !c.swap || (c.from <= head && head <= c.to));
  });

  // The correction under a collapsed caret (inside the word or at its ends).
  const at = (): Correction | null => {
    const { selection } = editor.state;
    if (!editor.isFocused || !selection.empty) return null;
    const head = selection.head;
    for (let i = list.length - 1; i >= 0; i--) if (list[i].from <= head && head <= list[i].to) return list[i];
    return null;
  };

  // Puts the typed word back; the keyboard's word is offered in turn while the caret stays.
  // Typed in through Chromium's editing like a keyboard would: a change made by ProseMirror
  // itself dropped the keyboard's underlines from every corrected word.
  const undo = (c: Correction) => {
    list = list.filter((x) => x !== c);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, c.from, c.to)));
    if (!document.execCommand('insertText', false, c.typed)) {
      editor.view.dispatch(editor.state.tr.insertText(c.typed, c.from, c.to));
    }
    setTimeout(() => {
      const to = c.from + c.typed.length;
      if (to <= editor.state.doc.content.size && editor.state.doc.textBetween(c.from, to) === c.typed) {
        list = [...list, { from: c.from, to, word: c.typed, typed: c.word, swap: true }].slice(-KEEP);
      }
      onChange();
    }, 30);
  };

  return { at, undo };
}
