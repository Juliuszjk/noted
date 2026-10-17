import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import type { Editor } from '@tiptap/core';
import { mdiClose, mdiOpenInNew, mdiLinkVariantOff } from '@mdi/js';
import { normalizeLinkUrl } from '@noted/editor';
import { Icon } from './Icon';
import { popoverStyle } from './menu-parts';

const input = (invalid = false): CSSProperties => ({
  width: '100%', boxSizing: 'border-box', padding: '8px 10px', fontSize: 13, color: 'var(--text-main)',
  backgroundColor: 'var(--bg-surface)', border: `1px solid ${invalid ? 'var(--error)' : 'var(--border-focus)'}`, borderRadius: 8, outline: 'none',
});

// Writes a link: on the selection when its text is kept, otherwise as new text.
const applyLink = (editor: Editor, href: string, text: string) => {
  const { from, to, empty } = editor.state.selection;
  const selected = editor.state.doc.textBetween(from, to, ' ');
  const chain = editor.chain().focus();
  if (!empty && (!text || text === selected)) {
    chain.extendMarkRange('link').setLink({ href }).run();
  } else {
    chain.insertContent({ type: 'text', text: text || href, marks: [{ type: 'link', attrs: { href } }] }).run();
  }
};

// "Insert link" from the toolbar: link text (the selection, if any) and the address. The
// caller selects the whole link first when the cursor is inside one.
// `embedded`: inside a dropdown that already draws the box.
export function InsertLinkDialog({ editor, onClose, embedded = false }: { editor: Editor; onClose: () => void; embedded?: boolean }) {
  const [text, setText] = useState(() => editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, ' '));
  const [url, setUrl] = useState((editor.getAttributes('link').href as string | undefined) ?? '');
  const [invalid, setInvalid] = useState(false);

  const insert = () => {
    const href = normalizeLinkUrl(url);
    if (!href) return setInvalid(true);
    applyLink(editor, href, text.trim());
    onClose();
  };
  const keys = (e: KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); insert(); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); editor.commands.focus(); }
  };

  return (
    <div style={embedded ? { padding: 6 } : { ...popoverStyle, top: 'calc(100% + 4px)', left: 'auto', right: -120, width: 300, padding: 14, zIndex: 60 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ flex: 1, fontSize: 16, fontWeight: 700 }}>Insert link</span>
        <button type="button" title="Close" onClick={onClose} style={{ display: 'flex', border: 'none', background: 'transparent', color: 'var(--text-main)', cursor: 'pointer' }}>
          <Icon path={mdiClose} size={18} />
        </button>
      </div>
      <div style={{ fontSize: 12, margin: '0 0 4px 2px' }}>Link text</div>
      <input value={text} placeholder="Link text" onChange={(e) => setText(e.target.value)} onKeyDown={keys} style={input()} />
      <div style={{ fontSize: 12, margin: '10px 0 4px 2px' }}>URL</div>
      <input autoFocus value={url} placeholder="https://example.com/" onChange={(e) => { setUrl(e.target.value); setInvalid(false); }} onKeyDown={keys} style={input(invalid)} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
        {editor.isActive('link') && (
          <button type="button" onClick={() => { editor.chain().focus().extendMarkRange('link').unsetLink().run(); onClose(); }} style={{ border: 'none', background: 'transparent', color: 'var(--error)', cursor: 'pointer', fontSize: 13 }}>
            Remove
          </button>
        )}
        <button type="button" onClick={insert} style={{ border: 'none', background: 'transparent', color: 'var(--primary)', cursor: 'pointer', fontSize: 14, fontWeight: 700 }}>
          Insert
        </button>
      </div>
    </div>
  );
}

// Ctrl+K: a small address field right above the selected word, with Open and Remove for an
// existing link.
export function LinkBubble({ editor, onClose, onOpenLink }: { editor: Editor; onClose: () => void; onOpenLink?: (href: string) => void }) {
  const [url, setUrl] = useState((editor.getAttributes('link').href as string | undefined) ?? '');
  const [invalid, setInvalid] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onMouseDown, true);
    return () => document.removeEventListener('mousedown', onMouseDown, true);
  }, [onClose]);

  const { from, to } = editor.state.selection;
  const start = editor.view.coordsAtPos(from);
  const end = editor.view.coordsAtPos(to);
  const existing = editor.getAttributes('link').href as string | undefined;
  const width = existing ? 480 : 360;
  const left = Math.max(8, Math.min((start.left + end.right) / 2 - width / 2, window.innerWidth - width - 8));
  const top = start.top - 52 < 8 ? end.bottom + 8 : start.top - 52;

  const apply = () => {
    if (!url.trim()) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return onClose();
    }
    const href = normalizeLinkUrl(url);
    if (!href) return setInvalid(true);
    applyLink(editor, href, '');
    onClose();
  };

  return (
    <div ref={ref} style={{ ...popoverStyle, position: 'fixed', top, left, width, display: 'flex', gap: 6, alignItems: 'center', zIndex: 9999 }}>
      <input
        autoFocus
        value={url}
        placeholder="Paste or type a link"
        onChange={(e) => { setUrl(e.target.value); setInvalid(false); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); apply(); }
          else if (e.key === 'Escape') { e.preventDefault(); onClose(); editor.commands.focus(); }
        }}
        style={{ ...input(invalid), flex: 1 }}
      />
      <BubbleButton primary title="Apply (Enter)" onClick={apply}>Apply</BubbleButton>
      {existing && onOpenLink && (
        <BubbleButton icon={mdiOpenInNew} title="Open in the browser" onClick={() => { onOpenLink(existing); onClose(); }}>Open</BubbleButton>
      )}
      {existing && (
        <BubbleButton icon={mdiLinkVariantOff} title="Remove the link" danger onClick={() => { editor.chain().focus().extendMarkRange('link').unsetLink().run(); onClose(); }}>
          Remove
        </BubbleButton>
      )}
    </div>
  );
}

// Buttons of the link bubble: filled for the main action, others light up under the mouse.
function BubbleButton({ children, onClick, title, icon, primary, danger }: {
  children: ReactNode; onClick: () => void; title: string; icon?: string; primary?: boolean; danger?: boolean;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 14, cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap',
        border: primary ? 'none' : '1px solid var(--border)',
        backgroundColor: primary ? (hover ? 'var(--primary-container)' : 'var(--primary)') : hover ? 'var(--bg-surface-highest)' : 'transparent',
        color: primary ? (hover ? 'var(--on-primary-container)' : 'var(--primary-fg)') : danger ? 'var(--error)' : 'var(--text-main)',
        fontWeight: primary ? 700 : 500,
      }}
    >
      {icon && <Icon path={icon} size={15} />}
      {children}
    </button>
  );
}
