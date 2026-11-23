// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import * as Y from 'yjs';
import { createSchemaExtensions } from './extensions';
import { getSearchState, findQueryFor } from './search';

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

  it('ignores accents unless matching case', () => {
    const editor = make('<p>Źródło i zrodlo, łódź</p>');
    editor.commands.setSearch('zrodlo');
    const s = getSearchState(editor);
    expect(s.matches.length).toBe(2);
    expect(editor.state.doc.textBetween(s.matches[0].from, s.matches[0].to)).toBe('Źródło');
    editor.commands.setSearch('lodz');
    expect(getSearchState(editor).matches.length).toBe(1);
    editor.commands.setSearch('zrodlo', true);
    expect(getSearchState(editor).matches.length).toBe(1);
  });

  it('opens folded headings and outline items that hide the match', () => {
    const editor = make([
      '<h2 data-foldable="true" data-collapsed="true">Outer</h2>',
      '<h3 data-foldable="true" data-collapsed="true">Inner</h3>',
      '<ul data-outline="true"><li data-collapsed="true"><p>item</p><ul><li><p>deep needle</p></li></ul></li></ul>',
      '<h2 data-foldable="true" data-collapsed="true">Other</h2><p>text</p>',
    ].join(''));
    editor.commands.setSearch('needle');
    // Typing leaves the folds; the step / reveal opens them.
    expect(getSearchState(editor).index).toBe(0);
    editor.commands.revealMatch();
    const folds: Record<string, boolean> = {};
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'heading') folds[node.textContent] = !!node.attrs.collapsed;
      if (node.type.name === 'listItem' && node.firstChild?.textContent === 'item') folds.item = !!node.attrs.collapsed;
    });
    expect(folds).toEqual({ Outer: false, Inner: false, item: false, Other: true });
  });

  it('picks a word the note has for a list search', () => {
    const editor = make('<p>alpha beta</p>');
    expect(findQueryFor(editor.state.doc, 'alpha beta')).toBe('alpha beta');
    expect(findQueryFor(editor.state.doc, 'beta gamma')).toBe('beta');
    expect(findQueryFor(editor.state.doc, 'gamma')).toBeNull();
  });

  it('keeps trailing accents of decomposed text in the match', () => {
    const editor = make('<p>Zro\u0301dlo\u0301 x</p>');
    editor.commands.setSearch('zrodlo');
    const [m] = getSearchState(editor).matches;
    expect(editor.state.doc.textBetween(m.from, m.to)).toBe('Zro\u0301dlo\u0301');
  });
});
