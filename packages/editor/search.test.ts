// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import * as Y from 'yjs';
import { createSchemaExtensions } from './extensions';
import { getSearchState } from './search';

const make = (html: string) => {
  const editor = new Editor({ extensions: createSchemaExtensions({ ydoc: new Y.Doc(), placeholder: '' }) });
  editor.commands.setContent(html);
  return editor;
};

describe('find and replace', () => {
  it('finds matches case-insensitively and steps through them', () => {
    const editor = make('<p>Cat cat</p><p>a <strong>c</strong>at</p>');
    editor.commands.setSearch('cat');
    const s = getSearchState(editor);
    expect(s.matches.length).toBe(3);
    editor.commands.searchStep(1);
    expect(getSearchState(editor).index).toBe((s.index + 1) % 3);
    editor.commands.setSearch('cat', true);
    expect(getSearchState(editor).matches.length).toBe(2);
  });

  it('replaces one match and all matches', () => {
    const editor = make('<p>one two one</p><p>one</p>');
    editor.commands.setSearch('one');
    editor.commands.replaceMatch('1');
    expect(editor.getText()).toContain('1 two one');
    expect(getSearchState(editor).matches.length).toBe(2);
    editor.commands.replaceAllMatches('uno');
    expect(editor.getText({ blockSeparator: '|' })).toBe('1 two uno|uno');
    expect(getSearchState(editor).matches.length).toBe(0);
    editor.commands.clearSearch();
    expect(getSearchState(editor).query).toBe('');
  });
});
