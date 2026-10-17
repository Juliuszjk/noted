import { describe, it, expect } from 'vitest';
import type { SlashItem } from './slash';
import { initialNav, navigate, activate, hover, searchNav, TABLE_MAX_COLS } from './slash-nav';
import type { NavLevel } from './slash-nav';
import { slashItems } from './slash-items';

const leaf = (title: string): SlashItem => ({ title, command: () => {} });
const tiles = (n: number): SlashItem[] => Array.from({ length: n }, (_, i) => leaf(`t${i}`));

const root: SlashItem[] = [
  leaf('one'),
  { title: 'sub', submenu: { kind: 'list', items: [leaf('a'), leaf('b')] } },
  { title: 'tiles', submenu: { kind: 'tiles', columns: 3, items: tiles(6) } },
  { title: 'table', submenu: { kind: 'table' } },
];

const press = (model: ReturnType<typeof initialNav>, ...keys: string[]) => {
  let result = { handled: false, model } as ReturnType<typeof navigate>;
  for (const key of keys) result = navigate(result.model, key);
  return result;
};

describe('slash navigation', () => {
  it('wraps around in the root list', () => {
    expect(press(initialNav(root), 'ArrowUp').model[0]).toMatchObject({ index: 3 });
    expect(press(initialNav(root), 'ArrowUp', 'ArrowDown').model[0]).toMatchObject({ index: 0 });
  });

  it('runs a leaf on Enter', () => {
    const result = press(initialNav(root), 'Enter');
    expect(result.action).toMatchObject({ type: 'run', item: { title: 'one' } });
  });

  it('opens a submenu with Enter or ArrowRight and closes it with ArrowLeft/Escape', () => {
    const open = press(initialNav(root), 'ArrowDown', 'Enter');
    expect(open.model).toHaveLength(2);
    expect(open.model[1]).toMatchObject({ kind: 'list', index: 0 });
    expect(press(initialNav(root), 'ArrowDown', 'ArrowRight').model).toHaveLength(2);
    expect(press(open.model, 'ArrowLeft').model).toHaveLength(1);
    expect(press(open.model, 'Escape').model).toHaveLength(1);
  });

  it('lets Escape and ArrowLeft through at the root', () => {
    expect(press(initialNav(root), 'Escape').handled).toBe(false);
    expect(press(initialNav(root), 'ArrowLeft').handled).toBe(false);
  });

  it('moves through tiles in a grid and goes back from the first column', () => {
    const open = press(initialNav(root), 'ArrowDown', 'ArrowDown', 'Enter').model;
    expect(open[1]).toMatchObject({ kind: 'tiles', index: 0 });
    expect(press(open, 'ArrowDown').model[1]).toMatchObject({ index: 3 });
    expect(press(open, 'ArrowRight', 'ArrowRight', 'ArrowRight').model[1]).toMatchObject({ index: 3 });
    expect(press(open, 'ArrowRight', 'ArrowLeft').model[1]).toMatchObject({ index: 0 });
    expect(press(open, 'ArrowLeft').model).toHaveLength(1);
    expect(press(open, 'ArrowRight', 'Enter').action).toMatchObject({ type: 'run', item: { title: 't1' } });
  });

  it('resizes the table picker and inserts or imports', () => {
    const open = press(initialNav(root), 'ArrowDown', 'ArrowDown', 'ArrowDown', 'Enter').model;
    expect(open[1]).toMatchObject({ kind: 'table', cols: 3, rows: 3 });
    const resized = press(open, 'ArrowRight', 'ArrowDown');
    expect(resized.model[1]).toMatchObject({ cols: 4, rows: 4 });
    expect(press(resized.model, 'Enter').action).toEqual({ type: 'table-insert', cols: 4, rows: 4 });
    const maxed = press(open, ...Array<string>(20).fill('ArrowRight'));
    expect(maxed.model[1]).toMatchObject({ cols: TABLE_MAX_COLS });
    const csv = press(open, 'ArrowUp', 'ArrowUp', 'ArrowUp');
    expect(csv.model[1]).toMatchObject({ csvFocused: true });
    expect(press(csv.model, 'Enter').action).toEqual({ type: 'table-csv' });
    expect(press(csv.model, 'ArrowDown').model[1]).toMatchObject({ csvFocused: false });
  });

  it('hover selects a row and opens its submenu', () => {
    const model = hover(initialNav(root), 0, 1);
    expect(model).toHaveLength(2);
    expect(hover(model, 0, 0)).toHaveLength(1);
  });

  it('activate ignores rows without action', () => {
    expect(activate(initialNav(root), undefined).action).toBeUndefined();
  });
});

