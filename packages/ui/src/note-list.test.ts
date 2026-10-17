import { describe, it, expect } from 'vitest';
import { filterNotes, searchSections, searchHighlights, groupNotes, notesInView, relativeTime, sortNotes } from './note-list';

const DAY = 86_400_000;
const now = 1_000 * DAY;
const note = (id: string, ageDays: number, pinned = false, title = id, excerpt = '') =>
  ({ id, title, excerpt, pinned, updatedAt: now - ageDays * DAY });

describe('note list', () => {
  it('formats compact ages', () => {
    expect(relativeTime(now - 1000, now)).toBe('now');
    expect(relativeTime(now - 11_000, now)).toBe('11s');
    expect(relativeTime(now - 90_000, now)).toBe('1m');
    expect(relativeTime(now - 2 * DAY, now)).toBe('2d');
    expect(relativeTime(now - 8 * DAY, now)).toBe('1w');
    expect(relativeTime(now - 95 * DAY, now)).toBe('3mo');
    expect(relativeTime(now - 400 * DAY, now)).toBe('1y');
  });

  it('groups into pinned, recent, last week and older', () => {
    const sections = groupNotes([note('a', 1), note('p', 50, true), note('b', 9), note('c', 60), note('d', 0)], now);
    expect(sections.map((s) => [s.title, s.items.map((n) => n.id)])).toEqual([
      ['Pinned', ['p']], ['Recent', ['d', 'a']], ['Last week', ['b']], ['Older', ['c']],
    ]);
  });

  it('searches titles and text, all words, ignoring accents', () => {
    const items = [note('1', 0, false, 'Zakupy na jutro'), note('2', 0, false, 'Plan', 'wakacje w Łodzi')];
    expect(filterNotes(items, 'zakupy').map((n) => n.id)).toEqual(['1']);
    expect(filterNotes(items, 'lodzi plan').map((n) => n.id)).toEqual(['2']);
    expect(filterNotes(items, '  ')).toHaveLength(2);
  });

  it('finds words deep in the text and shows them as the excerpt', () => {
    const items = [note('1', 0, false, 'Zakupy'), note('2', 0, false, 'Plan')];
    const long = `${'tekst '.repeat(40)}tutaj jest Pierogi z serem i dalej`;
    const found = filterNotes(items, 'pierogi', (id) => (id === '2' ? long : ''));
    expect(found.map((n) => n.id)).toEqual(['2']);
    expect(found[0].excerpt).toMatch(/^….*Pierogi z serem/);
  });
});

describe('views and sorting', () => {
  const items = [
    { ...note('live', 1), notebooks: ['nb'], tags: ['t'], created: now - 50 * DAY },
    { ...note('fav', 2), favorite: true, created: now - 1 * DAY, title: 'B' },
    { ...note('arch', 3), archived: true, notebooks: ['nb'] },
    { ...note('trashed', 4), trashedAt: now, favorite: true, tags: ['t'] },
  ];
  const ids = (list: { id: string }[]) => list.map((n) => n.id);

  it('filters by view', () => {
    expect(ids(notesInView(items, { kind: 'notes' }))).toEqual(['live', 'fav']);
    expect(ids(notesInView(items, { kind: 'favorites' }))).toEqual(['fav']);
    expect(ids(notesInView(items, { kind: 'archive' }))).toEqual(['arch']);
    expect(ids(notesInView(items, { kind: 'trash' }))).toEqual(['trashed']);
    expect(ids(notesInView(items, { kind: 'notebook', id: 'nb' }))).toEqual(['live', 'arch']);
    expect(ids(notesInView(items, { kind: 'tag', id: 't' }))).toEqual(['live']);
  });

  it('sorts by edit, creation or title', () => {
    expect(ids(sortNotes(items.slice(0, 2), 'edited'))).toEqual(['live', 'fav']);
    expect(ids(sortNotes(items.slice(0, 2), 'created'))).toEqual(['fav', 'live']);
    expect(ids(sortNotes(items.slice(0, 2), 'title'))).toEqual(['fav', 'live']);
    expect(groupNotes(items.slice(0, 2), now, 'title').map((s) => s.title)).toEqual(['A–Z']);
  });
});

describe('grouping by notebook and tag', () => {
  it('makes one section per name, with the rest at the end', () => {
    const items = [
      { ...note('a', 1), notebooks: ['n1'], tags: ['t1', 't2'] },
      { ...note('b', 2), notebooks: ['n2'], tags: ['t2'] },
      { ...note('c', 3) },
    ];
    const names = { notebooks: new Map([['n1', 'Studia'], ['n2', 'Dom']]), tags: new Map([['t1', 'analiza'], ['t2', 'egzamin']]) };
    const titles = (sections: { title: string; items: { id: string }[] }[]) => sections.map((s) => [s.title, s.items.map((i) => i.id)]);
    expect(titles(groupNotes(items, now, 'notebook', names))).toEqual([['Dom', ['b']], ['Studia', ['a']], ['No notebook', ['c']]]);
    expect(titles(groupNotes(items, now, 'tag', names))).toEqual([['#analiza', ['a']], ['#egzamin', ['a', 'b']], ['No tags', ['c']]]);
  });
});

it('search shows title matches before text matches', () => {
  const mk = (id: string, title: string, excerpt: string, updatedAt: number) => ({ id, title, excerpt, updatedAt, createdAt: updatedAt, pinned: false } as any);
  const list = [mk('a', 'Notes', 'buy milk', 3), mk('b', 'Milk recipes', '', 1), mk('c', 'Other', '', 2)];
  const sections = searchSections(list, 'milk', 'edited', (id) => (id === 'c' ? 'warm milk' : ''));
  expect(sections.map((s) => [s.title, s.items.map((n) => n.id)])).toEqual([['Title', ['b']], ['In the text', ['a', 'c']]]);
});

it('a space after a word means the word ends there; matches are highlighted', () => {
  const mk = (id: string, title: string) => ({ id, title, excerpt: '', updatedAt: 1, pinned: false } as any);
  const list = [mk('1', 'Zaliczenie'), mk('2', 'al egzamin'), mk('3', 'Ąl notes')];
  expect(filterNotes(list, 'al').map((n) => n.id)).toEqual(['1', '2', '3']);
  expect(filterNotes(list, 'Al ').map((n) => n.id)).toEqual(['2', '3']);
  expect(filterNotes(list, ' egz').map((n) => n.id)).toEqual(['2']);
  expect(searchHighlights('Ąl notes', 'al')).toEqual([{ text: 'Ąl', hit: true }, { text: ' notes', hit: false }]);
});
