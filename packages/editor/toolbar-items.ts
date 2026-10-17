import {
  mdiPlus, mdiFormatIndentDecrease, mdiFormatIndentIncrease, mdiFormatBold, mdiFormatItalic, mdiFormatUnderline,
  mdiFormatStrikethrough, mdiCodeTags, mdiFormatSubscript, mdiFormatSuperscript, mdiMarker, mdiFormatColorText,
  mdiFunctionVariant, mdiFormatSize, mdiFormatHeaderPound, mdiFormatFont, mdiFormatListBulleted,
  mdiFormatListNumbered, mdiFormatListCheckbox, mdiVectorLink, mdiLinkPlus, mdiFormatAlignLeft, mdiMagnify,
  mdiTableColumnPlusBefore, mdiTableColumnPlusAfter, mdiTableRowPlusBefore, mdiTableRowPlusAfter, mdiTableColumnRemove,
  mdiTableRowRemove, mdiTableColumn, mdiTableRow, mdiTableRemove, mdiTableArrowLeft, mdiTableArrowRight, mdiTableArrowUp,
  mdiTableArrowDown, mdiTableColumnWidth, mdiTableRowHeight, mdiTableRefresh, mdiTableHeadersEye, mdiSelect, mdiSelectAll,
  mdiTableMergeCells, mdiTableSplitCell, mdiFormatColorFill,
} from '@mdi/js';

// Settings > Toolbar, like Notesnook's: the toolbar is a list of groups (a separator between
// them); a group may end with a subgroup, whose buttons sit behind a "⋮" button.

export interface ToolbarItemDef {
  id: string;
  label: string;
  // @mdi/js path.
  icon: string;
}

// A group: item ids, and nested arrays for subgroups.
export type ToolbarGroup = (string | string[])[];
export type ToolbarPreset = 'default' | 'minimal' | 'custom';
// mobileTable: the phone's extra buttons while the cursor is in a table; desktopTable: the
// desktop table menu (same buttons).
export type ToolbarPlatform = 'desktop' | 'mobile' | 'mobileTable' | 'desktopTable';

export interface ToolbarConfig {
  preset: ToolbarPreset;
  // Only used by 'custom'.
  groups: ToolbarGroup[];
}

const ITEMS: Record<string, ToolbarItemDef> = Object.fromEntries(([
  ['insert', 'Insert block', mdiPlus],
  ['outdent', 'Outdent', mdiFormatIndentDecrease],
  ['indent', 'Indent', mdiFormatIndentIncrease],
  ['bold', 'Bold', mdiFormatBold],
  ['italic', 'Italic', mdiFormatItalic],
  ['underline', 'Underline', mdiFormatUnderline],
  ['strike', 'Strikethrough', mdiFormatStrikethrough],
  ['code', 'Code', mdiCodeTags],
  ['subscript', 'Subscript', mdiFormatSubscript],
  ['superscript', 'Superscript', mdiFormatSuperscript],
  ['highlight', 'Highlight', mdiMarker],
  ['textColor', 'Text color', mdiFormatColorText],
  ['math', 'Math (inline)', mdiFunctionVariant],
  ['fontSize', 'Font size', mdiFormatSize],
  ['headings', 'Headings', mdiFormatHeaderPound],
  ['font', 'Font family', mdiFormatFont],
  ['tasks', 'Checklist', mdiFormatListCheckbox],
  ['numbers', 'Numbered list', mdiFormatListNumbered],
  ['bullets', 'Bullet list', mdiFormatListBulleted],
  ['noteLink', 'Link to note', mdiVectorLink],
  ['link', 'Link', mdiLinkPlus],
  ['align', 'Alignment', mdiFormatAlignLeft],
  ['find', 'Find and replace', mdiMagnify],
  ['colLeft', 'Insert column left', mdiTableColumnPlusBefore],
  ['colRight', 'Insert column right', mdiTableColumnPlusAfter],
  ['rowAbove', 'Insert row above', mdiTableRowPlusBefore],
  ['rowBelow', 'Insert row below', mdiTableRowPlusAfter],
  ['deleteColumn', 'Delete column', mdiTableColumnRemove],
  ['deleteRow', 'Delete row', mdiTableRowRemove],
  ['columnProps', 'Column properties', mdiTableColumn],
  ['rowProps', 'Row properties', mdiTableRow],
  ['deleteTable', 'Delete table', mdiTableRemove],
  ['moveColumnLeft', 'Move column left', mdiTableArrowLeft],
  ['moveColumnRight', 'Move column right', mdiTableArrowRight],
  ['moveRowUp', 'Move row up', mdiTableArrowUp],
  ['moveRowDown', 'Move row down', mdiTableArrowDown],
  ['equalWidths', 'Equal column widths', mdiTableColumnWidth],
  ['equalHeights', 'Equal row heights', mdiTableRowHeight],
  ['naturalHeights', 'Natural row heights', mdiTableRefresh],
  ['headerRow', 'Header row on / off', mdiTableHeadersEye],
  ['selectColumn', 'Select column', mdiSelect],
  ['selectRow', 'Select row', mdiSelect],
  ['selectTable', 'Select table', mdiSelectAll],
  ['mergeCells', 'Merge cells', mdiTableMergeCells],
  ['splitCell', 'Split cell', mdiTableSplitCell],
  ['cellColor', 'Cell background', mdiFormatColorFill],
] as const).map(([id, label, icon]) => [id, { id, label, icon }]));

