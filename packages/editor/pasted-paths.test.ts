import { describe, expect, it } from 'vitest';
import { pastedFilePaths, isHeicFile } from './blob-image';

describe('pastedFilePaths', () => {
  it('reads file URIs copied in a file manager', () => {
    expect(pastedFilePaths('file:///home/a/Pictures/IMG%201.heic\r\nfile:///tmp/x.pdf\n', '')).toEqual(['/home/a/Pictures/IMG 1.heic', '/tmp/x.pdf']);
    expect(pastedFilePaths('', 'file:///home/a/zażółć.png')).toEqual(['/home/a/zażółć.png']);
    expect(pastedFilePaths('# comment\nfile:///a.txt', '')).toEqual(['/a.txt']);
  });

  it('leaves other text alone', () => {
    expect(pastedFilePaths('', 'hello')).toBeNull();
    expect(pastedFilePaths('', 'file:///a.txt\nsome text')).toBeNull();
    expect(pastedFilePaths('https://example.com/a.png', '')).toBeNull();
    expect(pastedFilePaths('', '')).toBeNull();
  });
});

describe('isHeicFile', () => {
  it('knows HEIC by type or name', () => {
    expect(isHeicFile(new File([], 'a.HEIC'))).toBe(true);
    expect(isHeicFile(new File([], 'photo', { type: 'image/heif' }))).toBe(true);
    expect(isHeicFile(new File([], 'a.jpg', { type: 'image/jpeg' }))).toBe(false);
  });
});
