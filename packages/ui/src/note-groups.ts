// The note list as rows (desktop NoteList and the phone's list): Pinned, Recent, then the
// notes grouped by notebook / tag / first letter (or the old date sections). Inside a
// notebook or tag the notes form a tree from their note links: a note that another note of
// the same group links to is shown under it (indented), so "Semestr 5 > Informatyka medyczna
// > Lab 1" reads as a tree. Every header and every note with children folds.
import { groupNotes, sortNotes } from './note-list';
import type { CatalogNames, NoteListItem, NoteSort, NoteView } from './note-list';

export type NoteGrouping = 'notebook' | 'tag' | 'az' | 'date';

export type ListRow =
  | { kind: 'header'; key: string; title: string; count: number; collapsed: boolean }
  | { kind: 'note'; key: string; item: NoteListItem; depth: number; hasChildren: boolean; collapsed: boolean; foldKey: string };

export interface RowOptions {
  view: NoteView;
  grouping: NoteGrouping;
  sort: NoteSort;
  now: number;
  names?: CatalogNames;
  // Ids of the notes a note links to (note meta `links`).
  linksOf: (id: string) => string[];
  // Keys the user folded / unfolded: each key is flipped against its default (group headers
  // start folded, Pinned / Recent and tree branches start open).
  toggled: ReadonlySet<string>;
}

export const RECENT_DAYS = 7;
export const RECENT_MAX = 10;
const DAY = 24 * 60 * 60 * 1000;

// Default fold state of a key: notebook / tag / letter groups start folded (the list stays
// short), everything else open.
const foldedByDefault = (key: string) => /^(nb|tag|az):[^>]*$/.test(key);
export const isFolded = (key: string, toggled: ReadonlySet<string>): boolean => foldedByDefault(key) !== toggled.has(key);

const byTitle = (a: NoteListItem, b: NoteListItem) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' });
const order = (items: NoteListItem[], sort: NoteSort): NoteListItem[] =>
  sort === 'title' ? [...items].sort(byTitle) : sortNotes(items, sort === 'created' ? 'created' : 'edited');

// Rows of one group as a tree of its note links. Top level in the chosen order; children by
// title (Lab 1, Lab 2, … Lab 10). A note linked from two notes of the group is under both;
// a loop of links shows each note once on that path.
export const treeRows = (groupKey: string, items: NoteListItem[], sort: NoteSort, linksOf: (id: string) => string[], toggled: ReadonlySet<string>): ListRow[] => {
  const byId = new Map(items.map((n) => [n.id, n]));
  const children = new Map<string, NoteListItem[]>();
  const linked = new Set<string>();
  for (const n of items) {
    const kids = [...new Set(linksOf(n.id))].filter((id) => id !== n.id && byId.has(id)).map((id) => byId.get(id)!).sort(byTitle);
    children.set(n.id, kids);
    kids.forEach((k) => linked.add(k.id));
  }
  const rows: ListRow[] = [];
  const shown = new Set<string>();
  const emit = (n: NoteListItem, depth: number, path: Set<string>) => {
    const kids = (children.get(n.id) ?? []).filter((k) => !path.has(k.id));
    const foldKey = `${groupKey}>${n.id}`;
    const collapsed = kids.length > 0 && isFolded(foldKey, toggled);
    rows.push({ kind: 'note', key: `${groupKey}/${[...path, n.id].join('/')}`, item: n, depth, hasChildren: kids.length > 0, collapsed, foldKey });
    if (collapsed) return;
    for (const k of kids) emit(k, depth + 1, new Set([...path, n.id]));
  };
  // Everything under a top note counts as placed, folded or not (a folded child must not
  // show up again as a top note).
  const reach = (id: string) => {
    if (shown.has(id)) return;
    shown.add(id);
    for (const k of children.get(id) ?? []) reach(k.id);
  };
  const tops = order(items.filter((n) => !linked.has(n.id)), sort);
  // Notes only reachable through a loop of links: the first of each loop becomes a top note.
  tops.forEach((n) => reach(n.id));
  for (const n of order(items, sort)) {
    if (shown.has(n.id)) continue;
    tops.push(n);
    reach(n.id);
  }
  for (const n of tops) emit(n, 0, new Set());
  return rows;
};

const header = (key: string, title: string, count: number, toggled: ReadonlySet<string>): ListRow =>
  ({ kind: 'header', key, title, count, collapsed: isFolded(key, toggled) });

// Rows of a group: its header and, unless folded, its notes.
const group = (rows: ListRow[], key: string, title: string, items: NoteListItem[], body: () => ListRow[], toggled: ReadonlySet<string>) => {
  if (items.length === 0) return;
  const h = header(key, title, items.length, toggled);
  rows.push(h);
  if (h.kind === 'header' && !h.collapsed) rows.push(...body());
};

const flat = (key: string, items: NoteListItem[]): ListRow[] =>
  items.map((n) => ({ kind: 'note' as const, key: `${key}/${n.id}`, item: n, depth: 0, hasChildren: false, collapsed: false, foldKey: `${key}>${n.id}` }));

