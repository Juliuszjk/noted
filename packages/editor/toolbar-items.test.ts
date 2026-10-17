import { describe, it, expect } from 'vitest';
import {
  TOOLBAR_PRESETS, flattenToolbar, moveToolbarRow, parseToolbarConfig, toolbarGroups, unflattenToolbar, unusedToolbarItems,
} from './toolbar-items';
import type { ToolbarRow } from './toolbar-items';

const ids = (rows: ToolbarRow[]) => rows.map((r) => (r.kind === 'item' ? r.id : r.kind === 'group' ? 'G' : 'S'));

describe('toolbar config', () => {
  it('uses the presets and drops old or broken settings', () => {
    expect(toolbarGroups('desktop', null)).toBe(TOOLBAR_PRESETS.desktop.default);
    expect(toolbarGroups('mobile', { preset: 'minimal', groups: [] })).toBe(TOOLBAR_PRESETS.mobile.minimal);
    expect(parseToolbarConfig('x')).toBeNull();
    expect(parseToolbarConfig(JSON.stringify({ order: ['bold'], hidden: [] }))).toBeNull();
  });
  it('cleans custom groups', () => {
    const groups = toolbarGroups('desktop', { preset: 'custom', groups: [['bold', 'nope', 'bold', ['italic', 'insert']], [], [[]], ['find']] });
    expect(groups).toEqual([['bold', ['italic']], ['find']]);
  });
  it('round-trips through rows', () => {
    const groups = TOOLBAR_PRESETS.desktop.default;
    expect(unflattenToolbar(flattenToolbar(groups))).toEqual(groups);
  });
  it('moves items, subgroups and whole groups', () => {
    const rows = flattenToolbar([['a', 'b', ['c', 'd']], ['e']]);
    expect(ids(rows)).toEqual(['G', 'a', 'b', 'S', 'c', 'd', 'G', 'e']);
    // Item into the other group.
    expect(ids(moveToolbarRow(rows, 1, 8))).toEqual(['G', 'b', 'S', 'c', 'd', 'G', 'e', 'a']);
    // Subgroup (with its items) to the second group.
    expect(unflattenToolbar(moveToolbarRow(rows, 3, 8))).toEqual([['a', 'b'], ['e', ['c', 'd']]]);
    // Second group to the top.
    expect(unflattenToolbar(moveToolbarRow(rows, 6, 0))).toEqual([['e'], ['a', 'b', ['c', 'd']]]);
    // Nothing may come before the first group.
    expect(moveToolbarRow(rows, 1, 0)).toBe(rows);
    // Into itself.
    expect(moveToolbarRow(rows, 0, 3)).toBe(rows);
  });
  it('lists the unused items', () => {
    const unused = unusedToolbarItems('desktop', [['bold']]).map((i) => i.id);
    expect(unused).toContain('italic');
    expect(unused).not.toContain('bold');
  });
});

it('the table toolbar has its own items and presets', () => {
  expect(toolbarGroups('mobileTable', null)[1]).toEqual([['mergeCells', 'splitCell', 'cellColor']]);
  const custom = toolbarGroups('mobileTable', { preset: 'custom', groups: [['bold', 'rowProps', ['mergeCells', 'italic']]] });
  expect(custom).toEqual([['rowProps', ['mergeCells']]]);
  expect(unusedToolbarItems('mobileTable', custom).map((i) => i.id)).toContain('colLeft');
});

it('moves buttons between groups, subgroups and out of the toolbar', async () => {
  const { toolbarMove, toolbarRemoveAt, toolbarInsertAt, pruneToolbar } = await import('./toolbar-items');
  const groups = [['a', 'b', ['c', 'd']], ['e']];
  // Within a group: before / after.
  expect(toolbarMove(groups, { group: 0, sub: null, index: 0 }, { group: 0, sub: null, index: 2 })).toEqual([['b', 'a', ['c', 'd']], ['e']]);
  // Into the subgroup, and from it to another group.
  expect(toolbarMove(groups, { group: 0, sub: null, index: 1 }, { group: 0, sub: 0, index: 1 })).toEqual([['a', ['c', 'b', 'd']], ['e']]);
  expect(toolbarMove(groups, { group: 0, sub: 0, index: 0 }, { group: 1, sub: null, index: 1 })).toEqual([['a', 'b', ['d']], ['e', 'c']]);
  // Same place = nothing.
  expect(toolbarMove(groups, { group: 1, sub: null, index: 0 }, { group: 1, sub: null, index: 1 })).toBe(groups);
  // Out and back in; emptied groups go.
  const out = toolbarRemoveAt(groups, { group: 1, sub: null, index: 0 });
  expect(pruneToolbar(out)).toEqual([['a', 'b', ['c', 'd']]]);
  expect(toolbarInsertAt(out, { group: 1, sub: null, index: 0 }, 'x')).toEqual([['a', 'b', ['c', 'd']], ['x']]);
});
