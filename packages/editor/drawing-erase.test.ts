import { describe, it, expect } from 'vitest';
import { boxNear, eraserPath, eraseStrokePart, pointsBox, resample, strokeHit } from './drawing-erase';

const line = (x0: number, x1: number, y = 50) => [{ x: x0, y, p: 0.5 }, { x: x1, y, p: 0.5 }];

describe('drawing eraser', () => {
  it('hits a stroke when the circle touches its ink', () => {
    expect(strokeHit(line(0, 100), 10, 50, 60, 5)).toBe(true); // 10 away, reach 5 + 5
    expect(strokeHit(line(0, 100), 10, 50, 61, 5)).toBe(false);
    expect(strokeHit(line(0, 100), 4, 120, 50, 18)).toBe(true); // beyond the end, within reach
    expect(strokeHit([{ x: 10, y: 10, p: 1 }], 4, 13, 10, 2)).toBe(true);
    expect(strokeHit([{ x: 10, y: 10, p: 1 }], 4, 15, 10, 2)).toBe(false);
  });

  it('resamples long segments without losing the ends', () => {
    const out = resample(line(0, 10), 1);
    expect(out).toHaveLength(11);
    expect(out[0]).toEqual({ x: 0, y: 50, p: 0.5 });
    expect(out[10]).toEqual({ x: 10, y: 50, p: 0.5 });
    expect(out[5].x).toBeCloseTo(5);
  });

  it('cuts the touched part out and keeps both sides', () => {
    const pieces = eraseStrokePart(line(0, 100), 4, 50, 50, 8)!;
    expect(pieces).toHaveLength(2);
    expect(pieces[0][0].x).toBe(0);
    expect(Math.max(...pieces[0].map((p) => p.x))).toBeLessThan(40);
    expect(Math.min(...pieces[1].map((p) => p.x))).toBeGreaterThan(60);
    expect(pieces[1][pieces[1].length - 1].x).toBe(100);
  });

  it('erases a stroke end, a whole short stroke, or nothing', () => {
    expect(eraseStrokePart(line(0, 100), 4, 100, 50, 8)).toHaveLength(1);
    expect(eraseStrokePart(line(45, 55), 2, 50, 50, 10)).toEqual([]);
    expect(eraseStrokePart(line(0, 100), 4, 50, 90, 8)).toBeNull();
  });

  it('fills the gaps of a fast eraser movement', () => {
    expect(eraserPath(null, { x: 5, y: 5 }, 10)).toEqual([{ x: 5, y: 5 }]);
    const path = eraserPath({ x: 0, y: 0 }, { x: 40, y: 0 }, 10);
    expect(path).toHaveLength(8);
    expect(path[path.length - 1]).toEqual({ x: 40, y: 0 });
  });

  it('boxes strokes for a quick distance check', () => {
    const box = pointsBox(line(10, 90), 2);
    expect(box).toEqual({ minX: 8, minY: 48, maxX: 92, maxY: 52 });
    expect(boxNear(box, 100, 50, 10)).toBe(true);
    expect(boxNear(box, 100, 70, 10)).toBe(false);
  });
});