const items = (ids: string[]) => ids.map((id) => ITEMS[id]);
const TABLE_ITEMS = items(['colLeft', 'colRight', 'rowAbove', 'rowBelow', 'deleteColumn', 'deleteRow', 'columnProps', 'rowProps',
  'deleteTable', 'moveColumnLeft', 'moveColumnRight', 'moveRowUp', 'moveRowDown', 'equalWidths', 'equalHeights',
  'naturalHeights', 'headerRow', 'selectColumn', 'selectRow', 'selectTable', 'mergeCells', 'splitCell', 'cellColor']);

// Every button each toolbar can show.
export const TOOLBAR_ITEMS: Record<ToolbarPlatform, ToolbarItemDef[]> = {
  desktop: items(['bold', 'italic', 'underline', 'strike', 'code', 'subscript', 'superscript', 'highlight', 'textColor', 'math',
    'fontSize', 'headings', 'font', 'tasks', 'numbers', 'bullets', 'link', 'noteLink', 'align', 'outdent', 'indent', 'find']),
  mobile: items(['insert', 'outdent', 'indent', 'bold', 'italic', 'underline', 'strike', 'code', 'subscript', 'superscript',
    'highlight', 'textColor', 'math', 'fontSize', 'headings', 'font', 'tasks', 'numbers', 'bullets', 'noteLink', 'link', 'align']),
  mobileTable: TABLE_ITEMS,
  desktopTable: TABLE_ITEMS,
};

// Table subgroups whose buttons all work on cells get the "Cell" icon, others the "Table" one.
export const CELL_TOOLBAR_ITEMS = new Set(['mergeCells', 'splitCell', 'cellColor', 'selectTable']);

export const TOOLBAR_PRESETS: Record<ToolbarPlatform, Record<'default' | 'minimal', ToolbarGroup[]>> = {
  desktop: {
    default: [
      ['bold', 'italic', 'underline', ['strike', 'code', 'subscript', 'superscript', 'highlight', 'textColor', 'math']],
      ['fontSize'],
      ['headings', 'font'],
      ['bullets', 'numbers', 'tasks'],
      ['link', 'noteLink', 'align', 'find'],
    ],
    minimal: [['bold', 'italic', 'underline'], ['headings'], ['bullets', 'numbers', 'tasks'], ['link']],
  },
  mobile: {
    default: [
      ['insert', 'outdent', 'indent', 'bold', ['italic', 'underline', 'strike', 'code', 'subscript', 'superscript', 'highlight', 'textColor', 'math']],
      ['fontSize'],
      ['headings', 'font'],
      ['bullets', 'numbers', 'tasks'],
      ['noteLink', 'link', 'align'],
    ],
    minimal: [['insert', 'bold', 'italic'], ['headings'], ['bullets', 'tasks'], ['link']],
  },
  mobileTable: {
    default: [
      [['colLeft', 'colRight', 'rowAbove', 'rowBelow', 'deleteColumn', 'deleteRow', 'columnProps', 'rowProps', 'deleteTable']],
      [['mergeCells', 'splitCell', 'cellColor']],
    ],
    minimal: [['columnProps', 'rowProps', ['mergeCells', 'splitCell', 'cellColor']]],
  },
  // The old Row ▾ / Column ▾ / Cell ▾ menu, with the phone's icons in front.
  desktopTable: {
    default: [
      ['colLeft', 'colRight', 'rowAbove', 'rowBelow'],
      ['rowProps', 'columnProps', ['mergeCells', 'splitCell', 'cellColor']],
      ['headerRow', 'selectTable', 'deleteTable'],
    ],
    minimal: [['rowProps', 'columnProps', ['mergeCells', 'splitCell', 'cellColor']], ['deleteTable']],
  },
};

