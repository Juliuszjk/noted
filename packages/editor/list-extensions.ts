import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { suggestionOpen, toggleInPlace } from './heading-fold';

export const BULLET_STYLES = ['disc', 'circle', 'square', 'square-open'] as const;
export const NUMBER_STYLES = ['decimal', 'lower-alpha', 'upper-alpha', 'lower-roman', 'upper-roman', 'lower-greek'] as const;

const stringAttr = (htmlName: string, attr: string) => ({
  default: null,
  parseHTML: (el: HTMLElement) => el.getAttribute(htmlName),
  renderHTML: (attrs: Record<string, any>) => (attrs[attr] ? { [htmlName]: attrs[attr] } : {}),
});

const boolAttr = (htmlName: string, attr: string) => ({
  default: false,
  parseHTML: (el: HTMLElement) => el.getAttribute(htmlName) === 'true',
  renderHTML: (attrs: Record<string, any>) => (attrs[attr] ? { [htmlName]: 'true' } : {}),
});

const outlineKey = new PluginKey('outlineToggles');

// List customisation stored in the document:
//  - bulletList.bulletStyle / orderedList.numberStyle: marker style
//  - bulletList.outline: collapsible "outline" list
//  - listItem.collapsed: whether a branch of an outline list is folded
export const ListStyles = Extension.create({
  name: 'listStyles',

  addGlobalAttributes() {
    return [
      {
        types: ['bulletList'],
        attributes: {
          bulletStyle: stringAttr('data-bullet-style', 'bulletStyle'),
          outline: boolAttr('data-outline', 'outline'),
        },
      },
      { types: ['orderedList'], attributes: { numberStyle: stringAttr('data-number-style', 'numberStyle') } },
      { types: ['listItem'], attributes: { collapsed: boolAttr('data-collapsed', 'collapsed') } },
    ];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: outlineKey,
        props: {
          // Fold/unfold buttons for items of outline lists that have a nested list.
          decorations(state) {
            const decorations: Decoration[] = [];
            state.doc.descendants((node, pos, parent) => {
              if (node.type.name !== 'listItem' || parent?.type.name !== 'bulletList' || !parent.attrs.outline) return;
              let hasChildList = false;
              node.forEach((child) => {
                if (child.type.name === 'bulletList' || child.type.name === 'orderedList') hasChildList = true;
              });
              if (!hasChildList) return;
              const collapsed = !!node.attrs.collapsed;
              decorations.push(
                Decoration.widget(
                  pos + 1,
                  (view) => {
                    const button = document.createElement('span');
                    button.className = 'outline-toggle';
                    button.contentEditable = 'false';
                    button.dataset.collapsed = String(collapsed);
                    button.addEventListener('mousedown', (event) => {
                      event.preventDefault();
                      const current = view.state.doc.nodeAt(pos);
                      if (!current) return;
                      toggleInPlace(view, pos, view.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, collapsed: !current.attrs.collapsed }));
                    });
                    return button;
                  },
                  { side: -1, key: `outline-${pos}-${collapsed}` },
                ),
              );
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});

// Enter at the end of a folded outline item's own line (not on an empty one, which leaves the
// list as usual): the new item goes under the whole folded branch. Its own extension so only
// this keymap runs before the list items' (priority 100).
export const OutlineEnter = Extension.create({
  name: 'outlineEnter',
  priority: 200,
  addKeyboardShortcuts() {
    return {
      // Enter at the end of a folded item's line: the new item goes under the whole folded
      // branch (splitting the item would hand its hidden children to the new line).
      Enter: ({ editor }) => {
        const { state, view } = editor;
        const { selection } = state;
        const { $from } = selection;
        if (!selection.empty || $from.depth < 2 || $from.index(-1) !== 0 || $from.parent.content.size === 0
          || $from.parentOffset !== $from.parent.content.size || suggestionOpen(state)) return false;
        const item = $from.node(-1);
        if (item.type.name !== 'listItem' || !item.attrs.collapsed) return false;
        let hidesBelow = false;
        for (let i = $from.index(-1) + 1; i < item.childCount; i++) {
          const name = item.child(i).type.name;
          if (name === 'bulletList' || name === 'orderedList') hidesBelow = true;
        }
        if (!hidesBelow) return false;
        const after = $from.after(-1);
        const tr = state.tr.insert(after, item.type.create(null, state.schema.nodes.paragraph.create()));
        view.dispatch(tr.setSelection(TextSelection.create(tr.doc, after + 2)).scrollIntoView());
        return true;
      },
    };
  },
});
