import { describe, it, expect } from 'vitest';
import { unsealBytes, publishPasswordKey } from '@noted/crypto';
import { nextPublishInfo, sealPublished, fromBase64Url, PUBLISH_MAGIC } from './publish';

const note = { title: 'T', html: '<p>x</p>', css: '' };

describe('published notes', () => {
  it('seals with the link key, or with the link key and the password', () => {
    const plain = nextPublishInfo(null, { password: null, selfDestruct: false });
    const bytes = sealPublished(note, plain);
    expect([...bytes.slice(0, 3)]).toEqual([PUBLISH_MAGIC, 1, 0]);
    expect(JSON.parse(new TextDecoder().decode(unsealBytes(fromBase64Url(plain.key), bytes.slice(3)))).html).toBe('<p>x</p>');

    const locked = nextPublishInfo(plain, { password: 'secret', selfDestruct: true });
    expect(locked.id).toBe(plain.id);
    expect(locked.key).toBe(plain.key);
    const sealed = sealPublished(note, locked);
    expect(sealed[2]).toBe(1);
    expect(() => unsealBytes(fromBase64Url(locked.key), sealed.slice(3))).toThrow();
    const key = publishPasswordKey(fromBase64Url(locked.key), 'secret');
    expect(JSON.parse(new TextDecoder().decode(unsealBytes(key, sealed.slice(3)))).title).toBe('T');
  });
});

describe('link expiry', () => {
  it('keeps the expiry and knows when it has passed', async () => {
    const { nextPublishInfo, publishExpired } = await import('./publish');
    const info = nextPublishInfo(null, { password: null, selfDestruct: false, expiresAt: 5000 });
    expect(info.expiresAt).toBe(5000);
    expect(publishExpired(info, 4999)).toBe(false);
    expect(publishExpired(info, 5000)).toBe(true);
    expect(publishExpired(nextPublishInfo(null, { password: null, selfDestruct: false }), Date.now())).toBe(false);
  });
});
