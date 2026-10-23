import { Extension } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

// Collapsible headings, like the outline list: a heading with `foldable` gets an arrow that
// folds everything below it up to the next heading of the same or a higher level (in the
// same container). Stored in the document:
//  - heading.foldable: the heading can be folded (made with the slash menu),
//  - heading.collapsed: it is folded now.
// The folded blocks are only hidden (node decorations), they stay in the note.

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    headingFold: {
      // Turns the heading at the cursor into a collapsible one (or back into a plain heading).
      toggleHeadingFoldable: () => ReturnType;
    };
  }
}

const boolAttr = (htmlName: string, attr: string) => ({
  default: false,
  keepOnSplit: false,
  parseHTML: (el: HTMLElement) => el.getAttribute(htmlName) === 'true',
  renderHTML: (attrs: Record<string, any>) => (attrs[attr] ? { [htmlName]: 'true' } : {}),
});

const isFolded = (node: PmNode) => node.type.name === 'heading' && !!node.attrs.foldable && !!node.attrs.collapsed;

// Whether `node` ends the section of a heading of `level` (a heading of the same or a higher level).
const endsSection = (node: PmNode, level: number) => node.type.name === 'heading' && Number(node.attrs.level) <= level;

// The range [from, to) of the blocks a folded heading at `pos` hides (from == to: nothing).
export const foldedRange = (doc: PmNode, pos: number): { from: number; to: number } => {
  const $pos = doc.resolve(pos);
  const parent = $pos.parent;
  const heading = parent.child($pos.index());
  const level = Number(heading.attrs.level);
  const from = pos + heading.nodeSize;
  let to = from;
  for (let i = $pos.index() + 1; i < parent.childCount; i++) {
    const child = parent.child(i);
    if (endsSection(child, level)) break;
    to += child.nodeSize;
  }
  return { from, to };
};

// Every range hidden by a folded heading.
const hiddenRanges = (doc: PmNode): { from: number; to: number }[] => {
  const ranges: { from: number; to: number }[] = [];
  doc.descendants((node, pos) => {
    // Blocks inside a hidden range need no second look.
    if (ranges.length && pos < ranges[ranges.length - 1].to) return false;
    if (isFolded(node)) {
      const range = foldedRange(doc, pos);
      if (range.to > range.from) ranges.push(range);
      return false;
    }
    return !node.isTextblock;
  });
  return ranges;
};

const foldKey = new PluginKey<DecorationSet>('headingFold');

const decorate = (state: EditorState): DecorationSet => {
  const { doc } = state;
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'heading' || !node.attrs.foldable) return !node.isTextblock;
    const collapsed = !!node.attrs.collapsed;
    decorations.push(Decoration.widget(pos + 1, (view) => {
      const button = document.createElement('span');
      button.className = 'heading-toggle';
      button.contentEditable = 'false';
      button.dataset.collapsed = String(collapsed);
      button.addEventListener('mousedown', (event) => {
        event.preventDefault();
        const current = view.state.doc.nodeAt(pos);
        if (!current || current.type.name !== 'heading') return;
        const tr = view.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, collapsed: !current.attrs.collapsed });
        // Folding the text the cursor is in moves the cursor to the end of the heading.
        if (!current.attrs.collapsed) {
          const { from, to } = foldedRange(tr.doc, pos);
          const { selection } = tr;
          if (selection.to > from && selection.from < to) tr.setSelection(TextSelection.create(tr.doc, pos + current.nodeSize - 1));
        }
        view.dispatch(tr);
      });
      return button;
    }, { side: -1, key: `heading-fold-${pos}-${collapsed}` }));
    return false;
  });
  for (const { from, to } of hiddenRanges(doc)) {
    doc.nodesBetween(from, to, (node, pos) => {
      if (pos >= from && pos + node.nodeSize <= to) decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'heading-folded' }));
      return false;
    });
  }
  return DecorationSet.create(doc, decorations);
};

export const HeadingFold = Extension.create({
  name: 'headingFold',

  addGlobalAttributes() {
    return [{
      types: ['heading'],
      attributes: {
        foldable: boolAttr('data-foldable', 'foldable'),
        collapsed: boolAttr('data-collapsed', 'collapsed'),
      },
    }];
  },

  addCommands() {
    return {
      toggleHeadingFoldable: () => ({ tr, dispatch }) => {
        const { $from } = tr.selection;
        if ($from.parent.type.name !== 'heading') return false;
        const pos = $from.before();
        const on = !$from.parent.attrs.foldable;
        if (dispatch) tr.setNodeMarkup(pos, undefined, { ...$from.parent.attrs, foldable: on, collapsed: false });
        return true;
      },
    };
  },

  addKeyboardShortcuts() {
    return {
      // Enter at the end of a folded heading opens the fold: the new line goes right under the
      // heading, which is inside the fold (everything up to the next heading belongs to it).
      Enter: ({ editor }) => {
        const { state, view } = editor;
        const { selection } = state;
        const { $from } = selection;
        if (!selection.empty || !isFolded($from.parent) || $from.parentOffset !== $from.parent.content.size) return false;
        const pos = $from.before();
        const after = pos + $from.parent.nodeSize;
        const tr = state.tr.setNodeMarkup(pos, undefined, { ...$from.parent.attrs, collapsed: false }).insert(after, state.schema.nodes.paragraph.create());
        view.dispatch(tr.setSelection(TextSelection.create(tr.doc, after + 1)).scrollIntoView());
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    return [new Plugin({
      key: foldKey,
      state: {
        init: (_, state) => decorate(state),
        apply: (tr, old, _, state) => (tr.docChanged ? decorate(state) : old),
      },
      props: {
        decorations: (state) => foldKey.getState(state),
      },
    })];
  },
});
