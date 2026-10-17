import { describe, expect, it } from 'vitest';
import { notePlaces } from './note-place';

const names = { notebooks: new Map([['b1', 'Studia'], ['b2', 'Fizyka']]), tags: new Map([['t1', 'lab']]) };

describe('notePlaces', () => {
  it('lists notebooks (no tags), the linking note and the age', () => {
    const now = 10 * 86400000;
    const places = notePlaces([
      { id: 'a', title: 'Lab1', notebooks: ['b2', 'b1'], tags: ['t1'], updatedAt: now - 2 * 86400000 },
      { id: 'p', title: 'Semestr 3', links: ['a', 'a'] },
      { id: 'q', title: 'Archiwum', links: ['a'], archived: true },
    ], names, now);
    expect(places.a).toBe('Fizyka, Studia · from Archiwum +1 · 2d');
    expect(places.p).toBe('No notebook');
    expect(places.q).toBe('No notebook · Archived');
  });

  it('skips unknown catalog ids and self links', () => {
    const places = notePlaces([{ id: 'a', title: 'A', notebooks: ['gone'], links: ['a'] }], names);
    expect(places.a).toBe('No notebook');
  });
});
