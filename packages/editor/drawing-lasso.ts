import type { StrokePoint } from './drawing-codec';
import type { Box } from './drawing-erase';

// Lasso selection of drawing strokes (drawing.ts): which strokes a loop takes, moving and
// scaling them, and where pasted strokes go. Pure, tested in drawing-lasso.test.ts.

type Pt = { x: number; y: number };

const inside = (pt: Pt, polygon: Pt[]): boolean => {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
};

// The loop (closed from its end back to its start) takes a stroke when most of its points
// are inside.
export const lassoTakes = (loop: Pt[], points: Pt[]): boolean => {
  if (loop.length < 3 || !points.length) return false;
  let count = 0;
  for (const pt of points) if (inside(pt, loop)) count++;
  return count > points.length / 2;
};

export interface StrokeShape {
  points: StrokePoint[];
  size: number;
}

// The box around strokes, their width included; null without strokes.
export const strokesBox = (strokes: StrokeShape[]): Box | null => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { points, size } of strokes) {
    for (const pt of points) {
      minX = Math.min(minX, pt.x - size / 2);
      minY = Math.min(minY, pt.y - size / 2);
      maxX = Math.max(maxX, pt.x + size / 2);
      maxY = Math.max(maxY, pt.y + size / 2);
    }
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
};

export interface StrokeMove {
  dx: number;
  dy: number;
  // Uniform scale around (originX, originY), applied before the move.
  scale: number;
  originX: number;
  originY: number;
}

export const NO_MOVE: StrokeMove = { dx: 0, dy: 0, scale: 1, originX: 0, originY: 0 };

// Moved / scaled strokes stay inside the drawing (x, y >= 0); widths scale too.
export const moveStroke = (stroke: StrokeShape, move: StrokeMove): StrokeShape => ({
  size: Math.max(0.5, Math.round(stroke.size * move.scale * 10) / 10),
  points: stroke.points.map((pt) => ({
    x: Math.max(0, move.originX + (pt.x - move.originX) * move.scale + move.dx),
    y: Math.max(0, move.originY + (pt.y - move.originY) * move.scale + move.dy),
    p: pt.p,
  })),
});

// Scale from dragging the box's corner handle (top left fixed), kept within sensible limits.
export const cornerScale = (box: Box, handleX: number, handleY: number): number => {
  const w = Math.max(1, box.maxX - box.minX);
  const h = Math.max(1, box.maxY - box.minY);
  const scale = Math.max((handleX - box.minX) / w, (handleY - box.minY) / h);
  return Math.min(8, Math.max(0.1, scale));
};

const overlaps = (a: Box, b: Box) => a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;

// Where pasted strokes go: where they were copied, or under the drawing's strokes when that
// place is taken. Returns the move for them.
export const pasteOffset = (clip: Box, existing: Box[], margin = 24): { dx: number; dy: number } => {
  if (!existing.some((box) => overlaps(box, clip))) return { dx: 0, dy: 0 };
  const bottom = Math.max(...existing.map((box) => box.maxY));
  return { dx: 0, dy: bottom + margin - clip.minY };
};

// Duplicating: the copy right under the original.
export const duplicateOffset = (box: Box, margin = 24): { dx: number; dy: number } => ({ dx: 0, dy: box.maxY - box.minY + margin });
