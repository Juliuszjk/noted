import { useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { hsvToHex, hexToHsv } from '@noted/editor';
import type { Hsv } from '@noted/editor';

// Custom colour picker: drag in the saturation/brightness square and on the hue bar, or type
// a hex value. Nothing is applied while dragging; "Apply" hands back the colour.

const clamp = (n: number, min = 0, max = 1) => Math.min(max, Math.max(min, n));

export function ColorPicker({ initial, onApply, onCancel }: { initial?: string; onApply: (hex: string) => void; onCancel: () => void }) {
  const [hsv, setHsv] = useState<Hsv>(() => (initial && hexToHsv(initial)) || { h: 210, s: 0.6, v: 0.9 });
  const [hexText, setHexText] = useState(() => hsvToHex((initial && hexToHsv(initial)) || { h: 210, s: 0.6, v: 0.9 }));
  const square = useRef<HTMLDivElement>(null);
  const hue = useRef<HTMLDivElement>(null);

  const update = (next: Hsv) => {
    setHsv(next);
    setHexText(hsvToHex(next));
  };
  // Follows the pointer while the button is held (pointer capture keeps it outside too).
  const drag = (target: 'square' | 'hue') => (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = (target === 'square' ? square : hue).current;
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    const move = (x: number, y: number) => {
      const rect = el.getBoundingClientRect();
      if (target === 'square') update({ h: hsv.h, s: clamp((x - rect.left) / rect.width), v: 1 - clamp((y - rect.top) / rect.height) });
      else update({ ...hsv, h: clamp((x - rect.left) / rect.width) * 359.9 });
    };
    move(e.clientX, e.clientY);
    const onMove = (ev: PointerEvent) => move(ev.clientX, ev.clientY);
    const onUp = () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
  };

  const hex = hsvToHex(hsv);
  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }} onMouseDown={(e) => { if (!(e.target as HTMLElement).closest('input')) e.preventDefault(); }}>
      <div
        ref={square}
        onPointerDown={drag('square')}
        style={{
          position: 'relative', height: 120, borderRadius: 8, cursor: 'crosshair', touchAction: 'none',
          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv.h}, 100%, 50%))`,
        }}
      >
        <span style={{ position: 'absolute', left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, width: 14, height: 14, margin: -7, borderRadius: 7, border: '2px solid #fff', boxShadow: '0 0 2px rgba(0,0,0,0.8)', pointerEvents: 'none' }} />
      </div>
      <div
        ref={hue}
        onPointerDown={drag('hue')}
        style={{ position: 'relative', height: 14, borderRadius: 7, cursor: 'pointer', touchAction: 'none', background: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)' }}
      >
        <span style={{ position: 'absolute', left: `${(hsv.h / 360) * 100}%`, top: -2, width: 8, height: 18, marginLeft: -4, borderRadius: 4, border: '2px solid #fff', boxShadow: '0 0 2px rgba(0,0,0,0.8)', pointerEvents: 'none' }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid var(--border)', backgroundColor: hex }} />
        <input
          value={hexText}
          onChange={(e) => {
            setHexText(e.target.value);
            const parsed = hexToHsv(e.target.value);
            if (parsed) setHsv(parsed);
          }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onApply(hex); } }}
          style={{ flex: 1, minWidth: 0, padding: '5px 8px', fontSize: 13, fontFamily: 'monospace', color: 'var(--text-main)', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 6, outline: 'none' }}
        />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
        <button type="button" onClick={onCancel} style={{ padding: '5px 12px', border: '1px solid var(--border)', borderRadius: 14, background: 'transparent', color: 'var(--text-main)', cursor: 'pointer' }}>Cancel</button>
        <button type="button" onClick={() => onApply(hex)} style={{ padding: '5px 12px', border: 'none', borderRadius: 14, background: 'var(--primary)', color: 'var(--primary-fg)', cursor: 'pointer', fontWeight: 600 }}>Apply</button>
      </div>
    </div>
  );
}
