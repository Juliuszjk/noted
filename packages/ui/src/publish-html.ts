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
