import type { CSSProperties } from 'react';

// Material Design Icons (@mdi/js, Apache 2.0): pass an icon's path, e.g. mdiFormatBold.
export function Icon({ path, size = 18, style }: { path: string; size?: number; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ display: 'block', flex: '0 0 auto', ...style }}>
      <path d={path} fill="currentColor" />
    </svg>
  );
}
