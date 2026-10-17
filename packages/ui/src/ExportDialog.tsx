import { useEffect } from 'react';
import type { Editor } from '@tiptap/core';
import { mdiLanguageMarkdownOutline, mdiTextBoxOutline, mdiFilePdfBox, mdiClose } from '@mdi/js';
import { Icon } from './Icon';
import { popoverStyle } from './menu-parts';

export type ExportFormat = 'markdown' | 'text' | 'pdf';

const OPTIONS: { format: ExportFormat; icon: string; label: string; detail: string }[] = [
  { format: 'markdown', icon: mdiLanguageMarkdownOutline, label: 'Markdown', detail: '.md file; with images or files a .zip with an attachments folder' },
  { format: 'text', icon: mdiTextBoxOutline, label: 'Plain text', detail: '.txt file, text only' },
  { format: 'pdf', icon: mdiFilePdfBox, label: 'PDF', detail: 'Print dialog: choose “Print to File” (PDF)' },
];

// "Export note" (the note properties panel, or "/export"): pick the format.
export function ExportDialog({ onPick, onClose }: { onPick: (format: ExportFormat) => void; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div onMouseDown={onClose} style={{ position: 'fixed', inset: 0, zIndex: 30000, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)' }}>
      <div onMouseDown={(e) => e.stopPropagation()} style={{ ...popoverStyle, position: 'relative', top: 'auto', left: 'auto', width: 380, padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ flex: 1, fontSize: 17, fontWeight: 700 }}>Export note</span>
          <button type="button" title="Close" onClick={onClose} style={{ display: 'flex', border: 'none', background: 'transparent', color: 'var(--text-main)', cursor: 'pointer' }}>
            <Icon path={mdiClose} size={18} />
          </button>
        </div>
        {OPTIONS.map((o) => (
          <button
            key={o.format}
            type="button"
            onClick={() => onPick(o.format)}
            style={{ display: 'flex', alignItems: 'center', gap: 14, width: '100%', padding: '10px 12px', marginBottom: 6, border: '1px solid var(--border)', borderRadius: 10, background: 'transparent', color: 'var(--text-main)', cursor: 'pointer', textAlign: 'left' }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-surface-high)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
          >
            <Icon path={o.icon} size={26} style={{ color: 'var(--primary)' }} />
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{o.label}</span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{o.detail}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

// PDF: the note alone on light "paper", printed with the system dialog (Print to File = PDF).
// The page's own styles apply; everything else is hidden while printing.
export const printNote = (editor: Editor, title: string, noteFont: string | null) => {
  document.getElementById('noted-print')?.remove();
  document.getElementById('noted-print-style')?.remove();
  const holder = document.createElement('div');
  holder.id = 'noted-print';
  if (noteFont) holder.setAttribute('data-note-font', noteFont);
  const clone = editor.view.dom.cloneNode(true) as HTMLElement;
  clone.removeAttribute('contenteditable');
  clone.querySelectorAll('[contenteditable]').forEach((el) => el.removeAttribute('contenteditable'));
  // Pictures load lazily in the note; the printed copy needs all of them.
  clone.querySelectorAll('img').forEach((img) => { img.loading = 'eager'; });
  holder.innerHTML = `<div class="note-title" style="font-size:1.9em;font-weight:700;margin:0 0 16px">${escapeHtml(title || 'Untitled')}</div>`;
  holder.append(clone);
  const style = document.createElement('style');
  style.id = 'noted-print-style';
  style.textContent = `
    #noted-print { display: none; }
    @media print {
      @page { margin: 16mm; }
      html, body { background: #fff !important; height: auto !important; overflow: visible !important; }
      body > *:not(#noted-print) { display: none !important; }
      #noted-print { display: block; color: #1b1b1f; font-family: var(--font-sans);
        --text-main: #1b1b1f; --text-muted: #5f5f66; --bg-base: #fff; --bg-surface: #f3f3f5; --bg-surface-high: #ececef; --border: #cfcfd6; }
      #noted-print .ProseMirror { color: #1b1b1f; }
    }`;
  document.body.append(style, holder);
  // Removed after printing (or by the next export; hidden on screen anyway).
  window.addEventListener('afterprint', () => { holder.remove(); style.remove(); }, { once: true });
  setTimeout(() => window.print(), 50);
};
