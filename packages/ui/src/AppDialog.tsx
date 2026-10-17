import { useEffect, useRef, useState } from 'react';
import { mdiAlertCircleOutline, mdiDeleteOutline, mdiInformationOutline } from '@mdi/js';
import { Icon } from './Icon';

// The app's own confirm / message dialogs in the theme's colours (the native GTK ones were
// grey boxes). `showDialog` can be called from anywhere; `<DialogHost />` (mounted once by
// the app) draws the open dialogs, the newest on top.

export type DialogKind = 'info' | 'warning' | 'error' | 'danger';

export interface DialogButton {
  label: string;
  // Returned by the dialog's promise.
  value: string;
  style?: 'default' | 'primary' | 'danger';
}

export interface DialogOptions {
  title: string;
  message?: string;
  kind?: DialogKind;
  // Left to right; the last one is the main button (Enter). Default: one "OK".
  buttons?: DialogButton[];
}

interface OpenDialog extends DialogOptions {
  id: number;
  // null = dismissed (Esc, click outside).
  resolve: (value: string | null) => void;
}

let dialogs: OpenDialog[] = [];
let nextId = 1;
const listeners = new Set<(list: OpenDialog[]) => void>();
const publish = () => listeners.forEach((l) => l(dialogs));

export const showDialog = (options: DialogOptions): Promise<string | null> =>
  new Promise((resolve) => {
    const id = nextId++;
    dialogs = [...dialogs, { ...options, id, resolve: (value) => { dialogs = dialogs.filter((d) => d.id !== id); publish(); resolve(value); } }];
    publish();
  });

// Yes / no question; true only when the main button was pressed.
export const confirmDialog = async (options: { title: string; message?: string; confirm?: string; cancel?: string; danger?: boolean }): Promise<boolean> =>
  (await showDialog({
    title: options.title,
    message: options.message,
    kind: options.danger ? 'danger' : 'info',
    buttons: [
      { label: options.cancel ?? 'Cancel', value: 'cancel' },
      { label: options.confirm ?? 'OK', value: 'ok', style: options.danger ? 'danger' : 'primary' },
    ],
  })) === 'ok';

export const messageDialog = async (title: string, message?: string, kind: DialogKind = 'info'): Promise<void> => {
  await showDialog({ title, message, kind });
};

const KIND_ICON: Record<DialogKind, { path: string; color: string }> = {
  info: { path: mdiInformationOutline, color: 'var(--primary)' },
  warning: { path: mdiAlertCircleOutline, color: 'var(--primary)' },
  error: { path: mdiAlertCircleOutline, color: 'var(--error)' },
  danger: { path: mdiDeleteOutline, color: 'var(--error)' },
};

const buttonStyle = (style: DialogButton['style']) => ({
  minWidth: 88,
  padding: '8px 16px',
  borderRadius: 999,
  border: style === 'default' || !style ? '1px solid var(--border)' : '1px solid transparent',
  backgroundColor: style === 'danger' ? 'var(--error)' : style === 'primary' ? 'var(--primary)' : 'transparent',
  color: style === 'danger' ? 'var(--bg-base)' : style === 'primary' ? 'var(--primary-fg)' : 'var(--text-main)',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
});

function DialogBox({ dialog, top }: { dialog: OpenDialog; top: boolean }) {
  const buttons = dialog.buttons?.length ? dialog.buttons : [{ label: 'OK', value: 'ok', style: 'primary' as const }];
  const main = useRef<HTMLButtonElement>(null);
  const icon = KIND_ICON[dialog.kind ?? 'info'];
  useEffect(() => { main.current?.focus(); }, []);
  useEffect(() => {
    if (!top) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); dialog.resolve(null); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [top, dialog]);
  return (
    <div
      onMouseDown={() => dialog.resolve(null)}
      style={{ position: 'fixed', inset: 0, zIndex: 40000, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)' }}
    >
      <div
        role="alertdialog"
        aria-label={dialog.title}
        onMouseDown={(e) => e.stopPropagation()}
        style={{ width: 400, maxWidth: 'calc(100vw - 32px)', padding: '22px 22px 18px', borderRadius: 18, backgroundColor: 'var(--bg-surface-high)', border: '1px solid var(--border)', color: 'var(--text-main)', boxShadow: '0 12px 40px rgba(0,0,0,0.35)' }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
          <span style={{ display: 'flex', flexShrink: 0, padding: 8, borderRadius: 999, backgroundColor: 'var(--bg-surface-highest)', color: icon.color }}>
            <Icon path={icon.path} size={22} />
          </span>
          <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
            <div style={{ fontSize: 17, fontWeight: 700, overflowWrap: 'anywhere' }}>{dialog.title}</div>
            {dialog.message && <div style={{ marginTop: 6, fontSize: 14, lineHeight: 1.45, color: 'var(--text-muted)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{dialog.message}</div>}
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          {buttons.map((b, i) => (
            <button
              key={b.value}
              ref={i === buttons.length - 1 ? main : undefined}
              type="button"
              onClick={() => dialog.resolve(b.value)}
              style={buttonStyle(b.style)}
              onMouseEnter={(e) => { e.currentTarget.style.filter = 'brightness(1.12)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.filter = ''; }}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function DialogHost() {
  const [list, setList] = useState<OpenDialog[]>(dialogs);
  useEffect(() => {
    listeners.add(setList);
    setList(dialogs);
    return () => { listeners.delete(setList); };
  }, []);
  return <>{list.map((d, i) => <DialogBox key={d.id} dialog={d} top={i === list.length - 1} />)}</>;
}
