import { Extension } from '@tiptap/core';
import type { Editor, Extensions } from '@tiptap/core';
import { InlineMath, BlockMath } from '@tiptap/extension-mathematics';
import { AllSelection, Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

// Math nodes: inlineMath and blockMath, both with a single `latex` attribute, rendered with
// KaTeX. Typing $$x$$ creates inline math and $$$x$$$ on its own line creates a block.
// The editing UI is platform specific; the schema only reports what should be edited.

export type MathKind = 'inline' | 'block';

export type MathEditRequest =
  // A new formula to insert at `pos` once the user has typed something.
  | { mode: 'insert'; kind: MathKind; pos: number }
  // An existing node at `pos`.
  | { mode: 'edit'; kind: MathKind; pos: number; latex: string };

export type MathEditHandler = (request: MathEditRequest) => void;

// Holds the platform's edit handler so slash commands can reach it through the editor.
// Formulas inside a text selection are painted as selected (the browser paints nothing on
// the KaTeX output, so they looked left out of a copy; copied text has them as $…$).
const MathEditing = Extension.create<{ onEdit: MathEditHandler | null }>({
  name: 'mathEditing',
  addOptions() {
    return { onEdit: null };
  },
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey('mathInSelection'),
      props: {
        decorations: (state) => {
          const { selection } = state;
          // A whole-note selection is painted by select-all.ts.
          if (selection.empty || selection instanceof AllSelection) return null;
          const decorations: Decoration[] = [];
          state.doc.nodesBetween(selection.from, selection.to, (node, pos) => {
            if ((node.type.name === 'inlineMath' || node.type.name === 'blockMath') && pos >= selection.from && pos + node.nodeSize <= selection.to) {
              decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'math-in-selection' }));
            }
            return !node.isAtom;
          });
          return decorations.length ? DecorationSet.create(state.doc, decorations) : null;
        },
      },
    })];
  },
});

export const createMathExtensions = (onEdit?: MathEditHandler): Extensions => [
  InlineMath.configure({
    katexOptions: { throwOnError: true },
    onClick: onEdit ? (node, pos) => onEdit({ mode: 'edit', kind: 'inline', pos, latex: node.attrs.latex ?? '' }) : undefined,
  }),
  BlockMath.configure({
    katexOptions: { throwOnError: true, displayMode: true },
    onClick: onEdit ? (node, pos) => onEdit({ mode: 'edit', kind: 'block', pos, latex: node.attrs.latex ?? '' }) : undefined,
  }),
  MathEditing.configure({ onEdit: onEdit ?? null }),
];

// Asks the platform UI to edit math. Returns false when this editor has no math UI.
export const requestMathEdit = (editor: Editor, request: MathEditRequest): boolean => {
  const extension = editor.extensionManager.extensions.find((e) => e.name === 'mathEditing');
  const onEdit = extension?.options.onEdit as MathEditHandler | null | undefined;
  if (!onEdit) return false;
  onEdit(request);
  return true;
};

// Applies the result of the math editor. Empty LaTeX deletes an existing formula.
export const commitMathEdit = (editor: Editor, request: MathEditRequest, latex: string): void => {
  const value = latex.trim();
  const { kind, pos } = request;
  const chain = editor.chain().focus();
  if (request.mode === 'insert') {
    if (!value) return void chain.run();
    if (kind === 'inline') chain.insertInlineMath({ latex: value, pos }).setTextSelection(pos + 1).run();
    else chain.insertBlockMath({ latex: value, pos }).run();
    return;
  }
  if (!value) {
    if (kind === 'inline') chain.deleteInlineMath({ pos }).run();
    else chain.deleteBlockMath({ pos }).run();
    return;
  }
  if (kind === 'inline') chain.updateInlineMath({ latex: value, pos }).setTextSelection(pos + 1).run();
  else chain.updateBlockMath({ latex: value, pos }).run();
};