export const toolbarItem = (id: string): ToolbarItemDef | undefined => ITEMS[id];

const cleanGroups = (groups: unknown): ToolbarGroup[] =>
  (Array.isArray(groups) ? groups : []).filter(Array.isArray).map((group) => (group as unknown[])
    .map((part) => (Array.isArray(part) ? part.filter((x): x is string => typeof x === 'string') : part))
    .filter((part): part is string | string[] => typeof part === 'string' || Array.isArray(part)));

export const parseToolbarConfig = (text: string | null): ToolbarConfig | null => {
  try {
    const d = JSON.parse(text ?? 'null');
    // Older settings ({order, hidden}) are dropped: the default comes back.
    if (!d || !['default', 'minimal', 'custom'].includes(d.preset)) return null;
    return { preset: d.preset, groups: cleanGroups(d.groups) };
  } catch {
    return null;
  }
};

// The groups a toolbar shows: the preset's, or the custom ones without unknown or repeated
// ids and without empty groups.
export const toolbarGroups = (platform: ToolbarPlatform, config: ToolbarConfig | null): ToolbarGroup[] => {
  if (!config || config.preset !== 'custom') return TOOLBAR_PRESETS[platform][config?.preset === 'minimal' ? 'minimal' : 'default'];
  const known = new Set(TOOLBAR_ITEMS[platform].map((i) => i.id));
  const seen = new Set<string>();
  const keep = (id: string) => known.has(id) && !seen.has(id) && !!seen.add(id);
  return config.groups
    .map((group) => group
      .map((part) => (Array.isArray(part) ? part.filter(keep) : keep(part) ? part : null))
      .filter((part): part is string | string[] => part !== null && (!Array.isArray(part) || part.length > 0)))
    .filter((group) => group.length > 0);
};

// ---- editing (Settings): the groups as a flat list of rows ----

export type ToolbarRow = { kind: 'group' } | { kind: 'subgroup' } | { kind: 'item'; id: string };

export const flattenToolbar = (groups: ToolbarGroup[]): ToolbarRow[] => groups.flatMap((group): ToolbarRow[] => [
  { kind: 'group' },
  ...group.filter((p): p is string => typeof p === 'string').map((id): ToolbarRow => ({ kind: 'item', id })),
  ...group.filter((p): p is string[] => Array.isArray(p)).flatMap((sub): ToolbarRow[] => [{ kind: 'subgroup' }, ...sub.map((id): ToolbarRow => ({ kind: 'item', id }))]),
]);

// Items after a subgroup row belong to that subgroup until the next group or subgroup row.
// Empty groups and subgroups are kept (a new group is filled by dragging items into it).
export const unflattenToolbar = (rows: ToolbarRow[]): ToolbarGroup[] => {
  const groups: ToolbarGroup[] = [];
  let sub: string[] | null = null;
  for (const row of rows) {
    if (row.kind === 'group') { groups.push([]); sub = null; continue; }
    if (!groups.length) groups.push([]);
    const group = groups[groups.length - 1];
    if (row.kind === 'subgroup') { sub = []; group.push(sub); continue; }
    if (sub) sub.push(row.id); else group.push(row.id);
  }
  return groups;
};

// The rows a drag of row `index` takes along: a group its whole block, a subgroup its items.
export const rowBlock = (rows: ToolbarRow[], index: number): [number, number] => {
  const kind = rows[index]?.kind;
  if (kind === 'item' || !kind) return [index, index + 1];
  let end = index + 1;
  while (end < rows.length && rows[end].kind !== 'group' && !(kind === 'subgroup' && rows[end].kind === 'subgroup')) end++;
  return [index, end];
};

