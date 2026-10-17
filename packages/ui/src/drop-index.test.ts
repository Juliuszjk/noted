import { it, expect } from 'vitest';
import { dropIndex } from './drop-index';

it('finds the place among wrapped buttons', () => {
  // Two lines: a b c / d e
  const boxes = [0, 40, 80].map((x) => ({ x, y: 0, w: 40, h: 40 })).concat([0, 40].map((x) => ({ x, y: 40, w: 40, h: 40 })));
  expect(dropIndex(boxes, 5, 20)).toBe(0);
  expect(dropIndex(boxes, 65, 20)).toBe(2);
  expect(dropIndex(boxes, 200, 20)).toBe(3);
  expect(dropIndex(boxes, 25, 60)).toBe(4);
  expect(dropIndex(boxes, 200, 60)).toBe(5);
  expect(dropIndex(boxes, 10, 300)).toBe(5);
  expect(dropIndex([], 10, 10)).toBe(0);
});
