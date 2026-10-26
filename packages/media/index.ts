import imageCompression from 'browser-image-compression';

import { isSvgFile, parseSvg, svgSize } from './svg-size';

// Longer side an SVG is drawn at before compression (the same cap as photos).
const MAX_SIDE = 1920;

// An SVG as a PNG whose longer side is MAX_SIDE. Drawn at its own size, a small one (an icon
// with width="24", a diagram with width="300") ended up tiny or blurry in the note; the
// browser draws the vector sharply at any size given on the root element. The note shows it
// at its own size (insertFiles in blob-image.ts sets the image's width).
async function rasterizeSvg(file: File): Promise<File> {
  const svg = parseSvg(await file.text());
  if (!svg) throw new Error('Not an SVG image');
  const { width, height, boxed } = svgSize(svg);
  // Without a viewBox the drawing would keep its own size inside the bigger root.
  if (!boxed) svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const scale = MAX_SIDE / Math.max(width, height);
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  svg.setAttribute('width', String(w));
  svg.setAttribute('height', String(h));
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!png) throw new Error('Could not draw the SVG image');
    return new File([png], file.name.replace(/\.svg$/i, '') + '.png', { type: 'image/png' });
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Compressed image bytes (WebP, max 1920 px, about 1 MB) for an encrypted blob. GIFs are kept
// as they are so animations survive; SVGs are drawn large first (rasterizeSvg). No web worker:
// the library's worker loads its own code from a CDN, and nothing in the app may be fetched
// from the network that way.
export async function compressImageBytes(file: File): Promise<{ bytes: Uint8Array; type: string }> {
  if (file.type === 'image/gif') return { bytes: new Uint8Array(await file.arrayBuffer()), type: file.type };
  // Should drawing fail, the library's own conversion (at the SVG's own size) still works.
  if (isSvgFile(file)) file = await rasterizeSvg(file).catch((e) => { console.warn('SVG drawing failed:', e); return file; });
  const compressed = await imageCompression(file, {
    maxSizeMB: 1,
    maxWidthOrHeight: MAX_SIDE,
    useWebWorker: false,
    fileType: 'image/webp',
    initialQuality: 0.8,
  });
  return { bytes: new Uint8Array(await compressed.arrayBuffer()), type: compressed.type || 'image/webp' };
}
