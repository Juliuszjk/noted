import type { StrokePoint } from './drawing-codec';

// Shapes for "hold the pen at the end of a stroke" (drawing.ts): the stroke is replaced by the
// clean shape it looks like. Pure, tested in drawing-shapes.test.ts.
// - an open stroke: a straight line (snapped to horizontal / vertical / 45° when close), or an
//   arrow when it ends in a head;
// - a closed stroke: a triangle, a rectangle (a square when nearly), or an ellipse (a circle
//   when nearly).

export type ShapeKind = 'line' | 'arrow' | 'triangle' | 'rectangle' | 'ellipse';

export interface Shape {
  kind: ShapeKind;
  points: StrokePoint[];
}

type Pt = { x: number; y: number };

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

const segmentDistance = (p: Pt, a: Pt, b: Pt) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};

const pathLength = (points: Pt[]) => {
  let length = 0;
  for (let i = 1; i < points.length; i++) length += dist(points[i - 1], points[i]);
  return length;
};

// Ramer-Douglas-Peucker: the corners of a stroke.
export const simplify = (points: Pt[], epsilon: number): Pt[] => {
  if (points.length < 3) return points.slice();
  const first = points[0];
  const last = points[points.length - 1];
  let far = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    const len = dist(first, last);
    const d = len
      ? Math.abs((last.y - first.y) * p.x - (last.x - first.x) * p.y + last.x * first.y - last.y * first.x) / len
      : dist(p, first);
    if (d > far) {
      far = d;
      index = i;
    }
  }
  if (far <= epsilon) return [first, last];
  return [...simplify(points.slice(0, index + 1), epsilon).slice(0, -1), ...simplify(points.slice(index), epsilon)];
};

// Points along straight segments, about `step` apart, all with one pressure.
const polyline = (corners: Pt[], p: number, step = 4): StrokePoint[] => {
  const out: StrokePoint[] = [];
  for (let i = 0; i < corners.length - 1; i++) {
    const a = corners[i];
    const b = corners[i + 1];
    const n = Math.max(1, Math.ceil(dist(a, b) / step));
    for (let k = 0; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n, p });
  }
  const end = corners[corners.length - 1];
  out.push({ x: end.x, y: end.y, p });
  return out;
};

const SNAP_DEGREES = 8;

// The end point moved so the line is horizontal, vertical or diagonal when it nearly is.
export const snapLineEnd = (start: Pt, end: Pt): Pt => {
  const length = dist(start, end);
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const step = Math.PI / 4;
  const snapped = Math.round(angle / step) * step;
  if (Math.abs(angle - snapped) > (SNAP_DEGREES * Math.PI) / 180) return end;
  return { x: start.x + Math.cos(snapped) * length, y: start.y + Math.sin(snapped) * length };
};

export const lineShape = (start: StrokePoint, end: Pt, p: number): Shape => ({ kind: 'line', points: polyline([start, snapLineEnd(start, end)], p) });

const averagePressure = (points: StrokePoint[]) => points.reduce((sum, pt) => sum + pt.p, 0) / points.length || 0.5;

const arrowHead = (from: Pt, tip: Pt, length: number): [Pt, Pt] => {
  const angle = Math.atan2(tip.y - from.y, tip.x - from.x);
  const wing = (turn: number) => ({ x: tip.x - Math.cos(angle + turn) * length, y: tip.y - Math.sin(angle + turn) * length });
  return [wing(Math.PI / 6), wing(-Math.PI / 6)];
};

