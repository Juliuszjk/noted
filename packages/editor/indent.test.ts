// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import { TextIndent } from './indent';
import { CodeBlockIndent } from './code-extensions';

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
  it('inserts and removes a tab in plain text', () => {
    const e = make('<p>hello</p>');
    e.commands.setTextSelection(1);
    e.commands.indentContent();
    expect(e.getJSON().content?.[0].content?.[0].text).toBe('\thello');
    e.commands.outdentContent();
    expect(e.getJSON().content?.[0].content?.[0].text).toBe('hello');
  });

  it('indents every selected paragraph', () => {
    const e = make('<p>one</p><p>two</p>');
    e.commands.setTextSelection({ from: 2, to: 8 });
    e.commands.indentContent();
    expect(e.getText({ blockSeparator: '|' })).toBe('\tone|\ttwo');
    e.commands.outdentContent();
    expect(e.getText({ blockSeparator: '|' })).toBe('one|two');
  });

  it('nests and lifts list items instead of typing a tab', () => {
    const e = make('<ul><li><p>a</p></li><li><p>b</p></li></ul>');
    const posInB = e.state.doc.content.size - 3;
    e.commands.setTextSelection(posInB);
    e.commands.indentContent();
    expect(html()).toBe('<ul><li><p>a</p><ul><li><p>b</p></li></ul></li></ul>');
    e.commands.outdentContent();
    expect(html()).toBe('<ul><li><p>a</p></li><li><p>b</p></li></ul>');
    // The first item cannot be nested: nothing happens, no tab is typed.
    e.commands.setTextSelection(3);
    e.commands.indentContent();
    expect(html()).toBe('<ul><li><p>a</p></li><li><p>b</p></li></ul>');
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
