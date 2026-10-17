import { getStroke } from 'perfect-freehand';
import { decodePoints, DRAWING_WIDTH } from './drawing-codec';
import type { StrokePoint } from './drawing-codec';

// Shapes of drawing strokes: perfect-freehand turns the points (with pressure) into an outline
// that is filled. Pure, so the editor node view, Markdown export and tests share it.

export type DrawingTool = 'pen' | 'highlighter';

export interface DrawingStrokeData {
  points: string;
  // CSS colour: a palette variable reference, a hex colour, or null = the text colour.
  color: string | null;
  // Diameter in drawing units.
  size: number;
  tool: DrawingTool;
}

export const DEFAULT_DRAWING_HEIGHT = 300;
export const DEFAULT_PEN_SIZE = 5;

export const isDrawingTool = (value: unknown): value is DrawingTool => value === 'pen' || value === 'highlighter';

export const strokeData = (attrs: Record<string, unknown>): DrawingStrokeData => ({
  points: typeof attrs.points === 'string' ? attrs.points : '',
  color: typeof attrs.color === 'string' && attrs.color ? attrs.color : null,
  size: Number(attrs.size) > 0 ? Number(attrs.size) : DEFAULT_PEN_SIZE,
  tool: isDrawingTool(attrs.tool) ? attrs.tool : 'pen',
});

const round = (n: number) => Math.round(n * 10) / 10;

// Closed SVG path through the outline points (quadratic curves between midpoints).
const outlinePath = (outline: number[][]): string => {
  if (!outline.length) return '';
  if (outline.length < 3) {
    const [x, y] = outline[0];
    return `M${round(x)} ${round(y)}Z`;
  }
  let d = `M${round(outline[0][0])} ${round(outline[0][1])}Q`;
  for (let i = 0; i < outline.length; i++) {
    const [x0, y0] = outline[i];
    const [x1, y1] = outline[(i + 1) % outline.length];
    d += `${round(x0)} ${round(y0)} ${round((x0 + x1) / 2)} ${round((y0 + y1) / 2)} `;
  }
  return `${d.trimEnd()}Z`;
};

export const strokeOutline = (points: StrokePoint[], size: number, tool: DrawingTool, last = true): string => {
  if (!points.length) return '';
  const outline = getStroke(points.map((pt) => [pt.x, pt.y, pt.p]), {
    size,
    thinning: tool === 'highlighter' ? 0 : 0.6,
    smoothing: 0.5,
    streamline: 0.4,
    simulatePressure: false,
    start: { cap: true, taper: false },
    end: { cap: true, taper: false },
    last,
  });
  return outlinePath(outline);
};

export const strokePath = (stroke: DrawingStrokeData): string => strokeOutline(decodePoints(stroke.points), stroke.size, stroke.tool);

// Fill and opacity of a stroke, as an inline style (SVG attributes cannot hold var()).
export const strokeStyle = (stroke: Pick<DrawingStrokeData, 'color' | 'tool'>): string =>
  `fill:${stroke.color ?? 'currentColor'}${stroke.tool === 'highlighter' ? ';opacity:0.35' : ''}`;

// Right and bottom edges of the strokes (0 when empty).
export const drawingExtent = (strokes: DrawingStrokeData[]): { right: number; bottom: number } => {
  let right = 0;
  let bottom = 0;
  for (const stroke of strokes) {
    for (const pt of decodePoints(stroke.points)) {
      right = Math.max(right, pt.x + stroke.size / 2);
      bottom = Math.max(bottom, pt.y + stroke.size / 2);
    }
  }
  return { right, bottom };
};

export interface DrawingSize {
  width: number;
  height: number;
}

// Size of the drawing area: at least the note width (DRAWING_WIDTH) and the stored height,
// more when strokes reach further right or lower (a long formula scrolls sideways). `room`
// keeps space beyond the strokes (the editor adds some to write further).
export const drawingSize = (baseHeight: unknown, strokes: DrawingStrokeData[], room: { x: number; y: number } = { x: 20, y: 20 }): DrawingSize => {
  const base = Number(baseHeight) > 0 ? Number(baseHeight) : DEFAULT_DRAWING_HEIGHT;
  const { right, bottom } = drawingExtent(strokes);
  return {
    width: Math.ceil(Math.max(DRAWING_WIDTH, right > DRAWING_WIDTH - room.x ? right + room.x : 0)),
    height: Math.ceil(Math.max(base, bottom ? bottom + room.y : 0)),
  };
};

const escapeAttr = (text: string) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// The palette's values in content.css, for files read outside the app.
const PALETTE_HEX: Record<string, string> = {
  red: '#ff8a80', orange: '#ffb26b', yellow: '#ffd666', green: '#7fd88a', teal: '#5fd4c4',
  blue: '#7db7ff', purple: '#c4a1ff', pink: '#ff9ecb', gray: '#9aa0a6',
};

export const exportColor = (color: string | null): string => {
  if (!color) return '#000000';
  const name = /^var\(--c-([a-z]+)\)$/.exec(color)?.[1];
  if (name) return PALETTE_HEX[name] ?? '#000000';
  return /^#[0-9a-f]{3,8}$/i.test(color) ? color : '#000000';
};

// Standalone SVG of a drawing (Markdown export). Palette variables do not exist outside the
// app, so `resolveColor` maps them (default: exportColor, the text colour becomes black).
export const drawingSvg = (baseHeight: unknown, strokes: DrawingStrokeData[], resolveColor = exportColor): string => {
  const { width, height } = drawingSize(baseHeight, strokes);
  const paths = strokes
    .map((stroke) => {
      const d = strokePath(stroke);
      if (!d) return '';
      const opacity = stroke.tool === 'highlighter' ? ' fill-opacity="0.35"' : '';
      return `<path d="${d}" fill="${escapeAttr(resolveColor(stroke.color))}"${opacity}/>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${paths}</svg>`;
};
