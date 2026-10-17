import { useEffect, useReducer, useState } from 'react';
import type { ReactNode } from 'react';
import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';
import {
  mdiTableColumnPlusBefore, mdiTableColumnPlusAfter, mdiTableRowPlusBefore, mdiTableRowPlusAfter, mdiTableRowRemove,
  mdiTableColumnRemove, mdiTableColumn,
  mdiTableRow, mdiTableArrowLeft, mdiTableArrowRight, mdiTableArrowUp, mdiTableArrowDown, mdiTableColumnWidth,
  mdiTableRowHeight, mdiTableRefresh, mdiSelect, mdiTableEdit, mdiInvertColorsOff, mdiPaletteOutline, mdiTableCog,
  mdiFormatColorFill, mdiChevronDown,
} from '@mdi/js';
import {
  EDITOR_COLORS, TABLE_MOVE_MERGED, CELL_TOOLBAR_ITEMS, toolbarGroups, toolbarItem, moveTableRowBy, moveTableColumnBy, selectTablePart, equalColumnWidths, equalRowHeights, resetRowHeights,
} from '@noted/editor';
import type { TableMoveResult, ToolbarConfig } from '@noted/editor';
import { Btn, Sep, toolbarStyle, popoverStyle, TOOLBAR_HEIGHT } from './menu-parts';
import { Icon } from './Icon';
import { ColorPicker } from './ColorPicker';

type Item = [icon: string, label: string, run: () => unknown, danger?: boolean];

