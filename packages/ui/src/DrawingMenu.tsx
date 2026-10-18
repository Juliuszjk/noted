import { useEffect, useReducer, useState } from 'react';
import type { ReactNode } from 'react';
import type { Editor } from '@tiptap/core';
import { mdiChevronDown, mdiClose, mdiDotsVertical } from '@mdi/js';
import {
  EDITOR_COLORS, DRAWING_TOOLS, DRAWING_TOOL_ITEMS, DRAWING_SIZE_RANGE, DRAWING_GRID_RANGE, currentPen, onDrawingChange, setDrawingActive,
  setDrawingTool, setPenSettings, strokeOutline, strokeStyle, toolbarGroups, toolbarItem,
} from '@noted/editor';
import type { DrawingTool, ToolbarConfig } from '@noted/editor';
import { Btn, Sep, toolbarStyle, popoverStyle, TOOLBAR_HEIGHT } from './menu-parts';
import { Icon } from './Icon';
import { ColorPicker } from './ColorPicker';

// Drawing tools above the active drawing (below it when there is no room, at the top of the
// view over a drawing taller than the view). Its buttons come from Settings > Toolbar >
// Drawing menu (`desktopDrawing`). `anchor`: note properties "Drawing menu at the top": the
// menu floats centred under that (zero-height) element below the top toolbar instead, over the
// note, so the note never moves when it shows or hides.

const KIND_OF_ITEM = Object.fromEntries(DRAWING_TOOLS.map((tool) => [DRAWING_TOOL_ITEMS[tool], tool])) as Record<string, DrawingTool>;

// A wave for the width preview, the pressure rising and falling like a real stroke.
const SAMPLE = Array.from({ length: 40 }, (_, i) => ({ x: 14 + i * 5.6, y: 30 + Math.sin(i / 4) * 12, p: 0.3 + 0.6 * Math.sin((i / 39) * Math.PI) }));

const isHex = (value: string | null | undefined): value is string => !!value && /^#[0-9a-f]{6}$/i.test(value);