export const buildNoteRows = (items: NoteListItem[], o: RowOptions): ListRow[] => {
  const rows: ListRow[] = [];
  const { view, sort, toggled, linksOf } = o;
  // One notebook / tag: grouped by that same kind = just its tree; by the other kind / A-Z /
  // date = those groups inside it (no Pinned / Recent there).
  const inside = view.kind === 'notebook' || view.kind === 'tag';
  if (inside && o.grouping === view.kind) return treeRows(`${view.kind}:${view.id}`, items, sort, linksOf, toggled);
  // The trash: by date as before.
  if (view.kind === 'trash') {
    for (const s of groupNotes(items, o.now, sort === 'title' ? 'title' : sort)) group(rows, `date:${s.title}`, s.title, s.items, () => flat(`date:${s.title}`, s.items), toggled);
    return rows;
  }
  const pinned = inside ? [] : order(items.filter((n) => n.pinned), sort);
  group(rows, 'pinned', 'Pinned', pinned, () => flat('pinned', pinned), toggled);
  const recent = inside ? [] : sortNotes(items.filter((n) => !n.pinned && o.now - n.updatedAt < RECENT_DAYS * DAY), 'edited').slice(0, RECENT_MAX);
  group(rows, 'recent', 'Recent', recent, () => flat('recent', recent), toggled);

  if (o.grouping === 'date') {
    // Pinned and Recent are above already; the rest by age.
    const rest = items.filter((n) => !pinned.includes(n) && !recent.includes(n));
    for (const s of groupNotes(rest, o.now, sort === 'title' ? 'title' : sort)) {
      group(rows, `date:${s.title}`, s.title === 'Recent' ? 'This week' : s.title, s.items, () => flat(`date:${s.title}`, s.items), toggled);
    }
    return rows;
  }
  if (o.grouping === 'az') {
    const letters = new Map<string, NoteListItem[]>();
    for (const n of [...items].sort(byTitle)) {
      const first = n.title.trim().charAt(0).toLocaleUpperCase();
      const letter = /\p{L}/u.test(first) ? first : /\d/.test(first) ? '0–9' : '#';
      letters.set(letter, [...(letters.get(letter) ?? []), n]);
    }
    for (const [letter, list] of letters) group(rows, `az:${letter}`, letter, list, () => flat(`az:${letter}`, list), toggled);
    return rows;
  }
  // By notebook / tag (A-Z by name; a note in two is in both), then the notes without any.
  const kind = o.grouping;
  const names = kind === 'notebook' ? o.names?.notebooks : o.names?.tags;
  const groups = new Map<string, NoteListItem[]>();
  const rest: NoteListItem[] = [];
  for (const n of items) {
    const ids = (kind === 'notebook' ? n.notebooks ?? [] : n.tags ?? []).filter((id) => names?.has(id));
    if (ids.length === 0) rest.push(n);
    for (const id of ids) groups.set(id, [...(groups.get(id) ?? []), n]);
  }
  const prefix = kind === 'notebook' ? 'nb' : 'tag';
  const sorted = [...groups.entries()].sort(([a], [b]) => names!.get(a)!.localeCompare(names!.get(b)!, undefined, { numeric: true, sensitivity: 'base' }));
  for (const [id, list] of sorted) {
    const key = `${prefix}:${id}`;
    group(rows, key, kind === 'tag' ? `#${names!.get(id)}` : names!.get(id)!, list, () => treeRows(key, list, sort, linksOf, toggled), toggled);
  }
  const restKey = `${prefix}:none`;
  group(rows, restKey, kind === 'notebook' ? 'No notebook' : 'No tags', rest, () => treeRows(restKey, rest, sort, linksOf, toggled), toggled);
  return rows;
};

// Grouping kept from the old sort setting ("By notebook" / "By tag" were sorts).
export const groupingFromSort = (sort: string | null | undefined): NoteGrouping | null =>
  sort === 'notebook' ? 'notebook' : sort === 'tag' ? 'tag' : null;

// Notes "under" the given notes in the link tree (what archiving a root takes along): notes
// reachable through their note links that sit DEEPER in the tree. Depth = shortest distance
// from a note no other note links to, so a child linking back up (Lab 1 -> Semestr 5) stays a
// child, and a link up to a grandparent never takes the grandparent along.
export const linkDescendants = (rootIds: string[], notes: { id: string; links: string[] }[]): string[] => {
  const linksOf = new Map(notes.map((n) => [n.id, n.links.filter((l) => l !== n.id)]));
  const incoming = new Set(notes.flatMap((n) => linksOf.get(n.id)!));
  const depth = new Map<string, number>();
  const bfs = (start: string[], base: number) => {
    let level = start.filter((id) => !depth.has(id));
    level.forEach((id) => depth.set(id, base));
    for (let d = base + 1; level.length; d++) {
      const next: string[] = [];
      for (const id of level) for (const k of linksOf.get(id) ?? []) {
        if (!linksOf.has(k) || depth.has(k)) continue;
        depth.set(k, d);
        next.push(k);
      }
      level = next;
    }
  };
  bfs(notes.map((n) => n.id).filter((id) => !incoming.has(id)), 0);
  const out = new Set<string>();
  for (const root of rootIds) {
    // A root inside a loop no top note reaches: measured from itself.
    if (!depth.has(root)) bfs([root], 0);
    const rootDepth = depth.get(root)!;
    const seen = new Set([root]);
    const stack = [root];
    while (stack.length) {
      const id = stack.pop()!;
      for (const k of linksOf.get(id) ?? []) {
        if (seen.has(k) || !linksOf.has(k)) continue;
        seen.add(k);
        if ((depth.get(k) ?? Infinity) <= rootDepth) continue;
        out.add(k);
        stack.push(k);
      }
    }
  }
  rootIds.forEach((id) => out.delete(id));
  return [...out];
};