// Moves row `from` (with its block) so it lands before row `to` (rows.length = at the end).
// Returns the rows unchanged when the move makes no sense (into itself, or before the first
// group).
export const moveToolbarRow = (rows: ToolbarRow[], from: number, to: number): ToolbarRow[] => {
  const [start, end] = rowBlock(rows, from);
  if (to >= start && to <= end) return rows;
  const block = rows.slice(start, end);
  const rest = [...rows.slice(0, start), ...rows.slice(end)];
  const at = to > start ? to - (end - start) : to;
  const next = [...rest.slice(0, at), ...block, ...rest.slice(at)];
  return next[0]?.kind === 'group' ? next : rows;
};

// The config after an edit in Settings (any edit makes the toolbar custom).
export const customToolbar = (rows: ToolbarRow[]): ToolbarConfig => ({ preset: 'custom', groups: unflattenToolbar(rows) });

// Items of the platform that are not in the groups.
export const unusedToolbarItems = (platform: ToolbarPlatform, groups: ToolbarGroup[]): ToolbarItemDef[] => {
  const used = new Set(groups.flat(2));
  return TOOLBAR_ITEMS[platform].filter((i) => !used.has(i.id));
};

// ---- visual editing (Settings: drag buttons on the picture of the toolbar) ----

// A place in the toolbar: a group's own buttons (sub = null) or one of its subgroups.
export interface ToolbarSlot {
  group: number;
  sub: number | null;
  index: number;
}

const split = (group: ToolbarGroup) => ({
  items: group.filter((p): p is string => typeof p === 'string'),
  subs: group.filter((p): p is string[] => Array.isArray(p)),
});
const join = (g: { items: string[]; subs: string[][] }): ToolbarGroup => [...g.items, ...g.subs];

const listAt = (g: { items: string[]; subs: string[][] }, sub: number | null): string[] | undefined => (sub === null ? g.items : g.subs[sub]);

// Removes the button at `slot` (to "Not in the toolbar").
export const toolbarRemoveAt = (groups: ToolbarGroup[], slot: ToolbarSlot): ToolbarGroup[] => groups.map((group, gi) => {
  if (gi !== slot.group) return group;
  const g = split(group);
  const list = listAt(g, slot.sub);
  if (!list) return group;
  const next = list.filter((_, i) => i !== slot.index);
  return join(slot.sub === null ? { ...g, items: next } : { ...g, subs: g.subs.map((s, i) => (i === slot.sub ? next : s)) });
});

// Puts button `id` at `slot` (index past the end = last).
export const toolbarInsertAt = (groups: ToolbarGroup[], slot: ToolbarSlot, id: string): ToolbarGroup[] => groups.map((group, gi) => {
  if (gi !== slot.group) return group;
  const g = split(group);
  const list = listAt(g, slot.sub);
  if (!list) return group;
  const next = [...list.slice(0, slot.index), id, ...list.slice(slot.index)];
  return join(slot.sub === null ? { ...g, items: next } : { ...g, subs: g.subs.map((s, i) => (i === slot.sub ? next : s)) });
});

export const toolbarIdAt = (groups: ToolbarGroup[], slot: ToolbarSlot): string | undefined => {
  const group = groups[slot.group];
  return group ? listAt(split(group), slot.sub)?.[slot.index] : undefined;
};

// Moves a button; `to` is the place among the buttons as they are before the move.
export const toolbarMove = (groups: ToolbarGroup[], from: ToolbarSlot, to: ToolbarSlot): ToolbarGroup[] => {
  const id = toolbarIdAt(groups, from);
  if (id === undefined) return groups;
  const sameList = from.group === to.group && from.sub === to.sub;
  if (sameList && (to.index === from.index || to.index === from.index + 1)) return groups;
  const index = sameList && to.index > from.index ? to.index - 1 : to.index;
  return toolbarInsertAt(toolbarRemoveAt(groups, from), { ...to, index }, id);
};

// Empty subgroups and groups go (after a drag left them empty).
export const pruneToolbar = (groups: ToolbarGroup[]): ToolbarGroup[] => groups
  .map((group) => group.filter((p) => !Array.isArray(p) || p.length > 0))
  .filter((group) => group.length > 0);

// The two lists of a group, for drawing it.
export const toolbarGroupParts = split;
