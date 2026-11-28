import { Extension } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';

// Collapsible headings, like the outline list: a heading with `foldable` gets an arrow that
// folds everything below it up to the next heading of the same or a higher level (in the
// same container). Stored in the document:
//  - heading.foldable: the heading can be folded (made with the slash menu),
//  - heading.collapsed: it is folded now.
// The folded blocks are only hidden (node decorations), they stay in the note.

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    headingFold: {
      // Turns the heading at the cursor into a collapsible one (or back into a plain heading).
      toggleHeadingFoldable: () => ReturnType;
    };
  }
}

const boolAttr = (htmlName: string, attr: string) => ({
  default: false,
  keepOnSplit: false,
  parseHTML: (el: HTMLElement) => el.getAttribute(htmlName) === 'true',
  renderHTML: (attrs: Record<string, any>) => (attrs[attr] ? { [htmlName]: 'true' } : {}),
});

// An open slash menu or [[ link picker (Tiptap Suggestion plugins) owns Enter.
export const suggestionOpen = (state: EditorState): boolean => state.plugins.some((p) =>
  /uggestion\$/.test((p as unknown as { key: string }).key) && !!(p.getState(state) as { active?: boolean } | undefined)?.active);

const isFolded = (node: PmNode) => node.type.name === 'heading' && !!node.attrs.foldable && !!node.attrs.collapsed;

// Whether `node` ends the section of a heading of `level` (a heading of the same or a higher level).
const endsSection = (node: PmNode, level: number) => node.type.name === 'heading' && Number(node.attrs.level) <= level;

// The range [from, to) of the blocks a folded heading at `pos` hides (from == to: nothing).
export const foldedRange = (doc: PmNode, pos: number): { from: number; to: number } => {
  const $pos = doc.resolve(pos);
  const parent = $pos.parent;
  const heading = parent.child($pos.index());
  const level = Number(heading.attrs.level);
  const from = pos + heading.nodeSize;
  let to = from;
  for (let i = $pos.index() + 1; i < parent.childCount; i++) {
    const child = parent.child(i);
    if (endsSection(child, level)) break;
    to += child.nodeSize;
  }
  return { from, to };
};

// Every range hidden by a folded heading.
const hiddenRanges = (doc: PmNode): { from: number; to: number }[] => {
  const ranges: { from: number; to: number }[] = [];
  doc.descendants((node, pos) => {
    // Blocks inside a hidden range need no second look.
    if (ranges.length && pos < ranges[ranges.length - 1].to) return false;
    if (isFolded(node)) {
      const range = foldedRange(doc, pos);
      if (range.to > range.from) ranges.push(range);
      return false;
    }
    return !node.isTextblock;
  });
  return ranges;
};

const LISTS = new Set(['bulletList', 'orderedList', 'taskList']);

// Opens every folded heading and outline item that hides `pos` (a search match, a jump to a
// place in the note). Returns whether anything opened.
export const revealPos = (tr: Transaction, pos: number): boolean => {
  const $pos = tr.doc.resolve(pos);
  const open: number[] = [];
  for (let d = 0; d < $pos.depth; d++) {
    const container = $pos.node(d);
    const index = $pos.index(d);
    // A folded item hides its nested lists, not its own paragraphs.
    if (d > 0 && container.type.name === 'listItem' && container.attrs.collapsed && LISTS.has(container.child(index).type.name)) open.push($pos.before(d));
    // Headings before the block, walking up: one hides it while every heading after it (the
    // block included) is of a lower level.
    const own = container.child(index);
    let lowest = own.type.name === 'heading' ? Number(own.attrs.level) : Infinity;
    for (let i = index - 1; i >= 0 && lowest > 1; i--) {
      const child = container.child(i);
      if (child.type.name !== 'heading') continue;
      const level = Number(child.attrs.level);
      if (level < lowest) {
        if (isFolded(child)) open.push($pos.posAtIndex(i, d));
        lowest = level;
      }
    }
  }
  for (const at of open) tr.setNodeMarkup(at, undefined, { ...tr.doc.nodeAt(at)!.attrs, collapsed: false });
  return open.length > 0;
};

// Meta on the transaction a fold arrow makes: the apps leave the scrolling alone (the phone
// brought the caret, often far away, back into view).
export const FOLD_TOGGLE = 'notedFoldToggle';

