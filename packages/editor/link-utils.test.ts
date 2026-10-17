import { describe, it, expect } from 'vitest';
import { normalizeLinkUrl } from './link-utils';

describe('normalizeLinkUrl', () => {
  it('adds https to bare domains and keeps full urls', () => {
    expect(normalizeLinkUrl('example.com')).toBe('https://example.com');
    expect(normalizeLinkUrl('  http://a.b/c?d=1 ')).toBe('http://a.b/c?d=1');
    expect(normalizeLinkUrl('localhost:3000')).toBe('https://localhost:3000');
  });
  it('supports mail and phone links', () => {
    expect(normalizeLinkUrl('user@example.com')).toBe('mailto:user@example.com');
    expect(normalizeLinkUrl('mailto:a@b.c')).toBe('mailto:a@b.c');
    expect(normalizeLinkUrl('tel:+48123456789')).toBe('tel:+48123456789');
  });
  it('rejects unsafe or invalid input', () => {
    expect(normalizeLinkUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeLinkUrl('JAVASCRIPT:alert(1)')).toBeNull();
    expect(normalizeLinkUrl('data:text/html,x')).toBeNull();
    expect(normalizeLinkUrl('two words')).toBeNull();
    expect(normalizeLinkUrl('   ')).toBeNull();
  });
});
