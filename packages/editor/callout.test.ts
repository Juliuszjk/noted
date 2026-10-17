// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import { Callout } from './callout';

let editor: Editor;
afterEach(() => editor?.destroy());

const make = (content: string) => {
  editor = new Editor({ extensions: [StarterKit, TaskList, TaskItem.configure({ nested: true }), Callout], content });
  return editor;
};

describe('setCallout', () => {
  it('wraps a paragraph', () => {
    const e = make('<p>hello</p>');
    e.commands.setTextSelection(2);
    expect(e.commands.setCallout({ variant: 'tip' })).toBe(true);
    expect(e.getJSON().content?.[0].type).toBe('callout');
  });

  it('wraps the whole list when the cursor is in a list item', () => {
    const e = make('<p>before</p><ul><li><p>one</p><ul><li><p>two</p></li></ul></li></ul>');
    const pos = e.state.doc.textContent.indexOf('two');
    let target = 0;
    e.state.doc.descendants((node, p) => { if (node.isText && node.text === 'two') target = p + 1; });
    expect(pos).toBeGreaterThan(0);
    e.commands.setTextSelection(target);
    expect(e.commands.setCallout()).toBe(true);
    const json = e.getJSON();
    expect(json.content?.[1].type).toBe('callout');
    expect(json.content?.[1].content?.[0].type).toBe('bulletList');
  });

  it('wraps a task list', () => {
    const e = make('<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>todo</p></li></ul>');
    e.commands.setTextSelection(3);
    expect(e.commands.setCallout()).toBe(true);
    expect(e.getJSON().content?.[0].type).toBe('callout');
  });
});
