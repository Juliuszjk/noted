// Note links drawn as a tree, like the `tree` command: a note that links to other notes is a
// parent of them. Roots are notes with links that no other note links to; notes caught only
// in link cycles get a root of their own afterwards. A note met again on its own path (a
// cycle) is shown once more, marked, without its children.

export interface TreeNote {
  id: string;
  title: string;
  // Ids of linked notes, in the order they appear in the note.
  links: string[];
}

export interface TreeRow {
  // Unique per row (the same note can appear under several parents).
  key: string;
  id: string;
  title: string;
  // Box-drawing prefix, e.g. "│   ├── ".
  prefix: string;
  depth: number;
  // The note is one of its own ancestors here.
  cycle: boolean;
  hasChildren: boolean;
}

const MAX_DEPTH = 16;

// `rootId`: only that note and what it links to (the open note); otherwise every tree.
export const buildLinkTree = (notes: TreeNote[], rootId?: string | null): TreeRow[] => {
  const byId = new Map(notes.map((n) => [n.id, n]));
  const childrenOf = (n: TreeNote) => [...new Set(n.links)].filter((id) => id !== n.id && byId.has(id));
  const linked = new Set<string>();
  for (const n of notes) for (const id of childrenOf(n)) linked.add(id);
  const byTitle = (a: TreeNote, b: TreeNote) => a.title.localeCompare(b.title);

  const rows: TreeRow[] = [];
  const shown = new Set<string>();
  const walk = (note: TreeNote, prefix: string, childPrefix: string, path: string[]) => {
    const cycle = path.includes(note.id);
    const children = cycle || path.length >= MAX_DEPTH ? [] : childrenOf(note).map((id) => byId.get(id)!);
    shown.add(note.id);
    rows.push({ key: [...path, note.id].join('/'), id: note.id, title: note.title, prefix, depth: path.length, cycle, hasChildren: childrenOf(note).length > 0 });
    children.forEach((child, i) => {
      const last = i === children.length - 1;
      walk(child, childPrefix + (last ? '└── ' : '├── '), childPrefix + (last ? '    ' : '│   '), [...path, note.id]);
    });
  };

  const root = rootId ? byId.get(rootId) : undefined;
  if (root) {
    walk(root, '', '', []);
    return rows;
  }
  const parents = notes.filter((n) => childrenOf(n).length > 0);
  for (const root of parents.filter((n) => !linked.has(n.id)).sort(byTitle)) walk(root, '', '', []);
  // Notes only reachable through a cycle.
  for (const rest of parents.sort(byTitle)) if (!shown.has(rest.id)) walk(rest, '', '', []);
  return rows;
};

// Rows whose title contains the query, with their ancestors (so the branch stays readable).
export const filterTree = (rows: TreeRow[], query: string): TreeRow[] => {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return rows;
  const keep = new Set<string>();
  for (const row of rows) {
    if (!row.title.toLocaleLowerCase().includes(q)) continue;
    const parts = row.key.split('/');
    for (let i = 1; i <= parts.length; i++) keep.add(parts.slice(0, i).join('/'));
  }
  return rows.filter((r) => keep.has(r.key));
};

// Rows left after folding: the descendants of a collapsed row are hidden.
export const foldTree = (rows: TreeRow[], collapsed: ReadonlySet<string>): TreeRow[] => {
  if (collapsed.size === 0) return rows;
  return rows.filter((row) => {
    const parts = row.key.split('/');
    for (let i = 1; i < parts.length; i++) if (collapsed.has(parts.slice(0, i).join('/'))) return false;
    return true;
  });
};