// Toolbar above the table the cursor is in (below it while cells are selected, where the
// FormatMenu is not). Its buttons come from Settings > Toolbar > Table (`desktopTable`, the
// phone's table buttons): plain buttons act at once, Row ▾ / Column ▾ open their lists, a
// subgroup opens its buttons in a dropdown. Lines between columns / rows can also be dragged
// (table-tools.ts).
// `anchor`: note properties "Table menu at the top": the menu floats centred under that
// (zero-height) element below the top toolbar instead of at the table, over the note, so the
// note never moves when it shows or hides.
export function TableMenu({ editor, anchor = null, config = null }: { editor: Editor; anchor?: HTMLElement | null; config?: ToolbarConfig | null }) {
  const docked = !!anchor;
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  // The open dropdown: an item id (rowProps, columnProps, cellColor) or `sub:<group>:<index>`.
  const [open, setOpen] = useState<string | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  // Why the last move did nothing (merged cells in the way), shown under the toolbar.
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 3500);
    return () => clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    const update = () => rerender();
    editor.on('transaction', update);
    editor.on('focus', update);
    editor.on('blur', update);
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      editor.off('transaction', update);
      editor.off('focus', update);
      editor.off('blur', update);
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [editor]);

  const { selection } = editor.state;
  const cells = selection instanceof CellSelection;
  // Selected text shows the FormatMenu, which would land on top of this toolbar.
  // The custom colour picker's hex field takes the focus: the menu stays while it is open.
  const hidden = (!editor.isFocused && !customOpen && !open) || !editor.isActive('table') || (!docked && selection instanceof TextSelection && !selection.empty);

  useEffect(() => {
    if (hidden && open) setOpen(null);
    if (!open) setCustomOpen(false);
  }, [hidden, open]);

  if (hidden) return null;

  const $from = cells ? (selection as CellSelection).$anchorCell : selection.$from;
  let tablePos = -1;
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name === 'table') {
      tablePos = $from.before(depth);
      break;
    }
  }
  if (tablePos < 0) return null;
  const dom = editor.view.nodeDOM(tablePos) as HTMLElement | null;
  if (!dom) return null;
  const rect = dom.getBoundingClientRect();

  // Floating: above the table when there is room in the note's visible area, else below it, else
  // (a table taller than the view) pinned to the top of the view over the table.
  const area = (editor.view.dom as HTMLElement).closest('[data-note-scroll]')?.getBoundingClientRect();
  const minTop = (area?.top ?? 0) + 6;
  const maxTop = (area?.bottom ?? window.innerHeight) - TOOLBAR_HEIGHT - 6;
  const anchorRect = anchor?.getBoundingClientRect();
  const top = anchorRect ? anchorRect.top + 6
    : cells ? Math.max(minTop, Math.min(rect.bottom + 8, maxTop))
    : rect.top - TOOLBAR_HEIGHT - 4 >= minTop ? rect.top - TOOLBAR_HEIGHT - 4
    : rect.bottom + 4 <= maxTop ? rect.bottom + 4
    : minTop;
  const left = anchorRect ? anchorRect.left + anchorRect.width / 2 : Math.max(8, Math.min(rect.left, window.innerWidth - 520));
  const openUp = !docked && window.innerHeight - top < 420 && top > window.innerHeight - top;
  const chain = () => editor.chain().focus();
  const act = (fn: () => unknown) => () => { setOpen(null); fn(); editor.view.focus(); };
  const cellColor = (editor.getAttributes('tableCell').background ?? editor.getAttributes('tableHeader').background) as string | undefined;

  const moved = (result: TableMoveResult) => { if (result === 'merged') setNotice(TABLE_MOVE_MERGED); };
  const customCell = cellColor && cellColor.startsWith('#') ? cellColor : null;
  const lists: Record<'rowProps' | 'columnProps', Item[]> = {
    rowProps: [
      [mdiTableRowPlusBefore, 'Insert row above', () => chain().addRowBefore().run()],
      [mdiTableRowPlusAfter, 'Insert row below', () => chain().addRowAfter().run()],
      [mdiTableArrowUp, 'Move row up', () => moved(moveTableRowBy(editor, -1))],
      [mdiTableArrowDown, 'Move row down', () => moved(moveTableRowBy(editor, 1))],
      [mdiSelect, 'Select row', () => selectTablePart(editor, 'row')],
      [mdiTableRowHeight, 'Equal row heights', () => equalRowHeights(editor)],
      [mdiTableRefresh, 'Natural row heights', () => resetRowHeights(editor)],
      [mdiTableRowRemove, 'Delete row', () => chain().deleteRow().run(), true],
    ],
    columnProps: [
      [mdiTableColumnPlusBefore, 'Insert column left', () => chain().addColumnBefore().run()],
      [mdiTableColumnPlusAfter, 'Insert column right', () => chain().addColumnAfter().run()],
      [mdiTableArrowLeft, 'Move column left', () => moved(moveTableColumnBy(editor, -1))],
      [mdiTableArrowRight, 'Move column right', () => moved(moveTableColumnBy(editor, 1))],
      [mdiSelect, 'Select column', () => selectTablePart(editor, 'column')],
      [mdiTableColumnWidth, 'Equal column widths', () => equalColumnWidths(editor)],
      [mdiTableColumnRemove, 'Delete column', () => chain().deleteColumn().run(), true],
    ],
  };
  // What each plain button does.
  const actions: Record<string, () => unknown> = {
    colLeft: () => chain().addColumnBefore().run(),
    colRight: () => chain().addColumnAfter().run(),
    rowAbove: () => chain().addRowBefore().run(),
    rowBelow: () => chain().addRowAfter().run(),
    deleteColumn: () => chain().deleteColumn().run(),
    deleteRow: () => chain().deleteRow().run(),
    deleteTable: () => chain().deleteTable().run(),
    moveColumnLeft: () => moved(moveTableColumnBy(editor, -1)),
    moveColumnRight: () => moved(moveTableColumnBy(editor, 1)),
    moveRowUp: () => moved(moveTableRowBy(editor, -1)),
    moveRowDown: () => moved(moveTableRowBy(editor, 1)),
    equalWidths: () => equalColumnWidths(editor),
    equalHeights: () => equalRowHeights(editor),
    naturalHeights: () => resetRowHeights(editor),
    headerRow: () => chain().toggleHeaderRow().run(),
    selectColumn: () => selectTablePart(editor, 'column'),
    selectRow: () => selectTablePart(editor, 'row'),
    selectTable: () => selectTablePart(editor, 'table'),
    mergeCells: () => chain().mergeCells().run(),
    splitCell: () => chain().splitCell().run(),
  };
  const DANGER = new Set(['deleteColumn', 'deleteRow', 'deleteTable']);
  const disabledItem = (id: string) => id === 'mergeCells' && !editor.can().mergeCells();
  const itemStyle = { display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', height: 'auto', padding: '6px 8px' } as const;
  const listItem = ([itemIcon, itemLabel, run, danger]: Item, disabled = false) => (
    <Btn key={itemLabel} title={itemLabel} danger={danger} onClick={disabled ? () => {} : act(run)} style={{ ...itemStyle, opacity: disabled ? 0.45 : 1 }}>
      <Icon path={itemIcon} size={18} />{itemLabel}
    </Btn>
  );
  const swatch = { minWidth: 24, width: 24, height: 24, padding: 0 } as const;
  const colours = customOpen ? (
    <ColorPicker
      key="custom"
      initial={customCell ?? undefined}
      onApply={(hex) => { chain().setCellAttribute('background', hex).run(); setCustomOpen(false); }}
      onCancel={() => setCustomOpen(false)}
    />
  ) : (
    <div key="colours">
      <div style={{ fontSize: 12, color: 'var(--text-muted)', margin: '8px 8px 4px' }}>Background</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '0 6px 4px', maxWidth: 228 }}>
        <Btn title="No background" active={!cellColor} onClick={() => chain().setCellAttribute('background', null).run()} style={swatch}>
          <Icon path={mdiInvertColorsOff} size={16} />
        </Btn>
        {EDITOR_COLORS.map((c) => (
          <Btn
            key={c.name}
            title={`${c.label} background`}
            onClick={() => chain().setCellAttribute('background', c.background).run()}
            style={{ ...swatch, backgroundColor: c.background, outline: cellColor === c.background ? '2px solid var(--text-main)' : 'none' }}
          >{''}</Btn>
        ))}
        <Btn
          title="Custom colour"
          onClick={() => setCustomOpen(true)}
          style={{ ...swatch, backgroundColor: customCell ?? 'transparent', outline: customCell ? '2px solid var(--text-main)' : 'none' }}
        >
          {customCell ? '' : <Icon path={mdiPaletteOutline} size={16} />}
        </Btn>
      </div>
    </div>
  );
  // One button inside a dropdown, as a row with its name.
  const dropdownEntry = (id: string): ReactNode => {
    if (id === 'cellColor') return colours;
    if (id === 'rowProps' || id === 'columnProps') {
      return (
        <div key={id}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', margin: '8px 8px 4px' }}>{id === 'rowProps' ? 'Row' : 'Column'}</div>
          {lists[id].map((entry) => listItem(entry))}
        </div>
      );
    }
    const def = toolbarItem(id);
    const run = actions[id];
    return def && run ? listItem([def.icon, def.label, run, DANGER.has(id)], disabledItem(id)) : null;
  };
  const dropdown = (key: string, icon: string, label: string | null, title: string, content: () => ReactNode) => (
    <span key={key} style={{ position: 'relative', display: 'flex' }}>
      <Btn title={title} active={open === key} onClick={() => setOpen((o) => (o === key ? null : key))}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Icon path={icon} size={16} />{label}{label ? ' ▾' : <Icon path={mdiChevronDown} size={12} />}</span>
      </Btn>
      {open === key && (
        <div style={{
          ...popoverStyle, minWidth: 210, overflowY: 'auto',
          // Low in the window: the menu opens upwards instead of past the window's bottom edge.
          ...(openUp ? { top: 'auto', bottom: 'calc(100% + 6px)', maxHeight: top - 16 } : { maxHeight: window.innerHeight - top - 56 }),
        }}
        >
          {content()}
        </div>
      )}
    </span>
  );
  const button = (id: string): ReactNode => {
    if (id === 'rowProps') return dropdown(id, mdiTableRow, 'Row', 'Row options', () => lists.rowProps.map((entry) => listItem(entry)));
    if (id === 'columnProps') return dropdown(id, mdiTableColumn, 'Column', 'Column options', () => lists.columnProps.map((entry) => listItem(entry)));
    if (id === 'cellColor') return dropdown(id, mdiFormatColorFill, null, 'Cell background', () => colours);
    const def = toolbarItem(id);
    const run = actions[id];
    if (!def || !run) return null;
    const disabled = disabledItem(id);
    return (
      <Btn key={id} title={def.label} danger={DANGER.has(id)} onClick={disabled ? () => {} : act(run)} style={{ opacity: disabled ? 0.45 : 1 }}>
        <Icon path={def.icon} size={16} />
      </Btn>
    );
  };
  const groups = toolbarGroups('desktopTable', config);

  return (
    <div style={{ ...toolbarStyle, top, left, ...(docked ? { transform: 'translateX(-50%)' } : {}) }}>
      {groups.map((group, gi) => (
        <span key={gi} style={{ display: 'contents' }}>
          {gi > 0 && <Sep />}
          {group.map((part, pi) => {
            if (!Array.isArray(part)) return button(part);
            const cellsOnly = part.every((id) => CELL_TOOLBAR_ITEMS.has(id));
            return dropdown(`sub:${gi}:${pi}`, cellsOnly ? mdiTableEdit : mdiTableCog, cellsOnly ? 'Cell' : 'Table', cellsOnly ? 'Cell options' : 'Table options', () => part.map(dropdownEntry));
          })}
        </span>
      ))}
      {notice && (
        <div style={{ ...popoverStyle, top: 'calc(100% + 6px)', minWidth: 260, padding: '8px 10px', fontSize: 13, color: 'var(--text-main)' }}>{notice}</div>
      )}
    </div>
  );
}
