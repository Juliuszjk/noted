import { Extension } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import type { EditorState, Transaction } from '@tiptap/pm/state';

// Indent / outdent that fit where the cursor is:
//  - list item: nest it one level deeper / move it one level up,
//  - code block: two spaces at the start of the line (see code-extensions.ts),
//  - other text: a tab character (shown 4 wide, see content.css); with a selection, a tab at
//    the start of every selected block.
// Used by the Tab key (TextIndent) and the mobile toolbar buttons.

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    indentation: {
      indentContent: () => ReturnType;
      outdentContent: () => ReturnType;
    };
  }
}

const TAB = '\t';
const CODE_INDENT = '  ';

const listItemType = (editor: Editor): string | null =>
  editor.isActive('taskItem') ? 'taskItem' : editor.isActive('listItem') ? 'listItem' : null;

// Start positions of the text blocks touched by the selection.
const blockStarts = (state: EditorState | Transaction): number[] => {
  const { from, to } = state.selection;
  const starts: number[] = [];
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.isTextblock) {
      starts.push(pos + 1);
      return false;
    }
    return true;
  });
  return starts;
};

export const TextIndent = Extension.create({
  name: 'textIndent',
  // Below tables (Tab = next cell), lists and the slash / "[[" menus, which all handle Tab first.
  priority: 50,

  addCommands() {
    return {
      indentContent: () => ({ editor, tr, dispatch, commands, can }) => {
        if (editor.isActive('codeBlock')) {
          if (dispatch) tr.insertText(CODE_INDENT);
          return true;
        }
        const item = listItemType(editor);
        if (item) return can().sinkListItem(item) ? commands.sinkListItem(item) : true;
        if (!dispatch) return true;
        if (tr.selection.empty) {
          tr.insertText(TAB);
        } else {
          // Back to front so earlier positions stay valid.
          for (const start of blockStarts(tr).reverse()) tr.insertText(TAB, start);
        }
        return true;
      },

      outdentContent: () => ({ editor, tr, dispatch, commands, can }) => {
        const { $from } = tr.selection;
        if (editor.isActive('codeBlock')) {
          const text = $from.parent.textContent;
          const offset = $from.parentOffset;
          const lineStart = offset === 0 ? 0 : text.lastIndexOf('\n', offset - 1) + 1;
          const leading = /^ {1,2}/.exec(text.slice(lineStart))?.[0].length ?? 0;
          if (leading && dispatch) tr.delete($from.start() + lineStart, $from.start() + lineStart + leading);
          return true;
        }
        const item = listItemType(editor);
        if (item) return can().liftListItem(item) ? commands.liftListItem(item) : true;
        if (!dispatch) return true;
        if (tr.selection.empty) {
          // A tab right before the cursor, otherwise one at the start of the block.
          const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - 1), $from.parentOffset);
          if (before === TAB) tr.delete($from.pos - 1, $from.pos);
          else if ($from.parent.textContent.startsWith(TAB)) tr.delete($from.start(), $from.start() + 1);
          return true;
        }
        for (const start of blockStarts(tr).reverse()) {
          if (tr.doc.textBetween(start, start + 1) === TAB) tr.delete(start, start + 1);
        }
        return true;
      },
    };
  },

  addKeyboardShortcuts() {
    return {
      // Tab stays in the editor instead of moving the focus to the next control.
      Tab: ({ editor }) => editor.commands.indentContent(),
      'Shift-Tab': ({ editor }) => editor.commands.outdentContent(),
    };
  },
});
