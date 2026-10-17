import { mdiRotateLeft, mdiRotateRight, mdiMagnifyMinusOutline, mdiMagnifyPlusOutline, mdiFitToScreenOutline, mdiDownload, mdiClose } from '@mdi/js';

// Full-screen picture of an image (the eye in the image menu): rotate, zoom (buttons, wheel,
// two fingers), move it around, download. Plain DOM, so the desktop and the phone's editor
// page share it. Esc or a click beside the picture closes it.

const STYLE_ID = 'noted-image-viewer-style';
const CSS = `
.niv { position: fixed; inset: 0; z-index: 100000; background: rgba(0,0,0,0.88); display: flex; align-items: center; justify-content: center; overflow: hidden; touch-action: none; user-select: none; }
.niv img { max-width: 92vw; max-height: 86vh; transform-origin: center; cursor: grab; will-change: transform; }
.niv.animate img { transition: transform 0.15s ease-out; }
.niv.moving img { cursor: grabbing; }
.niv-bar { position: absolute; top: 10px; right: 10px; display: flex; gap: 4px; padding: 4px; border-radius: 12px; background: rgba(30,30,30,0.85); }
.niv-bar button { width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; border: none; border-radius: 8px; background: transparent; color: #fff; cursor: pointer; }
.niv-bar button:hover { background: rgba(255,255,255,0.15); }
.niv-zoom { position: absolute; bottom: 14px; left: 50%; transform: translateX(-50%); padding: 4px 10px; border-radius: 10px; background: rgba(30,30,30,0.85); color: #fff; font: 13px sans-serif; }
`;

const icon = (path: string) => `<svg width="22" height="22" viewBox="0 0 24 24"><path d="${path}" fill="currentColor"/></svg>`;

// Window event carrying a touchpad pinch ({ phase: 'begin' | 'change' | 'end', scale }); a
// listener that uses it calls preventDefault (the app then leaves its own magnifier alone).
export const PINCH_EVENT = 'noted:pinch-gesture';

export const openImageViewer = (src: string, options: { alt?: string; onDownload?: () => void } = {}): (() => void) => {
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.append(style);
  }
  const root = document.createElement('div');
  root.className = 'niv';
  const img = document.createElement('img');
  img.src = src;
  img.alt = options.alt ?? '';
  img.draggable = false;
  const bar = document.createElement('div');
  bar.className = 'niv-bar';
  const zoomLabel = document.createElement('div');
  zoomLabel.className = 'niv-zoom';
  root.append(img, bar, zoomLabel);

  let rotation = 0;
  let zoom = 1;
  let x = 0;
  let y = 0;
  const apply = () => {
    img.style.transform = `translate(${x}px, ${y}px) rotate(${rotation}deg) scale(${zoom})`;
    zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  };
  // Buttons animate; wheel, fingers and dragging follow at once (an animation running behind
  // the pointer made the picture flicker).
  let animateTimer: ReturnType<typeof setTimeout> | undefined;
  const animated = (run: () => void) => {
    root.classList.add('animate');
    run();
    clearTimeout(animateTimer);
    animateTimer = setTimeout(() => root.classList.remove('animate'), 180);
  };
  // Zoom keeping the point (cx, cy) of the screen where it is (the middle for buttons).
  const setZoom = (next: number, cx = window.innerWidth / 2, cy = window.innerHeight / 2) => {
    const clamped = Math.min(10, Math.max(0.1, next));
    const f = clamped / zoom;
    const px = cx - window.innerWidth / 2;
    const py = cy - window.innerHeight / 2;
    x = px - (px - x) * f;
    y = py - (py - y) * f;
    zoom = clamped;
    apply();
  };
  // As big as the screen allows (also beyond the picture's own size), centred.
  const fit = () => {
    const turned = Math.abs(rotation / 90) % 2 === 1;
    const w = turned ? img.offsetHeight : img.offsetWidth;
    const h = turned ? img.offsetWidth : img.offsetHeight;
    if (!w || !h) return;
    zoom = Math.min((window.innerWidth * 0.98) / w, (window.innerHeight * 0.94) / h);
    x = 0;
    y = 0;
    apply();
  };

  const close = () => {
    root.remove();
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener(PINCH_EVENT, onPinch);
  };
  // Touchpad pinch (desktop): the app sends it as a cancelable window event; while the viewer
  // is open it zooms the picture around the pointer instead of the note behind it.
  let pinchBase = 1;
  let pointer = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  root.addEventListener('mousemove', (e) => { pointer = { x: e.clientX, y: e.clientY }; });
  const onPinch = (e: Event) => {
    const { phase, scale } = (e as CustomEvent<{ phase: string; scale: number }>).detail ?? {};
    e.preventDefault();
    if (phase === 'begin') pinchBase = zoom;
    else if (phase === 'change' && typeof scale === 'number') setZoom(pinchBase * scale, pointer.x, pointer.y);
  };
  window.addEventListener(PINCH_EVENT, onPinch);
  const button = (path: string, title: string, run: () => void) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.title = title;
    b.setAttribute('aria-label', title);
    b.innerHTML = icon(path);
    b.addEventListener('click', (e) => { e.stopPropagation(); run(); });
    bar.append(b);
  };
  button(mdiRotateLeft, 'Rotate left', () => animated(() => { rotation -= 90; apply(); }));
  button(mdiRotateRight, 'Rotate right', () => animated(() => { rotation += 90; apply(); }));
  button(mdiMagnifyMinusOutline, 'Zoom out', () => animated(() => setZoom(zoom / 1.25)));
  button(mdiMagnifyPlusOutline, 'Zoom in', () => animated(() => setZoom(zoom * 1.25)));
  button(mdiFitToScreenOutline, 'Fit to the screen', () => animated(fit));
  if (options.onDownload) button(mdiDownload, 'Download', options.onDownload);
  button(mdiClose, 'Close', close);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === '+' || e.key === '=') animated(() => setZoom(zoom * 1.25));
    else if (e.key === '-') animated(() => setZoom(zoom / 1.25));
  };
  document.addEventListener('keydown', onKey, true);
  root.addEventListener('wheel', (e) => { e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12), e.clientX, e.clientY); }, { passive: false });
  img.addEventListener('dblclick', (e) => animated(() => (zoom > 1.01 ? (() => { zoom = 1; x = 0; y = 0; apply(); })() : setZoom(2, e.clientX, e.clientY))));

  // One pointer moves the picture, two pinch-zoom it. A click beside the picture closes.
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch: { distance: number; zoom: number; cx: number; cy: number } | null = null;
  let moved = false;
  const distance = () => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  root.addEventListener('pointerdown', (e) => {
    if ((e.target as Element).closest('.niv-bar')) return;
    root.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved = false;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { distance: distance(), zoom, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
    }
    root.classList.add('moving');
  });
  root.addEventListener('pointermove', (e) => {
    const last = pointers.get(e.pointerId);
    if (!last) return;
    const dx = e.clientX - last.x;
    const dy = e.clientY - last.y;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
    if (pinch && pointers.size === 2) {
      setZoom(pinch.zoom * (distance() / (pinch.distance || 1)), pinch.cx, pinch.cy);
    } else if (pointers.size === 1) {
      x += dx;
      y += dy;
      apply();
    }
  });
  const end = (e: PointerEvent) => {
    const wasClick = pointers.size === 1 && !moved;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) root.classList.remove('moving');
    if (wasClick && e.type === 'pointerup' && e.target === root) close();
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);

  apply();
  document.body.append(root);
  return close;
};