// Dispatches a fold toggle of the heading / list item at `pos` and keeps it where it was on
// the screen: text folding around it, or the browser's scroll anchoring, moved the page.
export const toggleInPlace = (view: EditorView, pos: number, tr: Transaction) => {
  // The frame below can come after the note was closed.
  const top = () => (view.isDestroyed ? null : (view.nodeDOM(pos) as Element | null)?.getBoundingClientRect?.().top ?? null);
  const before = top();
  view.dispatch(tr.setMeta(FOLD_TOGGLE, true));
  if (before === null) return;
  let scroller: Element | null = view.dom.parentElement;
  while (scroller && !(/(auto|scroll)/.test(getComputedStyle(scroller).overflowY) && scroller.scrollHeight > scroller.clientHeight)) scroller = scroller.parentElement;
  const target = scroller ?? document.scrollingElement;
  const keep = () => {
    const now = top();
    if (target && now !== null && Math.abs(now - before) >= 1) target.scrollTop += now - before;
  };
  keep();
  requestAnimationFrame(keep);
};

// A block inserted from a folded heading (slash menu, the phone's "+" sheet) goes to the end of
// its section, which opens: in the heading it landed hidden at the section's start, or turned
// the heading itself into the block. Returns the range the insert should use; when a section was
// opened, also `cancel`, which folds it again and removes the empty line it added (a file picker
// closed without a choice), unless the note changed since.
export const openFoldForInsert = (editor: { state: EditorState; view: EditorView }, range: { from: number; to: number }): { from: number; to: number; cancel?: () => void } => {
  const { state } = editor;
  const $from = state.doc.resolve(range.from);
  if (!isFolded($from.parent)) return range;
  const pos = $from.before();
  // The space typed before "/" at the heading's end goes too (the block goes elsewhere).
  let start = range.from;
  if (range.to > range.from && range.to === $from.end()) while (start > $from.start() && state.doc.textBetween(start - 1, start) === ' ') start--;
  const tr = state.tr.delete(start, range.to);
  tr.setNodeMarkup(pos, undefined, { ...tr.doc.nodeAt(pos)!.attrs, collapsed: false });
  const opened = [pos];
  const { from, to } = foldedRange(tr.doc, pos);
  // A folded sub-heading whose section also ends there opens too (the block would be hidden).
  tr.doc.nodesBetween(from, to, (node, at) => {
    if (isFolded(node) && foldedRange(tr.doc, at).to === to) {
      tr.setNodeMarkup(at, undefined, { ...node.attrs, collapsed: false });
      opened.push(at);
    }
    return false;
  });
  // An empty line already ending the section is used, not left above the new block.
  const last = to > from ? tr.doc.resolve(to).nodeBefore : null;
  let at = to + 1;
  const added = !(last?.type.name === 'paragraph' && !last.content.size);
  if (!added) at = to - 1;
  else tr.insert(to, state.schema.nodes.paragraph.create());
  editor.view.dispatch(tr.setSelection(TextSelection.create(tr.doc, at)));
  const after = editor.view.state.doc;
  const cancel = () => {
    if (editor.view.isDestroyed || !editor.view.state.doc.eq(after)) return;
    const undo = editor.view.state.tr;
    if (added) undo.delete(to, to + 2);
    for (const p of opened) undo.setNodeMarkup(p, undefined, { ...undo.doc.nodeAt(p)!.attrs, collapsed: true });
    editor.view.dispatch(undo.setSelection(TextSelection.create(undo.doc, start)));
  };
  return { from: at, to: at, cancel };
};

const foldKey = new PluginKey<DecorationSet>('headingFold');

const decorate = (state: EditorState): DecorationSet => {
  const { doc } = state;
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'heading' || !node.attrs.foldable) return !node.isTextblock;
    const collapsed = !!node.attrs.collapsed;
    decorations.push(Decoration.widget(pos + 1, (view) => {
      const button = document.createElement('span');
      button.className = 'heading-toggle';
      button.contentEditable = 'false';
      button.dataset.collapsed = String(collapsed);
      button.addEventListener('mousedown', (event) => {
        event.preventDefault();
        const current = view.state.doc.nodeAt(pos);
        if (!current || current.type.name !== 'heading') return;
        const tr = view.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, collapsed: !current.attrs.collapsed });
        // Folding the text the cursor is in moves the cursor to the end of the heading.
        if (!current.attrs.collapsed) {
          const { from, to } = foldedRange(tr.doc, pos);
          const { selection } = tr;
          if (selection.to > from && selection.from < to) tr.setSelection(TextSelection.create(tr.doc, pos + current.nodeSize - 1));
        }
        toggleInPlace(view, pos, tr);
      });
      return button;
    }, { side: -1, key: `heading-fold-${pos}-${collapsed}` }));
    return false;
  });
  for (const { from, to } of hiddenRanges(doc)) {
    doc.nodesBetween(from, to, (node, pos) => {
      if (pos >= from && pos + node.nodeSize <= to) decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'heading-folded' }));
      return false;
    });
  }
  return DecorationSet.create(doc, decorations);
};

