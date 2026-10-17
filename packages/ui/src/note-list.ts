// Pure helpers of the desktop note list: sections, relative times and search.

export interface NoteListItem {
  id: string;
  title: string;
  excerpt: string;
  pinned: boolean;
  updatedAt: number;
  created?: number | null;
  favorite?: boolean;
  archived?: boolean;
  trashedAt?: number | null;
  notebooks?: string[];
  tags?: string[];
  locked?: boolean;
  published?: boolean;
}

// What the list shows: the main views of the navigation, or one notebook / tag. 'tree' shows
// the note links as a tree (link-tree.ts) instead of a list.
export type NoteView =
  | { kind: 'notes' | 'favorites' | 'archive' | 'trash' | 'tree' | 'published' }
  | { kind: 'notebook' | 'tag'; id: string };

// edited / created / title sort; notebook / tag group the list by them (newest first inside).
export type NoteSort = 'edited' | 'created' | 'title' | 'notebook' | 'tag';

// Notes view: everything not archived or trashed. Archive and Trash show only theirs.
export const notesInView = (items: NoteListItem[], view: NoteView): NoteListItem[] => {
  const live = (n: NoteListItem) => !n.trashedAt && !n.archived;
  switch (view.kind) {
    case 'notes':
    case 'tree': return items.filter(live);
    case 'favorites': return items.filter((n) => live(n) && n.favorite);
    case 'published': return items.filter((n) => !n.trashedAt && n.published);
    case 'archive': return items.filter((n) => !n.trashedAt && n.archived);
    case 'trash': return items.filter((n) => !!n.trashedAt);
    case 'notebook': return items.filter((n) => !n.trashedAt && (n.notebooks ?? []).includes(view.id));
    case 'tag': return items.filter((n) => !n.trashedAt && (n.tags ?? []).includes(view.id));
  }
};

const sortValue = (n: NoteListItem, sort: NoteSort) => (sort === 'created' ? n.created ?? 0 : n.updatedAt);

// Names of notebooks and tags, for grouping by them.
export interface CatalogNames {
  notebooks: Map<string, string>;
  tags: Map<string, string>;
}

// Sorted list: by title (A-Z), or newest first by last edit / creation.
export const sortNotes = (items: NoteListItem[], sort: NoteSort): NoteListItem[] =>
  [...items].sort((a, b) => (sort === 'title' ? a.title.localeCompare(b.title) : sortValue(b, sort) - sortValue(a, sort)));

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Compact age like "now", "11s", "5m", "3h", "2d", "1w", "3mo", "1y".
export const relativeTime = (at: number, now: number): string => {
  const diff = Math.max(0, now - at);
  if (diff < 5 * SECOND) return 'now';
  if (diff < MINUTE) return `${Math.floor(diff / SECOND)}s`;
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d`;
  if (diff < 30 * DAY) return `${Math.floor(diff / (7 * DAY))}w`;
  if (diff < 365 * DAY) return `${Math.floor(diff / (30 * DAY))}mo`;
  return `${Math.floor(diff / (365 * DAY))}y`;
};

export interface NoteSection {
  title: string;
  items: NoteListItem[];
}

// Pinned first, then by age: Recent (< 7 days), Last week (7-14 days), Older. Age is the last
// edit, or the creation time when sorting by creation. Sorting by title gives one A-Z
// section. Empty sections are left out.
export const groupNotes = (items: NoteListItem[], now: number, sort: NoteSort = 'edited', names?: CatalogNames): NoteSection[] => {
  const sorted = sortNotes(items, sort);
  if (sort === 'notebook' || sort === 'tag') {
    // One section per notebook / tag (A-Z; a note with several is in each), then the rest.
    const groups = new Map<string, NoteListItem[]>();
    const rest: NoteListItem[] = [];
    for (const n of sorted) {
      const keys = (sort === 'notebook' ? n.notebooks ?? [] : n.tags ?? [])
        .map((id) => (sort === 'notebook' ? names?.notebooks : names?.tags)?.get(id))
        .filter((name): name is string => !!name);
      if (keys.length === 0) rest.push(n);
      for (const key of keys) groups.set(key, [...(groups.get(key) ?? []), n]);
    }
    return [
      ...[...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([title, list]) => ({ title: sort === 'tag' ? `#${title}` : title, items: list })),
      ...(rest.length ? [{ title: sort === 'notebook' ? 'No notebook' : 'No tags', items: rest }] : []),
    ];
  }
  if (sort === 'title') {
    return [{ title: 'Pinned', items: sorted.filter((n) => n.pinned) }, { title: 'A–Z', items: sorted.filter((n) => !n.pinned) }]
      .filter((s) => s.items.length > 0);
  }
  const age = (n: NoteListItem) => now - sortValue(n, sort);
  const sections: NoteSection[] = [
    { title: 'Pinned', items: sorted.filter((n) => n.pinned) },
    { title: 'Recent', items: sorted.filter((n) => !n.pinned && age(n) < 7 * DAY) },
    { title: 'Last week', items: sorted.filter((n) => !n.pinned && age(n) >= 7 * DAY && age(n) < 14 * DAY) },
    { title: 'Older', items: sorted.filter((n) => !n.pinned && age(n) >= 14 * DAY) },
  ];
  return sections.filter((s) => s.items.length > 0);
};

