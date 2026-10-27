import { Extension } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import type { Node as PmNode } from '@tiptap/pm/model';

// Indent / outdent that fit where the cursor is:
//  - list item: nest it one level deeper / move it one level up,
//  - code block: two spaces at the start of the line (see code-extensions.ts),
//  - paragraph / heading: the whole block moves right / left (attribute `indent`, levels
//    0..MAX_INDENT); every block the selection touches,
//  - a whole list (its markers too) carries the same attribute on its outermost list node: Tab
//    in an item that cannot nest (the first one) moves the list right, Shift+Tab in a top-level
//    item moves it left before taking the item out of the list. A list started in an indented
//    paragraph takes over its indent, and leaving such a list keeps it on the new paragraph.
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
const LISTS = ['bulletList', 'orderedList', 'taskList'];

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

// The outermost list around the selection's start: [position, node, depth], or null.
const outerList = (tr: Transaction): [number, PmNode, number] | null => {
  const { $from } = tr.selection;
  for (let d = 1; d <= $from.depth; d++) {
    if (LISTS.includes($from.node(d).type.name)) return [$from.before(d), $from.node(d), d];
  }
  return null;
};

// Moves the outermost list `by` levels; false when it cannot move that way.
const shiftList = (tr: Transaction, by: number, dispatch: unknown): boolean => {
  const found = outerList(tr);
  if (!found) return false;
  const [pos, list] = found;
  const level = Number(list.attrs.indent) || 0;
  if (by > 0 ? level >= MAX_INDENT : level <= 0) return false;
  if (dispatch) tr.setNodeMarkup(pos, undefined, { ...list.attrs, indent: Math.max(0, Math.min(MAX_INDENT, level + by)) || null });
  return true;
};

// The selection is in an item of the outermost list (not in a nested one).
const inTopLevelItem = (tr: Transaction): boolean => {
  const found = outerList(tr);
  // list > item > paragraph
  return !!found && tr.selection.$from.depth === found[2] + 2;
};

// Takes the item out of the list; the paragraph it leaves keeps the list's indent.
const liftKeepingIndent = (editor: Editor, item: string): boolean => {
  const level = Number(outerList(editor.state.tr)?.[1].attrs.indent) || 0;
  return editor.chain().liftListItem(item).command(({ tr }) => {
    const { $from } = tr.selection;
    if (level && !['listItem', 'taskItem'].includes($from.node(-1).type.name) && INDENTED.includes($from.parent.type.name) && !$from.parent.attrs.indent) {
      tr.setNodeMarkup($from.before(), undefined, { ...$from.parent.attrs, indent: level });
    }
    return true;
  }).run();
};

// Paragraphs and headings inside list items carry no indent of their own (a list started in an
// indented paragraph, a pasted list): the outermost list takes it over. [list position, level]
// for every such list, and the blocks to clear.
export const listIndentFixes = (doc: PmNode): { lists: [number, number][]; blocks: number[] } => {
  const lists: [number, number][] = [];
  const blocks: number[] = [];
  doc.descendants((node, pos) => {
    if (!LISTS.includes(node.type.name)) return !node.isTextblock;
    let level = 0;
    node.descendants((child, offset) => {
      if (!child.isTextblock) return true;
      if (INDENTED.includes(child.type.name) && child.attrs.indent > 0) {
        if (!level) level = child.attrs.indent;
        blocks.push(pos + 1 + offset);
      }
      return false;
    });
    if (level && !(node.attrs.indent > 0)) lists.push([pos, level]);
    return false;
  });
  return { lists, blocks };
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
        if (item) {
          if (can().sinkListItem(item)) return commands.sinkListItem(item);
          shiftList(tr, 1, dispatch);
          return true;
        }
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
        if (item) {
          if (inTopLevelItem(tr) && shiftList(tr, -1, dispatch)) return true;
          return can().liftListItem(item) ? commands.liftListItem(item) : true;
        }
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
      types: [...INDENTED, ...LISTS],
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

  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey('listIndent'),
      appendTransaction: (transactions, _old, state) => {
        // Own edits only (changes arriving from other devices are theirs).
        if (!transactions.some((t) => t.docChanged && !t.getMeta('y-sync$'))) return null;
        const { lists, blocks } = listIndentFixes(state.doc);
        if (!blocks.length) return null;
        const tr = state.tr;
        for (const pos of blocks) tr.setNodeMarkup(pos, undefined, { ...tr.doc.nodeAt(pos)!.attrs, indent: null });
        for (const [pos, level] of lists) tr.setNodeMarkup(pos, undefined, { ...tr.doc.nodeAt(pos)!.attrs, indent: level });
        return tr;
      },
    })];
  },
});

// Backspace at the start of an indented block takes one level off first (like a text processor)
// instead of joining it with the line above. Before the core keymap (priority 100), which joins.
// Enter in an empty item of an indented list: the paragraph after the list stays indented
// (the list items' own Enter, priority 100, would lift it to the margin).
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
      // Enter in an empty item of an indented list: the paragraph after it stays indented.
      Enter: ({ editor }) => {
        const { selection } = editor.state;
        const item = listItemType(editor);
        const tr = editor.state.tr;
        if (!item || !selection.empty || selection.$from.parent.content.size || !inTopLevelItem(tr)) return false;
        if (!(outerList(tr)?.[1].attrs.indent > 0) || selection.$from.node(-1).childCount !== 1) return false;
        return liftKeepingIndent(editor, item);
      },
    };
  },
});
