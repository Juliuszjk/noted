import { describe, it, expect } from 'vitest';
import { belowCut, recognizeShape, simplify, snapLineEnd, spansSides } from './drawing-shapes';

// A hand-drawn path through the corners: points every few units with a little wobble.
const hand = (corners: [number, number][], wobble = 1.5) => {
  const out: { x: number; y: number; p: number }[] = [];
  let k = 0;
  for (let i = 0; i < corners.length - 1; i++) {
    const [ax, ay] = corners[i];
    const [bx, by] = corners[i + 1];
    const n = Math.ceil(Math.hypot(bx - ax, by - ay) / 3);
    for (let j = 0; j < n; j++) {
      const w = Math.sin(k++ * 1.7) * wobble;
      out.push({ x: ax + ((bx - ax) * j) / n + w, y: ay + ((by - ay) * j) / n - w, p: 0.5 });
    }
  }
  const [ex, ey] = corners[corners.length - 1];
  out.push({ x: ex, y: ey, p: 0.5 });
  return out;
};

const circle = (cx: number, cy: number, rx: number, ry: number, close = 1) =>
  Array.from({ length: 80 }, (_, i) => {
    const t = (i / 79) * Math.PI * 2 * close;
    return { x: cx + Math.cos(t) * rx + Math.sin(i) * 1.5, y: cy + Math.sin(t) * ry, p: 0.5 };
  });

describe('drawing shapes', () => {
  it('snaps a nearly level line and keeps a slanted one', () => {
    expect(snapLineEnd({ x: 0, y: 0 }, { x: 100, y: 6 }).y).toBeCloseTo(0);
    expect(snapLineEnd({ x: 0, y: 0 }, { x: 70, y: 74 }).x).toBeCloseTo(snapLineEnd({ x: 0, y: 0 }, { x: 70, y: 74 }).y);
    expect(snapLineEnd({ x: 0, y: 0 }, { x: 100, y: 30 })).toEqual({ x: 100, y: 30 });
  });

  it('straightens an open stroke into a line', () => {
    const shape = recognizeShape(hand([[10, 10], [60, 40], [200, 16]], 2))!;
    expect(shape.kind).toBe('line');
    expect(shape.points[0]).toMatchObject({ x: expect.closeTo(10, 0), y: expect.closeTo(10, 0) });
    const last = shape.points[shape.points.length - 1];
    expect(last.y).toBeCloseTo(10, 0); // 200,16 from 10,10 is nearly level: snapped
    expect(shape.points.every((p) => p.p === shape.points[0].p)).toBe(true);
  });

  it('turns a stroke ending in a head into an arrow', () => {
    expect(recognizeShape(hand([[0, 100], [300, 100], [270, 80], [300, 100], [270, 122]]))!.kind).toBe('arrow');
  });

  it('recognizes a triangle and rectangles, squaring nearly square ones', () => {
    expect(recognizeShape(hand([[100, 0], [200, 170], [0, 170], [98, 4]]))!.kind).toBe('triangle');
    const rect = recognizeShape(hand([[0, 0], [300, 0], [300, 120], [0, 120], [2, 4]]))!;
    expect(rect.kind).toBe('rectangle');
    const square = recognizeShape(hand([[0, 0], [200, 0], [200, 190], [0, 190], [2, 3]]))!;
    const xs = square.points.map((p) => p.x);
    const ys = square.points.map((p) => p.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(Math.max(...ys) - Math.min(...ys), 0);
  });

  it('recognizes ellipses and nearly round circles', () => {
    expect(recognizeShape(circle(200, 200, 150, 60))!.kind).toBe('ellipse');
    const round = recognizeShape(circle(200, 200, 100, 94))!;
    const xs = round.points.map((p) => p.x);
    const ys = round.points.map((p) => p.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(Math.max(...ys) - Math.min(...ys), 0);
  });

  it('leaves a dot alone', () => {
    expect(recognizeShape([{ x: 5, y: 5, p: 1 }, { x: 6, y: 5, p: 1 }])).toBeNull();
  });

  it('simplifies a stroke to its corners', () => {
    expect(simplify(hand([[0, 0], [100, 0], [100, 100]], 0.5), 5)).toHaveLength(3);
  });

  it('knows a cut from side to side by its ends', () => {
    expect(spansSides(5, 990, 0, 1000)).toBe(true);
    expect(spansSides(995, 30, 0, 1000)).toBe(true);
    expect(spansSides(5, 700, 0, 1000)).toBe(false);
    expect(spansSides(300, 990, 0, 1000)).toBe(false);
    // The visible part of a wider drawing (screen pixels).
    expect(spansSides(52, 870, 45, 880)).toBe(true);
  });

  it('puts strokes above or below a wavy cut', () => {
    const cut = Array.from({ length: 60 }, (_, i) => ({ x: i * 17, y: 400 + Math.sin(i / 4) * 40 }));
    expect(belowCut(cut, [{ x: 100, y: 300 }, { x: 140, y: 320 }])).toBe(false);
    expect(belowCut(cut, [{ x: 100, y: 500 }, { x: 140, y: 520 }])).toBe(true);
    // Crossing the cut: where most of it is.
    expect(belowCut(cut, [{ x: 500, y: 380 }, { x: 510, y: 520 }, { x: 520, y: 530 }, { x: 530, y: 540 }])).toBe(true);
  });

  it('separates words with a cut winding around them', () => {
    // From the left side under the first words, up between them and "takie", along the top to the right.
    const cut = [
      ...Array.from({ length: 20 }, (_, i) => ({ x: i * 15, y: 250 + i * 7 })),
      ...Array.from({ length: 20 }, (_, i) => ({ x: 300 + i * 12.5, y: 390 })),
      ...Array.from({ length: 20 }, (_, i) => ({ x: 550, y: 390 - i * 17 })),
      ...Array.from({ length: 20 }, (_, i) => ({ x: 550 + i * 23, y: 50 })),
    ];
    const leftWords = [{ x: 100, y: 150 }, { x: 300, y: 220 }, { x: 480, y: 200 }];
    const takie = [{ x: 650, y: 120 }, { x: 800, y: 200 }, { x: 950, y: 150 }];
    expect(belowCut(cut, leftWords)).toBe(false);
    expect(belowCut(cut, takie)).toBe(true);
    // The same cut drawn from right to left.
    expect(belowCut(cut.slice().reverse(), takie)).toBe(true);
  });
});
