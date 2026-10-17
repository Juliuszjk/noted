import React from 'react';
import Svg, { Rect, Line } from 'react-native-svg';
import { T } from './ui';

export type SplitSide = 'left' | 'right' | 'top' | 'bottom';

// Split view icon (same drawing as the editor page's): a square with a dashed middle line and
// the half where the note goes filled.
export function SplitIcon({ side, size = 24, color = T.on_surface }: { side: SplitSide; size?: number; color?: string }) {
  const half = {
    left: { x: 3, y: 3, width: 9, height: 18 },
    right: { x: 12, y: 3, width: 9, height: 18 },
    top: { x: 3, y: 3, width: 18, height: 9 },
    bottom: { x: 3, y: 12, width: 18, height: 9 },
  }[side];
  const vertical = side === 'left' || side === 'right';
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect {...half} fill={color} opacity={0.85} />
      <Line x1={vertical ? 12 : 3} y1={vertical ? 3 : 12} x2={vertical ? 12 : 21} y2={vertical ? 21 : 12} stroke={color} strokeWidth={1.6} strokeDasharray="2.2 1.8" />
      <Rect x={3} y={3} width={18} height={18} rx={2.5} fill="none" stroke={color} strokeWidth={2} />
    </Svg>
  );
}
