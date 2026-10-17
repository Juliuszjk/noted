// @vitest-environment happy-dom
import { it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';
import * as Y from 'yjs';
import { createSchemaExtensions } from './extensions';
import { moveTableRowBy, moveTableColumnBy, selectTablePart, selectCellRange, equalColumnWidths, currentCellPos } from './table-tools';

const make = () => {
  const editor = new Editor({ extensions: createSchemaExtensions({ ydoc: new Y.Doc(), placeholder: '' }).filter((e) => e.name !== 'collaboration') });
  editor.commands.setContent('<table><tr><td><p>a</p></td><td colwidth="120"><p>b</p></td></tr><tr><td><p>c</p></td><td><p>d</p></td></tr></table>');
  return editor;
};
const cursorIn = (editor: Editor, text: string) => {
  let at = -1;
  editor.state.doc.descendants((node, pos) => { if (node.isText && node.text === text) at = pos; });
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, at)));
};
const rows = (editor: Editor) => editor.getJSON().content![0].content!.map((r) => r.content!.map((c) => c.content![0].content![0].text).join(''));

it('moves rows and columns with the cursor', () => {
  const editor = make();
  cursorIn(editor, 'a');
  expect(moveTableRowBy(editor, -1)).toBe('edge');
  expect(moveTableRowBy(editor, 1)).toBe('moved');
  expect(rows(editor)).toEqual(['cd', 'ab']);
  expect(editor.state.selection.$from.parent.textContent).toBe('a');
  expect(moveTableColumnBy(editor, 1)).toBe('moved');
  expect(rows(editor)).toEqual(['dc', 'ba']);
  editor.destroy();
});

it('selects rows, columns, the table and cell ranges', () => {
  const editor = make();
  cursorIn(editor, 'a');
  const anchor = currentCellPos(editor.state)!;
  selectTablePart(editor, 'row');
  expect(editor.state.selection).toBeInstanceOf(CellSelection);
  expect((editor.state.selection as CellSelection).ranges.length).toBe(2);
  selectTablePart(editor, 'table');
  expect((editor.state.selection as CellSelection).ranges.length).toBe(4);
  cursorIn(editor, 'd');
  expect(selectCellRange(editor, anchor, editor.state.selection.from)).toBe(true);
  expect((editor.state.selection as CellSelection).ranges.length).toBe(4);
  expect(editor.can().mergeCells()).toBe(true);
  editor.destroy();
});

it('equal widths drop fixed column widths; row height survives a round trip', () => {
  const editor = make();
  cursorIn(editor, 'a');
  equalColumnWidths(editor);
  expect(JSON.stringify(editor.getJSON())).not.toContain('120');
  editor.commands.setContent('<table><tr style="height: 80px"><td><p>a</p></td></tr></table>');
  expect(editor.getJSON().content![0].content![0].attrs!.height).toBe(80);
  expect(editor.getHTML()).toContain('height: 80px');
  editor.destroy();
});

it('equal widths also clear the old widths on screen', () => {
  const editor = make();
  const cols = () => Array.from(editor.view.dom.querySelectorAll('colgroup > col')).map((c) => (c as HTMLElement).style.width);
  expect(cols()).toContain('120px');
  cursorIn(editor, 'a');
  equalColumnWidths(editor);
  expect(cols().every((w) => w === '')).toBe(true);
  editor.destroy();
});

it('says when merged cells are in the way of a move', () => {
  const editor = new Editor({ extensions: createSchemaExtensions({ ydoc: new Y.Doc(), placeholder: '' }).filter((e) => e.name !== 'collaboration') });
  editor.commands.setContent('<table><tr><td colspan="2"><p>ab</p></td><td><p>x</p></td></tr><tr><td><p>c</p></td><td><p>d</p></td><td><p>y</p></td></tr></table>');
  cursorIn(editor, 'c');
  expect(moveTableColumnBy(editor, 1)).toBe('merged');
  editor.destroy();
});
