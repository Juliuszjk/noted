import { useEffect, useState } from 'react';
import { mdiChevronDown } from '@mdi/js';
import { Icon } from './Icon';

// A dropdown drawn by us (WebKitGTK paints native <select> white, ignoring the theme).
export function Select<T extends string>({ value, options, onChange, width = 200, compact = false }: { value: T; options: [T, string][]; onChange: (v: T) => void; width?: number; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div style={{ position: 'relative', width }} onMouseDown={(e) => e.stopPropagation()}>
      <button type="button" onClick={() => setOpen((o) => !o)} style={{
        display: 'flex', alignItems: 'center', width: '100%', padding: compact ? '3px 6px' : '7px 10px', borderRadius: compact ? 6 : 8, cursor: 'pointer', fontSize: compact ? 13 : 14,
        border: `1px solid ${open ? 'var(--border-focus)' : 'var(--border)'}`, backgroundColor: 'var(--bg-surface)', color: 'var(--text-main)',
      }}>
        <span style={{ flex: 1, textAlign: 'left' }}>{options.find(([v]) => v === value)?.[1]}</span>
        <Icon path={mdiChevronDown} size={18} style={{ transform: open ? 'rotate(180deg)' : undefined }} />
      </button>
      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 40000, padding: 4, borderRadius: 8, border: '1px solid var(--border)', backgroundColor: 'var(--bg-surface-high)', boxShadow: '0 8px 24px rgba(0,0,0,0.35)' }}>
          {options.map(([v, label]) => (
            <button key={v} type="button" onClick={() => { onChange(v); setOpen(false); }} style={{
              display: 'block', width: '100%', textAlign: 'left', padding: '7px 10px', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 14,
              backgroundColor: v === value ? 'var(--secondary-container)' : 'transparent', color: v === value ? 'var(--on-secondary-container)' : 'var(--text-main)',
            }}>{label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

