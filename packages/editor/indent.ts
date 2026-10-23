import { Extension } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import type { Node as PmNode } from '@tiptap/pm/model';

// Indent / outdent that fit where the cursor is:
//  - list item: nest it one level deeper / move it one level up,
//  - code block: two spaces at the start of the line (see code-extensions.ts),
//  - paragraph / heading: the whole block moves right / left (attribute `indent`, levels
//    0..MAX_INDENT); every block the selection touches.
// Used by the Tab key (TextIndent) and the toolbar buttons. The Tab key inside a line (not at
// its start, nothing selected) still types a tab character (shown 4 wide, see content.css);
// Shift+Tab removes a tab right before the cursor first, and tabs typed at the start of a
// line before block indents existed.

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
export const MAX_INDENT = 8;
// Width of one level.
const INDENT_EM = 2;
const INDENTED = ['paragraph', 'heading'];

const listItemType = (editor: Editor): string | null =>
  editor.isActive('taskItem') ? 'taskItem' : editor.isActive('listItem') ? 'listItem' : null;

// Paragraphs and headings touched by the selection: [position, node].
const indentBlocks = (tr: Transaction): [number, PmNode][] => {
  const { from, to } = tr.selection;
  const found: [number, PmNode][] = [];
  tr.doc.nodesBetween(from, to, (node, pos) => {
    if (node.isTextblock) {
      if (INDENTED.includes(node.type.name)) found.push([pos, node]);
      return false;
    }
    return true;
  });
  return found;
};

// Moves the selected blocks `by` levels; false when none of them can move that way.
const shiftBlocks = (tr: Transaction, by: number, dispatch: unknown): boolean => {
  const blocks = indentBlocks(tr).filter(([, node]) => {
    const level = Number(node.attrs.indent) || 0;
    return by > 0 ? level < MAX_INDENT : level > 0;
  });
  if (!blocks.length) return false;
  if (dispatch) {
    for (const [pos, node] of blocks) {
      const level = Math.max(0, Math.min(MAX_INDENT, (Number(node.attrs.indent) || 0) + by));
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: level || null });
    }
  }
  return true;
};

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
        shiftBlocks(tr, 1, dispatch);
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
        if (tr.selection.empty) {
          // A tab right before the cursor first.
          const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - 1), $from.parentOffset);
          if (before === TAB) {
            if (dispatch) tr.delete($from.pos - 1, $from.pos);
            return true;
          }
        }
        if (shiftBlocks(tr, -1, dispatch) || !dispatch) return true;
        // Old notes: tabs typed at the start of the lines.
        for (const start of blockStarts(tr).reverse()) {
          if (tr.doc.textBetween(start, start + 1) === TAB) tr.delete(start, start + 1);
        }
        return true;
      },
    };
  },

  addGlobalAttributes() {
    return [{
      types: INDENTED,
      attributes: {
        indent: {
          default: null,
          parseHTML: (el: HTMLElement) => {
            const level = Number(el.getAttribute('data-indent'));
            return level > 0 ? Math.min(MAX_INDENT, Math.floor(level)) : null;
          },
          // The inline margin keeps the indent in published copies and exported HTML too.
          renderHTML: (attrs: Record<string, any>) => (attrs.indent > 0
            ? { 'data-indent': String(attrs.indent), style: `margin-left: ${attrs.indent * INDENT_EM}em` }
            : {}),
        },
      },
    }];
  },

  addKeyboardShortcuts() {
    return {
      // Tab stays in the editor instead of moving the focus to the next control. Inside a line
      // of plain text it types a tab; at the start of a line (or over a selection) it moves the
      // whole block.
      Tab: ({ editor }) => {
        const { selection } = editor.state;
        const { $from } = selection;
        if (selection.empty && $from.parentOffset > 0 && INDENTED.includes($from.parent.type.name) && !listItemType(editor)) {
          return editor.commands.command(({ tr }) => {
            tr.insertText(TAB);
            return true;
          });
        }
        return editor.commands.indentContent();
      },
      'Shift-Tab': ({ editor }) => editor.commands.outdentContent(),
    };
  },
});

// Backspace at the start of an indented block takes one level off first (like a text processor)
// instead of joining it with the line above. Before the core keymap (priority 100), which joins.
export const IndentBackspace = Extension.create({
  name: 'indentBackspace',
  priority: 200,
  addKeyboardShortcuts() {
    return {
      Backspace: ({ editor }) => {
        const { selection } = editor.state;
        const { $from } = selection;
        if (!selection.empty || $from.parentOffset !== 0 || !INDENTED.includes($from.parent.type.name) || !($from.parent.attrs.indent > 0)) return false;
        const level = $from.parent.attrs.indent - 1;
        return editor.commands.command(({ tr }) => {
          tr.setNodeMarkup($from.before(), undefined, { ...$from.parent.attrs, indent: level || null });
          return true;
        });
      },
    };
  },
});
