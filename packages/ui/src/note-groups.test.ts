import { describe, expect, it } from 'vitest';
import { buildNoteRows, treeRows, isFolded, linkDescendants } from './note-groups';
import type { ListRow } from './note-groups';
import type { NoteListItem } from './note-list';

const DAY = 86_400_000;
const NOW = 100 * DAY;
const note = (id: string, title: string, extra: Partial<NoteListItem> = {}): NoteListItem =>
  ({ id, title, excerpt: '', pinned: false, updatedAt: NOW - 30 * DAY, ...extra });
const view = (rows: ListRow[]) => rows.map((r) => (r.kind === 'header' ? `[${r.title}${r.collapsed ? '+' : ''}]` : `${'  '.repeat(r.depth)}${r.item.title}${r.collapsed ? '+' : ''}`));

const links: Record<string, string[]> = { s5: ['im', 'io', 'w5'], im: ['l1', 'l2', 'l10'], io: ['i1'] };
const linksOf = (id: string) => links[id] ?? [];
const studia = ['nb1'];
const items = [
  note('s5', 'Semestr 5', { notebooks: studia }),
  note('im', 'Informatyka medyczna', { notebooks: studia, tags: ['t1'] }),
  note('l1', 'Lab 1', { notebooks: studia, tags: ['t1'] }),
  note('l2', 'Lab 2', { notebooks: studia, tags: ['t1'] }),
  note('l10', 'Lab 10', { notebooks: studia, tags: ['t1'] }),
  note('io', 'Inżynieria oprogramowania 2', { notebooks: studia }),
  note('i1', 'Lab 1 IO', { notebooks: studia }),
  note('w5', 'Wykłady s5', { notebooks: studia }),
  note('x', 'Zakupy', { pinned: true }),
  note('r', 'Recent one', { updatedAt: NOW - DAY }),
];
const names = { notebooks: new Map([['nb1', 'Studia']]), tags: new Map([['t1', 'informatyka medyczna']]) };

describe('note groups', () => {
  it('builds a tree from note links inside a notebook (children by title, numbers in order)', () => {
    const rows = treeRows('nb:nb1', items.filter((n) => n.notebooks?.includes('nb1')), 'edited', linksOf, new Set());
    expect(view(rows)).toEqual([
      'Semestr 5',
      '  Informatyka medyczna',
      '    Lab 1', '    Lab 2', '    Lab 10',
      '  Inżynieria oprogramowania 2',
      '    Lab 1 IO',
      '  Wykłady s5',
    ]);
  });

  it('folds a branch (its notes do not reappear as top notes)', () => {
    const rows = treeRows('nb:nb1', items.filter((n) => n.notebooks?.includes('nb1')), 'edited', linksOf, new Set(['nb:nb1>im']));
    expect(view(rows)).toContain('  Informatyka medyczna+');
    expect(view(rows).join('|')).not.toMatch(/Lab 2/);
    const top = treeRows('nb:nb1', items.filter((n) => n.notebooks?.includes('nb1')), 'edited', linksOf, new Set(['nb:nb1>s5']));
    expect(view(top)).toEqual(['Semestr 5+']);
  });

  it('shows Pinned, Recent and folded notebook groups', () => {
    const rows = buildNoteRows(items, { view: { kind: 'notes' }, grouping: 'notebook', sort: 'edited', now: NOW, names, linksOf, toggled: new Set() });
    expect(view(rows)).toEqual(['[Pinned]', 'Zakupy', '[Recent]', 'Recent one', '[Studia+]', '[No notebook+]']);
    const open = buildNoteRows(items, { view: { kind: 'notes' }, grouping: 'notebook', sort: 'edited', now: NOW, names, linksOf, toggled: new Set(['nb:nb1']) });
    expect(view(open).slice(4, 7)).toEqual(['[Studia]', 'Semestr 5', '  Informatyka medyczna']);
  });

  it('builds the tree under a tag from the notes having it', () => {
    const rows = buildNoteRows(items, { view: { kind: 'notes' }, grouping: 'tag', sort: 'edited', now: NOW, names, linksOf, toggled: new Set(['tag:t1']) });
    const i = view(rows).indexOf('[#informatyka medyczna]');
    expect(view(rows).slice(i, i + 5)).toEqual(['[#informatyka medyczna]', 'Informatyka medyczna', '  Lab 1', '  Lab 2', '  Lab 10']);
  });

  it('groups A-Z by first letter without trees', () => {
    const rows = buildNoteRows(items, { view: { kind: 'notes' }, grouping: 'az', sort: 'edited', now: NOW, names, linksOf, toggled: new Set(['az:L']) });
    const i = view(rows).indexOf('[L]');
    expect(view(rows).slice(i, i + 5)).toEqual(['[L]', 'Lab 1', 'Lab 1 IO', 'Lab 2', 'Lab 10']);
  });

  it('survives loops of links', () => {
    const loop = [note('a', 'A'), note('b', 'B')];
    const rows = treeRows('g', loop, 'title', (id) => (id === 'a' ? ['b'] : ['a']), new Set());
    expect(view(rows)).toEqual(['A', '  B']);
  });

  it('knows the default fold of keys', () => {
    expect(isFolded('nb:x', new Set())).toBe(true);
    expect(isFolded('recent', new Set())).toBe(false);
    expect(isFolded('nb:x', new Set(['nb:x']))).toBe(false);
  });

  it('finds the notes under a root (not its ancestors)', () => {
    const notes = Object.entries({ ...links, l1: ['s5'], studia: ['s5'] }).map(([id, l]) => ({ id, links: l }))
      .concat(['l2', 'l10', 'i1', 'w5'].map((id) => ({ id, links: [] })));
    expect(linkDescendants(['s5'], notes).sort()).toEqual(['i1', 'im', 'io', 'l1', 'l10', 'l2', 'w5']);
    expect(linkDescendants(['im'], notes).sort()).toEqual(['l1', 'l10', 'l2']);
    // A child linking up to the grandparent does not take the grandparent along.
    const up = [{ id: 'studia', links: ['s5'] }, { id: 's5', links: ['w5'] }, { id: 'w5', links: ['studia'] }, { id: 'home', links: ['studia'] }];
    expect(linkDescendants(['s5'], up)).toEqual(['w5']);
  });

  it('groups inside a notebook by tags (and is the plain tree when grouped by notebooks)', () => {
    const inNb = items.filter((n) => n.notebooks?.includes('nb1'));
    const tree = buildNoteRows(inNb, { view: { kind: 'notebook', id: 'nb1' }, grouping: 'notebook', sort: 'edited', now: NOW, names, linksOf, toggled: new Set() });
    expect(view(tree)[0]).toBe('Semestr 5');
    const byTag = buildNoteRows(inNb, { view: { kind: 'notebook', id: 'nb1' }, grouping: 'tag', sort: 'edited', now: NOW, names, linksOf, toggled: new Set(['tag:t1']) });
    expect(view(byTag).slice(0, 3)).toEqual(['[#informatyka medyczna]', 'Informatyka medyczna', '  Lab 1']);
    expect(view(byTag)).toContain('[No tags+]');
  });
});