export function DrawingMenu({ editor, anchor = null, config = null }: { editor: Editor; anchor?: HTMLElement | null; config?: ToolbarConfig | null }) {
  const docked = !!anchor;
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  // The open dropdown: an item id (drawTool, drawColor, drawWidth) or `sub:<group>:<index>`.
  const [open, setOpen] = useState<string | null>(null);
  const [customOpen, setCustomOpen] = useState(false);

  useEffect(() => {
    const update = () => rerender();
    const off = onDrawingChange(editor, update);
    editor.on('transaction', update);
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      off();
      editor.off('transaction', update);
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [editor]);

  const storage = editor.storage.drawing;
  const dom = storage.activeDom;
  const hidden = !storage.active || !editor.isEditable || !dom || !dom.isConnected;
  useEffect(() => {
    if (hidden) setOpen(null);
    if (!open) setCustomOpen(false);
  }, [hidden, open]);
  if (hidden) return null;

  const state = storage.current;
  const pen = currentPen(editor);
  const rect = dom.getBoundingClientRect();
  const area = (editor.view.dom as HTMLElement).closest('[data-note-scroll]')?.getBoundingClientRect();
  const minTop = (area?.top ?? 0) + 6;
  const maxTop = (area?.bottom ?? window.innerHeight) - TOOLBAR_HEIGHT - 6;
  const anchorRect = anchor?.getBoundingClientRect();
  const top = anchorRect ? anchorRect.top + 6
    : rect.top - TOOLBAR_HEIGHT - 4 >= minTop ? rect.top - TOOLBAR_HEIGHT - 4
    : rect.bottom + 4 <= maxTop && rect.bottom > minTop + 120 ? rect.bottom + 4
    : minTop;
  const left = anchorRect ? anchorRect.left + anchorRect.width / 2 : Math.max(8, Math.min(rect.left, window.innerWidth - 420));
  const openUp = !docked && window.innerHeight - top < 360 && top > window.innerHeight - top;

  const pickKind = (tool: DrawingTool) => { setOpen(null); setDrawingTool(editor, { tool, mode: 'pen' }); };
  const colorCss = (value: string | null) => value ?? 'var(--text-main)';

  const dropdown = (key: string, title: string, face: ReactNode, content: () => ReactNode, active = false, shown = open === key) => (
    <span key={key} style={{ position: 'relative', display: 'flex' }}>
      <Btn title={title} active={shown || active} onClick={() => setOpen((o) => (o === key || shown ? null : key))}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>{face}<Icon path={mdiChevronDown} size={12} /></span>
      </Btn>
      {shown && (
        <div style={{
          ...popoverStyle, minWidth: 0, overflowY: 'auto',
          ...(docked ? { left: '50%', transform: 'translateX(-50%)' } : {}),
          ...(openUp ? { top: 'auto', bottom: 'calc(100% + 6px)', maxHeight: top - 16 } : { maxHeight: window.innerHeight - top - 56 }),
        }}
        >
          {content()}
        </div>
      )}
    </span>
  );

  const listItem = (icon: string, label: string, run: () => void, active: boolean) => (
    <Btn key={label} title={label} active={active} onClick={run} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', height: 'auto', padding: '6px 8px' }}>
      <Icon path={icon} size={18} />{label}
    </Btn>
  );

  const kinds = () => DRAWING_TOOLS.map((tool) => {
    const def = toolbarItem(DRAWING_TOOL_ITEMS[tool])!;
    return listItem(def.icon, def.label, () => pickKind(tool), state.tool === tool);
  });

  const swatch = { minWidth: 24, width: 24, height: 24, padding: 0, borderRadius: 12 } as const;
  const colours = () => (customOpen ? (
    <ColorPicker
      key="custom"
      initial={isHex(pen.color) ? pen.color : undefined}
      onApply={(hex) => { setPenSettings(editor, { color: hex }); setCustomOpen(false); setOpen(null); }}
      onCancel={() => setCustomOpen(false)}
    />
  ) : (
    <div key="colours" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: 4, width: 186 }}>
      {[{ name: 'text', label: 'Text colour', value: null as string | null }, ...EDITOR_COLORS.map((c) => ({ name: c.name, label: c.label, value: c.text }))].map((c) => (
        <Btn
          key={c.name}
          title={c.label}
          onClick={() => { setPenSettings(editor, { color: c.value }); setOpen(null); }}
          style={{ ...swatch, backgroundColor: colorCss(c.value), outline: pen.color === c.value ? '2px solid var(--primary)' : '1px solid var(--border)', outlineOffset: 1 }}
        >
          {null}
        </Btn>
      ))}
      <Btn
        title="Custom colour"
        onClick={() => setCustomOpen(true)}
        style={{ ...swatch, backgroundColor: isHex(pen.color) ? pen.color : 'transparent', outline: isHex(pen.color) ? '2px solid var(--primary)' : '1px solid var(--border)', outlineOffset: 1 }}
      >
        {isHex(pen.color) ? null : <Icon path={toolbarItem('drawColor')!.icon} size={15} />}
      </Btn>
    </div>
  ));

  const [min, max] = DRAWING_SIZE_RANGE[state.tool];
  const width = () => (
    <div key="width" style={{ width: 250, padding: '4px 6px' }}>
      <svg viewBox="0 0 240 60" style={{ display: 'block', width: '100%', height: 60, color: 'var(--text-main)' }} aria-hidden>
        {/* The width as it shows in the note (drawing units at the note's scale). */}
        <path d={strokeOutline(SAMPLE, (pen.size * (dom.clientWidth || 1000)) / 1000, state.tool)} style={parseStyle(strokeStyle({ color: pen.color, tool: state.tool }))} />
      </svg>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <input
          type="range"
          min={min}
          max={max}
          step={0.5}
          value={pen.size}
          onChange={(e) => setPenSettings(editor, { size: Number(e.target.value) })}
          style={{ flex: 1, accentColor: 'var(--primary)' }}
        />
        <span style={{ minWidth: 26, textAlign: 'right', fontSize: 12, color: 'var(--text-muted)' }}>{pen.size}</span>
      </div>
    </div>
  );

  // Grid paper: on / off and the cell size (shown at once in the drawing).
  const paperPanel = () => (
    <div key="paper" style={{ display: 'flex', alignItems: 'center', gap: 10, width: 250, padding: '4px 6px' }}>
      <Btn title="Grid paper on / off" active={state.paper === 'grid'} onClick={() => setDrawingTool(editor, { paper: state.paper === 'grid' ? 'none' : 'grid' })}>
        <Icon path={toolbarItem('drawPaper')!.icon} size={18} />
      </Btn>
      <input
        type="range"
        min={DRAWING_GRID_RANGE[0]}
        max={DRAWING_GRID_RANGE[1]}
        step={5}
        value={state.gridSize}
        title="Grid size"
        onChange={(e) => setDrawingTool(editor, { paper: 'grid', gridSize: Number(e.target.value) })}
        style={{ flex: 1, accentColor: 'var(--primary)' }}
      />
      <span style={{ minWidth: 26, textAlign: 'right', fontSize: 12, color: 'var(--text-muted)' }}>{state.gridSize}</span>
    </div>
  );

  const widthFace = (
    <svg width={18} height={18} viewBox="0 0 24 24" aria-hidden>
      <line x1={3} y1={12} x2={21} y2={12} strokeLinecap="round" stroke={colorCss(pen.color)} strokeWidth={1.5 + ((pen.size - min) / Math.max(1, max - min)) * 9} />
    </svg>
  );

  // Plain buttons act at once; the pen kind, colour and width open their dropdowns.
  const button = (id: string): ReactNode => {
    const def = toolbarItem(id);
    if (!def) return null;
    if (id === 'drawTool') {
      const kind = toolbarItem(DRAWING_TOOL_ITEMS[state.tool])!;
      return dropdown(id, `Pen kind: ${kind.label}`, <Icon path={kind.icon} size={18} />, kinds, state.mode === 'pen');
    }
    if (id === 'drawColor') {
      return dropdown(id, 'Colour', <span style={{ display: 'block', width: 16, height: 16, borderRadius: 8, border: '1px solid var(--border)', backgroundColor: colorCss(pen.color) }} />, colours);
    }
    if (id === 'drawWidth') return dropdown(id, 'Width', widthFace, width);
    if (id === 'drawPaper') return dropdown(id, def.label, <Icon path={def.icon} size={18} />, paperPanel, state.paper === 'grid');
    const kind = KIND_OF_ITEM[id];
    const run = kind ? () => pickKind(kind)
      : id === 'eraseStroke' ? () => setDrawingTool(editor, { mode: 'eraser', eraser: 'stroke' })
      : id === 'erasePart' ? () => setDrawingTool(editor, { mode: 'eraser', eraser: 'part' })
      : id === 'drawLasso' ? () => setDrawingTool(editor, { mode: state.mode === 'lasso' ? 'pen' : 'lasso' })
      : id === 'drawUndo' ? () => editor.commands.undo()
      : id === 'drawRedo' ? () => editor.commands.redo()
      : null;
    if (!run) return null;
    const active = kind ? state.mode === 'pen' && state.tool === kind
      : id === 'eraseStroke' ? state.mode === 'eraser' && state.eraser === 'stroke'
      : id === 'erasePart' ? state.mode === 'eraser' && state.eraser === 'part'
      : id === 'drawLasso' ? state.mode === 'lasso'
      : false;
    return (
      <Btn key={id} title={def.label} active={active} onClick={() => { setOpen(null); run(); }}>
        <Icon path={def.icon} size={18} />
      </Btn>
    );
  };

  // A subgroup (⋮): its buttons in a dropdown; the colour / width ones open their own.
  const subEntry = (id: string): ReactNode => {
    const def = toolbarItem(id);
    if (!def) return null;
    if (id === 'drawTool' || id === 'drawColor' || id === 'drawWidth' || id === 'drawPaper') return listItem(def.icon, def.label, () => setOpen(id), id === 'drawPaper' && state.paper === 'grid');
    const kind = KIND_OF_ITEM[id];
    if (kind) return listItem(def.icon, def.label, () => pickKind(kind), state.mode === 'pen' && state.tool === kind);
    const run = id === 'eraseStroke' ? () => setDrawingTool(editor, { mode: 'eraser', eraser: 'stroke' })
      : id === 'erasePart' ? () => setDrawingTool(editor, { mode: 'eraser', eraser: 'part' })
      : id === 'drawLasso' ? () => setDrawingTool(editor, { mode: state.mode === 'lasso' ? 'pen' : 'lasso' })
      : id === 'drawUndo' ? () => editor.commands.undo()
      : () => editor.commands.redo();
    return listItem(def.icon, def.label, () => { setOpen(null); run(); }, false);
  };

  const groups = toolbarGroups('desktopDrawing', config);
  // A dropdown opened from a subgroup row shows under the ⋮ button.
  const subOpen = (part: string[]) => !!open && part.includes(open);

  return (
    <div style={{ ...toolbarStyle, top, left, ...(docked ? { transform: 'translateX(-50%)' } : {}) }} onContextMenu={(e) => e.preventDefault()}>
      {groups.map((group, gi) => (
        <span key={gi} style={{ display: 'contents' }}>
          {gi > 0 && <Sep />}
          {group.map((part, pi) => {
            if (!Array.isArray(part)) return button(part);
            const key = `sub:${gi}:${pi}`;
            // The pen kind / colour / width picked from this subgroup: its dropdown under the ⋮.
            const inner = subOpen(part) ? open : null;
            if (inner) {
              return dropdown(key, toolbarItem(inner)?.label ?? 'More', <Icon path={mdiDotsVertical} size={18} />, inner === 'drawTool' ? kinds : inner === 'drawColor' ? colours : inner === 'drawPaper' ? paperPanel : width, true, true);
            }
            return dropdown(key, 'More drawing tools', <Icon path={mdiDotsVertical} size={18} />, () => part.map(subEntry));
          })}
        </span>
      ))}
      <Sep />
      <Btn title="Close the drawing tools" onClick={() => setDrawingActive(editor, false)}>
        <Icon path={mdiClose} size={16} />
      </Btn>
    </div>
  );
}

// "fill:...;opacity:..." (strokeStyle) as a React style object.
const parseStyle = (css: string): Record<string, string> =>
  Object.fromEntries(css.split(';').filter(Boolean).map((rule) => {
    const [key, value] = rule.split(':');
    return [key.trim(), value.trim()];
  }));
