import { Extension } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { FOLD_TOGGLE, revealPos } from './heading-fold';

// Find and replace in the open note (Ctrl+F on desktop, the note menu on mobile). Matches are
// painted with decorations only; nothing is stored in the document.

export interface SearchMatch { from: number; to: number }

export interface SearchState {
  query: string;
  caseSensitive: boolean;
  matches: SearchMatch[];
  // Index of the current match (-1 when there is none).
  index: number;
}

export const searchKey = new PluginKey<SearchState>('noteSearch');

// Without "Match case" accents are ignored too ("zrodlo" finds "Źródło"), like the note list.
const foldChar = (c: string) => c.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/ł/g, 'l');

// The text folded for comparing, with the index in `text` each folded character came from
// (null: the same index, as for case-sensitive or plain ASCII text).
const foldMapped = (text: string, caseSensitive: boolean): { folded: string; map: number[] | null } => {
  if (caseSensitive) return { folded: text, map: null };
  if (/^[\x00-\x7f]*$/.test(text)) return { folded: text.toLowerCase(), map: null };
  let folded = '';
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const f = foldChar(text[i]);
    folded += f;
    for (let k = 0; k < f.length; k++) map.push(i);
  }
  return { folded, map };
};

// All matches of `query` in the text of the document. A match never crosses a block or an
// inline node that is not text (note link, math, image).
export const findMatches = (doc: PmNode, query: string, caseSensitive = false): SearchMatch[] => {
  const needle = foldMapped(query, caseSensitive).folded;
  if (!needle) return [];
  const matches: SearchMatch[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    // Runs of adjacent text nodes with their start positions.
    let run = '';
    let runStart = -1;
    const flush = () => {
      if (run) {
        const { folded, map } = foldMapped(run, caseSensitive);
        for (let i = folded.indexOf(needle); i !== -1; i = folded.indexOf(needle, i + needle.length)) {
          if (!map) {
            matches.push({ from: runStart + i, to: runStart + i + needle.length });
            continue;
          }
          // Accents after the last letter (decomposed text) belong to the match.
          let end = map[i + needle.length - 1] + 1;
          while (end < run.length && !foldChar(run[end])) end++;
          matches.push({ from: runStart + map[i], to: runStart + end });
        }
      }
      run = '';
      runStart = -1;
    };
    node.forEach((child, offset) => {
      if (child.isText) {
        if (runStart < 0) runStart = pos + 1 + offset;
        run += child.text;
      } else flush();
    });
    flush();
    return false;
  });
  return matches;
};

// What to look for in a note opened from the note list's search: the whole query when the
// note's text has it, else its longest word the text has (the list matches words anywhere),
// null when only the title matched.
export const findQueryFor = (doc: PmNode, query: string): string | null => {
  const text = query.trim();
  if (!text) return null;
  if (findMatches(doc, text).length) return text;
  const words = text.split(/\s+/).sort((a, b) => b.length - a.length);
  return words.find((w) => findMatches(doc, w).length) ?? null;
};

const closestIndex = (matches: SearchMatch[], pos: number) => {
  if (!matches.length) return -1;
  const i = matches.findIndex((m) => m.to > pos);
  return i === -1 ? 0 : i;
};

type Meta = { query?: string; caseSensitive?: boolean; index?: number };

const recompute = (state: SearchState, doc: PmNode, near: number): SearchState => {
  const matches = findMatches(doc, state.query, state.caseSensitive);
  const index = matches.length ? Math.min(Math.max(state.index, 0), matches.length - 1) : -1;
  return { ...state, matches, index: state.index < 0 ? closestIndex(matches, near) : index };
};

export const getSearchState = (editor: Editor): SearchState =>
  searchKey.getState(editor.state) ?? { query: '', caseSensitive: false, matches: [], index: -1 };

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    noteSearch: {
      setSearch: (query: string, caseSensitive?: boolean) => ReturnType;
      clearSearch: () => ReturnType;
      // Moves to the next / previous match, selects it and scrolls it into view.
      searchStep: (direction: 1 | -1) => ReturnType;
      // Opens the folds hiding the current match (setSearch leaves them while typing).
      revealMatch: () => ReturnType;
      replaceMatch: (replacement: string) => ReturnType;
      replaceAllMatches: (replacement: string) => ReturnType;
    };
  }
}

