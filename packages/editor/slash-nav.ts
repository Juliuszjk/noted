import type { SlashItem } from './slash';

// Pure navigation model of the slash menu: a stack of panels (root list, submenus, the table
// picker). No DOM and no React, so it is unit-tested; the UI only renders the model.

export type NavLevel =
  // `divider` is the index of the first "deeper match" row when search results are split in two groups.
  | { kind: 'list'; items: SlashItem[]; index: number; divider?: number }
  | { kind: 'tiles'; items: SlashItem[]; columns: number; index: number }
  | { kind: 'table'; cols: number; rows: number; csvFocused: boolean };

export type NavModel = NavLevel[];

export const TABLE_MAX_COLS = 10;
export const TABLE_MAX_ROWS = 8;
const TABLE_DEFAULT_SIZE = 3;

export type NavAction =
  | { type: 'run'; item: SlashItem }
  | { type: 'table-insert'; cols: number; rows: number }
  | { type: 'table-csv' };

export interface NavResult {
  handled: boolean;
  model: NavModel;
  action?: NavAction;
}

export const initialNav = (rootItems: SlashItem[]): NavModel => [{ kind: 'list', items: rootItems, index: 0 }];

// The panel an item opens, if any.
export const levelFor = (item: SlashItem | undefined): NavLevel | null => {
  const sub = item?.submenu;
  if (!sub) return null;
  if (sub.kind === 'list') return { kind: 'list', items: sub.items, index: 0 };
  if (sub.kind === 'tiles') return { kind: 'tiles', items: sub.items, columns: sub.columns, index: 0 };
  return { kind: 'table', cols: TABLE_DEFAULT_SIZE, rows: TABLE_DEFAULT_SIZE, csvFocused: false };
};

// Opens the item's submenu or, for a leaf, asks the UI to run it.
export const activate = (model: NavModel, item: SlashItem | undefined): NavResult => {
  const next = levelFor(item);
  if (next) return { handled: true, model: [...model, next] };
  if (item?.command) return { handled: true, model, action: { type: 'run', item } };
  return { handled: true, model };
};

export const navigate = (model: NavModel, key: string): NavResult => {
  const depth = model.length - 1;
  const level = model[depth];
  const replace = (next: NavLevel): NavModel => [...model.slice(0, depth), next];
  const pop = (): NavResult => (depth > 0 ? { handled: true, model: model.slice(0, depth) } : { handled: false, model });
  const unhandled: NavResult = { handled: false, model };
  const stay: NavResult = { handled: true, model };

  if (level.kind === 'list') {
    const n = level.items.length;
    switch (key) {
      case 'ArrowDown':
        return n ? { handled: true, model: replace({ ...level, index: (level.index + 1) % n }) } : stay;
      case 'ArrowUp':
        return n ? { handled: true, model: replace({ ...level, index: (level.index - 1 + n) % n }) } : stay;
      case 'ArrowRight': {
        const next = levelFor(level.items[level.index]);
        return next ? { handled: true, model: [...model, next] } : stay;
      }
      case 'ArrowLeft':
        return depth > 0 ? pop() : unhandled;
      case 'Enter':
        return activate(model, level.items[level.index]);
      case 'Escape':
        return pop();
      default:
        return unhandled;
    }
  }

  if (level.kind === 'tiles') {
    const n = level.items.length;
    const c = level.columns;
    const move = (index: number): NavResult => ({ handled: true, model: replace({ ...level, index }) });
    switch (key) {
      case 'ArrowRight':
        return move(Math.min(n - 1, level.index + 1));
      case 'ArrowLeft':
        return level.index % c === 0 ? pop() : move(level.index - 1);
      case 'ArrowDown':
        return level.index + c < n ? move(level.index + c) : stay;
      case 'ArrowUp':
        return level.index - c >= 0 ? move(level.index - c) : stay;
      case 'Enter':
        return activate(model, level.items[level.index]);
      case 'Escape':
        return pop();
      default:
        return unhandled;
    }
  }

  // Table picker: arrows resize the highlighted area, going above the first row focuses "Import CSV".
  const set = (patch: Partial<typeof level>): NavResult => ({ handled: true, model: replace({ ...level, ...patch }) });
  switch (key) {
    case 'ArrowRight':
      return level.csvFocused ? stay : set({ cols: Math.min(TABLE_MAX_COLS, level.cols + 1) });
    case 'ArrowLeft':
      if (level.csvFocused) return stay;
      return level.cols > 1 ? set({ cols: level.cols - 1 }) : pop();
    case 'ArrowDown':
      return level.csvFocused ? set({ csvFocused: false }) : set({ rows: Math.min(TABLE_MAX_ROWS, level.rows + 1) });
    case 'ArrowUp':
      if (level.csvFocused) return stay;
      return level.rows > 1 ? set({ rows: level.rows - 1 }) : set({ csvFocused: true });
    case 'Enter':
      return {
        handled: true,
        model,
        action: level.csvFocused ? { type: 'table-csv' } : { type: 'table-insert', cols: level.cols, rows: level.rows },
      };
    case 'Escape':
      return pop();
    default:
      return unhandled;
  }
};

