// Compact text form of a stroke's points, stored in the `points` attribute of a drawingStroke
// node. Points are in drawing units: x 0..DRAWING_WIDTH, y from the top (unbounded), pressure
// 0..1. Encoded as "1:" + base64 of zigzag varints of the deltas of x*10, y*10 and pressure*100,
// about 3-5 bytes per point instead of ~15 as JSON. Pure (no DOM, no atob), so React Native
// export can decode it too.

export const DRAWING_WIDTH = 1000;

export interface StrokePoint {
  x: number;
  y: number;
  p: number;
}

const PREFIX = '1:';
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INDEX = new Map([...B64].map((c, i) => [c, i]));

const toBase64 = (bytes: number[]): string => {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? B64[n & 63] : '=';
  }
  return out;
};

const fromBase64 = (text: string): number[] | null => {
  const clean = text.replace(/=+$/, '');
  const bytes: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const c of clean) {
    const v = B64_INDEX.get(c);
    if (v === undefined) return null;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((acc >> bits) & 255);
    }
  }
  return bytes;
};

const zigzag = (n: number) => (n >= 0 ? n * 2 : -n * 2 - 1);
const unzigzag = (n: number) => (n % 2 === 0 ? n / 2 : -(n + 1) / 2);

const pushVarint = (out: number[], value: number) => {
  let v = value;
  while (v >= 128) {
    out.push((v % 128) | 128);
    v = Math.floor(v / 128);
  }
  out.push(v);
};

export const encodePoints = (points: StrokePoint[]): string => {
  const bytes: number[] = [];
  let px = 0;
  let py = 0;
  let pp = 0;
  for (const point of points) {
    const x = Math.round(point.x * 10);
    const y = Math.round(point.y * 10);
    const p = Math.round(Math.min(1, Math.max(0, point.p)) * 100);
    pushVarint(bytes, zigzag(x - px));
    pushVarint(bytes, zigzag(y - py));
    pushVarint(bytes, zigzag(p - pp));
    px = x;
    py = y;
    pp = p;
  }
  return PREFIX + toBase64(bytes);
};

// Points of an encoded stroke; [] for anything unreadable (a damaged stroke is skipped, never thrown).
export const decodePoints = (text: unknown): StrokePoint[] => {
  if (typeof text !== 'string' || !text.startsWith(PREFIX)) return [];
  const bytes = fromBase64(text.slice(PREFIX.length));
  if (!bytes) return [];
  const values: number[] = [];
  let value = 0;
  let scale = 1;
  for (const b of bytes) {
    value += (b & 127) * scale;
    if (b & 128) {
      scale *= 128;
      continue;
    }
    values.push(unzigzag(value));
    value = 0;
    scale = 1;
  }
  const points: StrokePoint[] = [];
  let x = 0;
  let y = 0;
  let p = 0;
  for (let i = 0; i + 2 < values.length; i += 3) {
    x += values[i];
    y += values[i + 1];
    p += values[i + 2];
    points.push({ x: x / 10, y: y / 10, p: p / 100 });
  }
  return points;
};
