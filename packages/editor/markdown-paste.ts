import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { marked } from 'marked';

// Pasting text written in Markdown (from a chat, a README, an AI answer, ...) gives the
// formatted note at once: headings, lists, task lists, tables, quotes, code blocks, links.
// Text that does not look like Markdown, pastes with HTML (from web pages and apps) and
// pastes into a code block stay as they are; Ctrl+Shift+V always pastes plain text.

// Task lists from other apps' HTML (GitHub-style checkboxes, Notesnook's checklists) as the
// editor's task list markup. Also used by the importer.
export const normalizeTaskListHtml = (html: string): string => {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const isChecklist = (ul: Element | null) => !!ul && (/checklist/i.test(ul.getAttribute('class') ?? '') || /^(taskList|checkList)$/i.test(ul.getAttribute('data-type') ?? ''));
  doc.querySelectorAll('li').forEach((li) => {
    const box = li.querySelector(':scope > input[type=checkbox], :scope > p > input[type=checkbox], :scope > label > input[type=checkbox], :scope > div > input[type=checkbox]');
    if (!box && !isChecklist(li.parentElement)) return;
    const checked = box ? (box as HTMLInputElement).hasAttribute('checked') : /\bchecked\b/.test(li.getAttribute('class') ?? '') || li.getAttribute('data-checked') === 'true';
    // Checkbox inputs and their labels / wrappers carry no text.
    li.querySelectorAll(':scope > input[type=checkbox], :scope > p > input[type=checkbox], :scope > label, :scope > div > input[type=checkbox]').forEach((el) => {
      if (el.tagName === 'LABEL' && el.textContent?.trim()) return;
      el.remove();
    });
    li.setAttribute('data-type', 'taskItem');
    li.setAttribute('data-checked', String(checked));
    if (!li.querySelector(':scope > p')) {
      const p = doc.createElement('p');
      while (li.firstChild && !(li.firstChild instanceof HTMLUListElement || li.firstChild instanceof HTMLOListElement)) p.appendChild(li.firstChild);
      li.insertBefore(p, li.firstChild);
    }
    li.parentElement?.setAttribute('data-type', 'taskList');
  });
  doc.querySelectorAll('script, style, iframe, object, embed').forEach((el) => el.remove());
  // An empty line written as <p><br></p> (Notesnook, browsers) is one empty paragraph, not two lines.
  doc.querySelectorAll('p').forEach((p) => { if (p.childNodes.length === 1 && p.firstChild?.nodeName === 'BR') p.firstChild.remove(); });
  return doc.body.innerHTML;
};

// Enough Markdown in the text to be meant as Markdown: a heading, a code fence, a table or a
// task list, or two kinds of other marks (lists, quotes, **bold**, [links](...)).
export const looksLikeMarkdown = (text: string): boolean => {
  const lines = text.split(/\r?\n/);
  if (lines.length < 2 && !/\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)/.test(text)) return false;
  const has = (re: RegExp, min = 1) => lines.filter((l) => re.test(l)).length >= min;
  if (has(/^#{1,6}\s+\S/) || has(/^\s*(```|~~~)/) || has(/^\s*[-*+]\s+\[[ xX]\]\s/)) return true;
  if (has(/^\s*\|.*\|\s*$/, 2) && has(/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/)) return true;
  const kinds = [
    has(/^\s*[-*+]\s+\S/, 2),
    has(/^\s*\d+[.)]\s+\S/, 2),
    has(/^\s*>\s?\S/),
    /\*\*[^*\n]+\*\*|__[^_\n]+__/.test(text),
    /\[[^\]\n]+\]\((https?:\/\/|mailto:)[^)\s]+\)/.test(text),
    has(/^\s*([-*_])(\s*\1){2,}\s*$/),
    /`[^`\n]+`/.test(text),
  ].filter(Boolean).length;
  return kinds >= 2;
};

export const markdownToHtml = (md: string): string => normalizeTaskListHtml(marked.parse(md, { gfm: true, breaks: false, async: false }) as string);

export const MarkdownPaste = Extension.create({
  name: 'markdownPaste',
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [new Plugin({
      key: new PluginKey('markdownPaste'),
      props: {
        handlePaste(view, event) {
          const data = event.clipboardData;
          if (!data || (view as unknown as { input?: { shiftKey?: boolean } }).input?.shiftKey) return false;
          const text = data.getData('text/plain');
          const html = data.getData('text/html');
          // Rich pastes (web pages, apps) keep their own formatting; plain HTML wrappers (code
          // editors, terminals) do not count.
          if (!text || (html && /<(h[1-6]|ul|ol|li|table|blockquote|strong|em|b|i|a|img)\b/i.test(html))) return false;
          if (view.state.selection.$from.parent.type.spec.code || !looksLikeMarkdown(text)) return false;
          editor.chain().insertContent(markdownToHtml(text), { parseOptions: { preserveWhitespace: false } }).run();
          return true;
        },
      },
    })];
  },
});
