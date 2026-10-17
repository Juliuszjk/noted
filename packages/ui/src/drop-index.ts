// Drag and drop in the settings pictures (toolbar, note menu): where a button dropped at a
// point goes among the buttons of a zone, given their boxes in reading order (lines may wrap).

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const inBox = (b: Box, x: number, y: number, pad = 0): boolean =>
  x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad;

// The number of buttons before the point: those on earlier lines, and those on the point's
// line whose middle is left of it.
export const dropIndex = (boxes: Box[], x: number, y: number): number => {
  let index = 0;
  boxes.forEach((b, i) => {
    const sameLine = y >= b.y && y <= b.y + b.h;
    if (b.y + b.h < y || (sameLine && b.x + b.w / 2 < x)) index = i + 1;
  });
  return index;
};
