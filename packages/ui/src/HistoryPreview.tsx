import { useEffect, useMemo, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { Editor } from '@tiptap/core';
import type { JSONContent } from '@tiptap/core';
import * as Y from 'yjs';
import { mdiBackupRestore, mdiContentCopy, mdiClose } from '@mdi/js';
import { createSchemaExtensions, setNoteTitles } from '@noted/editor';
import { getTitleText } from '@noted/sync';
import { formatDateTime } from './format-date';
import { diffHtml } from '@noted/editor/html-diff';
import { Icon } from './Icon';

// HTML of a note state, rendered by a hidden read-only editor with the same schema (the
// collaboration binding fills it on the next tick).
const htmlOf = (state: Uint8Array, titles: Record<string, string>): Promise<string> => new Promise((resolve) => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  const editor = new Editor({ element: document.createElement('div'), editable: false, extensions: createSchemaExtensions({ ydoc: doc, placeholder: '' }) });
  setNoteTitles(editor, titles);
  setTimeout(() => {
    const html = editor.getHTML();
    editor.destroy();
    resolve(html);
  }, 30);
});

// An older version next to the current note, like Notesnook: the old version on the left,
// the current note on the right with added words in green and removed ones struck out in red.
// "Restore this version" copies the old content over the note as a normal edit (it syncs and
// can be undone); "Save a copy" makes a new note of it.
export function HistoryPreview({ state, current, startedAt, endedAt, edited, titles, right = 0, onRestore, onSaveCopy, onClose, embedded = false, oldLabel, currentLabel, actions }: {
  state: Uint8Array;
  // The note as it is now.
  current: Y.Doc;
  startedAt: number;
  endedAt: number;
  edited: number;
  titles: Record<string, string>;
  // Room left free on the right (the properties panel with the version list).
  right?: number;
  onRestore?: (content: JSONContent, title: string) => void;
  onSaveCopy?: (state: Uint8Array) => void;
  onClose?: () => void;
  // Inside another view (Settings > Backup > compare) instead of over the window.
  embedded?: boolean;
  oldLabel?: string;
  currentLabel?: string;
  // Buttons instead of Restore / Save a copy / Close.
  actions?: ReactNode;
}) {
  const doc = useMemo(() => {
    const d = new Y.Doc();
    Y.applyUpdate(d, state);
    return d;
  }, [state]);
  const editor = useEditor({ editable: false, extensions: createSchemaExtensions({ ydoc: doc, placeholder: '' }) }, [doc]);
  useEffect(() => { if (editor) setNoteTitles(editor, titles); }, [editor, titles]);
  const title = getTitleText(doc).toString();
  const currentTitle = getTitleText(current).toString();

  const [diff, setDiff] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setDiff(null);
    Promise.all([htmlOf(state, titles), htmlOf(Y.encodeStateAsUpdate(current), titles)]).then(([oldHtml, newHtml]) => {
      if (!cancelled) setDiff(diffHtml(oldHtml, newHtml));
    });
    return () => { cancelled = true; };
  }, [state, current]);

  // The difference is plain HTML: links in it must not navigate the app window.
  const stopLinks = (e: ReactMouseEvent) => {
    if ((e.target as HTMLElement).closest('a')) e.preventDefault();
  };
  const titleDiff = title === currentTitle ? currentTitle : null;

  const button = (label: string, icon: string, onClick: () => void, kind: 'plain' | 'danger' = 'plain') => (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 16, cursor: 'pointer', fontSize: 13, fontWeight: 600,
        border: kind === 'danger' ? 'none' : '1px solid var(--border)',
        backgroundColor: kind === 'danger' ? 'var(--error)' : 'transparent',
        color: kind === 'danger' ? 'var(--bg-base)' : 'var(--text-main)',
      }}
    >
      <Icon path={icon} size={16} /> {label}
    </button>
  );
  const label = { fontSize: 11, color: 'var(--text-muted)', padding: '6px 24px', borderBottom: '1px solid var(--border)' } as const;
  const pane = { flex: 1, minWidth: 0, overflowY: 'auto', padding: '20px 32px 48px' } as const;

  return (
    <div style={{ position: embedded ? 'absolute' : 'fixed', top: 0, bottom: 0, left: 0, right, zIndex: embedded ? 0 : 20000, display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-base)' }}>
      <style>{`
        .history-diff ins { text-decoration: none; background: color-mix(in srgb, #3fb950 30%, transparent); border-radius: 3px; }
        .history-diff del { text-decoration: line-through; background: color-mix(in srgb, #f85149 30%, transparent); border-radius: 3px; }
        .history-diff input { pointer-events: none; }
      `}</style>
      <div style={{ textAlign: 'center', padding: '12px 16px 4px', fontSize: 18, fontWeight: 700 }}>{currentTitle || title || 'Untitled'}</div>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 8, padding: '6px 16px 10px' }}>
        {actions ?? (
          <>
            {button('Restore this version', mdiBackupRestore, () => { if (editor) onRestore?.(editor.getJSON(), title); })}
            {button('Save a copy', mdiContentCopy, () => onSaveCopy?.(state))}
            {button('Close', mdiClose, () => onClose?.(), 'danger')}
          </>
        )}
      </div>
      <div style={{ display: 'flex', borderTop: '1px solid var(--border)' }}>
        <div style={{ ...label, flex: 1 }}>{oldLabel ?? `Older version | ${formatDateTime(startedAt)} — ${formatDateTime(endedAt).slice(11)}`}</div>
        <div style={{ ...label, flex: 1, borderLeft: '1px solid var(--border)', textAlign: 'right' }}>{currentLabel ?? `Current note | ${formatDateTime(edited)}`}</div>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <div style={pane}>
          <div className="note-title" style={{ fontSize: '1.8em', fontWeight: 700, marginBottom: 12 }}>{title || 'Untitled'}</div>
          <EditorContent editor={editor} />
        </div>
        <div style={{ ...pane, borderLeft: '1px solid var(--border)' }} onClick={stopLinks}>
          <div className="note-title history-diff" style={{ fontSize: '1.8em', fontWeight: 700, marginBottom: 12 }}>
            {titleDiff ?? <><del>{title || 'Untitled'}</del> <ins>{currentTitle || 'Untitled'}</ins></>}
          </div>
          {diff === null
            ? <div style={{ color: 'var(--text-muted)' }}>Comparing…</div>
            // Our own editor's HTML (attributes escaped, images without addresses).
            : <div className="ProseMirror history-diff" dangerouslySetInnerHTML={{ __html: diff }} />}
        </div>
      </div>
    </div>
  );
}
