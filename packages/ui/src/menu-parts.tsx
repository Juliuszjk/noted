import type { CSSProperties, ReactNode } from 'react';

// Shared pieces of the floating editor menus.

export const toolbarStyle: CSSProperties = {
  position: 'fixed',
  zIndex: 9998,
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  padding: 4,
  backgroundColor: 'var(--bg-surface-high)',
  border: '1px solid var(--border-focus)',
  borderRadius: 8,
  boxShadow: '0 8px 16px rgba(0,0,0,0.4)',
};

export const TOOLBAR_HEIGHT = 38;

// Top of a toolbar attached to a block (table, callout): above the block when there is room,
// otherwise below it, so it never covers the block's first line. Kept inside the window.
export const blockToolbarTop = (rect: DOMRect): number => {
  const above = rect.top - TOOLBAR_HEIGHT - 4;
  if (above >= 8) return above;
  return Math.min(rect.bottom + 4, window.innerHeight - TOOLBAR_HEIGHT - 8);
};

export const popoverStyle: CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 6px)',
  left: 0,
  minWidth: 180,
  padding: 6,
  backgroundColor: 'var(--bg-surface-high)',
  border: '1px solid var(--border-focus)',
  borderRadius: 8,
  boxShadow: '0 8px 16px rgba(0,0,0,0.4)',
};

// mousedown (not click) with preventDefault keeps the text selection and editor focus.
export function Btn({
  title, onClick, active, danger, style, children,
}: {
  title: string;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
      style={{
        minWidth: 28, height: 28, padding: '0 7px', border: 'none', borderRadius: 6, cursor: 'pointer',
        fontSize: 13, whiteSpace: 'nowrap', boxShadow: 'none',
        color: danger ? '#ff8a80' : 'var(--text-main)',
        backgroundColor: active ? 'var(--border)' : 'transparent',
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export const Sep = () => (
  <span style={{ width: 1, height: 18, backgroundColor: 'var(--border)', margin: '0 4px', alignSelf: 'center' }} />
);

// Square icon button for the toolbars and bars. Like Btn, it acts on mousedown so the editor
// keeps its selection and focus.
export function IconBtn({
  icon, title, onClick, active, disabled, size = 18, label, style,
}: {
  // MDI path; omit for a text-only button (label).
  icon?: string;
  title: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  size?: number;
  // Optional text after the icon (e.g. a chevron menu's current value).
  label?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onMouseDown={(e) => {
        e.preventDefault();
        if (!disabled) onClick();
      }}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, minWidth: 30, height: 30,
        padding: label ? '0 8px' : 0, border: 'none', borderRadius: 6, cursor: disabled ? 'default' : 'pointer',
        fontSize: 13, whiteSpace: 'nowrap', boxShadow: 'none', opacity: disabled ? 0.4 : 1,
        color: active ? 'var(--primary)' : 'var(--text-main)',
        backgroundColor: active ? 'var(--secondary-container)' : 'transparent',
        ...style,
      }}
      // Buttons with their own background (e.g. the white "+") keep it on hover.
      onMouseEnter={(e) => { if (!active && !disabled && !style?.backgroundColor) e.currentTarget.style.backgroundColor = 'var(--bg-surface-high)'; }}
      onMouseLeave={(e) => { if (!active && !style?.backgroundColor) e.currentTarget.style.backgroundColor = 'transparent'; }}
    >
      {icon && (
        <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ display: 'block', flex: '0 0 auto' }}>
          <path d={icon} fill="currentColor" />
        </svg>
      )}
      {label}
    </button>
  );
}