// Selects the match; with `reveal` also opens folded headings / outline items that hide it
// (not on each typed letter: opening is a change of the note that syncs; never in a read-only
// note).
const selectMatch = (tr: Transaction, match: SearchMatch | undefined, reveal = true) => {
  if (!match) return tr;
  // The phone scrolls to the match itself (find.ts), not to the caret; opening is not undone.
  if (reveal && revealPos(tr, match.from)) tr.setMeta(FOLD_TOGGLE, true).setMeta('addToHistory', false);
  return tr.setSelection(TextSelection.create(tr.doc, match.from, match.to)).scrollIntoView();
};

export const NoteSearch = Extension.create({
  name: 'noteSearch',

  addCommands() {
    return {
      setSearch: (query, caseSensitive) => ({ tr, state, dispatch }) => {
        const prev = searchKey.getState(state)!;
        const meta: Meta = { query, caseSensitive: caseSensitive ?? prev.caseSensitive, index: -1 };
        if (dispatch) {
          tr.setMeta(searchKey, meta);
          const matches = findMatches(state.doc, query, meta.caseSensitive);
          const i = closestIndex(matches, state.selection.from);
          if (i >= 0) {
            meta.index = i;
            selectMatch(tr, matches[i], false);
          }
        }
        return true;
      },
      clearSearch: () => ({ tr, dispatch }) => {
        if (dispatch) tr.setMeta(searchKey, { query: '', index: -1 } satisfies Meta);
        return true;
      },
      searchStep: (direction) => ({ tr, state, dispatch, editor }) => {
        const s = searchKey.getState(state)!;
        if (!s.matches.length) return false;
        const index = (s.index + direction + s.matches.length) % s.matches.length;
        if (dispatch) {
          tr.setMeta(searchKey, { index } satisfies Meta);
          selectMatch(tr, s.matches[index], editor.isEditable);
        }
        return true;
      },
      revealMatch: () => ({ tr, state, dispatch, editor }) => {
        const s = searchKey.getState(state)!;
        const match = s.matches[s.index];
        if (!match || !editor.isEditable) return false;
        if (dispatch) selectMatch(tr, match);
        return true;
      },
      replaceMatch: (replacement) => ({ tr, state, dispatch }) => {
        const s = searchKey.getState(state)!;
        const match = s.matches[s.index];
        if (!match) return false;
        if (dispatch) {
          if (replacement) tr.insertText(replacement, match.from, match.to);
          else tr.delete(match.from, match.to);
          // Then on to the next match after the replaced text.
          const next = findMatches(tr.doc, s.query, s.caseSensitive);
          const i = closestIndex(next, match.from + replacement.length);
          tr.setMeta(searchKey, { index: i } satisfies Meta);
          // Not opened here: the replace must stay undoable (opening is left out of history).
          selectMatch(tr, next[i], false);
        }
        return true;
      },
      replaceAllMatches: (replacement) => ({ tr, state, dispatch }) => {
        const s = searchKey.getState(state)!;
        if (!s.matches.length) return false;
        if (dispatch) {
          for (const m of [...s.matches].reverse()) {
            if (replacement) tr.insertText(replacement, m.from, m.to);
            else tr.delete(m.from, m.to);
          }
          tr.setMeta(searchKey, { index: -1 } satisfies Meta);
        }
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<SearchState>({
        key: searchKey,
        state: {
          init: () => ({ query: '', caseSensitive: false, matches: [], index: -1 }),
          apply: (tr, value, _old, next: EditorState) => {
            const meta = tr.getMeta(searchKey) as Meta | undefined;
            if (!meta && !tr.docChanged) return value;
            const merged: SearchState = { ...value, ...meta };
            if (!merged.query) return { query: '', caseSensitive: merged.caseSensitive, matches: [], index: -1 };
            return recompute(merged, next.doc, next.selection.from);
          },
        },
        props: {
          decorations(state) {
            const s = searchKey.getState(state);
            if (!s?.matches.length) return null;
            return DecorationSet.create(state.doc, s.matches.map((m, i) =>
              Decoration.inline(m.from, m.to, { class: i === s.index ? 'search-match search-match-current' : 'search-match' })));
          },
        },
      }),
    ];
  },
});
