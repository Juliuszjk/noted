// Layout facts of A4 sheets (pdf-sheets.ts), comparable between browser engines.

// The text of a block line by line, cut where the engine wrapped it. Rounded offsets decide
// only which line a word is on, so sub-pixel font differences do not count.
export const textLines = (block: Element): string[] => {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  const lines: { top: number; text: string }[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent ?? '';
    for (const match of text.matchAll(/\s*\S+/g)) {
      const range = document.createRange();
      const start = match.index + match[0].length - match[0].trimStart().length;
      range.setStart(node, start);
      range.setEnd(node, match.index + match[0].length);
      const box = range.getClientRects()[0];
      if (!box) continue;
      const last = lines.at(-1);
      if (last && Math.abs(last.top - box.top) < 4) last.text += match[0];
      else lines.push({ top: box.top, text: match[0].trimStart() });
    }
  }
  return lines.map((line) => line.text);
};

// Page by page: the headings starting there and the blocks' text the sheet shows. A sheet
// shows a slice of a full copy, so a block belongs to the sheet whose window holds its top.
export const sheetSummary = (sheets: HTMLElement[]) => sheets.map((sheet) => {
  const body = sheet.querySelector('.pdf-sheet-body') as HTMLElement;
  const window = body.getBoundingClientRect();
  const shown = (el: Element) => {
    const box = el.getBoundingClientRect();
    return box.height > 0 && box.top >= window.top - 1 && box.top < window.bottom - 1;
  };
  const headings = [...sheet.querySelectorAll('.note-title, h1, h2, h3, h4, h5, h6')].filter(shown);
  return {
    headings: headings.map((el) => textLines(el)),
    text: (sheet.textContent ?? '').length,
    width: sheet.offsetWidth,
    height: sheet.offsetHeight,
  };
});
