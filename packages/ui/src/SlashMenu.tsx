import { Fragment, forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Editor } from '@tiptap/core';
import {
  slashItems, insertTableAt, importCsvInto,
  initialNav, searchNav, navigate, activate, hover, hoverTable, hoverCsv,
  TABLE_MAX_COLS, TABLE_MAX_ROWS,
} from '@noted/editor';
import type { SlashItem, NavModel, NavAction } from '@noted/editor';

export interface SlashMenuState {
  // Viewport position just below the "/" (top) and the top edge of its line (caretTop).
  top: number;
  caretTop: number;
  left: number;
  query: string;
  range: { from: number; to: number };
}

export interface SlashMenuHandle {
  handleKey(event: KeyboardEvent): boolean;
}

interface Props {
  editor: Editor;
  state: SlashMenuState;
  onClose: () => void;
}

const HEADING_PX = [22, 19, 17, 15, 14, 12];
// Tallest a panel gets (the lists scroll beyond it).
const MENU_MAX_HEIGHT = 340;

const panelStyle: CSSProperties = {
  backgroundColor: 'var(--bg-surface-high)',
  border: '1px solid var(--border-focus)',
  borderRadius: 8,
  boxShadow: '0 8px 16px rgba(0,0,0,0.4)',
  overflow: 'hidden',
};

// Keys move the highlight and scroll the list; the list then slides under a resting mouse
// pointer, which must not take the highlight (or open a submenu) until the mouse really moves.
let keyboardMode = false;
if (typeof window !== 'undefined') {
  window.addEventListener('mousemove', (e) => { if (e.movementX !== 0 || e.movementY !== 0) keyboardMode = false; }, true);
}
const pointerHover = (run: () => void) => () => { if (!keyboardMode) run(); };

function Row({ item, active, onHover, onPick }: { item: SlashItem; active: boolean; onHover: () => void; onPick: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const preview = item.preview;
  const icon = item.icon ? (
    <svg width={16} height={16} viewBox="0 0 24 24" aria-hidden><path d={item.icon} fill="currentColor" /></svg>
  ) : preview?.kind === 'icon' ? (preview.path ? <svg width={16} height={16} viewBox="0 0 24 24" aria-hidden><path d={preview.path} fill="currentColor" /></svg> : preview.icon) : null;
  const title =
    preview?.kind === 'heading' ? (
      <span
        style={{
          fontSize: HEADING_PX[preview.level - 1],
          fontWeight: 700,
          lineHeight: 1.2,
          ...(preview.level === 6 ? { textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)' } : {}),
        }}
      >
        {item.title}
      </span>
    ) : (
      <span>{item.title}</span>
    );
  const label = icon ? (
    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 18, flexShrink: 0, display: 'flex', justifyContent: 'center', color: 'var(--text-muted)' }}>{icon}</span>
      {title}
    </span>
  ) : title;

  return (
    <div
      ref={ref}
      onMouseEnter={pointerHover(onHover)}
      onMouseMove={active ? undefined : pointerHover(onHover)}
      onMouseDown={(e) => {
        e.preventDefault();
        onPick();
      }}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        padding: '7px 12px', cursor: 'pointer', fontSize: 13, color: 'var(--text-main)',
        backgroundColor: active ? 'var(--bg-surface)' : 'transparent',
      }}
    >
      {label}
      {item.submenu ? <span style={{ color: 'var(--text-muted)' }}>›</span> : null}
    </div>
  );
}

function Tile({ item, active, onHover, onPick }: { item: SlashItem; active: boolean; onHover: () => void; onPick: () => void }) {
  const markers = item.preview?.kind === 'markers' ? item.preview.markers : [];
  return (
    <div
      title={item.title}
      onMouseEnter={pointerHover(onHover)}
      onMouseMove={active ? undefined : pointerHover(onHover)}
      onMouseDown={(e) => {
        e.preventDefault();
        onPick();
      }}
      style={{
        padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
        border: active ? '1px solid var(--border-focus)' : '1px solid transparent',
        backgroundColor: active ? 'var(--bg-surface)' : 'transparent',
      }}
    >
      {markers.map((marker, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, height: 18 }}>
          <span style={{ width: 22, textAlign: 'right', fontSize: 12, color: 'var(--text-main)' }}>{marker}</span>
          <span style={{ width: 44, height: 7, borderRadius: 4, backgroundColor: 'var(--border-focus)' }} />
        </div>
      ))}
    </div>
  );
}

