import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

// Touchpad pinch over the note = a magnifying glass like a browser's pinch zoom: the note is
// scaled as a picture (no reflow, unlike Ctrl+wheel / the status bar zoom), the point under
// the pointer stays put, and the magnified note scrolls both ways. Pinching back to 100 %
// ends it. lib.rs sends the gesture ("noted:pinch"); WebKit's own one would magnify the
// whole window.
const MAX_SCALE = 5;
const SNAP_TO_ONE = 1.03;

export function useMagnifier(resetKey: unknown) {
  const [scale, setScale] = useState(1);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const scaleRef = useRef(1);
  const baseRef = useRef(1);
  const pointer = useRef({ x: 0, y: 0 });
  const pendingScroll = useRef<{ left: number; top: number } | null>(null);

  useEffect(() => {
    const move = (e: MouseEvent) => { pointer.current = { x: e.clientX, y: e.clientY }; };
    window.addEventListener('mousemove', move, { passive: true });
    return () => window.removeEventListener('mousemove', move);
  }, []);

  // Another note: back to normal.
  useEffect(() => {
    scaleRef.current = 1;
    setScale(1);
  }, [resetKey]);

  // The note's own height changes while typing; the scrollable area follows it.
  const magnified = scale > 1;
  useEffect(() => {
    const el = contentRef.current;
    if (!magnified || !el) return;
    const observer = new ResizeObserver(() => setSize((s) => (s.height === el.offsetHeight ? s : { ...s, height: el.offsetHeight })));
    observer.observe(el);
    return () => observer.disconnect();
  }, [magnified]);

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const target = pendingScroll.current;
    if (!scroller || !target) return;
    pendingScroll.current = null;
    scroller.scrollLeft = target.left;
    scroller.scrollTop = target.top;
  }, [scale]);

  const pinch = (phase: string, factor: number) => {
    const scroller = scrollRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return;
    if (phase === 'begin') {
      baseRef.current = scaleRef.current;
      if (scaleRef.current === 1) setSize({ width: scroller.clientWidth, height: content.offsetHeight });
      return;
    }
    if (phase !== 'change') return;
    const prev = scaleRef.current;
    let next = Math.min(MAX_SCALE, Math.max(1, baseRef.current * factor));
    if (next < SNAP_TO_ONE) next = 1;
    if (Math.abs(next - prev) < 0.002) return;
    // Keep the note point under the pointer where it is.
    const rect = scroller.getBoundingClientRect();
    const px = Math.min(rect.width, Math.max(0, pointer.current.x - rect.left));
    const py = Math.min(rect.height, Math.max(0, pointer.current.y - rect.top));
    const cx = (scroller.scrollLeft + px) / prev;
    const cy = (scroller.scrollTop + py) / prev;
    pendingScroll.current = { left: Math.max(0, cx * next - px), top: Math.max(0, cy * next - py) };
    scaleRef.current = next;
    setScale(next);
  };

  const reset = () => {
    scaleRef.current = 1;
    setScale(1);
  };

  // Styles of the two wrappers around the note (always rendered, so the editor never remounts).
  const sizerStyle: CSSProperties | undefined = magnified
    ? { position: 'relative', width: size.width * scale, height: size.height * scale, overflow: 'hidden' }
    : undefined;
  const contentStyle: CSSProperties | undefined = magnified
    ? { position: 'absolute', left: 0, top: 0, width: size.width, transform: `scale(${scale})`, transformOrigin: '0 0' }
    : undefined;

  return { scale, scrollRef, contentRef, pinch, reset, sizerStyle, contentStyle };
}