export const HeadingFold = Extension.create({
  name: 'headingFold',

  addGlobalAttributes() {
    return [{
      types: ['heading'],
      attributes: {
        foldable: boolAttr('data-foldable', 'foldable'),
        collapsed: boolAttr('data-collapsed', 'collapsed'),
      },
    }];
  },

  addCommands() {
    return {
      toggleHeadingFoldable: () => ({ tr, dispatch }) => {
        const { $from } = tr.selection;
        if ($from.parent.type.name !== 'heading') return false;
        const pos = $from.before();
        const on = !$from.parent.attrs.foldable;
        if (dispatch) tr.setNodeMarkup(pos, undefined, { ...$from.parent.attrs, foldable: on, collapsed: false });
        return true;
      },
    };
  },

  addKeyboardShortcuts() {
    return {
      // Enter at the end of a folded heading: the fold stays closed and a new empty heading of
      // the same level starts after the whole section (a paragraph there would belong to the
      // section, everything up to the next heading does, and be hidden).
      Enter: ({ editor }) => {
        const { state, view } = editor;
        const { selection } = state;
        const { $from } = selection;
        if (!selection.empty || !isFolded($from.parent) || $from.parentOffset !== $from.parent.content.size || suggestionOpen(state)) return false;
        const { to } = foldedRange(state.doc, $from.before());
        const $to = state.doc.resolve(to);
        const heading = $from.parent.type;
        if (!$to.parent.canReplaceWith($to.index(), $to.index(), heading)) {
          // No room for a heading there: open the fold and start a line under the heading.
          const pos = $from.before();
          const after = pos + $from.parent.nodeSize;
          const tr = state.tr.setNodeMarkup(pos, undefined, { ...$from.parent.attrs, collapsed: false }).insert(after, state.schema.nodes.paragraph.create());
          view.dispatch(tr.setSelection(TextSelection.create(tr.doc, after + 1)).scrollIntoView());
          return true;
        }
        // Same level and alignment, but a plain heading (not foldable).
        const tr = state.tr.insert(to, heading.create({ ...$from.parent.attrs, foldable: false, collapsed: false }));
        view.dispatch(tr.setSelection(TextSelection.create(tr.doc, to + 1)).scrollIntoView());
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    return [new Plugin({
      key: foldKey,
      state: {
        init: (_, state) => decorate(state),
        apply: (tr, old, _, state) => (tr.docChanged ? decorate(state) : old),
      },
      props: {
        decorations: (state) => foldKey.getState(state),
      },
    })];
  },
});

// A rendered copy of the note for print / PDF shows everything: folded headings and outline
// list items are opened (a folded section would be missing from the paper).
export const unfoldRenderedCopy = (root: HTMLElement) => {
  root.querySelectorAll('.heading-folded').forEach((el) => el.classList.remove('heading-folded'));
  root.querySelectorAll('[data-collapsed="true"]').forEach((el) => el.removeAttribute('data-collapsed'));
};

// Lines of code that fit on a page with the title: longer code blocks may split (content.css).
const PAGE_LINES = 45;

// A rendered copy of the note (the .ProseMirror element) made ready for paper: unfolded, the
// paper styles on (content.css) and long code blocks marked.
export const markPrintCopy = (root: HTMLElement) => {
  unfoldRenderedCopy(root);
  root.classList.add('print-copy');
  // Nothing of the moment it was copied: selected blocks (a page break's outline drew lines
  // across the paper), cells, a whole-note selection, search matches.
  const passing = ['ProseMirror-selectednode', 'selectedCell', 'has-all-selection', 'all-selected-text', 'all-selected-node', 'search-match', 'search-match-current', 'ProseMirror-focused'];
  for (const name of passing) {
    if (root.classList.contains(name)) root.classList.remove(name);
    root.querySelectorAll(`.${name}`).forEach((el) => el.classList.remove(name));
  }
  // A tick is a property of the box: copied as HTML (the phone's PDF page) it was lost.
  root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((box) => box.toggleAttribute('checked', box.checked));
  root.querySelectorAll('.code-block').forEach((block) => {
    if ((block.querySelector('pre')?.textContent ?? '').split('\n').length > PAGE_LINES) block.classList.add('code-block-long');
  });
};
