import { useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { mdiEyeOutline, mdiEyeOffOutline } from '@mdi/js';
import { Icon } from './Icon';

// A password field with an eye button that shows what was typed.
export function PasswordInput({ value, onChange, placeholder, autoFocus, style, onBlur, onKeyDown }: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  style?: CSSProperties;
  onBlur?: () => void;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div style={{ position: 'relative', ...style, padding: 0, border: 'none', background: 'transparent' }}>
      <input
        type={visible ? 'text' : 'password'}
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={value}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        style={{ ...style, width: '100%', boxSizing: 'border-box', paddingRight: 38, margin: 0 }}
      />
      <button
        type="button"
        tabIndex={-1}
        title={visible ? 'Hide' : 'Show'}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setVisible((v) => !v)}
        style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', display: 'flex', padding: 4, border: 'none', borderRadius: 6, background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}
      >
        <Icon path={visible ? mdiEyeOffOutline : mdiEyeOutline} size={18} />
      </button>
    </div>
  );
}
