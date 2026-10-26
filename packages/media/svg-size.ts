// The size an SVG asks for, in CSS px: width / height on the root, else its viewBox, else the
// browsers' default for an image without a size (300 x 150). `boxed` says whether the root has
// a viewBox (without one the drawing does not scale with the root).
export interface SvgSize {
  width: number;
  height: number;
  boxed: boolean;
}

// A plain length in px ("24", "24px"); percentages and other units say nothing about the size.
const svgLength = (value: string | null): number => {
  const match = /^\s*([\d.]+)\s*(px)?\s*$/.exec(value ?? '');
  const n = match ? parseFloat(match[1]) : NaN;
  return n > 0 ? n : 0;
};

export const svgSize = (svg: Element): SvgSize => {
  const box = (svg.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
  const boxed = box.length === 4 && box[2] > 0 && box[3] > 0;
  const width = svgLength(svg.getAttribute('width'));
  const height = svgLength(svg.getAttribute('height'));
  if (width && height) return { width, height, boxed };
  // One side given: the other follows the viewBox's proportions.
  if (boxed && width) return { width, height: (width * box[3]) / box[2], boxed };
  if (boxed && height) return { width: (height * box[2]) / box[3], height, boxed };
  return boxed ? { width: box[2], height: box[3], boxed } : { width: 300, height: 150, boxed };
};

export const isSvgFile = (file: File): boolean => file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);

// The root <svg> of an SVG file's text, or null when it is not one.
export const parseSvg = (text: string): Element | null => {
  const root = new DOMParser().parseFromString(text, 'image/svg+xml').documentElement;
  return root.nodeName === 'svg' ? root : null;
};
