// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { parseSvg, svgSize } from '@noted/media/svg-size';

const size = (attrs: string) => svgSize(parseSvg(`<svg xmlns="http://www.w3.org/2000/svg" ${attrs}/>`)!);

describe('svgSize', () => {
  it('takes width and height in px', () => {
    expect(size('width="24" height="24px" viewBox="0 0 12 12"')).toEqual({ width: 24, height: 24, boxed: true });
  });
  it('falls back to the viewBox, keeping its proportions for a single side', () => {
    expect(size('viewBox="0 0 400 100"')).toEqual({ width: 400, height: 100, boxed: true });
    expect(size('width="200" viewBox="0 0 400 100"')).toEqual({ width: 200, height: 50, boxed: true });
    expect(size('width="100%" height="100%" viewBox="0 0 50 100"')).toEqual({ width: 50, height: 100, boxed: true });
  });
  it('uses the browsers default without any size', () => {
    expect(size('')).toEqual({ width: 300, height: 150, boxed: false });
  });
  it('refuses text that is not an SVG', () => {
    expect(parseSvg('<html></html>')).toBeNull();
  });
});
