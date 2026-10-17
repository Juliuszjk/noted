import { describe, it, expect } from 'vitest';
import { decodePoints, encodePoints } from './drawing-codec';
import type { StrokePoint } from './drawing-codec';
import { drawingSize, drawingSvg, exportColor, strokeData, strokePath, strokeStyle } from './drawing-render';

describe('drawing point codec', () => {
  it('round-trips points at 0.1 unit / 0.01 pressure precision', () => {
    const points: StrokePoint[] = [
      { x: 0, y: 0, p: 0 },
      { x: 999.94, y: 12.36, p: 0.537 },
      { x: 500.1, y: 4000.7, p: 1 },
      { x: 3.2, y: 0.1, p: 0.01 },
    ];
    expect(decodePoints(encodePoints(points))).toEqual([
      { x: 0, y: 0, p: 0 },
      { x: 999.9, y: 12.4, p: 0.54 },
      { x: 500.1, y: 4000.7, p: 1 },
      { x: 3.2, y: 0.1, p: 0.01 },
    ]);
  });

  it('clamps pressure and keeps large jumps', () => {
    const decoded = decodePoints(encodePoints([{ x: 1, y: 1, p: 2 }, { x: 1000, y: 100000, p: -1 }]));
    expect(decoded).toEqual([{ x: 1, y: 1, p: 1 }, { x: 1000, y: 100000, p: 0 }]);
  });

  it('is compact for a typical stroke', () => {
    const points = Array.from({ length: 100 }, (_, i) => ({ x: 100 + i * 1.3, y: 200 + Math.sin(i / 5) * 20, p: 0.4 + (i % 10) / 100 }));
    expect(encodePoints(points).length).toBeLessThan(points.length * 6);
  });

  it('reads anything damaged as no points', () => {
    expect(decodePoints('')).toEqual([]);
    expect(decodePoints(null)).toEqual([]);
    expect(decodePoints('2:AAAA')).toEqual([]);
    expect(decodePoints('1:@@@')).toEqual([]);
    expect(decodePoints(encodePoints([]))).toEqual([]);
  });
});

describe('drawing render', () => {
  const stroke = (points: StrokePoint[], extra: Record<string, unknown> = {}) => strokeData({ points: encodePoints(points), ...extra });

  it('fills defaults for missing attributes', () => {
    expect(strokeData({})).toEqual({ points: '', color: null, size: 5, tool: 'pen' });
    expect(strokeData({ points: 'x', color: 'var(--c-red)', size: 8, tool: 'highlighter' })).toEqual({ points: 'x', color: 'var(--c-red)', size: 8, tool: 'highlighter' });
    expect(strokeData({ tool: 'eraser', size: -1, color: '' }).tool).toBe('pen');
  });

  it('draws a closed outline, also for a single dot', () => {
    const line = strokePath(stroke([{ x: 10, y: 10, p: 0.5 }, { x: 50, y: 20, p: 0.6 }, { x: 90, y: 10, p: 0.5 }]));
    expect(line).toMatch(/^M[\d. ]+Q.*Z$/);
    expect(strokePath(stroke([{ x: 10, y: 10, p: 0.5 }]))).toMatch(/Z$/);
    expect(strokePath(stroke([]))).toBe('');
  });

  it('grows below the lowest stroke and right of the rightmost one', () => {
    expect(drawingSize(300, [])).toEqual({ width: 1000, height: 300 });
    expect(drawingSize(null, [])).toEqual({ width: 1000, height: 300 });
    expect(drawingSize(300, [stroke([{ x: 1, y: 100, p: 0.5 }])])).toEqual({ width: 1000, height: 300 });
    expect(drawingSize(300, [stroke([{ x: 1, y: 500, p: 0.5 }], { size: 10 })])).toEqual({ width: 1000, height: 525 });
    expect(drawingSize(300, [stroke([{ x: 1, y: 500, p: 0.5 }], { size: 10 })], { x: 200, y: 200 }).height).toBe(705);
    // A long formula: wider than the note.
    expect(drawingSize(300, [stroke([{ x: 1500, y: 50, p: 0.5 }], { size: 10 })]).width).toBe(1525);
    // Near the right edge while editing: room to keep writing.
    expect(drawingSize(300, [stroke([{ x: 900, y: 50, p: 0.5 }], { size: 10 })], { x: 250, y: 160 }).width).toBe(1155);
    expect(drawingSize(300, [stroke([{ x: 500, y: 50, p: 0.5 }], { size: 10 })], { x: 250, y: 160 }).width).toBe(1000);
  });

  it('styles and exports colours', () => {
    expect(strokeStyle({ color: null, tool: 'pen' })).toBe('fill:currentColor');
    expect(strokeStyle({ color: 'var(--c-blue)', tool: 'highlighter' })).toBe('fill:var(--c-blue);opacity:0.35');
    expect(exportColor(null)).toBe('#000000');
    expect(exportColor('var(--c-red)')).toBe('#ff8a80');
    expect(exportColor('#123abc')).toBe('#123abc');
    expect(exportColor('url(javascript:x)')).toBe('#000000');
  });

  it('exports a standalone SVG', () => {
    const svg = drawingSvg(300, [stroke([{ x: 10, y: 10, p: 0.5 }, { x: 90, y: 10, p: 0.5 }], { color: 'var(--c-green)', tool: 'highlighter' })]);
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 1000 300"/);
    expect(svg).toContain('fill="#7fd88a" fill-opacity="0.35"');
  });
});
