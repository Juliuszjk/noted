// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import { AllSelection } from '@tiptap/pm/state';
import * as Y from 'yjs';
import { createSchemaExtensions } from './extensions';
import { sliceText } from './clipboard-text';

let editor: Editor;
afterEach(() => editor?.destroy());

const make = (content: string) => {
  editor = new Editor({ extensions: createSchemaExtensions({ ydoc: new Y.Doc(), placeholder: '' }).filter((e) => e.name !== 'collaboration'), content });
  return editor;
};

// Tiptap's keyboardShortcut command keeps only the document steps, not selection changes.
const press = (key: string) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  return editor.view.someProp('handleKeyDown', (f) => f(editor.view, event));
};

describe('select all and the arrows', () => {
  it('goes to the start or the end of the note', () => {
    const e = make('<p>one</p><p>two</p>');
    e.view.dispatch(e.state.tr.setSelection(new AllSelection(e.state.doc)));
    expect(press('ArrowLeft')).toBe(true);
    expect(e.state.selection.empty).toBe(true);
    expect(e.state.selection.from).toBe(1);
    e.view.dispatch(e.state.tr.setSelection(new AllSelection(e.state.doc)));
    expect(press('ArrowDown')).toBe(true);
    expect(e.state.selection.empty).toBe(true);
    expect(e.state.selection.from).toBe(e.state.doc.content.size - 1);
  });
});

describe('copied formulas', () => {
  it('keep their dollars in the plain text', () => {
    const e = make('<p>Let <span data-type="inline-math" data-latex="x^2"></span> be</p>');
    e.commands.setTextSelection({ from: 1, to: e.state.doc.content.size - 1 });
    const { $from, $to } = e.state.selection;
    expect(sliceText(e.state.selection.content(), {}, $from.node($from.sharedDepth($to.pos)))).toBe('Let $x^2$ be');
  });
});

describe('collapsible headings', () => {
  const doc = '<h2 data-foldable="true">A</h2><p>a1</p><h3>A.1</h3><p>a2</p><h2>B</h2><p>b</p>';
  const hidden = () => [...editor.view.dom.querySelectorAll('.heading-folded')].map((el) => el.textContent);

  it('folds the blocks up to the next heading of the same level', () => {
    const e = make(doc);
    expect(e.view.dom.querySelectorAll('.heading-toggle')).toHaveLength(1);
    expect(hidden()).toEqual([]);
    (e.view.dom.querySelector('.heading-toggle') as HTMLElement).dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(e.state.doc.firstChild!.attrs.collapsed).toBe(true);
    expect(hidden()).toEqual(['a1', 'A.1', 'a2']);
    expect(e.getHTML()).toContain('<h2 data-foldable="true" data-collapsed="true">');
  });

  it('Enter at the end of a folded heading opens it and starts a line under it', () => {
    const e = make(doc.replace('data-foldable="true"', 'data-foldable="true" data-collapsed="true"'));
    e.commands.setTextSelection(2);
    press('Enter');
    const types = e.getJSON().content!.map((n) => n.content?.[0]?.text ?? '');
    expect(types.slice(0, 6)).toEqual(['A', '', 'a1', 'A.1', 'a2', 'B']);
    expect(hidden()).toEqual([]);
    expect(e.state.selection.$from.parent.type.name).toBe('paragraph');
  });

  it('the slash command makes a collapsible heading, a toggle makes it plain again', () => {
    const e = make('<h1>T</h1>');
    e.commands.setTextSelection(2);
    e.commands.toggleHeadingFoldable();
    expect(e.state.doc.firstChild!.attrs.foldable).toBe(true);
    e.commands.toggleHeadingFoldable();
    expect(e.state.doc.firstChild!.attrs.foldable).toBe(false);
  });
});
