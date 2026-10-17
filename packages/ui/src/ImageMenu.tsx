import { useEffect, useReducer, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { mdiEyeOutline, mdiDownload, mdiFormatAlignLeft, mdiFormatAlignCenter, mdiFormatAlignRight, mdiViewColumnOutline, mdiArrowExpandVertical, mdiDotsVertical, mdiClose } from '@mdi/js';
import {
  selectedImage, imageElementAt, currentImageAlign, setImageAlign, currentImageSideBySide, setImageSideBySide, matchImageRowHeights, imageRowAt, imageSize, setImageWidth, downloadSelectedImage, openImageViewer,
} from '@noted/editor';
import { toolbarStyle, blockToolbarTop } from './menu-parts';
import { IconBtn } from './menu-parts';

// Toolbar above the selected image (like Notesnook's): full-screen preview, download,
// alignment, and "Image properties" with the exact width / height (the other follows the
// picture's proportions). The corner handle on the image resizes it by dragging.
export function ImageMenu({ editor }: { editor: Editor }) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [propsOpen, setPropsOpen] = useState(false);
  const [draft, setDraft] = useState<{ width: string; height: string } | null>(null);

  useEffect(() => {
    const update = () => rerender();
    editor.on('transaction', update);
    editor.on('focus', update);
    editor.on('blur', update);
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      editor.off('transaction', update);
      editor.off('focus', update);
      editor.off('blur', update);
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [editor]);

  const image = selectedImage(editor);
  // The size fields take the focus: the menu stays while they are open.
  const hidden = !image || (!editor.isFocused && !propsOpen);
  useEffect(() => {
    if (!image) { setPropsOpen(false); setDraft(null); }
  }, [image?.pos]);
  if (hidden || !image) return null;

  const img = imageElementAt(editor, image.pos);
  const dom = editor.view.nodeDOM(image.pos) as HTMLElement | null;
  if (!dom) return null;
  const rect = dom.getBoundingClientRect();
  const top = blockToolbarTop(rect);
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - 300));
  const align = currentImageAlign(editor);
  const sideBySide = currentImageSideBySide(editor);
  const inRow = sideBySide && imageRowAt(editor.state.doc, image.pos).length > 1;
  const size = imageSize(editor);
  const shown = draft ?? (size ? { width: String(size.width), height: String(size.height) } : { width: '', height: '' });

  const commit = (field: 'width' | 'height', value: string) => {
    const n = parseInt(value, 10);
    if (!size || !Number.isFinite(n) || n <= 0) return setDraft(null);
    setImageWidth(editor, field === 'width' ? n : n / (size.ratio || 1));
    setDraft(null);
  };
  const field = (name: 'width' | 'height') => (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, color: 'var(--text-muted)' }}>
      <input
        type="number"
        min={1}
        value={shown[name]}
        onChange={(e) => {
          const v = e.target.value;
          const n = parseInt(v, 10);
          const other = size && Number.isFinite(n) ? String(Math.round(name === 'width' ? n * size.ratio : n / (size.ratio || 1))) : '';
          setDraft(name === 'width' ? { width: v, height: other } : { width: other, height: v });
        }}
        onBlur={(e) => commit(name, e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(name, (e.target as HTMLInputElement).value); }}
        style={{ width: 70, border: 'none', background: 'transparent', color: 'var(--text-main)', fontSize: 14, outline: 'none' }}
      />
      {name}
    </label>
  );

  return (
    <div style={{ ...toolbarStyle, top, left, flexDirection: 'column', alignItems: 'stretch' }} onMouseDown={(e) => { if (!(e.target instanceof HTMLInputElement)) e.preventDefault(); }}>
      <div style={{ display: 'flex', gap: 2 }}>
        <IconBtn icon={mdiEyeOutline} title="Preview" onClick={() => {
          if (img?.src) openImageViewer(img.src, { alt: image.node.attrs.alt ?? '', onDownload: () => downloadSelectedImage(editor) });
        }} />
        <IconBtn icon={mdiDownload} title="Download" onClick={() => downloadSelectedImage(editor)} />
        <IconBtn icon={mdiFormatAlignLeft} title="Align left" active={align === 'left'} onClick={() => setImageAlign(editor, 'left')} />
        <IconBtn icon={mdiFormatAlignCenter} title="Align center" active={align === 'center'} onClick={() => setImageAlign(editor, 'center')} />
        <IconBtn icon={mdiFormatAlignRight} title="Align right" active={align === 'right'} onClick={() => setImageAlign(editor, 'right')} />
        <IconBtn icon={mdiViewColumnOutline} title="Side by side (with the next / previous image set so too)" active={sideBySide} onClick={() => setImageSideBySide(editor, !sideBySide)} />
        {inRow && <IconBtn icon={mdiArrowExpandVertical} title="Same height as this image for the whole row" onClick={() => matchImageRowHeights(editor)} />}
        <IconBtn icon={mdiDotsVertical} title="Image properties" active={propsOpen} onClick={() => setPropsOpen((o) => !o)} />
      </div>
      {propsOpen && (
        <div style={{ padding: '8px 6px 4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>Image properties</span>
            <IconBtn icon={mdiClose} title="Close" size={16} onClick={() => { setPropsOpen(false); editor.view.focus(); }} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>{field('width')}{field('height')}</div>
          <button
            type="button"
            onClick={() => { setImageWidth(editor, null); setDraft(null); }}
            style={{ marginTop: 8, padding: 0, border: 'none', background: 'transparent', color: 'var(--primary)', cursor: 'pointer', fontSize: 12 }}
          >
            Original size
          </button>
        </div>
      )}
    </div>
  );
}
