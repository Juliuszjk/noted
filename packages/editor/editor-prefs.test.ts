// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import * as Y from 'yjs';
import { createSchemaExtensions } from './extensions';
import { formatTitleTemplate, parseEditorPrefs, setLigatures } from './editor-prefs';

const typeIn = (editor: Editor, text: string) => {
  for (const ch of text) {
    const { from, to } = editor.state.selection;
    const handled = editor.view.someProp('handleTextInput', (f) => f(editor.view, from, to, ch, () => editor.state.tr.insertText(ch, from, to)));
    if (!handled) editor.view.dispatch(editor.state.tr.insertText(ch, from, to));
  }
};

describe('editor settings', () => {
  it('formats the default title and reads settings safely', () => {
    expect(formatTitleTemplate('Note $date$ $time$', new Date(2026, 9, 10, 9, 5))).toBe('Note 2026-10-10 09:05');
    expect(parseEditorPrefs('nonsense').fontSize).toBe(16);
    expect(parseEditorPrefs('{"fontSize":99,"defaultFont":"mono"}')).toMatchObject({ fontSize: 16, defaultFont: 'mono' });
  });

  it('turns typed arrows into symbols unless switched off', () => {
    const editor = new Editor({ extensions: createSchemaExtensions({ ydoc: new Y.Doc(), placeholder: '' }) });
    editor.commands.setContent('<p></p>');
    editor.commands.focus('end');
    typeIn(editor, 'a -> b != c <=> d');
    expect(editor.getText()).toBe('a → b ≠ c ⇔ d');
    setLigatures(editor, false);
    typeIn(editor, ' ->');
    expect(editor.getText()).toBe('a → b ≠ c ⇔ d ->');
  });
});
