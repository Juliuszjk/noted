import { useEffect, useRef } from 'react';
import { Btn, popoverStyle } from './menu-parts';

export interface LinkContextMenuState {
  x: number;
  y: number;
  href: string;
  // Document position inside the link, used to select its whole range.
  pos: number;
}

const itemStyle = { display: 'block', width: '100%', textAlign: 'left', height: 'auto', padding: '6px 10px' } as const;

// Right-click menu on a link. The webview's own menu offers "Open link" items that do nothing
// inside the app, so links get this one instead.
export function LinkContextMenu({ state, onOpen, onEdit, onCopy, onRemove, onClose }: {
  state: LinkContextMenuState;
  onOpen?: () => void;
  onEdit: () => void;
  onCopy: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);
    window.addEventListener('blur', onClose);
    return () => {
      document.removeEventListener('mousedown', onMouseDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  const pick = (action: () => void) => () => {
    action();
    onClose();
  };

  const width = 200;
  const left = Math.min(state.x, window.innerWidth - width - 8);
  const top = Math.min(state.y, window.innerHeight - 150);

  return (
    <div
      ref={ref}
      onContextMenu={(e) => e.preventDefault()}
      style={{ ...popoverStyle, position: 'fixed', top, left, width, zIndex: 10000 }}
    >
      <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '2px 10px 6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {state.href}
      </div>
      {onOpen && <Btn title="Open link (Ctrl+click)" onClick={pick(onOpen)} style={itemStyle}>Open link</Btn>}
      <Btn title="Edit link (Ctrl+K)" onClick={pick(onEdit)} style={itemStyle}>Edit link</Btn>
      <Btn title="Copy link" onClick={pick(onCopy)} style={itemStyle}>Copy link</Btn>
      <Btn title="Remove link" danger onClick={pick(onRemove)} style={itemStyle}>Remove link</Btn>
    </div>
  );
}
