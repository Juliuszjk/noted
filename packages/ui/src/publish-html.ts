// The copy of a note that gets published (sync/publish.ts): the editor's rendered DOM (so math,
// note link titles and decrypted images look the same) and only the CSS rules the note needs.
// Plain DOM code: used by the desktop app and by the mobile editor page.

import { isReminderRepeat, reminderDateLabel } from '@noted/editor/reminder-time';

const NOTE_RULE = /ProseMirror|katex|note-title|data-note-font|tableWrapper|data-type|search-match|reminder-chip/;

const toDataUrl = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});

const fetchDataUrl = async (url: string): Promise<string | null> => {
  try {
    const res = await fetch(url);
    return res.ok ? await toDataUrl(await res.blob()) : null;
  } catch {
    return null;
  }
};

// CSS of the note: content.css, KaTeX, the palette and font variables. Fonts are inlined
// (the published page loads nothing from anywhere else).
const noteCss = async (): Promise<string> => {
  const out: string[] = [];
  const fonts: Promise<string>[] = [];
  const visit = (rules: CSSRuleList, base: string) => {
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSStyleRule) {
        if (rule.selectorText === ':root' || NOTE_RULE.test(rule.selectorText)) out.push(rule.cssText);
      } else if (rule instanceof CSSMediaRule) {
        const inner: string[] = [];
        for (const r of Array.from(rule.cssRules)) if (r instanceof CSSStyleRule && NOTE_RULE.test(r.selectorText)) inner.push(r.cssText);
        if (inner.length) out.push(`@media ${rule.conditionText} { ${inner.join(' ')} }`);
      } else if (rule instanceof CSSFontFaceRule) {
        const text = rule.cssText;
        fonts.push((async () => {
          let result = text;
          for (const match of text.matchAll(/url\(["']?([^"')]+\.woff2)["']?\)/g)) {
            if (match[1].startsWith('data:')) continue;
            const data = await fetchDataUrl(new URL(match[1], base).href);
            if (data) result = result.replace(match[0], `url("${data}")`);
          }
          return result;
        })());
      }
    }
  };
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      visit(sheet.cssRules, sheet.href ?? document.baseURI);
    } catch {
      // A stylesheet from another origin cannot be read; the note does not need it.
    }
  }
  return [...(await Promise.all(fonts)), ...out].join('\n');
};

export const buildPublishedNote = async (editorDom: HTMLElement): Promise<{ html: string; css: string }> => {
  const clone = editorDom.cloneNode(true) as HTMLElement;
  clone.removeAttribute('contenteditable');
  clone.querySelectorAll('[contenteditable]').forEach((el) => el.removeAttribute('contenteditable'));
  // Editing helpers that make no sense on a read-only page, and other people's cursors and
  // selections in a live note (published as a copy again, they stayed highlighted).
  clone.querySelectorAll('.image-node button, .ProseMirror-separator, .search-match, .drawing-paper, .drawing-cut, .drawing-eraser, .drawing-lasso, .drawing-selection, .drawing-handle, .drawing-actions, .collaboration-carets__caret, .collaboration-carets__selection').forEach((el) => {
    if (el.classList.contains('search-match') || el.classList.contains('collaboration-carets__selection')) el.replaceWith(...Array.from(el.childNodes));
    else el.remove();
  });
  clone.querySelectorAll('.is-empty').forEach((el) => el.classList.remove('is-empty', 'is-editor-empty'));
  // Reminder chips: a full date ("Tomorrow" and "overdue" would go stale on the page).
  clone.querySelectorAll<HTMLElement>('[data-reminder]').forEach((chip) => {
    const at = Number(chip.getAttribute('data-at')) || 0;
    const repeat = chip.getAttribute('data-repeat');
    const done = chip.hasAttribute('data-done');
    chip.className = `reminder-chip${done ? ' reminder-chip--done' : ''}`;
    chip.removeAttribute('title');
    const label = chip.querySelector('span');
    if (label) label.textContent = reminderDateLabel({ at, repeat: isReminderRepeat(repeat) ? repeat : null, done });
  });
  // Decrypted images are object URLs of this page: put the bytes into the copy.
  await Promise.all(Array.from(clone.querySelectorAll('img')).map(async (img) => {
    const src = img.getAttribute('src') ?? '';
    if (src.startsWith('blob:')) {
      const data = await fetchDataUrl(src);
      if (data) img.setAttribute('src', data); else img.remove();
    } else if (!src.startsWith('data:')) img.remove();
  }));
  const wrapper = document.createElement('div');
  wrapper.className = 'ProseMirror';
  wrapper.innerHTML = clone.innerHTML;
  return { html: wrapper.outerHTML, css: await noteCss() };
};