const fold = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/ł/g, 'l');

// Search words. A space typed before a word means "the word starts here", after it "the word
// ends here": "al " finds "al egzamin" but not "zaliczenie"; "al" alone finds both.
interface SearchWord { text: string; start: boolean; end: boolean }
const searchWords = (query: string): SearchWord[] => {
  const q = fold(query);
  return [...q.matchAll(/\S+/g)].map((m) => ({
    text: m[0],
    start: m.index! > 0 && /\s/.test(q[m.index! - 1]),
    end: m.index! + m[0].length < q.length,
  }));
};
const WORD_CHAR = /[\p{L}\p{N}_]/u;
// Every place (start index) where `w` is in the folded text with its boundaries.
const findWord = (folded: string, w: SearchWord, from = 0): number => {
  for (let at = folded.indexOf(w.text, from); at >= 0; at = folded.indexOf(w.text, at + 1)) {
    if (w.start && at > 0 && WORD_CHAR.test(folded[at - 1])) continue;
    const after = folded[at + w.text.length];
    if (w.end && after !== undefined && WORD_CHAR.test(after)) continue;
    return at;
  }
  return -1;
};

// Folds text char by char, remembering where each folded char came from (for highlighting).
const foldMapped = (text: string): { folded: string; map: number[] } => {
  let folded = '';
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const f = fold(text[i]);
    folded += f;
    for (let k = 0; k < f.length; k++) map.push(i);
  }
  return { folded, map };
};

// The parts of `text` that match the search (to show them in bold), in the original text.
export const searchHighlights = (text: string, query: string): { text: string; hit: boolean }[] => {
  const words = searchWords(query);
  if (!words.length || !text) return [{ text, hit: false }];
  const { folded, map } = foldMapped(text);
  const marks = new Array<boolean>(text.length).fill(false);
  for (const w of words) {
    for (let at = findWord(folded, w); at >= 0; at = findWord(folded, w, at + 1)) {
      for (let k = at; k < at + w.text.length; k++) marks[map[k]] = true;
    }
  }
  const parts: { text: string; hit: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const last = parts[parts.length - 1];
    if (last && last.hit === marks[i]) last.text += text[i];
    else parts.push({ text: text[i], hit: marks[i] });
  }
  return parts;
};

// Search: every word must be in the title, the excerpt or (with `textOf`) the whole text of
// the note. A note found by its text shows the text around the first match as its excerpt.
export const filterNotes = (items: NoteListItem[], query: string, textOf?: (id: string) => string): NoteListItem[] => {
  const words = searchWords(query);
  if (words.length === 0) return items;
  const out: NoteListItem[] = [];
  for (const n of items) {
    const head = fold(`${n.title} ${n.excerpt}`);
    if (words.every((w) => findWord(head, w) >= 0)) { out.push(n); continue; }
    const text = textOf?.(n.id) ?? '';
    const { folded, map } = foldMapped(text);
    const found = words.map((w) => findWord(folded, w));
    if (!words.every((w, i) => findWord(head, w) >= 0 || found[i] >= 0)) continue;
    const at = map[Math.min(...found.filter((i) => i >= 0))] ?? 0;
    const start = Math.max(0, at - 40);
    const snippet = `${start > 0 ? '…' : ''}${text.slice(start, at + 120).replace(/\s+/g, ' ').trim()}`;
    out.push({ ...n, excerpt: snippet });
  }
  return out;
};

// The list while searching: notes whose TITLE has every word first, then the ones that have them
// in their text (with the matching text as the excerpt). Each part keeps the chosen sort order.
export const searchSections = (items: NoteListItem[], query: string, sort: NoteSort = 'edited', textOf?: (id: string) => string): NoteSection[] => {
  const words = searchWords(query);
  const found = sortNotes(filterNotes(items, query, textOf), sort === 'notebook' || sort === 'tag' ? 'edited' : sort);
  const inTitle = found.filter((n) => { const t = fold(n.title); return words.every((w) => findWord(t, w) >= 0); });
  const rest = found.filter((n) => !inTitle.includes(n));
  return [
    ...(inTitle.length ? [{ title: 'Title', items: inTitle }] : []),
    ...(rest.length ? [{ title: 'In the text', items: rest }] : []),
  ];
};
