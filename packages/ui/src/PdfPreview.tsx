import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { mdiClose, mdiFilePdfBox } from '@mdi/js';
import { IconBtn } from './menu-parts';
import { buildSheets, printSheets, SHEET_HEIGHT, SHEET_WIDTH } from '@noted/editor/pdf-sheets';

// "/pdf": the open note as it will look on paper, on A4 sheets beside the note (desktop). Built
// again shortly after every change; "Save PDF" prints exactly these sheets (pdf-sheets.ts).

const REBUILD_MS = 500;
const GAP = 16;

export function PdfPreview({ editor, title, noteFont, width, onClose, onSave }: {
  editor: Editor | null,
  title: string,
  noteFont: string | null,
  width: number,
  onClose: () => void,
  // Saves the sheets as a PDF file (desktop: straight to a file); without it the print dialog.
  onSave?: (sheets: HTMLElement[]) => void,
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const sheetsRef = useRef<HTMLElement[]>([]);
  const [pages, setPages] = useState(0);
  const [busy, setBusy] = useState(false);
  const scale = Math.max(0.1, (width - 2 * GAP) / SHEET_WIDTH);
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  // Puts the sheets into the list, scaled to the pane (layout stays at full size: the slices
  // must wrap exactly like the measured copy).
  const show = () => {
    const list = listRef.current;
    if (!list) return;
    const s = scaleRef.current;
    list.replaceChildren(...sheetsRef.current.map((sheet) => {
      const frame = document.createElement('div');
      frame.style.cssText = `width:${SHEET_WIDTH * s}px;height:${SHEET_HEIGHT * s}px;margin:0 auto ${GAP}px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,0.35);border-radius:2px;background:#fff;`;
      sheet.style.transform = `scale(${s})`;
      sheet.style.transformOrigin = '0 0';
      frame.append(sheet);
      return frame;
    }));
  };

  useEffect(show, [scale]);

  useEffect(() => {
    if (!editor) return;
    let generation = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const build = async () => {
      const mine = ++generation;
      setBusy(true);
      try {
        const sheets = await buildSheets(editor, title, noteFont);
        if (mine !== generation) return;
        const scroller = listRef.current?.parentElement;
        const scrollTop = scroller?.scrollTop ?? 0;
        sheetsRef.current = sheets;
        setPages(sheets.length);
        show();
        if (scroller) scroller.scrollTop = scrollTop;
      } catch (err) {
        console.error('PDF preview failed:', err);
      } finally {
        if (mine === generation) setBusy(false);
      }
    };
    const later = () => {
      clearTimeout(timer);
      timer = setTimeout(build, REBUILD_MS);
    };
    build();
    editor.on('update', later);
    // Pictures decrypted after the note opened change the layout too.
    const dom = editor.view.dom;
    dom.addEventListener('load', later, true);
    return () => {
      generation++;
      clearTimeout(timer);
      editor.off('update', later);
      dom.removeEventListener('load', later, true);
    };
  }, [editor, title, noteFont]);

  return (
    <div style={{ width, flexShrink: 0, display: 'flex', flexDirection: 'column', minHeight: 0, backgroundColor: 'var(--bg-surface-low)', borderLeft: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          PDF preview{pages ? ` · ${pages} ${pages === 1 ? 'page' : 'pages'}` : ''}{busy ? ' · updating…' : ''}
        </div>
        <IconBtn icon={mdiFilePdfBox} label="Save PDF" title="Save as a PDF file" disabled={!pages} onClick={() => (onSave ? onSave(sheetsRef.current) : printSheets(sheetsRef.current))} />
        <IconBtn icon={mdiClose} title="Close the preview" onClick={onClose} />
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: `${GAP}px 0` }}>
        <div ref={listRef} />
      </div>
    </div>
  );
}