// Mouse: hovering a row selects it, closes deeper panels and opens its submenu.
export const hover = (model: NavModel, depth: number, index: number): NavModel => {
  const level = model[depth];
  if (!level || level.kind === 'table' || level.index === index) return model;
  const base: NavModel = [...model.slice(0, depth), { ...level, index }];
  const sub = levelFor(level.items[index]);
  return sub ? [...base, sub] : base;
};

export const hoverTable = (model: NavModel, depth: number, cols: number, rows: number): NavModel =>
  model.map((level, i) => (i === depth && level.kind === 'table' ? { ...level, cols, rows, csvFocused: false } : level));

export const hoverCsv = (model: NavModel, depth: number): NavModel =>
  model.map((level, i) => (i === depth && level.kind === 'table' ? { ...level, csvFocused: true } : level));

// ---------------------------------------------------------------------------------------------
// Search. Typing after "/" narrows the tree instead of flattening it:
//  - one match: jump straight to its choices (skipping panels that would hold a single row)
//  - several matches: the matching categories first, deeper matches below a divider as "A › B"
// Titles are searched first; extra keywords only count when no title matches anything.

type SearchMode = 'title' | 'keyword';

const childrenOf = (item: SlashItem): SlashItem[] => {
  const sub = item.submenu;
  if (sub && sub.kind !== 'table') return sub.items;
  return item.searchChildren ?? [];
};

const matchesSelf = (item: SlashItem, q: string, mode: SearchMode): boolean =>
  item.title.toLowerCase().includes(q) ||
  (mode === 'keyword' && !!item.keywords?.some((keyword) => keyword.toLowerCase().includes(q)));

const hasMatchBelow = (item: SlashItem, q: string, mode: SearchMode): boolean =>
  childrenOf(item).some((child) => matchesSelf(child, q, mode) || hasMatchBelow(child, q, mode));

const deepMatches = (item: SlashItem, trail: string[], q: string, mode: SearchMode): SlashItem[] =>
  childrenOf(item).flatMap((child) => {
    if (matchesSelf(child, q, mode)) {
      return [{ ...child, title: [...trail, child.title].join(' › '), preview: undefined }];
    }
    return hasMatchBelow(child, q, mode) ? deepMatches(child, [...trail, child.title], q, mode) : [];
  });

// An item that matched the query: show its own choices, narrowed to matching ones if any match.
const openMatched = (item: SlashItem, q: string, mode: SearchMode): NavModel => {
  const sub = item.submenu;
  if (!sub) return [{ kind: 'list', items: [item], index: 0 }];
  if (sub.kind === 'table') return [levelFor(item)!];
  const matching = sub.items.filter((child) => matchesSelf(child, q, mode));
  const shown = matching.length > 0 ? matching : sub.items;
  return sub.kind === 'tiles'
    ? [{ kind: 'tiles', items: shown, columns: sub.columns, index: 0 }]
    : [{ kind: 'list', items: shown, index: 0 }];
};

const buildSearch = (items: SlashItem[], q: string, mode: SearchMode): NavModel => {
  const self = items.filter((item) => matchesSelf(item, q, mode));
  const below = items.filter((item) => !matchesSelf(item, q, mode) && hasMatchBelow(item, q, mode));

  if (self.length + below.length === 0) return [{ kind: 'list', items: [], index: 0 }];
  if (self.length === 1 && below.length === 0) return openMatched(self[0], q, mode);
  if (self.length === 0 && below.length === 1) return buildSearch(childrenOf(below[0]), q, mode);

  const deep = below.flatMap((item) => deepMatches(item, [item.title], q, mode));
  return [
    {
      kind: 'list',
      items: [...self, ...deep],
      index: 0,
      ...(self.length > 0 && deep.length > 0 ? { divider: self.length } : {}),
    },
  ];
};

export const searchNav = (rootItems: SlashItem[], query: string): NavModel => {
  const q = query.trim().toLowerCase();
  if (!q) return initialNav(rootItems);
  const titleHit = rootItems.some((item) => matchesSelf(item, q, 'title') || hasMatchBelow(item, q, 'title'));
  return buildSearch(rootItems, q, titleHit ? 'title' : 'keyword');
};
