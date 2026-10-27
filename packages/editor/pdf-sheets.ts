import type { Editor } from '@tiptap/core';
import { markPrintCopy } from './heading-fold';
import { paginate } from './print-pages';
import { PAPER_MONO, PAPER_SANS, paperFontFaces } from './pdf-fonts';

// A note on A4 sheets, laid out by the app: the PDF preview shows them and printing (Save PDF,
// Export > PDF) prints the very same sheets, one per page, so the paper looks like the preview.
// The note is copied once at the text width and measured (print-pages.ts finds where pages
// begin); each sheet shows its slice of a copy of that layout.
//
// Units: WebKitGTK (the Linux app) lays a printed page out at 1.25 CSS px per point of paper
// (measured: printed text came out 96 / 72 / 1.25 = 1.067 times its screen size), so the sheets
// use that scale everywhere (the same layout, and pages, on every device) and print 1:1 there.
// It ignores @page margins and keeps the print dialog's (GTK default 6.35 mm, also set by the
// app's own Save PDF, print_pdf in lib.rs): a printed sheet is the paper minus those, its
// padding makes up the rest of the 16 mm margin. Chromium (Windows, the phone, browsers) takes
// `@page { margin: 0 }` and prints 96 px per inch (A4 = 794 px wide): the sheets are zoomed by
// 96 / 90. Android's printing (expo-print) lays the page out at a width of its own: print media
// queries on the page width zoom the sheets to it there (desktop Chromium answers them with a
// width that ignores the @page margins, 740 px, so they are Android's only).

const ANDROID = typeof navigator !== 'undefined' && /Android/.test(navigator.userAgent);
const WEBKIT_GTK = typeof navigator !== 'undefined' && /AppleWebKit/.test(navigator.userAgent) && !/Chrome|Chromium|Edg|Android/.test(navigator.userAgent);
const MM = (72 / 25.4) * 1.25;
const PAPER_W = 210 * MM;
const PAPER_H = 297 * MM;
const MARGIN = 16 * MM;
const DIALOG_MARGIN = WEBKIT_GTK ? 6.35 * MM : 0;
const TEXT_W = PAPER_W - 2 * MARGIN;
const TEXT_H = PAPER_H - 2 * MARGIN;
export const SHEET_WIDTH = PAPER_W;
export const SHEET_HEIGHT = PAPER_H;

// Chromium: one rule per 4 px of printed page width (300 to 4000 px), each zooming the sheets
// to fill it (CSS cannot divide the page width by the sheet's).
const pageZoom = (): string => {
  const rules: string[] = [];
  for (let width = 300; width <= 4000; width += 4) {
    rules.push(`@media print and (min-width: ${width}px) { #noted-print { zoom: ${(width / PAPER_W).toFixed(4)}; } }`);
  }
  return rules.join('\n');
};

