import { Node, mergeAttributes } from '@tiptap/core';

// "/page break" ("/pg"): the PDF (pdf-sheets.ts) starts a new page here. The editor shows a
// dashed line; exported Markdown, text and HTML files and published pages leave it out.

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pageBreak: {
      insertPageBreak: () => ReturnType;
    };
  }
}

export const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  parseHTML() {
    return [{ tag: 'div[data-type="page-break"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'page-break', class: 'page-break' }), ['span', 'Page break']];
  },

  addCommands() {
    return {
      // A line to write on follows, unless the note goes on below already.
      insertPageBreak: () => ({ chain, state }) => {
        const { $to } = state.selection;
        const last = $to.depth > 0 && $to.indexAfter(1) >= state.doc.childCount;
        return chain().insertContent(last ? [{ type: this.name }, { type: 'paragraph' }] : { type: this.name }).run();
      },
    };
  },
});
