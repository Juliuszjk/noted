// Where the pages of a note on paper begin, found by measuring a copy laid out at the paper's
// text width (pdf-sheets.ts in @noted/ui cuts the copy into sheets there; print engines placed
// breaks badly: WebKitGTK left headings alone at the bottom of a page, cut table rows in half
// and moved single lines of a paragraph).
//  - pictures, drawings, formulas, code up to a page, headings: whole, on the next page,
//  - a heading stays with the block after it (the page begins at the heading),
//  - paragraphs and long code split between lines (paragraphs: at least 2 lines on each side),
//  - lists, quotes and callouts taller than the rest of the page split between their blocks,
//  - tables between rows: the rest goes into a new table, under a copy of the header row,
//  - a page break ("/page break") always starts a new page.

const MIN_LINES = 2;
const CONTAINERS = new Set(['UL', 'OL', 'LI', 'BLOCKQUOTE', 'TBODY', 'THEAD']);

const isHeading = (el: Element | null): el is HTMLElement => !!el && /^H[1-6]$/.test(el.tagName);

// The block before `el` on paper (a table's <colgroup> takes no room).
const blockBefore = (el: Element): Element | null => {
  let prev = el.previousElementSibling;
  while (prev && prev.tagName === 'COLGROUP') prev = prev.previousElementSibling;
  return prev;
};

// A table cut before `row`: the rows from it on move into a copy of the table (in a copy of its
// wrapper) right after it, with the header row repeated. Returns the new wrapper.
const splitTable = (row: HTMLTableRowElement): HTMLElement => {
  const table = row.closest('table')!;
  const outer = (table.parentElement?.classList.contains('tableWrapper') ? table.parentElement : table) as HTMLElement;
  const copy = table.cloneNode(false) as HTMLTableElement;
  const colgroup = table.querySelector(':scope > colgroup');
  if (colgroup) copy.append(colgroup.cloneNode(true));
  const body = document.createElement('tbody');
  copy.append(body);
  const first = table.querySelector('tr');
  if (first && first !== row && first.querySelector(':scope > th')) body.append(first.cloneNode(true));
  for (let next: Element | null = row; next;) {
    const after: Element | null = next.nextElementSibling;
    body.append(next);
    next = after;
  }
  let holder: HTMLElement = copy;
  if (outer !== table) {
    holder = outer.cloneNode(false) as HTMLElement;
    holder.append(copy);
  }
  holder.style.marginTop = '0';
  outer.after(holder);
  return holder;
};

// The lines of a block's text, top to bottom (rects of one line merged). Text nodes only: a
// range over whole elements also gives their boxes (a code block's <code> spans every line).
const textLines = (el: HTMLElement, top0: number): { top: number; bottom: number }[] => {
  const range = document.createRange();
  const rects: DOMRect[] = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    range.selectNodeContents(node);
    rects.push(...[...range.getClientRects()].filter((r) => r.height > 0));
  }
  rects.sort((a, b) => a.top - b.top);
  const lines: { top: number; bottom: number }[] = [];
  for (const r of rects) {
    const last = lines[lines.length - 1];
    // Same line: overlaps the previous one by more than half of the smaller height.
    if (last && Math.min(last.bottom, r.bottom - top0) - Math.max(last.top, r.top - top0) > Math.min(last.bottom - last.top, r.height) / 2) {
      last.top = Math.min(last.top, r.top - top0);
      last.bottom = Math.max(last.bottom, r.bottom - top0);
    } else lines.push({ top: r.top - top0, bottom: r.bottom - top0 });
  }
  return lines;
};

