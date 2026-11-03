import { describe, it, expect } from 'vitest';
import { archivedNotebooks, visibleNotebooks, notebookArchiveTargets } from './notebook-archive';
import type { NoteListItem } from './note-list';

const note = (id: string, notebooks: string[], extra: Partial<NoteListItem> = {}): NoteListItem =>
  ({ id, title: id, excerpt: '', pinned: false, updatedAt: 0, notebooks, ...extra });

// Studia > Rok 2 > Semestr 3 / Semestr 4 / Semestr 5 (new, empty); Linux.
const tree = [
  { id: 'studia', parent: null },
  { id: 'rok2', parent: 'studia' },
  { id: 's3', parent: 'rok2' },
  { id: 's4', parent: 'rok2' },
  { id: 'linux', parent: null },
  { id: 'empty', parent: null },
];

describe('archivedNotebooks', () => {
  it('hides notebooks whose notes are all archived, counting sub-notebooks', () => {
    const items = [
      note('a', ['s3'], { archived: true }),
      note('b', ['s4'], { archived: true }),
      note('c', ['s4'], { archived: true, trashedAt: 1 }),
      note('d', ['s4'], { trashedAt: 1 }),
      note('e', ['linux']),
    ];
    expect([...archivedNotebooks(tree, items)].sort()).toEqual(['rok2', 's3', 's4', 'studia']);
  });

  it('keeps a parent with live notes but hides its archived children', () => {
    const items = [note('a', ['s3'], { archived: true }), note('b', ['s4']), note('c', ['studia'])];
    expect([...archivedNotebooks(tree, items)]).toEqual(['s3']);
  });

  it('keeps empty notebooks and the parents of empty ones', () => {
    const t = [...tree, { id: 's5', parent: 'rok2' }];
    const items = [note('a', ['s3'], { archived: true }), note('b', ['s4'], { archived: true })];
    expect([...archivedNotebooks(t, items)].sort()).toEqual(['s3', 's4']);
    // Only trashed notes: counts as empty.
    expect(archivedNotebooks(tree, [note('x', ['linux'], { trashedAt: 1 })]).has('linux')).toBe(false);
    expect(archivedNotebooks(tree, []).size).toBe(0);
  });

  it('a note in two notebooks counts in each', () => {
    const items = [note('a', ['s3', 'linux'], { archived: true }), note('b', ['linux'])];
    const hidden = archivedNotebooks(tree, items);
    expect(hidden.has('s3')).toBe(true);
    expect(hidden.has('linux')).toBe(false);
  });
});

describe('visibleNotebooks', () => {
  const hidden = new Set(['s3']);
  it('leaves hidden ones out, except in the Archive view or while one of them is open', () => {
    expect(visibleNotebooks(tree, hidden, { kind: 'notes' }).map((n) => n.id)).not.toContain('s3');
    expect(visibleNotebooks(tree, hidden, { kind: 'notebook', id: 'linux' }).map((n) => n.id)).not.toContain('s3');
    expect(visibleNotebooks(tree, hidden, { kind: 'archive' })).toHaveLength(tree.length);
    expect(visibleNotebooks(tree, hidden, { kind: 'notebook', id: 's3' })).toHaveLength(tree.length);
  });
});

describe('notebookArchiveTargets', () => {
  it('lists the notes that change, skipping trashed ones', () => {
    const items = [
      note('a', ['s3']), note('b', ['s4'], { archived: true }), note('c', ['s3'], { trashedAt: 1 }),
      note('d', ['linux']), note('e', ['s4', 'linux'], { locked: true }),
    ];
    const ids = new Set(['rok2', 's3', 's4']);
    expect(notebookArchiveTargets(items, ids, true)).toEqual(['a', 'e']);
    expect(notebookArchiveTargets(items, ids, false)).toEqual(['b']);
  });
});