export const SlashMenu = forwardRef<SlashMenuHandle, Props>(function SlashMenu({ editor, state, onClose }, ref) {
  const buildModel = (query: string): NavModel => (query ? searchNav(slashItems, query) : initialNav(slashItems));
  const [model, setModel] = useState<NavModel>(() => buildModel(state.query));
  useEffect(() => setModel(buildModel(state.query)), [state.query]);

  // The key handler is called from ProseMirror, outside React; it reads the latest values here.
  const latest = useRef({ model, editor, range: state.range, onClose });
  latest.current = { model, editor, range: state.range, onClose };

  const perform = (action: NavAction | undefined) => {
    if (!action) return;
    const { editor: ed, range, onClose: close } = latest.current;
    if (action.type === 'run') action.item.command?.({ editor: ed, range });
    else if (action.type === 'table-insert') insertTableAt(ed, range, action.cols, action.rows);
    else importCsvInto(ed, range);
    close();
  };

  useImperativeHandle(ref, () => ({
    handleKey(event: KeyboardEvent) {
      const result = navigate(latest.current.model, event.key);
      if (!result.handled) return false;
      event.preventDefault();
      keyboardMode = true;
      latest.current.model = result.model;
      setModel(result.model);
      perform(result.action);
      return true;
    },
  }), []);

  const pick = (depth: number, index: number) => {
    const level = latest.current.model[depth];
    if (!level || level.kind === 'table') return;
    const result = activate(latest.current.model.slice(0, depth + 1), level.items[index]);
    latest.current.model = result.model;
    setModel(result.model);
    perform(result.action);
  };

  // Near the bottom of the window the menu opens upwards, with panels aligned at the bottom so
  // submenus grow up too. The decision uses the tallest possible panel, so it does not flip
  // back and forth while submenus open and close.
  const spaceBelow = window.innerHeight - state.top - 8;
  const spaceAbove = state.caretTop - 16;
  const openUp = spaceBelow < MENU_MAX_HEIGHT && spaceAbove > spaceBelow;
  const listMaxHeight = Math.max(120, Math.min(MENU_MAX_HEIGHT, openUp ? spaceAbove : spaceBelow));
  const vertical: CSSProperties = openUp
    ? { bottom: window.innerHeight - state.caretTop + 8, alignItems: 'flex-end' }
    : { top: state.top, alignItems: 'flex-start' };
  const left = Math.max(8, Math.min(state.left, window.innerWidth - 640));

  return (
    <div style={{ position: 'fixed', ...vertical, left, zIndex: 9999, display: 'flex', gap: 6 }}>
      {model.map((level, depth) => {
        if (level.kind === 'list') {
          return (
            <div key={depth} style={{ ...panelStyle, minWidth: depth === 0 ? 190 : 170, maxHeight: listMaxHeight, overflowY: 'auto' }}>
              {level.items.length === 0 ? (
                <div style={{ padding: '8px 12px', fontSize: 13, color: 'var(--text-muted)' }}>No results</div>
              ) : (
                level.items.map((item, i) => (
                  <Fragment key={item.title}>
                    {level.divider === i && <div style={{ height: 1, backgroundColor: 'var(--border)', margin: '4px 0' }} />}
                    <Row
                      item={item}
                      active={i === level.index}
                      onHover={() => setModel((m) => hover(m, depth, i))}
                      onPick={() => pick(depth, i)}
                    />
                  </Fragment>
                ))
              )}
            </div>
          );
        }

        if (level.kind === 'tiles') {
          return (
            <div key={depth} style={{ ...panelStyle, padding: 6, display: 'grid', gridTemplateColumns: `repeat(${level.columns}, auto)`, gap: 4 }}>
              {level.items.map((item, i) => (
                <Tile
                  key={item.title}
                  item={item}
                  active={i === level.index}
                  onHover={() => setModel((m) => hover(m, depth, i))}
                  onPick={() => pick(depth, i)}
                />
              ))}
            </div>
          );
        }

        return (
          <div key={depth} style={{ ...panelStyle, padding: 8 }}>
            <div
              onMouseEnter={pointerHover(() => setModel((m) => hoverCsv(m, depth)))}
              onMouseDown={(e) => {
                e.preventDefault();
                perform({ type: 'table-csv' });
              }}
              style={{
                padding: '7px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 13, color: 'var(--text-main)',
                backgroundColor: level.csvFocused ? 'var(--bg-surface)' : 'transparent',
              }}
            >
              Import CSV
            </div>
            <div style={{ height: 1, backgroundColor: 'var(--border)', margin: '6px 0 8px' }} />
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${TABLE_MAX_COLS}, 20px)`, gap: 4 }}>
              {Array.from({ length: TABLE_MAX_ROWS * TABLE_MAX_COLS }, (_, i) => {
                const col = (i % TABLE_MAX_COLS) + 1;
                const row = Math.floor(i / TABLE_MAX_COLS) + 1;
                const selected = !level.csvFocused && col <= level.cols && row <= level.rows;
                return (
                  <div
                    key={i}
                    onMouseEnter={pointerHover(() => setModel((m) => hoverTable(m, depth, col, row)))}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      perform({ type: 'table-insert', cols: col, rows: row });
                    }}
                    style={{
                      width: 20, height: 20, borderRadius: 4, cursor: 'pointer',
                      border: `1px solid ${selected ? 'var(--primary)' : 'var(--border-focus)'}`,
                      backgroundColor: selected ? 'var(--border)' : 'transparent',
                    }}
                  />
                );
              })}
            </div>
            <div style={{ textAlign: 'center', marginTop: 8, fontSize: 13, color: 'var(--text-main)' }}>
              {level.cols} x {level.rows}
            </div>
          </div>
        );
      })}
    </div>
  );
});
