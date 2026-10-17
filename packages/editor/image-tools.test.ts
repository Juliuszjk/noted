// @vitest-environment happy-dom
import { it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import * as Y from 'yjs';
import { createSchemaExtensions } from './extensions';
import { setImageAlign, setImageWidth, currentImageAlign, currentImageSideBySide, setImageSideBySide, imageRowAt, matchImageRowHeights, moveBlockTo } from './image-tools';

it('aligns and resizes the selected image', () => {
  const editor = new Editor({ extensions: createSchemaExtensions({ ydoc: new Y.Doc(), placeholder: '' }).filter((e) => e.name !== 'collaboration') });
  editor.commands.setContent('<p>a</p><img data-blob="id:key" width="200" height="100"><p>b</p>');
  let pos = -1;
  editor.state.doc.descendants((n, p) => { if (n.type.name === 'image') pos = p; });
  editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)));
  expect(setImageAlign(editor, 'center')).toBe(true);
  expect(currentImageAlign(editor)).toBe('center');
  expect(setImageWidth(editor, 100)).toBe(true);
  const attrs = editor.state.doc.nodeAt(pos)!.attrs;
  expect(attrs).toMatchObject({ align: 'center', width: 100, height: 50 });
  expect(editor.getHTML()).toContain('data-align="center"');
  editor.destroy();
});

it('aligns a side-by-side row together and matches its heights', () => {
  const editor = new Editor({ extensions: createSchemaExtensions({ ydoc: new Y.Doc(), placeholder: '' }).filter((e) => e.name !== 'collaboration') });
  editor.commands.setContent('<p>a</p><img data-blob="a:k" data-align="inline" width="200" height="100"><img data-blob="b:k" width="100" height="100"><p>b</p>');
  const positions: number[] = [];
  editor.state.doc.descendants((n, p) => { if (n.type.name === 'image') positions.push(p); });
  const select = (pos: number) => editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)));
  // The second image joins the first one's row.
  select(positions[1]);
  expect(setImageSideBySide(editor, true)).toBe(true);
  expect(imageRowAt(editor.state.doc, positions[1])).toEqual(positions);
  expect(setImageAlign(editor, 'center')).toBe(true);
  expect(positions.map((p) => editor.state.doc.nodeAt(p)!.attrs.align)).toEqual(['inline-center', 'inline-center']);
  expect(currentImageAlign(editor)).toBe('center');
  expect(currentImageSideBySide(editor)).toBe(true);
  // Heights follow the selected (second) image: 100 px; the first one is 2:1.
  expect(matchImageRowHeights(editor)).toBe(true);
  expect(editor.state.doc.nodeAt(positions[0])!.attrs).toMatchObject({ width: 200, height: 100 });
  select(positions[0]);
  expect(setImageWidth(editor, 100)).toBe(true);
  select(positions[1]);
  matchImageRowHeights(editor);
  expect(editor.state.doc.nodeAt(positions[0])!.attrs).toMatchObject({ width: 200, height: 100 });
  // Off again: back to a centred single image.
  expect(setImageSideBySide(editor, false)).toBe(true);
  expect(editor.state.doc.nodeAt(positions[1])!.attrs.align).toBe('center');
  editor.destroy();
});

const makeEditor = (html: string) => {
  const editor = new Editor({ extensions: createSchemaExtensions({ ydoc: new Y.Doc(), placeholder: '' }).filter((e) => e.name !== 'collaboration') });
  editor.commands.setContent(html);
  return editor;
};
const imagePos = (editor: Editor) => {
  let pos = -1;
  editor.state.doc.descendants((n, p) => { if (n.type.name === 'image') pos = p; });
  return pos;
};

it('drops a dragged place when aligning with the buttons', () => {
  const editor = makeEditor('<p>a</p><img data-blob="id:key" data-x="0.3"><p>b</p>');
  editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, imagePos(editor))));
  expect(editor.state.doc.nodeAt(imagePos(editor))!.attrs.x).toBe(0.3);
  expect(currentImageAlign(editor)).toBeNull();
  setImageAlign(editor, 'right');
  expect(editor.state.doc.nodeAt(imagePos(editor))!.attrs).toMatchObject({ x: null, align: 'right' });
  expect(currentImageAlign(editor)).toBe('right');
  editor.destroy();
});

it('moves an image to another block boundary', () => {
  const editor = makeEditor('<p>a</p><img data-blob="id:key"><p>b</p><p>c</p>');
  // (The schema keeps an empty paragraph at the end.)
  const order = () => editor.state.doc.content.content.map((n) => (n.type.name === 'image' ? 'img' : n.textContent)).filter(Boolean);
  // After "c" (end of the document).
  const tr = moveBlockTo(editor.state, imagePos(editor), editor.state.doc.content.size)!;
  editor.view.dispatch(tr);
  expect(order()).toEqual(['a', 'b', 'c', 'img']);
  expect((editor.state.selection as NodeSelection).node.type.name).toBe('image');
  // Before "a".
  editor.view.dispatch(moveBlockTo(editor.state, imagePos(editor), 0)!);
  expect(order()).toEqual(['img', 'a', 'b', 'c']);
  // Its own place: nothing to do.
  expect(moveBlockTo(editor.state, imagePos(editor), 0)).toBeNull();
  editor.destroy();
});

it('moves an image out of a list item start where it may not stand', () => {
  const editor = makeEditor('<img data-blob="id:key"><ul><li><p>one</p></li><li><p>two</p></li></ul>');
  // Before the paragraph "two" (inside the second list item).
  let target = -1;
  editor.state.doc.descendants((n, p) => { if (n.type.name === 'paragraph' && n.textContent === 'two') target = p; });
  editor.view.dispatch(moveBlockTo(editor.state, imagePos(editor), target)!);
  const json = JSON.stringify(editor.getJSON());
  expect(json).toContain('"image"');
  expect(editor.state.doc.check()).toBeUndefined();
  editor.destroy();
});

it('moves an image under the text of a list item (into that item)', () => {
  const editor = makeEditor('<img data-blob="id:key"><ul><li><p>one</p></li><li><p>two</p></li></ul><p>end</p>');
  let after = -1;
  editor.state.doc.descendants((n, p) => { if (n.type.name === 'paragraph' && n.textContent === 'one') after = p + n.nodeSize; });
  editor.view.dispatch(moveBlockTo(editor.state, imagePos(editor), after)!);
  const list = editor.getJSON().content!.find((n) => n.type === 'bulletList')!;
  expect(list.content![0].content!.map((n) => n.type)).toEqual(['paragraph', 'image']);
  expect(editor.state.doc.check()).toBeUndefined();
  editor.destroy();
});