const STYLE_ID = 'noted-pdf-sheets-style';
export const ensureSheetStyles = () => {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    ${paperFontFaces()}
    /* The same type on every device: the paper's own fonts and size, never the device's editor
       settings (font size, system fonts). */
    .pdf-flow { width: ${TEXT_W}px; color: #1b1b1f; line-height: normal;
      font-size: calc(16px / var(--paper-text-zoom, 1)); --editor-font-size: calc(16px / var(--paper-text-zoom, 1));
      --font-sans: '${PAPER_SANS}', sans-serif; --font-mono: '${PAPER_MONO}', monospace;
      --editor-font: var(--font-sans); font-family: var(--font-sans);
      -webkit-text-size-adjust: none; text-size-adjust: none;
      --text-main: #1b1b1f; --text-muted: #5f5f66; --bg-base: #fff; --bg-surface: #f3f3f5; --bg-surface-low: #f7f7f9;
      --bg-surface-high: #ececef; --bg-surface-highest: #e4e4e8; --border: #cfcfd6; --primary: #6750a4; }
    .pdf-flow .ProseMirror { color: #1b1b1f; outline: none; min-height: 0; font-size: inherit !important; }
    .pdf-flow .ProseMirror code, .pdf-flow .ProseMirror pre { font-family: var(--font-mono); }
    .pdf-flow .note-title { font-size: 1.9em; font-weight: 700; margin: 0 0 16px; }
    .pdf-measure { position: fixed; left: -100000px; top: 0; visibility: hidden; pointer-events: none; }
    .pdf-sheet { box-sizing: border-box; width: ${PAPER_W}px; height: ${PAPER_H}px; padding: ${MARGIN}px; background: #fff; overflow: hidden; }
    /* Inline block: the print engine paginated the hidden rest of the copy inside a plain block
       (and shifted what shows); an inline block stays one piece. */
    .pdf-sheet-body { overflow: hidden; display: inline-block; width: 100%; vertical-align: top; }
    #noted-print { display: none; }
    ${WEBKIT_GTK ? '' : ANDROID ? pageZoom() : `@media print { #noted-print { zoom: ${(96 / 25.4 / MM).toFixed(5)}; } }`}
    @media print {
      ${WEBKIT_GTK ? '' : '@page { size: A4; margin: 0; }'}
      html, body { background: #fff !important; height: auto !important; overflow: visible !important; margin: 0 !important; }
      body > *:not(#noted-print) { display: none !important; }
      #noted-print { display: block; }
      #noted-print .pdf-sheet { transform: none !important; width: ${PAPER_W - 2 * DIALOG_MARGIN}px; height: ${PAPER_H - 2 * DIALOG_MARGIN - 2}px;
        padding: ${MARGIN - DIALOG_MARGIN}px; break-after: page; page-break-after: always; box-shadow: none; margin: 0; }
      #noted-print .pdf-sheet:last-child { break-after: auto; page-break-after: auto; }
    }`;
  document.head.append(style);
};

const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

// How much bigger than its CSS size this page draws text: Android's WebView follows the system
// font size (text zoom), widths stay. The paper undoes it (--paper-text-zoom), or the phone laid
// the note out in smaller type than the computer and broke lines and pages elsewhere.
export const textZoom = (): number => {
  const probe = document.createElement('div');
  probe.style.cssText = 'position: fixed; left: -100000px; top: 0; visibility: hidden; font: 100px/1 sans-serif; -webkit-text-size-adjust: none; text-size-adjust: none;';
  probe.textContent = 'X';
  document.body.append(probe);
  const zoom = probe.getBoundingClientRect().height / 100;
  probe.remove();
  return zoom > 0.3 && zoom < 3 ? zoom : 1;
};

// The note as it goes on paper: title + an unfolded copy of the editor's content. The phone
// sends it (as HTML) to its PDF page, which lays it out without the system's text zoom.
export const noteFlow = (editor: Editor, title: string, noteFont: string | null): HTMLElement => {
  const flow = document.createElement('div');
  flow.className = 'pdf-flow';
  flow.style.setProperty('--paper-text-zoom', String(textZoom()));
  if (noteFont) flow.setAttribute('data-note-font', noteFont);
  const clone = editor.view.dom.cloneNode(true) as HTMLElement;
  clone.removeAttribute('contenteditable');
  clone.querySelectorAll('[contenteditable]').forEach((el) => el.removeAttribute('contenteditable'));
  clone.querySelectorAll('.is-empty').forEach((el) => el.classList.remove('is-empty'));
  markPrintCopy(clone);
  // Pictures load lazily in the note; the paper needs all of them.
  clone.querySelectorAll('img').forEach((img) => { img.loading = 'eager'; });
  flow.innerHTML = `<div class="note-title">${escapeHtml(title.trim() || 'Untitled')}</div>`;
  flow.append(clone);
  return flow;
};

const imagesLoaded = (root: HTMLElement) => Promise.all([...root.querySelectorAll('img')].map((img) => (img.complete ? null : new Promise((done) => {
  img.addEventListener('load', done, { once: true });
  img.addEventListener('error', done, { once: true });
  setTimeout(done, 3000);
}))));

// The note's sheets (detached elements, each a full A4 page).
export const buildSheets = (editor: Editor, title: string, noteFont: string | null): Promise<HTMLElement[]> =>
  sheetsFromFlow(noteFlow(editor, title, noteFont));

// The sheets of a note's flow (noteFlow), measured on this page.
export const sheetsFromFlow = async (flow: HTMLElement): Promise<HTMLElement[]> => {
  ensureSheetStyles();
  flow.style.setProperty('--paper-text-zoom', String(textZoom()));
  const measure = document.createElement('div');
  measure.className = 'pdf-measure';
  measure.append(flow);
  document.body.append(measure);
  try {
    await imagesLoaded(flow);
    // Laid out once first: fonts used only now (formulas, code) start loading, and are measured
    // once they are in.
    flow.getBoundingClientRect();
    await Promise.all([`400 16px '${PAPER_SANS}'`, `700 16px '${PAPER_SANS}'`, `400 16px '${PAPER_MONO}'`]
      .map((font) => document.fonts?.load(font, 'aą').catch(() => null)));
    await document.fonts?.ready;
    const starts = paginate(flow, TEXT_H);
    const total = flow.getBoundingClientRect().height;
    return starts.map((start, i) => {
      const sheet = document.createElement('div');
      sheet.className = 'pdf-sheet';
      const body = document.createElement('div');
      body.className = 'pdf-sheet-body';
      body.style.height = `${Math.min(TEXT_H, (starts[i + 1] ?? total) - start)}px`;
      const copy = flow.cloneNode(true) as HTMLElement;
      // Moved, not given a negative margin: that collapsed through the sheet's body, and the
      // print layout placed it differently than the screen.
      copy.style.position = 'relative';
      copy.style.top = `${-start}px`;
      body.append(copy);
      sheet.append(body);
      return sheet;
    });
  } finally {
    measure.remove();
  }
};

// A sheet for paper: without the scale a preview gave it on screen (a phone's narrow preview
// printed the note at 40 % of the page).
const paperCopy = (sheet: HTMLElement): HTMLElement => {
  const copy = sheet.cloneNode(true) as HTMLElement;
  copy.style.removeProperty('transform');
  copy.style.removeProperty('transform-origin');
  return copy;
};

// Puts copies of the sheets where printing finds them (hidden on screen); returns the clean-up.
export const mountPrintSheets = (sheets: HTMLElement[]): (() => void) => {
  ensureSheetStyles();
  document.getElementById('noted-print')?.remove();
  const holder = document.createElement('div');
  holder.id = 'noted-print';
  holder.append(...sheets.map(paperCopy));
  document.body.append(holder);
  return () => holder.remove();
};

// Prints sheets with the system dialog (Print to File = PDF).
export const printSheets = (sheets: HTMLElement[]) => {
  const remove = mountPrintSheets(sheets);
  window.addEventListener('afterprint', remove, { once: true });
  setTimeout(() => window.print(), 50);
};

// The sheets as a page of their own (the phone prints it with expo-print): every style of this
// page, then the sheets; `inline` turns the pictures' object URLs into data the printer can load.
export const sheetsDocument = async (sheets: HTMLElement[], title: string, inline: (src: string) => Promise<string>): Promise<string> => {
  ensureSheetStyles();
  const holder = document.createElement('div');
  holder.id = 'noted-print';
  holder.append(...sheets.map(paperCopy));
  await Promise.all([...holder.querySelectorAll('img')].map(async (img) => {
    const src = img.getAttribute('src') ?? '';
    if (src.startsWith('blob:')) img.setAttribute('src', await inline(src).catch(() => ''));
  }));
  const styles = [...document.querySelectorAll('style')].map((el) => el.textContent ?? '').join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title.trim() || 'Untitled')}</title><style>${styles}</style>`
    // Printed with this page's text zoom (the phone hands it to expo-print): the same layout.
    + '<style>html, body { margin: 0; padding: 0; background: #fff; }</style></head><body>' + holder.outerHTML + '</body></html>';
};

// Export > PDF: the sheets straight to the print dialog.
export const printNote = async (editor: Editor, title: string, noteFont: string | null) => {
  try {
    printSheets(await buildSheets(editor, title, noteFont));
  } catch (err) {
    console.error('Printing failed:', err);
  }
};
