import { useEffect, useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { IconBtn } from '@noted/ui';
import { mdiClose, mdiSwapHorizontal, mdiSwapVertical, mdiRotateRight, mdiDockWindow, mdiPictureInPictureBottomRightOutline } from '@mdi/js';

// Split view of the desktop: a second note next to the open one (left / right / top / bottom)
// or in a small floating window. A note from the list or a tab is dragged onto the note
// area; where it is let go decides (DropZones).

export type SplitSide = 'left' | 'right' | 'top' | 'bottom';
export type SplitMode = SplitSide | 'float';
export interface FloatBox { x: number; y: number; w: number; h: number }

// Where a drop at (x, y) puts the note: the outer quarter on each side splits there, the
// middle opens the small window.
export const zoneAt = (rect: DOMRect, x: number, y: number): SplitMode | null => {
  if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return null;
  const fx = (x - rect.left) / rect.width;
  const fy = (y - rect.top) / rect.height;
  const edges: [SplitSide, number][] = [['left', fx], ['right', 1 - fx], ['top', fy], ['bottom', 1 - fy]];
  const [side, distance] = edges.sort((a, b) => a[1] - b[1])[0];
  return distance < 0.25 ? side : 'float';
};

export const DEFAULT_FLOAT: FloatBox = { x: -1, y: -1, w: 440, h: 360 };

// The preview of a zone inside the note area (screen coordinates).
const zoneRect = (rect: DOMRect, zone: SplitMode): CSSProperties => {
  const half = { left: rect.left, top: rect.top, width: rect.width / 2, height: rect.height };
  switch (zone) {
    case 'left': return half;
    case 'right': return { ...half, left: rect.left + rect.width / 2 };
    case 'top': return { left: rect.left, top: rect.top, width: rect.width, height: rect.height / 2 };
    case 'bottom': return { left: rect.left, top: rect.top + rect.height / 2, width: rect.width, height: rect.height / 2 };
    case 'float': return { left: rect.right - 460, top: rect.bottom - 380, width: 440, height: 360 };
  }
};

const ZONE_LABEL: Record<SplitMode, string> = {
  left: 'Split: left', right: 'Split: right', top: 'Split: top', bottom: 'Split: bottom', float: 'Small window',
};

// While a note is dragged: the target zone and a label with the note's title at the pointer.
export function DropZones({ area, zone, x, y, title }: { area: DOMRect | null; zone: SplitMode | null; x: number; y: number; title: string }) {
  return (
    <>
      {area && zone && (
        <div style={{
          position: 'fixed', ...zoneRect(area, zone), zIndex: 20000, pointerEvents: 'none', borderRadius: 10,
          border: '2px solid var(--primary)', backgroundColor: 'color-mix(in srgb, var(--primary) 14%, transparent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)', fontSize: 14, fontWeight: 600,
        }}>{ZONE_LABEL[zone]}</div>
      )}
      <div style={{
        position: 'fixed', left: x + 14, top: y + 10, zIndex: 20001, pointerEvents: 'none', maxWidth: 260, padding: '5px 10px',
        borderRadius: 8, fontSize: 13, color: 'var(--text-main)', backgroundColor: 'var(--bg-surface-highest)',
        border: '1px solid var(--border)', boxShadow: '0 6px 16px rgba(0,0,0,0.35)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{title}</div>
    </>
  );
}

interface PaneProps {
  title: string;
  mode: SplitMode;
  float: FloatBox;
  // The note area (the float window stays inside it).
  area: HTMLElement | null;
  onClose: () => void;
  onSwap: () => void;
  onRotate: () => void;
  onToggleFloat: () => void;
  onFloat: (box: FloatBox) => void;
  children: ReactNode;
}

// The second note's pane: a bar (title, swap, turn, window / dock, close) over its editor.
export function SplitPane({ title, mode, float, area, onClose, onSwap, onRotate, onToggleFloat, onFloat, children }: PaneProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const floating = mode === 'float';
  // Default place of the window: bottom right of the note area.
  const bounds = area?.getBoundingClientRect();
  const box = floating && bounds && float.x < 0
    ? { ...float, x: Math.max(8, bounds.width - float.w - 16), y: Math.max(8, bounds.height - float.h - 16) }
    : float;

  // The window's own resize handle (CSS resize): keep the size it was given.
  useEffect(() => {
    const el = boxRef.current;
    if (!floating || !el) return;
    const observer = new ResizeObserver(() => {
      const w = Math.round(el.offsetWidth);
      const h = Math.round(el.offsetHeight);
      if (Math.abs(w - box.w) > 2 || Math.abs(h - box.h) > 2) onFloat({ ...box, w, h });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [floating, box.x, box.y, box.w, box.h]);

  // Moving the window by its bar.
  const dragBar = (e: React.MouseEvent) => {
    if (!floating || e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY, bx: box.x, by: box.y };
    const limit = area?.getBoundingClientRect();
    const move = (ev: MouseEvent) => {
      const x = start.bx + ev.clientX - start.x;
      const y = start.by + ev.clientY - start.y;
      onFloat({
        ...box,
        x: limit ? Math.min(Math.max(0, x), limit.width - 80) : x,
        y: limit ? Math.min(Math.max(0, y), limit.height - 40) : y,
      });
    };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const frame: CSSProperties = floating
    ? {
      position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, zIndex: 50, resize: 'both', overflow: 'hidden',
      minWidth: 260, minHeight: 160, borderRadius: 10, border: '1px solid var(--border-focus)', boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
      pointerEvents: 'auto',
    }
    : { flex: 1, minWidth: 0, minHeight: 0 };
  return (
    <div ref={boxRef} data-split-pane="" style={{ ...frame, display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-base)' }}>
      <div onMouseDown={dragBar} style={{
        display: 'flex', alignItems: 'center', gap: 2, padding: '3px 4px 3px 12px', borderBottom: '1px solid var(--border)',
        backgroundColor: 'var(--bg-surface-low)', cursor: floating ? 'move' : 'default', userSelect: 'none',
      }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
        {!floating && <IconBtn icon={mode === 'left' || mode === 'right' ? mdiSwapHorizontal : mdiSwapVertical} title="Swap with the main note" onClick={onSwap} size={16} />}
        {!floating && <IconBtn icon={mdiRotateRight} title="Turn the split (side by side / one above the other)" onClick={onRotate} size={16} />}
        <IconBtn icon={floating ? mdiDockWindow : mdiPictureInPictureBottomRightOutline} title={floating ? 'Dock next to the note' : 'Small window'} onClick={onToggleFloat} size={16} />
        <IconBtn icon={mdiClose} title="Close this pane" onClick={onClose} size={16} />
      </div>
      {children}
    </div>
  );
}
