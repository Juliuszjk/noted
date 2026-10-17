// Named colour palette. Documents store CSS variable references (never raw hex), so colours
// follow the active theme. The variables are defined in content.css.
export interface EditorColor {
  name: string;
  label: string;
  text: string;
  background: string;
}

const COLOR_NAMES: [string, string][] = [
  ['red', 'Red'],
  ['orange', 'Orange'],
  ['yellow', 'Yellow'],
  ['green', 'Green'],
  ['teal', 'Teal'],
  ['blue', 'Blue'],
  ['purple', 'Purple'],
  ['pink', 'Pink'],
  ['gray', 'Gray'],
];

export const EDITOR_COLORS: EditorColor[] = COLOR_NAMES.map(([name, label]) => ({
  name,
  label,
  text: `var(--c-${name})`,
  background: `var(--hl-${name})`,
}));

// Custom colours (stored as plain hex): conversions for the colour pickers.
export type Hsv = { h: number; s: number; v: number };

export const hsvToHex = ({ h, s, v }: Hsv): string => {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return `#${[f(5), f(3), f(1)].map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('')}`;
};

export const hexToHsv = (hex: string): Hsv | null => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max };
};
