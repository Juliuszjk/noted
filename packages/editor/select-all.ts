import { Extension } from '@tiptap/core';
import { AllSelection, Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

// Ctrl+A: inside a code block it first selects just that block's code (like code editors),
// pressed again it selects the whole note. Everywhere else the whole note at once (also from
// inside tables, callouts and lists, where the default could stop at the cell).
export const SelectAllKeys = Extension.create({
  name: 'selectAllKeys',
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      'Mod-a': () => {
        const { state, view } = this.editor;
        const { selection } = state;
        const { $from, $to } = selection;
        if ($from.parent.type.name === 'codeBlock' && $from.sameParent($to)) {
          const start = $from.start();
          const end = $from.end();
          if (selection.from !== start || selection.to !== end) {
            view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, start, end)));
            return true;
          }
        }
        view.dispatch(state.tr.setSelection(new AllSelection(state.doc)));
        return true;
      },
    };
  },
  // The browser paints a whole-note selection badly (dark boxes around task lists, nothing on
  // images, sometimes only the caret at the end): while it is selected, the text and the
  // blocks without text are painted by the editor instead.
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey('allSelectionPaint'),
      props: {
        attributes: (state): Record<string, string> => (state.selection instanceof AllSelection ? { class: 'has-all-selection' } : {}),
        decorations: (state) => {
          if (!(state.selection instanceof AllSelection)) return null;
          const decorations = [Decoration.inline(0, state.doc.content.size, { class: 'all-selected-text' })];
          state.doc.descendants((node, pos) => {
            if (node.isAtom || node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
              decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'all-selected-node' }));
              return false;
            }
            return true;
          });
          return DecorationSet.create(state.doc, decorations);
        },
      },
    })];
  },
});
