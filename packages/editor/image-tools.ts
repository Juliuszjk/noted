import type { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import { imagePx, parseBlobRef, isSideBySide, imageBaseAlign, composeImageAlign, imageX } from './blob-image';

// The image menu (desktop above the image, phone as a toolbar row): preview, download,
// alignment and exact size of the selected image.

export interface SelectedImage {
  pos: number;
  node: PMNode;
}

export const selectedImage = (editor: Editor): SelectedImage | null => {
  const { selection } = editor.state;
  return selection instanceof NodeSelection && selection.node.type.name === 'image' ? { pos: selection.from, node: selection.node } : null;
};

// The shown <img> of the image at `pos` (its decrypted object URL and natural size).
export const imageElementAt = (editor: Editor, pos: number): HTMLImageElement | null => {
  const dom = editor.view.nodeDOM(pos) as HTMLElement | null;
  return dom?.querySelector('img') ?? (dom instanceof HTMLImageElement ? dom : null);
};

// Left / center / right (also of a side-by-side row).
// Null: placed freely by dragging, not at one of the three.
export const currentImageAlign = (editor: Editor): 'left' | 'center' | 'right' | null => {
  const node = selectedImage(editor)?.node;
  const x = node && !isSideBySide(node.attrs.align) ? imageX(node.attrs.x) : null;
  if (x === null) return imageBaseAlign(node?.attrs.align);
  return x === 0 ? 'left' : x === 0.5 ? 'center' : x === 1 ? 'right' : null;
};
export const currentImageSideBySide = (editor: Editor): boolean => isSideBySide(selectedImage(editor)?.node.attrs.align);

// Positions of the side-by-side images in the same row as the one at `pos` (consecutive
// siblings), in order; just `pos` when it is not side by side.
export const imageRowAt = (doc: PMNode, pos: number): number[] => {
  const node = doc.nodeAt(pos);
  if (!node || !isSideBySide(node.attrs.align)) return [pos];
  const $pos = doc.resolve(pos);
  const parent = $pos.parent;
  const start = $pos.start();
  const offsets: number[] = [];
  parent.forEach((_child, offset) => offsets.push(offset));
  const index = $pos.index();
  const inRow = (i: number) => {
    const child = parent.child(i);
    return child.type.name === 'image' && isSideBySide(child.attrs.align);
  };
  let first = index;
  while (first > 0 && inRow(first - 1)) first--;
  let last = index;
  while (last < parent.childCount - 1 && inRow(last + 1)) last++;
  const row: number[] = [];
  for (let i = first; i <= last; i++) row.push(start + offsets[i]);
  return row;
};

const keepSelected = (editor: Editor, tr: ReturnType<Editor['state']['tr']['setNodeMarkup']>, pos: number) => {
  editor.view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, pos)));
  return true;
};

// Left / center / right. A side-by-side image moves its whole row.
export const setImageAlign = (editor: Editor, align: 'left' | 'center' | 'right'): boolean => {
  const image = selectedImage(editor);
  if (!image) return false;
  const sideBySide = isSideBySide(image.node.attrs.align);
  const value = composeImageAlign(align, sideBySide);
  const tr = editor.state.tr;
  for (const pos of sideBySide ? imageRowAt(editor.state.doc, image.pos) : [image.pos]) {
    // The buttons replace a place set by dragging.
    tr.setNodeMarkup(pos, undefined, { ...tr.doc.nodeAt(pos)!.attrs, align: value, x: null });
  }
  return keepSelected(editor, tr, image.pos);
};

// Side by side on / off. Joining a neighbour's row takes that row's alignment.
export const setImageSideBySide = (editor: Editor, on: boolean): boolean => {
  const image = selectedImage(editor);
  if (!image) return false;
  let base = imageBaseAlign(image.node.attrs.align);
  if (on) {
    const $pos = editor.state.doc.resolve(image.pos);
    const index = $pos.index();
    const parent = $pos.parent;
    for (const i of [index - 1, index + 1]) {
      const sibling = i >= 0 && i < parent.childCount ? parent.child(i) : null;
      if (sibling?.type.name === 'image' && isSideBySide(sibling.attrs.align)) { base = imageBaseAlign(sibling.attrs.align); break; }
    }
  }
  const tr = editor.state.tr.setNodeMarkup(image.pos, undefined, { ...image.node.attrs, align: composeImageAlign(base, on) });
  return keepSelected(editor, tr, image.pos);
};

// Gives every image in the selected image's row its height (widths follow each picture's
// proportions). False when the image is alone.
export const matchImageRowHeights = (editor: Editor): boolean => {
  const image = selectedImage(editor);
  const size = imageSize(editor);
  if (!image || !size || !size.height) return false;
  const row = imageRowAt(editor.state.doc, image.pos);
  if (row.length < 2) return false;
  const tr = editor.state.tr;
  for (const pos of row) {
    const node = tr.doc.nodeAt(pos)!;
    const ratio = sizeAt(editor, pos, node).ratio;
    if (!ratio) continue;
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, width: Math.max(16, Math.round(size.height / ratio)), height: size.height });
  }
  return keepSelected(editor, tr, image.pos);
};

// Width and height as shown now (set ones, or the rendered size).
const sizeAt = (editor: Editor, pos: number, node: PMNode): { width: number; height: number; ratio: number } => {
  const img = imageElementAt(editor, pos);
  const ratio = img && img.naturalWidth ? img.naturalHeight / img.naturalWidth : (imagePx(node.attrs.height) ?? 1) / (imagePx(node.attrs.width) ?? 1);
  const width = imagePx(node.attrs.width) ?? img?.offsetWidth ?? 0;
  return { width, height: Math.round(width * ratio), ratio };
};

