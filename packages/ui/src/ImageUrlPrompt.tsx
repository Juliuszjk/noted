import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { insertImageFromUrl, normalizeLinkUrl } from '@noted/editor';
import { Btn, popoverStyle } from './menu-parts';

const WIDTH = 380;

// "Image from URL": asks for the address, then downloads the image into an encrypted blob.
// The image is fetched once by the app, never hotlinked from the note.
export function ImageUrlPrompt({ editor, pos, onClose }: { editor: Editor; pos: number; onClose: () => void }) {
  const [url, setUrl] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      if (!busy && !ref.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onMouseDown, true);
    return () => document.removeEventListener('mousedown', onMouseDown, true);
  }, [onClose, busy]);

  const submit = async () => {
    const href = normalizeLinkUrl(url);
    if (!href || !/^https?:/i.test(href)) {
      setInvalid(true);
      return;
    }
    setBusy(true);
    await insertImageFromUrl(editor, href, pos);
    onClose();
  };

  const coords = editor.view.coordsAtPos(Math.min(pos, editor.state.doc.content.size));
  const left = Math.max(8, Math.min(coords.left, window.innerWidth - WIDTH - 8));
  const vertical = coords.bottom + 90 > window.innerHeight
    ? { top: 'auto' as const, bottom: window.innerHeight - coords.top + 8 }
    : { top: coords.bottom + 8 };

  return (
    <div ref={ref} style={{ ...popoverStyle, position: 'fixed', ...vertical, left, width: WIDTH, zIndex: 10000, display: 'flex', gap: 6, alignItems: 'center' }}>
      <input
        autoFocus
        value={url}
        disabled={busy}
        placeholder="Paste an image address"
        onChange={(e) => { setUrl(e.target.value); setInvalid(false); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            editor.commands.focus();
            onClose();
          }
        }}
        style={{
          flex: 1, padding: '6px 8px', fontSize: 13, color: 'var(--text-main)', backgroundColor: 'var(--bg-surface)',
          border: `1px solid ${invalid ? '#ff8a80' : 'var(--border)'}`, borderRadius: 6, outline: 'none', boxShadow: 'none',
        }}
      />
      <Btn title="Download and insert" onClick={submit}>{busy ? 'Downloading…' : 'Insert'}</Btn>
    </div>
  );
}
