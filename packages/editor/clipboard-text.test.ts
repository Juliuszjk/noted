// @vitest-environment happy-dom
import { it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import * as Y from 'yjs';
import { createSchemaExtensions } from './extensions';
import { sliceText } from './clipboard-text';

const make = (html: string) => {
  const editor = new Editor({ extensions: createSchemaExtensions({ ydoc: new Y.Doc(), placeholder: '' }).filter((e) => e.name !== 'collaboration') });
  editor.commands.setContent(html);
  return editor;
};
const copied = (editor: Editor, from: number, to: number) => {
  const $from = editor.state.doc.resolve(from);
  return sliceText(editor.state.doc.slice(from, to), {}, $from.node($from.sharedDepth(to)));
};

it('copies a list one item per line', () => {
  const editor = make('<p>Shopping</p><ul><li><p>milk</p></li><li><p>bread</p><ul><li><p>white</p></li></ul></li></ul><ol><li><p>one</p></li><li><p>two</p></li></ol><p></p><p>end</p>');
  expect(copied(editor, 0, editor.state.doc.content.size)).toBe('Shopping\n• milk\n• bread\n  • white\n1. one\n2. two\n\nend');
  editor.destroy();
});

it('copies a word inside a list item without the marker', () => {
  const editor = make('<ul><li><p>milk and bread</p></li></ul>');
  editor.commands.setTextSelection({ from: 3, to: 7 });
  const { from, to } = editor.state.selection;
  expect(editor.state.selection).toBeInstanceOf(TextSelection);
  expect(copied(editor, from, to)).toBe('milk');
  editor.destroy();
});

it('copies two items of a task list with their boxes', () => {
  const editor = make('<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>done</p></li><li data-type="taskItem" data-checked="false"><p>todo</p></li></ul>');
  expect(copied(editor, 3, editor.state.doc.content.size - 3)).toBe('☑ done\n☐ todo');
  editor.destroy();
});
