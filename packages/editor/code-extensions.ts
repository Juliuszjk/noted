import { Extension } from '@tiptap/core';

const CODE_INDENT = '  ';

// Tab indents inside a code block instead of moving focus; Shift+Tab removes one level.
// Priority is high so list-item indentation never wins inside a code block.
export const CodeBlockIndent = Extension.create({
  name: 'codeBlockIndent',
  priority: 1000,

  addKeyboardShortcuts() {
    return {
      Tab: ({ editor }) => {
        if (!editor.isActive('codeBlock')) return false;
        return editor.commands.command(({ tr }) => {
          tr.insertText(CODE_INDENT);
          return true;
        });
      },
      'Shift-Tab': ({ editor }) => {
        if (!editor.isActive('codeBlock')) return false;
        const { $from } = editor.state.selection;
        const text = $from.parent.textContent;
        const offset = $from.parentOffset;
        const lineStart = offset === 0 ? 0 : text.lastIndexOf('\n', offset - 1) + 1;
        const leading = /^ {1,2}/.exec(text.slice(lineStart))?.[0].length ?? 0;
        if (leading === 0) return true;
        const from = $from.start() + lineStart;
        return editor.commands.deleteRange({ from, to: from + leading });
      },
    };
  },
});
