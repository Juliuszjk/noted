import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { Fragment, Node, Slice } from '@tiptap/pm/model';
import { clipboardText } from './export';

// The text/plain part of a copy. Tiptap's default puts a blank line between all blocks and two
// around every list item (item + its paragraph), so a copied list pasted elsewhere had three
// empty lines between its lines. Here every block is one line, as in the note (export.ts).

const LISTS = new Set(['bulletList', 'orderedList', 'taskList']);

// Text of a slice. A selection inside one block (a word in a list item, a callout, ...) is
// copied without the wrappers it sits in (no "• " before a copied word). `parent` = the node
// whose children the slice holds (the selection's shared ancestor): items cut out of a list
// keep their markers.
export const sliceText = (slice: Slice, titles: Record<string, string> = {}, parent?: Node): string => {
  let fragment: Fragment = slice.content;
  let open = Math.min(slice.openStart, slice.openEnd);
  while (open > 0 && fragment.childCount === 1) {
    const child = fragment.firstChild!;
    if (child.isTextblock) return clipboardText(child.content.toJSON() ?? [], titles, true);
    if (child.childCount !== 1) break;
    parent = child;
    fragment = child.content;
    open--;
  }
  const nodes = fragment.toJSON() ?? [];
  if (parent && LISTS.has(parent.type.name)) return clipboardText([{ type: parent.type.name, attrs: parent.attrs, content: nodes }], titles);
  return clipboardText(nodes, titles);
};

export const ClipboardText = Extension.create({
  name: 'clipboardText',
  // Before Tiptap's own serializer (core extensions have priority 100): the first one wins.
  priority: 1000,
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey('clipboardText'),
        props: {
          clipboardTextSerializer: (slice, view) => {
            const { $from, $to } = view.state.selection;
            const titles: Map<string, string> | undefined = (editor.storage as unknown as Record<string, { titles?: Map<string, string> }>).noteLink?.titles;
            return sliceText(slice, titles ? Object.fromEntries(titles) : {}, $from.node($from.sharedDepth($to.pos)));
          },
        },
      }),
    ];
  },
});
