import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { marked } from 'marked';

// Pasting text written in Markdown (from a chat, a README, an AI answer, ...) gives the
// formatted note at once: headings, lists, task lists, tables, quotes, code blocks, links,
// formulas ($…$, $$…$$, \(…\), \[…\]) and "> [!NOTE]" callouts.
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
// task list, or two kinds of other marks (lists, quotes, **bold**, [links](...), formulas).
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
    /\$[^$\s][^$\n]*\$|\\\(.+?\\\)/.test(text),
  ].filter(Boolean).length;
  return kinds >= 2;
};

const CALLOUT_VARIANTS: Record<string, string> = { NOTE: 'info', INFO: 'info', TIP: 'tip', IMPORTANT: 'info', WARNING: 'warning', CAUTION: 'danger', DANGER: 'danger' };

const escapeAttr = (text: string) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

const blockMath = (latex: string) => `<div data-type="block-math" data-latex="${escapeAttr(latex.trim())}"></div>`;
const inlineMath = (latex: string) => `<span data-type="inline-math" data-latex="${escapeAttr(latex.trim())}"></span>`;

// Outside code: $$…$$ / \[…\] blocks and $…$ / \(…\) / ==…== inline become the HTML the
// editor reads, before Markdown sees them (it took the backslashes of \{ \, \_ as escapes).
// A quote's "> " stays in front of a formula line.
export const markdownMath = (md: string): string => {
  const out: string[] = [];
  const lines = md.split(/\r?\n/);
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const open = /^\s*(```|~~~)/.exec(line);
    if (fence) {
      out.push(line);
      if (open && line.trim().startsWith(fence)) fence = null;
      continue;
    }
    if (open) {
      fence = open[1];
      out.push(line);
      continue;
    }
    const quote = /^(\s*(?:>\s?)*)/.exec(line)![1];
    const body = line.slice(quote.length).trim();
    const close = body === '$$' ? '$$' : body === '\\[' ? '\\]' : null;
    if (close) {
      const end = lines.findIndex((l, j) => j > i && l.slice(quote.length).trim() === close);
      if (end > i) {
        out.push(quote + blockMath(lines.slice(i + 1, end).map((l) => l.slice(quote.length)).join('\n')));
        i = end;
        continue;
      }
    }
    const single = /^\$\$(.+)\$\$$/.exec(body) ?? /^\\\[(.+)\\\]$/.exec(body);
    if (single) {
      out.push(quote + blockMath(single[1]));
      continue;
    }
    // Inline code keeps its dollars and equals signs.
    out.push(line.split(/(`[^`]*`)/).map((part, k) => (k % 2 ? part : part
      .replace(/\\\((.+?)\\\)/g, (_, latex) => inlineMath(latex))
      .replace(/(^|[^\\$])\$(?![\s$])([^$\n]+?)(?<![\s\\])\$(?!\d)/g, (_, pre, latex) => `${pre}${inlineMath(latex)}`)
      .replace(/==(?=\S)([^=\n]+?)(?<=\S)==/g, '<mark>$1</mark>'))).join(''));
  }
  return out.join('\n');
};

// GitHub alerts ("> [!NOTE]") as callouts.
const callouts = (html: string): string => {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  for (const quote of [...doc.querySelectorAll('blockquote')]) {
    const first = quote.firstElementChild;
    const m = first?.tagName === 'P' ? /^\s*\[!(\w+)\]\s*/.exec(first.innerHTML) : null;
    if (!m || !CALLOUT_VARIANTS[m[1].toUpperCase()]) continue;
    first!.innerHTML = first!.innerHTML.slice(m[0].length);
    if (!first!.textContent?.trim() && !first!.querySelector('*')) first!.remove();
    const box = doc.createElement('div');
    box.setAttribute('data-type', 'callout');
    box.setAttribute('data-variant', CALLOUT_VARIANTS[m[1].toUpperCase()]);
    box.innerHTML = quote.innerHTML;
    quote.replaceWith(box);
  }
  return doc.body.innerHTML;
};

// Formulas written for Markdown ($…$, $$…$$, \(…\), \[…\]) outside inline code.
export const hasMarkdownMath = (text: string): boolean =>
  /(^|[^\\$])\$(?![\s$])[^$\n]+?(?<![\s\\])\$(?!\d)|\\\(.+?\\\)|^\s*(\$\$|\\\[)/m.test(text.replace(/`[^`\n]*`/g, ''));

// Formulas a page rendered with KaTeX or MathML (copied from an AI chat, Wikipedia, ...) keep
// their LaTeX source in an <annotation>: they paste as the editor's math nodes.
export const pastedMathHtml = (html: string): string => {
  if (!/<annotation[^>]*application\/x-tex/i.test(html)) return html;
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const formulas = [...doc.querySelectorAll('.katex-display, .katex, math')].filter((el) => !el.parentElement?.closest('.katex-display, .katex, math'));
  for (const el of formulas) {
    const latex = el.querySelector('annotation[encoding="application/x-tex"]')?.textContent?.trim();
    if (!latex) continue;
    const block = el.classList.contains('katex-display') || el.getAttribute('display') === 'block';
    const node = doc.createElement(block ? 'div' : 'span');
    node.setAttribute('data-type', block ? 'block-math' : 'inline-math');
    node.setAttribute('data-latex', latex);
    el.replaceWith(node);
  }
  return doc.body.innerHTML;
};

export const markdownToHtml = (md: string): string =>
  callouts(normalizeTaskListHtml(marked.parse(markdownMath(md), { gfm: true, breaks: false, async: false }) as string));

export const MarkdownPaste = Extension.create({
  name: 'markdownPaste',
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [new Plugin({
      key: new PluginKey('markdownPaste'),
      props: {
        transformPastedHTML: pastedMathHtml,
        handlePaste(view, event) {
          const data = event.clipboardData;
          if (!data || (view as unknown as { input?: { shiftKey?: boolean } }).input?.shiftKey) return false;
          const text = data.getData('text/plain');
          const html = data.getData('text/html');
          // Rich pastes (web pages, apps) keep their own formatting; plain HTML wrappers (code
          // editors, terminals) do not count. Except Markdown with formulas whose HTML has no
          // rendered math (an AI chat's Copy button): that HTML came from a Markdown renderer
          // that knew no math and ate the LaTeX backslashes.
          const rich = !!html && /<(h[1-6]|ul|ol|li|table|blockquote|strong|em|b|i|a|img)\b/i.test(html);
          const mathLost = rich && hasMarkdownMath(text) && !/class="[^"]*katex|<math\b/i.test(html);
          if (!text || (rich && !mathLost)) return false;
          if (view.state.selection.$from.parent.type.spec.code || !looksLikeMarkdown(text)) return false;
          editor.chain().insertContent(markdownToHtml(text), { parseOptions: { preserveWhitespace: false } }).run();
          return true;
        },
      },
    })];
  },
});