const titlesOf = (level: NavLevel): string[] => (level.kind === 'table' ? [] : level.items.map((i) => i.title));

describe('slash items', () => {
  it('has a compact root menu', () => {
    expect(slashItems.map((i) => i.title)).toEqual(['Heading', 'Quote', 'List', 'Divider', 'Code block', 'Table', 'Image', 'File', 'Callout', 'Math', 'Reminder', 'Link to note', 'Link from another note', 'Go to note', 'Notebook', 'Tag', 'Export', 'Publish']);
  });
});

describe('slash search', () => {
  const search = (q: string) => searchNav(slashItems, q);

  it('opens the category submenu for a unique category match', () => {
    const model = search('list');
    expect(model).toHaveLength(1);
    expect(titlesOf(model[0])).toEqual(['Bullet list', 'Numbered list', 'Task list', 'Outline list']);
  });

  it('jumps straight to the style choice', () => {
    const model = search('bull');
    expect(model).toHaveLength(1);
    expect(model[0].kind).toBe('tiles');
    expect(titlesOf(model[0])).toEqual(['Disc', 'Circle', 'Square', 'Open square']);
  });

  it('shows all headings for "head"', () => {
    expect(titlesOf(search('head')[0])).toHaveLength(6);
  });

  it('lists several category matches in one panel, matching inside words', () => {
    const model = search('bl');
    expect(titlesOf(model[0])).toEqual(['Code block', 'Table', 'Publish', 'Math › Math block']);
    expect(model[0]).toMatchObject({ divider: 3 });
  });

  it('finds /goto and /linkto by keyword', () => {
    expect(titlesOf(search('goto')[0])).toEqual(['Go to note']);
    expect(titlesOf(search('linkto')[0])).toEqual(['Link from another note']);
  });

  it('finds callout variants and math by keyword', () => {
    expect(titlesOf(search('warn')[0])).toEqual(['Warning callout']);
    expect(titlesOf(search('latex')[0])).toEqual(['Inline math', 'Math block']);
  });

  it('puts deeper matches below the categories', () => {
    const tree: SlashItem[] = [
      leaf('Code block'),
      { title: 'List', submenu: { kind: 'list', items: [leaf('Black list'), leaf('Task list')] } },
      leaf('Table'),
    ];
    const model = searchNav(tree, 'bl');
    expect(titlesOf(model[0])).toEqual(['Code block', 'Table', 'List › Black list']);
    expect(model[0]).toMatchObject({ divider: 2 });
  });

  it('falls back to keywords and narrows the tiles', () => {
    const model = search('roman');
    expect(model[0].kind).toBe('tiles');
    expect(titlesOf(model[0])).toEqual(['I, II, III', 'i, ii, iii']);
    expect(titlesOf(search('h3')[0])).toEqual(['Heading 3']);
  });

  it('finds the CSV import and the table picker', () => {
    expect(titlesOf(search('csv')[0])).toEqual(['Import CSV']);
    expect(search('tab')[0].kind).toBe('table');
  });

  it('handles no results and an empty query', () => {
    expect(titlesOf(search('zzz')[0])).toEqual([]);
    expect(search('')).toEqual(initialNav(slashItems));
  });
});
