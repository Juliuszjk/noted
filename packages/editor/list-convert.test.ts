// @vitest-environment happy-dom
import { it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import * as Y from 'yjs';
import { createSchemaExtensions } from './extensions';

const make = (html: string) => {
  const editor = new Editor({ extensions: createSchemaExtensions({ ydoc: new Y.Doc(), placeholder: '' }).filter((e) => e.name !== 'collaboration') });
  editor.commands.setContent(html);
  return editor;
};
const shape = (editor: Editor) => JSON.stringify(editor.getJSON().content!.filter((n) => n.content?.length).map((n) => [n.type, (n.content ?? []).map((i) => [i.type, i.content?.map((c) => c.type)])]));

it('turns a whole task list into a bullet list and back', () => {
  const editor = make('<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>a</p></li><li data-type="taskItem" data-checked="false"><p>b</p><ul data-type="taskList"><li data-type="taskItem"><p>c</p></li></ul></li></ul>');
  editor.commands.selectAll();
  editor.commands.toggleBulletList();
  expect(shape(editor)).toBe(JSON.stringify([['bulletList', [['listItem', ['paragraph']], ['listItem', ['paragraph', 'bulletList']]]]]));
  expect(editor.getText()).toContain('c');
  editor.commands.selectAll();
  editor.commands.toggleTaskList();
  expect(editor.getJSON().content![0].type).toBe('taskList');
  editor.destroy();
});

it('turns the list with the cursor into a numbered list; the same kind still unwraps', () => {
  const editor = make('<ul><li><p>one</p></li><li><p>two</p></li></ul>');
  editor.commands.setTextSelection(3);
  editor.commands.toggleOrderedList();
  expect(editor.getJSON().content![0].type).toBe('orderedList');
  expect(editor.getJSON().content![0].content!.length).toBe(2);
  editor.commands.toggleOrderedList();
  expect(editor.getJSON().content![0].type).toBe('paragraph');
  editor.destroy();
});

it('a paragraph still becomes a list', () => {
  const editor = make('<p>x</p>');
  editor.commands.setTextSelection(1);
  editor.commands.toggleTaskList();
  expect(editor.getJSON().content![0].type).toBe('taskList');
  editor.destroy();
});

it('two lists of the same kind next to each other become one', () => {
  const editor = make('<p>x</p>');
  editor.commands.setContent('<ul data-type="taskList"><li data-type="taskItem"><p>a</p></li></ul><p>gap</p><ul data-type="taskList"><li data-type="taskItem"><p>b</p></li></ul>');
  // Deleting the paragraph between them.
  let from = 0;
  editor.state.doc.forEach((node, offset) => { if (node.type.name === 'paragraph' && node.textContent === 'gap') from = offset; });
  editor.commands.deleteRange({ from, to: from + 5 });
  const lists = editor.getJSON().content!.filter((n) => n.type === 'taskList');
  expect(lists.length).toBe(1);
  expect(lists[0].content!.length).toBe(2);
  editor.destroy();
});
