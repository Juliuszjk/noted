import { describe, it, expect } from 'vitest';
import { formatBlobRef, parseBlobRef } from './blob-image';

describe('blob references', () => {
  it('round-trips id and base64 key in one attribute', () => {
    const ref = { id: '11111111-2222-4333-8444-555555555555', key: 'a+b/c==' };
    expect(parseBlobRef(formatBlobRef(ref))).toEqual(ref);
  });
  it('rejects malformed values', () => {
    for (const bad of [null, '', 'nokey', ':key', 'id:', 42]) expect(parseBlobRef(bad)).toBeNull();
  });
});

import { formatBytes, fileIcon } from './attachment';

describe('attachment card helpers', () => {
  it('formats sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(25 * 1024 * 1024)).toBe('25 MB');
  });
  it('picks an icon from type or extension', () => {
    expect(fileIcon('application/pdf', 'a.pdf')).toBe('📕');
    expect(fileIcon(null, 'backup.tar.gz')).toBe('📦');
    expect(fileIcon('', 'x.bin')).toBe('📎');
  });
});
