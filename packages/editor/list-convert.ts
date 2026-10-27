import { Extension } from '@tiptap/core';
import type { Node as PMNode, NodeType, Schema } from '@tiptap/pm/model';
import { Plugin, PluginKey, Selection } from '@tiptap/pm/state';
import { canJoin } from '@tiptap/pm/transform';
import type { EditorState, Transaction } from '@tiptap/pm/state';

// Bullet / numbered / task list buttons on a list of another kind turn that list into the
// chosen kind (items, nesting and text kept; task boxes come and go). Tiptap only does that
// between lists with the same item type: a task list picked whole and switched to a bullet
// list lost its boxes and became plain paragraphs.
// The commands keep their names, so every button, slash item and shortcut gets this.

type ListKind = 'bulletList' | 'orderedList' | 'taskList';
const LISTS = new Set<string>(['bulletList', 'orderedList', 'taskList']);
const itemOf = (kind: ListKind) => (kind === 'taskList' ? 'taskItem' : 'listItem');

// The lists the selection asks to change: the innermost list holding the whole selection, or
// else every top-level list it touches.
const targetLists = (state: EditorState): { pos: number; node: PMNode }[] => {
  const { $from, $to, from, to } = state.selection;
  for (let d = $from.sharedDepth($to.pos); d > 0; d--) {
    const node = $from.node(d);
    if (LISTS.has(node.type.name)) return [{ pos: $from.before(d), node }];
  }
  const found: { pos: number; node: PMNode }[] = [];
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (LISTS.has(node.type.name)) { found.push({ pos, node }); return false; }
    return true;
  });
  return found;
};

// The list rebuilt as `kind`; nested lists of the same old kind change too.
const convertList = (schema: Schema, list: PMNode, kind: ListKind): PMNode => {
  const listType: NodeType = schema.nodes[kind];
  const itemType: NodeType = schema.nodes[itemOf(kind)];
  const from = list.type.name;
  const items: PMNode[] = [];
  list.forEach((item) => {
    const content: PMNode[] = [];
    item.forEach((child) => content.push(child.type.name === from ? convertList(schema, child, kind) : child));
    const attrs = kind === 'taskList' ? { checked: item.type.name === 'taskItem' ? item.attrs.checked : false } : {};
    items.push(itemType.create(attrs, content, item.marks));
  });
  const attrs = kind === 'orderedList' && from === 'orderedList' ? list.attrs : { indent: list.attrs.indent ?? null };
  return listType.create(attrs, items, list.marks);
};

export const convertSelectedLists = (state: EditorState, tr: Transaction, kind: ListKind): boolean => {
  const lists = targetLists(state).filter((l) => l.node.type.name !== kind);
  if (!lists.length) return false;
  for (const { pos, node } of [...lists].reverse()) {
    let converted: PMNode;
    try {
      converted = convertList(state.schema, node, kind);
      converted.check();
    } catch {
      return false;
    }
    tr.replaceWith(pos, pos + node.nodeSize, converted);
  }
  // The structure (and so every position) is the same: the selection stays where it was.
  try { tr.setSelection(Selection.fromJSON(tr.doc, state.selection.toJSON())); } catch { /* mapped one is fine */ }
  return true;
};

// Two lists of the same kind right after each other (an item deleted from the middle of a list
// leaves two) become one list again: no bigger gap and one list to work on. Lists with other
// styles (bullet style, outline) stay apart; a numbered list keeps the first one's start.
const sameListAttrs = (a: PMNode, b: PMNode) => {
  const strip = (n: PMNode) => JSON.stringify({ ...n.attrs, start: undefined });
  return strip(a) === strip(b);
};
export const adjacentListJoins = (doc: PMNode): number[] => {
  const joins: number[] = [];
  const scan = (parent: PMNode, base: number) => {
    let prev: PMNode | null = null;
    parent.forEach((child, offset) => {
      if (prev && LISTS.has(child.type.name) && prev.type === child.type && sameListAttrs(prev, child)) joins.push(base + offset);
      prev = child;
    });
  };
  scan(doc, 0);
  doc.descendants((node, pos) => {
    if (node.childCount > 1 && !node.isTextblock) scan(node, pos + 1);
    return !node.isTextblock;
  });
  return joins;
};

export const ListConvert = Extension.create({
  name: 'listConvert',
  // Lower than the list extensions: these commands are registered after theirs and replace them.
  priority: 10,
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('listJoin'),
        appendTransaction: (transactions, _old, state) => {
          // Own edits only (changes arriving from other devices are theirs).
          if (!transactions.some((t) => t.docChanged && !t.getMeta('y-sync$'))) return null;
          const joins = adjacentListJoins(state.doc);
          if (!joins.length) return null;
          const tr = state.tr;
          for (const pos of joins.sort((a, b) => b - a)) if (canJoin(tr.doc, pos)) tr.join(pos);
          return tr.docChanged ? tr : null;
        },
      }),
    ];
  },
  addCommands() {
    const make = (kind: ListKind) => () => ({ state, tr, dispatch, commands }: { state: EditorState; tr: Transaction; dispatch?: (tr: Transaction) => void; commands: { toggleList: (list: string, item: string, keepMarks?: boolean) => boolean } }) => {
      const others = targetLists(state).filter((l) => l.node.type.name !== kind);
      if (others.length) {
        if (!dispatch) return true;
        return convertSelectedLists(state, tr, kind);
      }
      return commands.toggleList(kind, itemOf(kind));
    };
    return {
      toggleBulletList: make('bulletList'),
      toggleOrderedList: make('orderedList'),
      toggleTaskList: make('taskList'),
    } as never;
  },
});
