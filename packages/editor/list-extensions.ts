import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { toggleInPlace } from './heading-fold';

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
