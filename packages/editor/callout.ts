import { Node, mergeAttributes } from '@tiptap/core';
import { NodeRange } from '@tiptap/pm/model';
import { liftTarget, findWrapping } from '@tiptap/pm/transform';

// Callout kinds. Each has a default icon and palette colour; both can be overridden per
// callout. content.css draws the same defaults (keep them in sync) from data-variant,
// data-icon and data-color, so every client renders callouts the same without a node view.
export const CALLOUT_VARIANTS = [
  { name: 'info', label: 'Info', icon: 'ℹ️', color: 'blue', keywords: ['information', 'notice'] },
  { name: 'tip', label: 'Tip', icon: '💡', color: 'green', keywords: ['hint', 'idea', 'success'] },
  { name: 'warning', label: 'Warning', icon: '⚠️', color: 'yellow', keywords: ['caution', 'attention'] },
  { name: 'danger', label: 'Danger', icon: '⛔', color: 'red', keywords: ['error', 'important', 'critical'] },
  { name: 'note', label: 'Note', icon: '📝', color: 'gray', keywords: ['aside', 'remark'] },
] as const;

export type CalloutVariant = (typeof CALLOUT_VARIANTS)[number]['name'];

// Icons offered in the callout menu besides the variant defaults.
export const CALLOUT_ICONS = [
  'ℹ️', '💡', '⚠️', '⛔', '📝', '✅', '❌', '❓', '❗', '📌', '🔥', '⭐', '🚀', '🔒', '🔑', '📎',
  '📅', '🧪', '🐛', '💬', '📖', '🎯', '⚡', '🧠',
];

export interface CalloutAttributes {
  variant: CalloutVariant;
  // Emoji shown instead of the variant default; null = default.
  icon: string | null;
  // Palette colour name (see palette.ts) instead of the variant default; null = default.
  color: string | null;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      setCallout: (attributes?: Partial<CalloutAttributes>) => ReturnType;
      toggleCallout: (attributes?: Partial<CalloutAttributes>) => ReturnType;
      unsetCallout: () => ReturnType;
    };
  }
}

const LIST_TYPES = new Set(['bulletList', 'orderedList', 'taskList']);

const dataAttr = (htmlName: string, attr: string) => ({
  default: null,
  parseHTML: (el: HTMLElement) => el.getAttribute(htmlName),
  renderHTML: (attrs: Record<string, any>) => (attrs[attr] ? { [htmlName]: attrs[attr] } : {}),
});

// A coloured box with an icon around any blocks (paragraphs, lists, code, ...).
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      variant: {
        default: 'info',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-variant') ?? 'info',
        renderHTML: (attrs: Record<string, any>) => ({ 'data-variant': attrs.variant }),
      },
      icon: dataAttr('data-icon', 'icon'),
      color: dataAttr('data-color', 'color'),
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="callout"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-type': 'callout' }, HTMLAttributes), 0];
  },

  addCommands() {
    return {
      // Inside a list the paragraph cannot be wrapped (a list item must start with a
      // paragraph), so the whole outermost list around the cursor goes into the callout.
      setCallout: (attributes) => ({ commands, state, tr, dispatch }) => {
        if (commands.wrapIn(this.name, attributes)) return true;
        const { $from } = state.selection;
        for (let depth = 1; depth <= $from.depth; depth++) {
          if (!LIST_TYPES.has($from.node(depth).type.name)) continue;
          const range = new NodeRange(state.doc.resolve($from.before(depth)), state.doc.resolve($from.after(depth)), depth - 1);
          const wrapping = findWrapping(range, state.schema.nodes[this.name], attributes);
          if (!wrapping) return false;
          if (dispatch) tr.wrap(range, wrapping);
          return true;
        }
        return false;
      },
      toggleCallout: (attributes) => ({ commands }) => commands.toggleWrap(this.name, attributes),
      // Unwraps the innermost callout around the cursor, keeping all of its blocks.
      unsetCallout: () => ({ tr, dispatch }) => {
        const { $from } = tr.selection;
        for (let depth = $from.depth; depth > 0; depth--) {
          const node = $from.node(depth);
          if (node.type.name !== this.name) continue;
          const start = $from.start(depth);
          const range = new NodeRange(tr.doc.resolve(start), tr.doc.resolve(start + node.content.size), depth);
          const target = liftTarget(range);
          if (target == null) return false;
          if (dispatch) tr.lift(range, target);
          return true;
        }
        return false;
      },
    };
  },
});
