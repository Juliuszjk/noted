// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import { AllSelection } from '@tiptap/pm/state';
import * as Y from 'yjs';
import { createSchemaExtensions } from './extensions';
import { sliceText } from './clipboard-text';
import { SlashCommands } from './slash';
import { suggestionOpen } from './heading-fold';
import { slashItems } from './slash-items';
import { insertTableAt } from './table-actions';

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

  it('Enter at the end of a folded heading keeps it folded and starts a heading after the section', () => {
    const e = make(doc.replace('data-foldable="true"', 'data-foldable="true" data-collapsed="true"'));
    e.commands.setTextSelection(2);
    expect(press('Enter')).toBe(true);
    const blocks = e.getJSON().content!.map((n) => `${n.type}${n.attrs?.level ?? ''}:${n.content?.[0]?.text ?? ''}`);
    expect(blocks.slice(0, 7)).toEqual(['heading2:A', 'paragraph:a1', 'heading3:A.1', 'paragraph:a2', 'heading2:', 'heading2:B', 'paragraph:b']);
    expect(e.state.doc.firstChild!.attrs.collapsed).toBe(true);
    expect(hidden()).toEqual(['a1', 'A.1', 'a2']);
    const { $from } = e.state.selection;
    expect($from.parent.type.name).toBe('heading');
    expect($from.parent.attrs.level).toBe(2);
    expect($from.parent.content.size).toBe(0);
  });

  it('Enter at the end of a folded heading that ends the note adds the heading at the end', () => {
    const e = make('<p>x</p><h2 data-foldable="true" data-collapsed="true">A</h2><p>a1</p>');
    e.commands.setTextSelection(5);
    press('Enter');
    e.commands.insertContent('New');
    expect(e.getHTML()).toContain('<h2 data-foldable="true" data-collapsed="true">A</h2><p>a1</p><h2>New</h2>');
    expect(hidden()).toEqual(['a1']);
  });

  it('a block inserted from a folded heading goes to the end of its section, which opens', () => {
    const e = make(doc.replace('data-foldable="true"', 'data-foldable="true" data-collapsed="true"'));
    e.commands.insertContentAt(2, ' /x');
    const callout = slashItems.find((i) => i.title === 'Callout')!.submenu!.items[0];
    callout.command!({ editor: e, range: { from: 3, to: 5 } });
    const blocks = e.getJSON().content!.map((n) => n.type);
    expect(blocks.slice(0, 6)).toEqual(['heading', 'paragraph', 'heading', 'paragraph', 'callout', 'heading']);
    expect(e.state.doc.firstChild!.textContent).toBe('A');
    expect(e.state.doc.firstChild!.attrs.collapsed).toBe(false);
    expect(hidden()).toEqual([]);
  });

  it('a table inserted from a folded heading goes to the end of its section', () => {
    const e = make(doc.replace('data-foldable="true"', 'data-foldable="true" data-collapsed="true"'));
    e.commands.setTextSelection(2);
    insertTableAt(e, { from: 2, to: 2 }, 2, 2);
    expect(e.getJSON().content!.map((n) => n.type).slice(0, 6)).toEqual(['heading', 'paragraph', 'heading', 'paragraph', 'table', 'heading']);
    expect(e.state.doc.firstChild!.attrs.collapsed).toBe(false);
  });

  it('an empty line ending the folded section takes the new block', () => {
    const e = make(doc.replace('data-foldable="true"', 'data-foldable="true" data-collapsed="true"').replace('<p>a2</p>', '<p>a2</p><p></p>'));
    e.commands.setTextSelection(2);
    insertTableAt(e, { from: 2, to: 2 }, 2, 2);
    expect(e.getJSON().content!.map((n) => n.type).slice(0, 6)).toEqual(['heading', 'paragraph', 'heading', 'paragraph', 'table', 'heading']);
  });

  it('a folded sub-heading ending the section opens too', () => {
    const e = make('<h1 data-foldable="true" data-collapsed="true">A</h1><h2 data-foldable="true" data-collapsed="true">B</h2><p>b1</p><h1>C</h1>');
    e.commands.setTextSelection(2);
    insertTableAt(e, { from: 2, to: 2 }, 2, 2);
    expect(e.getJSON().content!.map((n) => n.type).slice(0, 5)).toEqual(['heading', 'heading', 'paragraph', 'table', 'heading']);
    expect(hidden()).toEqual([]);
  });

  it('the phone "+" sheet (no slash typed) keeps spaces at the end of the heading', () => {
    const e = make(doc.replace('data-foldable="true"', 'data-foldable="true" data-collapsed="true"'));
    e.commands.insertContentAt(2, ' ');
    expect(e.state.doc.firstChild!.textContent).toBe('A ');
    e.commands.setTextSelection(3);
    insertTableAt(e, { from: 3, to: 3 }, 2, 2);
    expect(e.state.doc.firstChild!.textContent).toBe('A ');
  });

  it('a heading row still changes the folded heading itself', () => {
    const e = make(doc.replace('data-foldable="true"', 'data-foldable="true" data-collapsed="true"'));
    e.commands.setTextSelection(2);
    const h3 = slashItems.find((i) => i.title === 'Heading')!.submenu!.items[2];
    h3.command!({ editor: e, range: { from: 2, to: 2 } });
    expect(e.state.doc.firstChild!.attrs.level).toBe(3);
  });

  it('a drawing in a folded section is hidden too', () => {
    const e = make(doc.replace('data-foldable="true"', 'data-foldable="true" data-collapsed="true"'));
    e.commands.insertContentAt(e.state.doc.child(0).nodeSize, { type: 'drawing' });
    expect(e.state.doc.child(1).type.name).toBe('drawing');
    expect(e.view.dom.querySelector('[data-type="drawing"]')!.classList.contains('heading-folded')).toBe(true);
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

describe('folded outline items', () => {
  const doc = '<ul data-outline="true"><li data-collapsed="true"><p>Parent</p><ul><li><p>Child</p></li></ul></li><li><p>Next</p></li></ul>';

  it('Enter at the end of a folded item starts a new item under its whole branch', () => {
    const e = make(doc);
    e.commands.setTextSelection(1 + 1 + 1 + 'Parent'.length);
    expect(press('Enter')).toBe(true);
    e.commands.insertContent('New');
    expect(e.getHTML()).toContain('<ul data-outline="true"><li data-collapsed="true"><p>Parent</p><ul><li><p>Child</p></li></ul></li><li><p>New</p></li><li><p>Next</p></li></ul>');
  });

  it('Enter on an emptied folded item is left to the list (no extra empty item)', () => {
    const e = make(doc.replace('<p>Parent</p>', '<p></p>'));
    e.commands.setTextSelection(3);
    press('Enter');
    expect(e.getHTML()).not.toContain('<li><p></p></li><li><p>Next</p></li>');
  });

  it('Enter with the slash menu open is left to the menu', () => {
    editor = new Editor({ extensions: [...createSchemaExtensions({ ydoc: new Y.Doc(), placeholder: '' }).filter((x) => x.name !== 'collaboration'), SlashCommands], content: doc });
    editor.commands.setTextSelection(1 + 1 + 1 + 'Parent'.length);
    editor.commands.insertContent(' /');
    expect(suggestionOpen(editor.state)).toBe(true);
    press('Enter');
    // The fold's own Enter would have put an empty item after the branch (the test editor has
    // no menu renderer, so the list's default Enter runs instead).
    expect(editor.getHTML()).not.toContain('</ul></li><li><p></p></li><li><p>Next');
  });
});

describe('ctrl+arrows by word', () => {
  const ctrl = (key: string, shiftKey = false) => {
    const event = new KeyboardEvent('keydown', { key, ctrlKey: true, shiftKey, bubbles: true, cancelable: true });
    return editor.view.someProp('handleKeyDown', (f) => f(editor.view, event));
  };
  const selected = () => editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to);

  it('stops at punctuation as its own word', () => {
    const e = make('<p>w TikToku (też cudzą, spod filmu)</p>');
    const start = e.state.doc.textContent.indexOf('TikToku') + 1;
    e.commands.setTextSelection({ from: start, to: start + 'TikToku'.length });
    const steps: string[] = [];
    for (let i = 0; i < 5; i++) { ctrl('ArrowRight', true); steps.push(selected()); }
    expect(steps).toEqual(['TikToku (', 'TikToku (też', 'TikToku (też cudzą', 'TikToku (też cudzą,', 'TikToku (też cudzą, spod']);
    ctrl('ArrowLeft', true);
    expect(selected()).toBe('TikToku (też cudzą, ');
  });

  it('moves the caret without shift and splits code tokens', () => {
    const e = make('<pre><code>Grid.Row="0"</code></pre>');
    e.commands.setTextSelection(1);
    const stops: number[] = [];
    for (let i = 0; i < 4; i++) { ctrl('ArrowRight'); stops.push(e.state.selection.head - 1); }
    expect(e.state.selection.empty).toBe(true);
    expect(stops).toEqual([4, 5, 8, 10]);
  });
});
