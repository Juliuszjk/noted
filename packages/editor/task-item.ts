import { TaskItem } from '@tiptap/extension-list';

// Tiptap's task item node view rewrites a hidden accessibility label next to the checkbox
// (and the item's attributes) on every keystroke inside the item. ProseMirror then re-reads
// the DOM and the IME on Android restarts: keyboards started capitalising words in the middle
// of a sentence. Changes outside the item's content are ignored here; the label text is hidden
// from the text by content.css (the checkbox keeps its aria-label).
export const QuietTaskItem = TaskItem.extend({
  addNodeView() {
    const create = this.parent?.();
    if (!create) return null;
    return (props) => {
      const view = create(props);
      const content = view.contentDOM;
      return {
        ...view,
        ignoreMutation: (mutation) => {
          if (mutation.type === 'selection') return false;
          return !content || !content.contains(mutation.target);
        },
      };
    };
  },
});
