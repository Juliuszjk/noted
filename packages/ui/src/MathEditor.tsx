import { useEffect, useMemo, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import katex from 'katex';
import { commitMathEdit } from '@noted/editor';
import type { MathEditRequest } from '@noted/editor';
import { Btn, popoverStyle } from './menu-parts';

const WIDTH = 420;
// Typing within this many ms of the previous change is undone in one step.
const UNDO_GROUP_MS = 500;

// Renders the preview. KaTeX output is plain markup (no scripts, \href etc. need `trust`).
const renderPreview = (latex: string, displayMode: boolean): { html: string } | { error: string } => {
  try {
    return { html: katex.renderToString(latex, { displayMode, throwOnError: true }) };
  } catch (error) {
    return { error: error instanceof Error ? error.message.replace(/^KaTeX parse error: /, '') : String(error) };
  }
};

// LaTeX input with a live preview, shown below the formula being edited (or the cursor for a
// new one). Enter saves, Shift+Enter adds a line, Escape cancels, empty LaTeX deletes.
export function MathEditor({ editor, request, onClose }: { editor: Editor; request: MathEditRequest; onClose: () => void }) {
  const [latex, setLatex] = useState(request.mode === 'edit' ? request.latex : '');
  // Own undo history: the native one of a React-controlled textarea is unreliable in WebKitGTK.
  const history = useRef({ past: [] as string[], future: [] as string[], lastChange: 0 });
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const displayMode = request.kind === 'block';
  const preview = useMemo(() => (latex.trim() ? renderPreview(latex, displayMode) : null), [latex, displayMode]);

  const change = (value: string) => {
    const h = history.current;
    const now = Date.now();
    if (now - h.lastChange > UNDO_GROUP_MS) h.past.push(latex);
    h.lastChange = now;
    h.future = [];
    setLatex(value);
  };
  const undo = () => {
    const h = history.current;
    const previous = h.past.pop();
    if (previous === undefined) return;
    h.future.push(latex);
    h.lastChange = 0;
    setLatex(previous);
  };
  const redo = () => {
    const h = history.current;
    const next = h.future.pop();
    if (next === undefined) return;
    h.past.push(latex);
    h.lastChange = 0;
    setLatex(next);
  };

  const save = () => {
    commitMathEdit(editor, request, latex);
    onClose();
  };
  const cancel = () => {
    editor.commands.focus();
    onClose();
  };

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    const onMouseDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onMouseDown, true);
    return () => document.removeEventListener('mousedown', onMouseDown, true);
  }, [onClose]);

  // Position below the formula, or below the cursor for a new one; flip up near the bottom.
  const anchor = (() => {
    const dom = request.mode === 'edit' ? (editor.view.nodeDOM(request.pos) as HTMLElement | null) : null;
    if (dom?.getBoundingClientRect) return dom.getBoundingClientRect();
    const coords = editor.view.coordsAtPos(Math.min(request.pos, editor.state.doc.content.size));
    return { top: coords.top, bottom: coords.bottom, left: coords.left };
  })();
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - WIDTH - 8));
  // Below the formula when it fits, otherwise above it, otherwise pinned inside the window
  // (popoverStyle's own `top` must be overridden either way).
  const HEIGHT = 250;
  const below = anchor.bottom + 8;
  const vertical: { top: number | 'auto'; bottom?: number } =
    below + HEIGHT <= window.innerHeight ? { top: below }
    : anchor.top - 8 - HEIGHT >= 8 ? { top: 'auto', bottom: window.innerHeight - anchor.top + 8 }
    : { top: Math.max(8, window.innerHeight - HEIGHT - 8) };

  return (
    <div ref={ref} style={{ ...popoverStyle, position: 'fixed', ...vertical, left, width: WIDTH, zIndex: 10000, padding: 8 }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 2px 6px' }}>
        {request.kind === 'inline' ? 'Inline math' : 'Math block'} (LaTeX)
      </div>
      <textarea
        ref={inputRef}
        value={latex}
        rows={request.kind === 'block' ? 4 : 2}
        placeholder={request.kind === 'inline' ? 'e.g. E = mc^2' : 'e.g. \\sum_{i=1}^{n} x_i'}
        spellCheck={false}
        onChange={(e) => change(e.target.value)}
        onKeyDown={(e) => {
          const mod = e.ctrlKey || e.metaKey;
          const key = e.key.toLowerCase();
          if (mod && key === 'z' && !e.shiftKey) {
            e.preventDefault();
            undo();
          } else if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) {
            e.preventDefault();
            redo();
          } else if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            save();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            cancel();
          }
        }}
        style={{
          width: '100%', boxSizing: 'border-box', resize: 'vertical', padding: '6px 8px', fontSize: 13,
          fontFamily: 'monospace', color: 'var(--text-main)', backgroundColor: 'var(--bg-surface)',
          border: `1px solid ${preview && 'error' in preview ? '#ff8a80' : 'var(--border)'}`, borderRadius: 6, outline: 'none',
        }}
      />
      <div style={{ minHeight: 32, maxHeight: 160, overflow: 'auto', margin: '6px 2px', color: 'var(--text-main)' }}>
        {!preview && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Preview</span>}
        {preview && 'html' in preview && <div dangerouslySetInnerHTML={{ __html: preview.html }} />}
        {preview && 'error' in preview && <span style={{ fontSize: 12, color: '#ff8a80' }}>{preview.error}</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ flex: 1, fontSize: 11, color: 'var(--text-muted)' }}>Enter to save · Shift+Enter new line · Esc to cancel</span>
        {request.mode === 'edit' && (
          <Btn title="Delete formula" danger onClick={() => { commitMathEdit(editor, request, ''); onClose(); }}>Delete</Btn>
        )}
        <Btn title="Save (Enter)" onClick={save}>Save</Btn>
      </div>
    </div>
  );
}
