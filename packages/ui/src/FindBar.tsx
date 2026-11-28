import { useEffect, useReducer, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { Editor } from '@tiptap/core';
import { mdiChevronUp, mdiChevronDown, mdiClose, mdiFormatLetterCase, mdiChevronRight } from '@mdi/js';
import { getSearchState } from '@noted/editor/search';
import { IconBtn, popoverStyle } from './menu-parts';

const field = { flex: 1, minWidth: 0, padding: '5px 8px', fontSize: 13, color: 'var(--text-main)', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 6, outline: 'none' } as const;
const textBtn = { padding: '4px 10px', border: '1px solid var(--border)', borderRadius: 6, background: 'transparent', color: 'var(--text-main)', cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap' } as const;

// Find and replace in the open note (Ctrl+F, or the magnifier in the top toolbar). Enter goes
// to the next match, Shift+Enter to the previous one, Escape closes the bar.
// `initialQuery`: what the note list's search found in the note it opened (findQueryFor).
export function FindBar({ editor, onClose, initialQuery }: { editor: Editor; onClose: () => void; initialQuery?: string }) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [query, setQuery] = useState(() => {
    if (initialQuery) return initialQuery;
    const { from, to } = editor.state.selection;
    const selected = editor.state.doc.textBetween(from, to, ' ');
    return selected.includes('\n') ? '' : selected.slice(0, 100);
  });
  const [replacement, setReplacement] = useState('');
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    editor.on('transaction', rerender);
    input.current?.select();
    return () => {
      editor.off('transaction', rerender);
      editor.commands.clearSearch();
    };
  }, [editor]);
  // The current match goes to the middle of the note when it is near an edge (under the find
  // bar or the toolbar); ProseMirror only scrolls it just inside.
  const reveal = () => requestAnimationFrame(() => {
    const el = editor.view.dom.querySelector('.search-match-current');
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.top < 140 || r.bottom > window.innerHeight - 60) el.scrollIntoView({ block: 'center' });
  });
  const step = (direction: 1 | -1) => {
    editor.commands.searchStep(direction);
    reveal();
  };
  // The next match may sit in a folded section: it opens in its own transaction (the replace
  // stays undoable, the opening stays out of history).
  const replace = () => {
    editor.commands.replaceMatch(replacement);
    editor.commands.revealMatch();
    reveal();
  };
  // A match in a folded section opens once typing pauses (each opening changes the note), at
  // once for a query the bar opened with.
  const first = useRef(true);
  useEffect(() => {
    editor.commands.setSearch(query, caseSensitive);
    reveal();
    const open = () => {
      if (editor.isDestroyed || !editor.commands.revealMatch()) return;
      reveal();
    };
    if (first.current) {
      first.current = false;
      if (initialQuery) open();
      return;
    }
    const timer = setTimeout(open, 600);
    return () => clearTimeout(timer);
  }, [query, caseSensitive]);
  // Ctrl+F again while the bar is open selects the search text.
  useEffect(() => {
    const onFocus = () => input.current?.select();
    window.addEventListener('noted:find', onFocus);
    return () => window.removeEventListener('noted:find', onFocus);
  }, []);

  const close = () => {
    onClose();
    editor.commands.focus();
  };
  const keys = (e: KeyboardEvent, onEnter: () => void) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Enter') { e.preventDefault(); onEnter(); }
  };
  const s = getSearchState(editor);
  const count = s.matches.length ? `${s.index + 1} of ${s.matches.length}` : query ? 'No results' : '';

  return (
    <div style={{ ...popoverStyle, position: 'absolute', top: 0, right: 0, width: '100%', maxWidth: 380, boxSizing: 'border-box', padding: 8, zIndex: 50, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <IconBtn icon={mdiChevronRight} title="Replace" active={replaceOpen} onClick={() => setReplaceOpen((v) => !v)} style={{ transform: replaceOpen ? 'rotate(90deg)' : undefined }} />
        <input
          ref={input}
          autoFocus
          value={query}
          placeholder="Find in note"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => keys(e, () => step(e.shiftKey ? -1 : 1))}
          style={field}
        />
        <span style={{ minWidth: 64, fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>{count}</span>
        <IconBtn icon={mdiFormatLetterCase} title="Match case" active={caseSensitive} onClick={() => setCaseSensitive((v) => !v)} />
        <IconBtn icon={mdiChevronUp} title="Previous match (Shift+Enter)" onClick={() => step(-1)} />
        <IconBtn icon={mdiChevronDown} title="Next match (Enter)" onClick={() => step(1)} />
        <IconBtn icon={mdiClose} title="Close (Escape)" onClick={close} />
      </div>
      {replaceOpen && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, paddingLeft: 34 }}>
          <input
            value={replacement}
            placeholder="Replace with"
            onChange={(e) => setReplacement(e.target.value)}
            onKeyDown={(e) => keys(e, replace)}
            style={field}
          />
          <button type="button" style={textBtn} disabled={!s.matches.length} onClick={replace}>Replace</button>
          <button type="button" style={textBtn} disabled={!s.matches.length} onClick={() => editor.commands.replaceAllMatches(replacement)}>Replace all</button>
        </div>
      )}
    </div>
  );
}
