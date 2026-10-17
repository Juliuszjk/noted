import { describe, it, expect } from 'vitest';
import { diffHtml, tokenizeHtml } from './html-diff';

describe('diffHtml', () => {
  it('marks added and removed words', () => {
    expect(diffHtml('<p>one two three</p>', '<p>one 2 three</p>')).toBe('<p>one <del>two</del><ins>2</ins> three</p>');
  });

  it('keeps the new structure and drops tags of removed blocks', () => {
    const out = diffHtml('<p>a</p><p>gone</p>', '<p>a</p>');
    expect(out).toBe('<p>a</p><del>gone</del>');
  });

  it('marks a whole new paragraph', () => {
    expect(diffHtml('<p>a</p>', '<p>a</p><p>new text</p>')).toBe('<p>a</p><p><ins>new text</ins></p>');
  });

  it('returns the document unchanged when nothing changed', () => {
    const html = '<ul><li><p>x, y</p></li></ul>';
    expect(diffHtml(html, html)).toBe(html);
  });

  it('never keeps an image address', () => {
    expect(diffHtml('', '<img src="https://tracker.example/x.png" data-blob="a:b">')).toBe('<img data-blob="a:b">');
  });

  it('splits words, spaces, punctuation and tags', () => {
    expect(tokenizeHtml('<p>Zażółć, gęślą</p>')).toEqual(['<p>', 'Zażółć', ',', ' ', 'gęślą', '</p>']);
  });
});