export const recognizeShape = (points: StrokePoint[]): Shape | null => {
  if (points.length < 2) return null;
  const p = averagePressure(points);
  const start = points[0];
  const end = points[points.length - 1];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const pt of points) {
    minX = Math.min(minX, pt.x);
    minY = Math.min(minY, pt.y);
    maxX = Math.max(maxX, pt.x);
    maxY = Math.max(maxY, pt.y);
  }
  const width = maxX - minX;
  const height = maxY - minY;
  const diagonal = Math.hypot(width, height);
  if (diagonal < 4) return null;
  const length = pathLength(points);
  const closed = dist(start, end) < Math.max(12, diagonal * 0.22) && length > diagonal * 1.8;

  if (!closed) {
    // An arrow: the stroke runs out to its farthest point (the tip), and what follows stays
    // close to the tip (the head drawn there).
    // (The first arrival there: the head passes the tip again.)
    let far = 0;
    for (const pt of points) far = Math.max(far, dist(start, pt));
    const tipIndex = points.findIndex((pt) => dist(start, pt) >= far * 0.97);
    const tip = points[tipIndex];
    const shaft = dist(start, tip);
    const rest = points.slice(tipIndex);
    if (tipIndex < points.length - 1 && shaft > 0 && pathLength(rest) > shaft * 0.15 && rest.every((pt) => dist(pt, tip) < shaft * 0.4)) {
      const end2 = snapLineEnd(start, tip);
      const [a, b] = arrowHead(start, end2, Math.max(12, Math.min(shaft * 0.2, 60)));
      return { kind: 'arrow', points: polyline([start, end2, a, end2, b], p) };
    }
    return lineShape(start, end, p);
  }

  // Closed: its corners (the closing point left out). A polygon only when the stroke follows
  // its edges clearly better than the ellipse of the bounding box.
  const loop = [...points, start];
  const corners = simplify(loop, diagonal * 0.09).slice(0, -1);
  const cx0 = minX + width / 2;
  const cy0 = minY + height / 2;
  const rx0 = Math.max(1, width / 2);
  const ry0 = Math.max(1, height / 2);
  const ellipseError = points.reduce((sum, pt) => sum + Math.abs(Math.hypot((pt.x - cx0) / rx0, (pt.y - cy0) / ry0) - 1), 0) / points.length * ((rx0 + ry0) / 2);
  const polygonError = (poly: Pt[]) => points.reduce((sum, pt) => {
    let best = Infinity;
    for (let i = 0; i < poly.length; i++) best = Math.min(best, segmentDistance(pt, poly[i], poly[(i + 1) % poly.length]));
    return sum + best;
  }, 0) / points.length;
  const polygon = (corners.length === 3 || corners.length === 4) && polygonError(corners) < ellipseError * 0.7;
  if (polygon && corners.length === 3) return { kind: 'triangle', points: polyline([...corners, corners[0]], p) };
  if (polygon && corners.length === 4) {
    // Edges close to horizontal / vertical: an upright rectangle (square when nearly).
    const upright = corners.every((c, i) => {
      const n = corners[(i + 1) % 4];
      const angle = Math.abs((Math.atan2(n.y - c.y, n.x - c.x) * 180) / Math.PI) % 90;
      return angle < 18 || angle > 72;
    });
    if (upright) {
      let w = width;
      let h = height;
      if (Math.abs(w - h) < Math.max(w, h) * 0.12) w = h = (w + h) / 2;
      const box = [{ x: minX, y: minY }, { x: minX + w, y: minY }, { x: minX + w, y: minY + h }, { x: minX, y: minY + h }];
      return { kind: 'rectangle', points: polyline([...box, box[0]], p) };
    }
    return { kind: 'rectangle', points: polyline([...corners, corners[0]], p) };
  }
  // Round: the ellipse of the bounding box (a circle when nearly).
  let rx = width / 2;
  let ry = height / 2;
  if (Math.abs(rx - ry) < Math.max(rx, ry) * 0.12) rx = ry = (rx + ry) / 2;
  const cx = minX + width / 2;
  const cy = minY + height / 2;
  const n = Math.max(24, Math.ceil((Math.PI * 2 * Math.max(rx, ry)) / 4));
  const ring = Array.from({ length: n + 1 }, (_, i) => {
    const t = (i / n) * Math.PI * 2;
    return { x: cx + Math.cos(t) * rx, y: cy + Math.sin(t) * ry, p };
  });
  return { kind: 'ellipse', points: ring };
};

// A cut across the drawing: a held stroke that starts at one side of the visible drawing and
// ends at the other (screen x of its first and last point), in any shape.
export const spansSides = (firstX: number, lastX: number, left: number, right: number): boolean => {
  const near = (right - left) * 0.12;
  const atLeft = (x: number) => x <= left + near;
  const atRight = (x: number) => x >= right - near;
  return (atLeft(firstX) && atRight(lastX)) || (atRight(firstX) && atLeft(lastX));
};

const insidePolygon = (pt: Pt, polygon: Pt[]): boolean => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
};

// Which strokes lie below a cut: the cut and the drawing's top close the part that stays; a
// stroke goes below when most of its points are outside it. So a cut may wind around words
// (down, up between them, along the top) and still separate them.
export const belowCut = (cut: Pt[], stroke: Pt[]): boolean => {
  if (cut.length < 2 || !stroke.length) return false;
  const line = cut[0].x <= cut[cut.length - 1].x ? cut : cut.slice().reverse();
  const far = 1e6;
  const first = line[0];
  const last = line[line.length - 1];
  const upper = [{ x: -far, y: first.y }, ...line, { x: far, y: last.y }, { x: far, y: -far }, { x: -far, y: -far }];
  let below = 0;
  for (const pt of stroke) if (!insidePolygon(pt, upper)) below++;
  return below > stroke.length / 2;
};
