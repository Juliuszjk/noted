import { expect, test } from 'vitest';
import * as Y from 'yjs';
import { generateKey } from '@noted/crypto';
import { docFromSealed, sealDoc, mergeRemote } from './index';

const text = (d: Y.Doc) => d.getText('t').toString();

// A copy of a doc with its own client id, like a second device.
const fork = (d: Y.Doc) => {
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(d));
  return copy;
};

test('concurrent offline edits merge and both sides converge', () => {
  const key = generateKey();
  const base = new Y.Doc();
  base.getText('t').insert(0, 'hello');
  const a = fork(base);
  const b = fork(base);
  a.getText('t').insert(0, 'A-');
  b.getText('t').insert(5, '-B');

  const sealedA = sealDoc(key, a);
  const sealedB = sealDoc(key, b);
  mergeRemote(key, a, sealedB);
  mergeRemote(key, b, sealedA);

  expect(text(a)).toBe(text(b));
  expect(text(a)).toContain('A-');
  expect(text(a)).toContain('-B');
  expect(text(a)).toContain('hello');
});

test('identical states report no change on either side', () => {
  const key = generateKey();
  const a = new Y.Doc();
  a.getText('t').insert(0, 'same');
  const copy = fork(a);
  expect(mergeRemote(key, a, sealDoc(key, copy))).toEqual({
    changedLocal: false,
    changedRemote: false,
  });
});

test('merging the same remote state twice does not change local again', () => {
  const key = generateKey();
  const a = new Y.Doc();
  a.getText('t').insert(0, 'x');
  const b = new Y.Doc();
  b.getText('t').insert(0, 'y');
  const sealedB = sealDoc(key, b);

  expect(mergeRemote(key, a, sealedB).changedLocal).toBe(true);
  expect(mergeRemote(key, a, sealedB).changedLocal).toBe(false);
});

test('a deletion-only difference is detected and propagates', () => {
  const key = generateKey();
  const a = new Y.Doc();
  a.getText('t').insert(0, 'hello');
  const stale = fork(a);
  const b = fork(a);
  a.getText('t').delete(2, 3);

  const toB = mergeRemote(key, b, sealDoc(key, a));
  expect(toB.changedLocal).toBe(true);
  expect(text(b)).toBe('he');

  const toA = mergeRemote(key, a, sealDoc(key, stale));
  expect(toA.changedLocal).toBe(false);
  expect(toA.changedRemote).toBe(true);
});

test('empty remote means local content needs pushing', () => {
  const key = generateKey();
  const a = new Y.Doc();
  a.getText('t').insert(0, 'x');
  expect(mergeRemote(key, a, null)).toEqual({ changedLocal: false, changedRemote: true });
  expect(mergeRemote(key, new Y.Doc(), null)).toEqual({ changedLocal: false, changedRemote: false });
});

test('a wrong key throws instead of corrupting the doc', () => {
  const sealed = sealDoc(generateKey(), fork(new Y.Doc()));
  expect(() => mergeRemote(generateKey(), new Y.Doc(), sealed)).toThrow();
});

test('sealed state round-trips through docFromSealed', () => {
  const key = generateKey();
  const a = new Y.Doc();
  a.getText('t').insert(0, 'round trip');
  expect(text(docFromSealed(key, sealDoc(key, a)))).toBe('round trip');
});

test('data sealed with a legacy key opens through fallback keys and heals on re-seal', () => {
  const key = generateKey();
  const legacy = new Uint8Array(32);
  const damaged = new Y.Doc();
  damaged.getText('t').insert(0, 'written with the wrong key');
  const sealedLegacy = sealDoc(legacy, damaged);

  const mine = new Y.Doc();
  mine.getText('t').insert(0, 'good copy ');

  expect(() => mergeRemote(key, new Y.Doc(), sealedLegacy)).toThrow();
  expect(mergeRemote(key, mine, sealedLegacy, [legacy]).changedLocal).toBe(true);
  expect(text(mine)).toContain('written with the wrong key');
  expect(text(mine)).toContain('good copy');

  // Once re-sealed with the real key no fallback is needed.
  expect(text(docFromSealed(key, sealDoc(key, mine)))).toBe(text(mine));
});