// Page start offsets (CSS px from the top of `root`), the first one 0. Tables crossing a page
// end are split in the DOM (see splitTable).
export const paginate = (root: HTMLElement, pageHeight: number): number[] => {
  const top0 = root.getBoundingClientRect().top;
  const rect = (el: Element) => {
    const r = el.getBoundingClientRect();
    return { top: r.top - top0, bottom: r.bottom - top0, height: r.height };
  };
  const starts = [0];
  let pageStart = 0;
  const end = () => pageStart + pageHeight;
  const newPage = (at: number) => {
    if (at <= pageStart + 1) return;
    pageStart = at;
    starts.push(at);
  };

  // Starts a new page at `el`, or at the headings right before it (also before the list,
  // table or quote that `el` opens).
  const breakBefore = (el: HTMLElement) => {
    let target = el;
    while (!blockBefore(target) && target.parentElement && target.parentElement !== root && !target.parentElement.classList.contains('ProseMirror')) {
      target = target.parentElement;
    }
    for (let prev = blockBefore(target); isHeading(prev); prev = blockBefore(prev)) {
      // Never empty a page: a heading run filling the page from its top keeps its place.
      if (rect(prev).top <= pageStart + 1) break;
      target = prev;
    }
    if (target.tagName === 'TR' && blockBefore(target)) target = splitTable(target as HTMLTableRowElement);
    newPage(rect(target).top);
  };

  // Splits a block between its lines; false when it should move whole instead.
  const splitLines = (el: HTMLElement, min: number): boolean => {
    const lines = textLines(el, top0);
    const fitting = () => lines.filter((l) => l.bottom <= end() + 1).length;
    const first = fitting();
    if (lines.length < 2 * min || first < min || lines.length - first < min) return false;
    while (lines[lines.length - 1].bottom > end() + 1) {
      const k = fitting();
      if (k >= lines.length || lines[k].top <= pageStart + 1) break;
      newPage(lines[k].top);
    }
    return true;
  };

  const visit = (el: HTMLElement) => {
    const r = rect(el);
    if (el.classList.contains('page-break')) {
      const next = el.nextElementSibling;
      newPage(next ? rect(next).top : r.top);
      return;
    }
    // Page breaks inside (a list item, a callout): their blocks one by one.
    if (el.querySelector('.page-break')) {
      ([...el.children] as HTMLElement[]).forEach(visit);
      return;
    }
    if (!r.height) return;
    // Starts below the page end (its top margin did not fit, or something above ran over the
    // page end: taller than a page, nothing to split it at).
    if (r.top >= end()) {
      while (r.top >= end() + pageHeight) newPage(end());
      newPage(r.top);
    }
    if (r.bottom <= end() + 1) return;
    // A task item's blocks sit in a <div> next to its checkbox.
    const kids = (el.tagName === 'LI'
      ? [...el.children].flatMap((c) => (c.tagName === 'LABEL' ? [] : c.tagName === 'DIV' ? [...c.children] : [c]))
      : [...el.children]) as HTMLElement[];
    const container = CONTAINERS.has(el.tagName) || el.tagName === 'TABLE' || el.classList.contains('tableWrapper')
      || el.classList.contains('ProseMirror') || (el.getAttribute('data-type') === 'callout' && r.height > pageHeight);
    if (container && kids.length) {
      const firstLine = el.tagName === 'LI' && kids[0] ? textLines(kids[0], top0)[0] : null;
      if (firstLine && firstLine.bottom > end() + 1) {
        // Not even the item's first line fits: the whole item (marker too) moves on.
        breakBefore(el);
        if (rect(el).bottom > end()) kids.forEach(visit);
        return;
      }
      kids.forEach(visit);
      return;
    }
    if (el.tagName === 'P' && splitLines(el, MIN_LINES)) return;
    if (r.height <= pageHeight) {
      breakBefore(el);
      return;
    }
    // Taller than a page: code splits between its lines, anything else where the page ends.
    // At least 3 lines of code under its heading, or it starts on the next page.
    const pre = (el.tagName === 'PRE' ? el : el.querySelector('pre')) as HTMLElement | null;
    if (pre && splitLines(pre, 3)) return;
    if (pre) {
      breakBefore(el);
      if (splitLines(pre, 1)) return;
    }
    while (rect(el).bottom > end()) newPage(end());
  };

  ([...root.children] as HTMLElement[]).forEach(visit);
  return starts;
};
