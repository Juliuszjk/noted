import type { StrokePoint } from './drawing-codec';

// Eraser geometry for drawing strokes (pure, tested in drawing-erase.test.ts). A stroke is hit
// when the eraser circle touches its ink: the distance from the centre line is below the
// eraser radius plus half the stroke width.

export type EraserMode = 'stroke' | 'part';

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const pointsBox = (points: StrokePoint[], pad = 0): Box => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { x, y } of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
};

export const boxNear = (box: Box, x: number, y: number, r: number): boolean =>
  x >= box.minX - r && x <= box.maxX + r && y >= box.minY - r && y <= box.maxY + r;

const segmentDistance = (px: number, py: number, a: StrokePoint, b: StrokePoint): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len)) : 0;
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
};

// Does an eraser at (x, y) with radius r touch a stroke of this width?
export const strokeHit = (points: StrokePoint[], size: number, x: number, y: number, r: number): boolean => {
  const reach = r + size / 2;
  if (points.length === 1) return Math.hypot(points[0].x - x, points[0].y - y) <= reach;
  for (let i = 1; i < points.length; i++) {
    if (segmentDistance(x, y, points[i - 1], points[i]) <= reach) return true;
  }
  return false;
};

// Points no further apart than `step`, so a cut lands where the eraser is even on long
// straight segments.
export const resample = (points: StrokePoint[], step: number): StrokePoint[] => {
  if (points.length < 2) return points.slice();
  const out: StrokePoint[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step);
    for (let k = 1; k < n; k++) {
      const t = k / n;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, p: a.p + (b.p - a.p) * t });
    }
    out.push(b);
  }
  return out;
};

// The pieces of a stroke left after erasing around (x, y): points whose ink the eraser
// touches are removed and the stroke splits there. Pieces of a single point go too (they
// would show as dots). Returns null when the eraser does not touch the stroke.
export const eraseStrokePart = (points: StrokePoint[], size: number, x: number, y: number, r: number): StrokePoint[][] | null => {
  if (!strokeHit(points, size, x, y, r)) return null;
  const reach = r + size / 2;
  const pieces: StrokePoint[][] = [];
  let current: StrokePoint[] = [];
  for (const point of resample(points, Math.max(0.5, r / 4))) {
    if (Math.hypot(point.x - x, point.y - y) <= reach) {
      if (current.length > 1) pieces.push(current);
      current = [];
    } else {
      current.push(point);
    }
  }
  if (current.length > 1) pieces.push(current);
  return pieces;
};

// Eraser positions between two samples of a fast movement (no gaps in the erased path).
export const eraserPath = (from: { x: number; y: number } | null, to: { x: number; y: number }, r: number): { x: number; y: number }[] => {
  if (!from) return [to];
  const n = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / (r / 2)));
  return Array.from({ length: n }, (_, i) => ({ x: from.x + ((to.x - from.x) * (i + 1)) / n, y: from.y + ((to.y - from.y) * (i + 1)) / n }));
};
