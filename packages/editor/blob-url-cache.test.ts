// @vitest-environment happy-dom
import { it, expect } from 'vitest';
import { createBlobUrlCache } from './blob-url-cache';

it('keeps decrypted images while shown, then only a few unused ones', async () => {
  const sweeps: (() => void)[] = [];
  let loads = 0;
  let clock = 0;
  const cache = createBlobUrlCache(async (id) => { loads++; return id === 'missing' ? null : new Blob([id]); }, {
    keepUnused: 1, now: () => ++clock, schedule: (run) => { sweeps.push(run); },
  });
  const a = await cache.acquire('a');
  const a2 = await cache.acquire('a');
  expect(a).toBe(a2);
  expect(loads).toBe(1);
  expect(await cache.acquire('missing')).toBeNull();
  await cache.acquire('b');
  await cache.acquire('c');
  cache.release('a');
  cache.release('a');
  cache.release('b');
  sweeps.forEach((run) => run());
  // c is shown, b was the last one let go, a is revoked.
  expect(cache.size()).toBe(2);
  expect(await cache.acquire('a')).not.toBe(a);
  expect(loads).toBe(5);
});
