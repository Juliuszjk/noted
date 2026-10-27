// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import { TextIndent, IndentBackspace } from './indent';
import { CodeBlockIndent } from './code-extensions';
import * as Y from 'yjs';
import { createSchemaExtensions } from './extensions';

let editor: Editor;
afterEach(() => editor?.destroy());

const make = (content: string) => {
  editor = new Editor({
    extensions: [StarterKit, TaskList, TaskItem.configure({ nested: true }), CodeBlockIndent, TextIndent],
    content,
  });
  return editor;
};

// StarterKit appends an empty trailing paragraph; it is not part of what is tested.
const html = () => editor.getHTML().replace(/<p><\/p>$/, '');

describe('indent / outdent', () => {
  it('moves the whole paragraph right and back', () => {
    const e = make('<p>hello</p>');
    e.commands.setTextSelection(3);
    e.commands.indentContent();
    e.commands.indentContent();
    expect(html()).toBe('<p data-indent="2" style="margin-left: 4em;">hello</p>');
    e.commands.outdentContent();
    expect(html()).toBe('<p data-indent="1" style="margin-left: 2em;">hello</p>');
    e.commands.outdentContent();
    expect(html()).toBe('<p>hello</p>');
    expect(e.state.doc.textContent).toBe('hello');
  });

  it('indents every selected paragraph and heading', () => {
    const e = make('<h2>one</h2><p>two</p>');
    e.commands.setTextSelection({ from: 2, to: 8 });
    e.commands.indentContent();
    expect(html()).toBe('<h2 data-indent="1" style="margin-left: 2em;">one</h2><p data-indent="1" style="margin-left: 2em;">two</p>');
    e.commands.outdentContent();
    expect(html()).toBe('<h2>one</h2><p>two</p>');
  });

  it('Tab inside a line types a tab, Shift+Tab removes it', () => {
    const e = make('<p>ab</p>');
    e.commands.setTextSelection(2);
    e.commands.keyboardShortcut('Tab');
    expect(e.state.doc.textContent).toBe('a\tb');
    e.commands.keyboardShortcut('Shift-Tab');
    expect(html()).toBe('<p>ab</p>');
  });

  it('Shift+Tab still removes an old tab at the line start', () => {
    const e = make('<p>\tab</p>');
    e.commands.setTextSelection(3);
    e.commands.outdentContent();
    expect(e.state.doc.textContent).toBe('ab');
  });

  it('Backspace at the start of an indented paragraph takes a level off', () => {
    editor = new Editor({ extensions: [StarterKit, TextIndent, IndentBackspace], content: '<p>one</p><p data-indent="1">two</p>' });
    editor.commands.setTextSelection(6);
    editor.commands.keyboardShortcut('Backspace');
    expect(html()).toBe('<p>one</p><p>two</p>');
  });

  it('nests and lifts list items instead of typing a tab', () => {
    const e = make('<ul><li><p>a</p></li><li><p>b</p></li></ul>');
    const posInB = e.state.doc.content.size - 3;
    e.commands.setTextSelection(posInB);
    e.commands.indentContent();
    expect(html()).toBe('<ul><li><p>a</p><ul><li><p>b</p></li></ul></li></ul>');
    e.commands.outdentContent();
    expect(html()).toBe('<ul><li><p>a</p></li><li><p>b</p></li></ul>');
    // The first item cannot be nested: the whole list moves (see below), no tab is typed.
    e.commands.setTextSelection(3);
    e.commands.indentContent();
    expect(e.state.doc.textContent).toBe('ab');
  });

  it('uses two spaces in code blocks', () => {
    const e = make('<pre><code>x</code></pre>');
    e.commands.setTextSelection(1);
    e.commands.indentContent();
    expect(e.state.doc.textContent).toBe('  x');
    e.commands.outdentContent();
    expect(e.state.doc.textContent).toBe('x');
  });
});

describe('indented lists', () => {
  const list = (attrs = '') => `<ul${attrs}><li><p>one</p></li><li><p>two</p></li></ul>`;
  const indented = (level: number) => ` data-indent="${level}" style="margin-left: ${level * 2}em;"`;

  it('Tab in the first item moves the whole list, Shift+Tab moves it back first', () => {
    const e = make(list());
    e.commands.setTextSelection(3);
    e.commands.indentContent();
    expect(html()).toBe(list(indented(1)));
    e.commands.outdentContent();
    expect(html()).toBe(list());
    e.commands.outdentContent();
    expect(html()).toBe('<p>one</p><ul><li><p>two</p></li></ul>');
  });

  it('nests a later item instead of moving the list', () => {
    const e = make(list(indented(1)));
    e.commands.setTextSelection(10);
    e.commands.indentContent();
    expect(html()).toBe(`<ul${indented(1)}><li><p>one</p><ul><li><p>two</p></li></ul></li></ul>`);
  });

  // The whole schema: list conversion and Enter come from other extensions.
  const full = (content: string) => {
    editor = new Editor({ extensions: createSchemaExtensions({ ydoc: new Y.Doc(), placeholder: '' }).filter((x) => x.name !== 'collaboration'), content });
    return editor;
  };

  it('a list started in an indented paragraph takes over its indent', () => {
    const e = full('<p data-indent="2">one</p>');
    e.commands.setTextSelection(2);
    e.commands.toggleBulletList();
    expect(html()).toBe(`<ul${indented(2)}><li><p>one</p></li></ul>`);
    e.commands.setTextSelection(1);
    e.commands.insertContent('x');
    e.commands.toggleTaskList();
    expect(html()).toContain('data-type="taskList"');
    expect(html()).toContain(indented(2));
  });

  it('Enter in the empty last item leaves the list with the indent kept', () => {
    const e = full(`<ul${indented(1)}><li><p>one</p></li><li><p></p></li></ul><p>end</p>`);
    e.commands.setTextSelection(10);
    e.commands.keyboardShortcut('Enter');
    expect(e.getHTML()).toBe(`<ul${indented(1)}><li><p>one</p></li></ul><p${indented(1)}></p><p>end</p>`);
  });
});