const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

// Colours of an exported HTML file: light, or dark when the reader's system is dark (like the
// published note viewer).
const FILE_THEME = `
  :root { color-scheme: light dark; --text-main: #1b1b1f; --text-muted: #5f5f66; --bg-base: #ffffff; --bg-surface: #f3f3f5;
    --bg-surface-low: #f7f7f9; --bg-surface-high: #ececef; --bg-surface-highest: #e4e4e8; --border: #cfcfd6; --border-focus: #9a9aa3;
    --primary: #6750a4; --primary-fg: #ffffff; --secondary-container: #e8def8; --on-secondary-container: #1d192b; --error: #b3261e; }
  @media (prefers-color-scheme: dark) {
    :root { --text-main: #e6e0e9; --text-muted: #a6a0aa; --bg-base: #141218; --bg-surface: #211f26; --bg-surface-low: #1d1b20;
      --bg-surface-high: #2b2930; --bg-surface-highest: #36343b; --border: #49454f; --border-focus: #79747e; --primary: #d0bcff;
      --primary-fg: #381e72; --secondary-container: #4a4458; --on-secondary-container: #e8def8; --error: #f2b8b5; }
  }
  html, body { margin: 0; background: var(--bg-base); color: var(--text-main); }
  body { font-family: var(--font-sans, system-ui, sans-serif); }
  article { max-width: 760px; margin: 0 auto; padding: 32px 20px 64px; }
  .export-title { font-size: 2em; font-weight: 700; margin: 0 0 24px; line-height: 1.25; }
  .ProseMirror { outline: none; }
  .ProseMirror img { max-width: 100%; height: auto; }
  .ProseMirror input[type=checkbox] { pointer-events: none; }
  .ProseMirror .code-block-lang { pointer-events: none; }
  @media print { .ProseMirror .code-block-bar { display: none; } }
`;

// The file's own script: folding headings and outline lists (heading-fold.ts and the outline
// list in the editor) and the code blocks' Copy button.
const FILE_SCRIPT = `
(() => {
  const level = (el) => Number((/^H([1-6])$/.exec(el.tagName) || [])[1] || 0);
  const refold = () => {
    document.querySelectorAll('.heading-folded').forEach((el) => el.classList.remove('heading-folded'));
    document.querySelectorAll('[data-foldable="true"][data-collapsed="true"]').forEach((heading) => {
      const own = level(heading);
      for (let next = heading.nextElementSibling; next; next = next.nextElementSibling) {
        const l = level(next);
        if (l && l <= own) break;
        next.classList.add('heading-folded');
      }
    });
  };
  const flip = (holder, toggle) => {
    const collapsed = holder.getAttribute('data-collapsed') !== 'true';
    if (collapsed) holder.setAttribute('data-collapsed', 'true'); else holder.removeAttribute('data-collapsed');
    toggle.dataset.collapsed = String(collapsed);
  };
  document.addEventListener('click', (e) => {
    const toggle = e.target.closest('.heading-toggle, .outline-toggle, .code-block-copy');
    if (!toggle) return;
    if (toggle.classList.contains('heading-toggle')) {
      const heading = toggle.closest('[data-foldable="true"]');
      if (heading) { flip(heading, toggle); refold(); }
    } else if (toggle.classList.contains('outline-toggle')) {
      const item = toggle.closest('li');
      if (item) flip(item, toggle);
    } else {
      const code = toggle.closest('.code-block')?.querySelector('pre');
      if (!code) return;
      navigator.clipboard.writeText(code.textContent || '').then(() => { toggle.textContent = 'Copied'; }, () => { toggle.textContent = 'Copy failed'; });
      setTimeout(() => { toggle.textContent = 'Copy'; }, 1500);
    }
  });
})();
`;

// "Export > HTML": the note as one file that looks like it does in the app (the same copy as
// a published note: styles, fonts and images inside), readable anywhere without Noted.
export const buildNoteHtmlFile = async (editorDom: HTMLElement, title: string, font: string | null): Promise<string> => {
  const { html, css } = await buildPublishedNote(editorDom);
  const name = escapeHtml(title.trim() || 'Untitled');
  return `<!doctype html>\n<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">`
    + `<title>${name}</title><style>${css.replace(/<\/style/gi, '')}</style><style>${FILE_THEME}</style></head>`
    + `<body${font ? ` data-note-font="${escapeHtml(font)}"` : ''}><article><div class="export-title note-title">${name}</div>`
    + `${html}</article><script>${FILE_SCRIPT}</script></body></html>\n`;
};
