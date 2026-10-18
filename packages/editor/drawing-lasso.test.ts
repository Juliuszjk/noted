import { describe, it, expect } from 'vitest';
import { cornerScale, duplicateOffset, lassoTakes, moveStroke, pasteOffset, strokesBox } from './drawing-lasso';

const line = (x0: number, x1: number, y: number) => [{ x: x0, y, p: 0.5 }, { x: (x0 + x1) / 2, y, p: 0.5 }, { x: x1, y, p: 0.5 }];

describe('drawing lasso', () => {
  const loop = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, { x: 0, y: 200 }];

  it('takes strokes mostly inside the loop', () => {
    expect(lassoTakes(loop, line(20, 180, 100))).toBe(true);
    expect(lassoTakes(loop, line(150, 400, 100))).toBe(false);
    expect(lassoTakes(loop, line(300, 400, 100))).toBe(false);
    expect(lassoTakes(loop.slice(0, 2), line(20, 180, 100))).toBe(false);
  });

  it('boxes strokes with their width', () => {
    expect(strokesBox([{ points: line(10, 90, 50), size: 10 }, { points: line(20, 30, 150), size: 4 }]))
      .toEqual({ minX: 5, minY: 45, maxX: 95, maxY: 152 });
    expect(strokesBox([])).toBeNull();
  });

  it('moves and scales strokes, widths too, never off the drawing', () => {
    const moved = moveStroke({ points: line(10, 90, 50), size: 4 }, { dx: 100, dy: -10, scale: 2, originX: 10, originY: 50 });
    expect(moved.size).toBe(8);
    expect(moved.points.map((p) => [p.x, p.y])).toEqual([[110, 40], [190, 40], [270, 40]]);
    expect(moveStroke({ points: line(10, 20, 5), size: 4 }, { dx: -50, dy: -50, scale: 1, originX: 0, originY: 0 }).points[0]).toEqual({ x: 0, y: 0, p: 0.5 });
  });

  it('scales from the corner handle within limits', () => {
    const box = { minX: 0, minY: 0, maxX: 100, maxY: 50 };
    expect(cornerScale(box, 200, 50)).toBe(2);
    expect(cornerScale(box, 50, 100)).toBe(2);
    expect(cornerScale(box, -500, -500)).toBe(0.1);
    expect(cornerScale(box, 1e6, 0)).toBe(8);
  });

  it('pastes in place, or under the strokes when the place is taken', () => {
    const clip = { minX: 10, minY: 10, maxX: 110, maxY: 60 };
    expect(pasteOffset(clip, [])).toEqual({ dx: 0, dy: 0 });
    expect(pasteOffset(clip, [{ minX: 500, minY: 0, maxX: 600, maxY: 50 }])).toEqual({ dx: 0, dy: 0 });
    expect(pasteOffset(clip, [{ minX: 50, minY: 30, maxX: 200, maxY: 300 }])).toEqual({ dx: 0, dy: 314 });
    expect(duplicateOffset(clip)).toEqual({ dx: 0, dy: 74 });
  });
});