export const imageSize = (editor: Editor): { width: number; height: number; ratio: number } | null => {
  const image = selectedImage(editor);
  return image ? sizeAt(editor, image.pos, image.node) : null;
};

// A new width (the height follows the picture's proportions); null = natural size.
export const setImageWidth = (editor: Editor, width: number | null): boolean => {
  const image = selectedImage(editor);
  const size = imageSize(editor);
  if (!image || !size) return false;
  const w = width === null ? null : Math.max(16, Math.round(width));
  const attrs = { ...image.node.attrs, width: w, height: w === null ? null : Math.round(w * size.ratio) };
  const tr = editor.state.tr.setNodeMarkup(image.pos, undefined, attrs);
  editor.view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, image.pos)));
  return true;
};

// Saves the selected image through the app's blob handlers (download folder or a dialog).
export const downloadSelectedImage = (editor: Editor): void => {
  const image = selectedImage(editor);
  const handlers = editor.storage.image?.handlers;
  const ref = parseBlobRef(image?.node.attrs.blob);
  if (!image || !ref || !handlers?.saveFile) return;
  handlers.saveFile(ref, image.node.attrs.alt || 'image').catch((err) => {
    handlers.notify?.(`Download: ${err instanceof Error ? err.message : String(err)}`);
  });
};

// Moves the node at `from` to the block boundary `target` (a position between blocks, in the
// document before the move). Where the node may not stand (e.g. before the first paragraph of
// a list item) it goes out of the containers until it may. Returns the transaction with the
// moved node selected, or null when nothing would change.
export const moveBlockTo = (state: EditorState, from: number, target: number): Transaction | null => {
  const node = state.doc.nodeAt(from);
  if (!node || (target >= from && target <= from + node.nodeSize)) return null;
  const tr = state.tr.delete(from, from + node.nodeSize);
  let at = tr.mapping.map(target, target > from ? 1 : -1);
  let $at = tr.doc.resolve(at);
  while ($at.depth > 0 && !$at.parent.canReplaceWith($at.index(), $at.index(), node.type)) {
    // Out of the container, on the side the target was nearer to.
    at = at - $at.start() < $at.end() - at ? $at.before() : $at.after();
    $at = tr.doc.resolve(at);
  }
  if (!$at.parent.canReplaceWith($at.index(), $at.index(), node.type)) return null;
  tr.insert(at, node);
  return tr.setSelection(NodeSelection.create(tr.doc, at)).scrollIntoView();
};

// Where a dragged image lands for the height y: right AFTER the last line block (paragraph,
// heading, code block, another picture...) whose top is above y, in that block's own
// container (so under a list item's text it goes into that list item); above the first
// block when y is above everything. No aiming at gaps between blocks. `skip` = the dragged
// node's position (it does not count). `pos` = the boundary (document before the move),
// `y` = where to draw the line (the block's bottom edge), `left` / `width` = the column the
// block stands in (the line, and where a dropped image's side is measured).
export const blockDropTarget = (view: EditorView, _x: number, y: number, skip = -1): { pos: number; y: number; left: number; width: number } | null => {
  const { doc } = view.state;
  let best: { pos: number; y: number; left: number; width: number } | null = null;
  let first: { pos: number; y: number; left: number; width: number } | null = null;
  doc.descendants((node, pos) => {
    if (pos === skip) return false;
    const leaf = node.isTextblock || (node.isBlock && node.isAtom);
    if (!leaf) return true;
    const dom = view.nodeDOM(pos) as HTMLElement | null;
    const rect = dom?.getBoundingClientRect?.();
    if (!rect || (!rect.width && !rect.height)) return false;
    // A picture is only as wide as itself (and may sit moved sideways): its column is its
    // container's. Measured on the picture, an image dropped under another one of the same
    // width had no room and jumped back to the left edge.
    const column = node.isTextblock ? rect : columnOf(dom!) ?? rect;
    if (!first) first = { pos, y: rect.top, left: column.left, width: column.width };
    if (rect.top <= y) best = { pos: pos + node.nodeSize, y: rect.bottom, left: column.left, width: column.width };
    return false;
  });
  return best ?? first;
};

// The content box of the element's container (without its padding and borders).
const columnOf = (dom: HTMLElement): { left: number; width: number } | null => {
  const parent = dom.parentElement;
  const rect = parent?.getBoundingClientRect();
  if (!parent || !rect?.width) return null;
  const style = getComputedStyle(parent);
  const px = (v: string) => parseFloat(v) || 0;
  const left = rect.left + px(style.borderLeftWidth) + px(style.paddingLeft);
  const width = rect.width - px(style.borderLeftWidth) - px(style.paddingLeft) - px(style.paddingRight) - px(style.borderRightWidth);
  return width > 0 ? { left, width } : null;
};

// Moves the selected image to the drop target of the point (x, y).
export const moveImageToPoint = (editor: Editor, x: number, y: number): boolean => {
  const image = selectedImage(editor);
  const drop = image ? blockDropTarget(editor.view, x, y) : null;
  if (!image || !drop) return false;
  const tr = moveBlockTo(editor.state, image.pos, drop.pos);
  if (tr) editor.view.dispatch(tr);
  return true;
};
