import { describe, it, expect } from 'vitest';
import { buildLinkTree, foldTree } from './link-tree';

const n = (id: string, links: string[] = []) => ({ id, title: id.toUpperCase(), links });
const draw = (notes: ReturnType<typeof n>[]) => buildLinkTree(notes).map((r) => `${r.prefix}${r.title}${r.cycle ? ' ↻' : ''}`);

describe('buildLinkTree', () => {
  it('draws parents and children like `tree`', () => {
    expect(draw([
      n('sem5', ['med', 'net']), n('med', ['lab1', 'lab2']), n('lab1'), n('lab2'), n('net', ['lab3']), n('lab3'), n('loose'),
    ])).toEqual([
      'SEM5',
      '├── MED',
      '│   ├── LAB1',
      '│   └── LAB2',
      '└── NET',
      '    └── LAB3',
    ]);
  });

  it('marks cycles and still shows notes only reachable through one', () => {
    expect(draw([n('a', ['b']), n('b', ['a'])])).toEqual(['A', '└── B', '    └── A ↻']);
  });

  it('ignores links to missing notes and to itself', () => {
    expect(draw([n('a', ['a', 'gone']), n('b', ['a'])])).toEqual(['B', '└── A']);
    expect(draw([n('a', ['a', 'gone'])])).toEqual([]);
  });

  it('shows only the open note when asked, and folds branches', () => {
    const notes = [n('sem5', ['med', 'net']), n('med', ['lab1']), n('lab1'), n('net'), n('other', ['net'])];
    expect(buildLinkTree(notes, 'med').map((r) => r.prefix + r.title)).toEqual(['MED', '└── LAB1']);
    const rows = buildLinkTree(notes, 'sem5');
    expect(foldTree(rows, new Set(['sem5/med'])).map((r) => r.title)).toEqual(['SEM5', 'MED', 'NET']);
  });
});
