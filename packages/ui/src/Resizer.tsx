import { useRef } from 'react';

// How far past a column's minimum the handle must be dragged before the column changes its form
// (a rail of icons, or hidden).
export const RESIZE_SNAP = 48;

// Vertical handle on the right edge of a column. While dragging it reports the width the
// column would have (`onDrag`, not clamped); the app decides what that means (resize, turn
// into a rail, open again). The element stays the same across those changes, so one drag can
// go from the full column to the rail and back.
// `edge: 'left'`: the handle sits on the left edge of a column on the right (dragging left
// makes it wider).
export function Resizer({ width, onDrag, edge = 'right' }: { width: number; onDrag: (width: number) => void; edge?: 'left' | 'right' }) {
  const start = useRef<{ x: number; width: number } | null>(null);
  return (
    <div
      title="Drag to resize"
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, width };
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        const dx = e.clientX - start.current.x;
        onDrag(Math.round(start.current.width + (edge === 'left' ? -dx : dx)));
      }}
      onPointerUp={(e) => {
        start.current = null;
        e.currentTarget.style.backgroundColor = 'transparent';
      }}
      onPointerCancel={() => { start.current = null; }}
      style={{ width: 5, ...(edge === 'left' ? { marginRight: -3 } : { marginLeft: -3 }), cursor: 'col-resize', flex: '0 0 auto', zIndex: 5, position: 'relative', touchAction: 'none' }}
      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--primary)'; }}
      onMouseLeave={(e) => { if (!start.current) e.currentTarget.style.backgroundColor = 'transparent'; }}
    />
  );
}
