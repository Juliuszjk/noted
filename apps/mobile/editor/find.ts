import type { Editor } from '@tiptap/core';
import { mdiChevronUp, mdiChevronDown, mdiClose, mdiFormatLetterCase, mdiFindReplace } from '@mdi/js';
import { getSearchState } from '@noted/editor/search';

// Find and replace bar of the mobile editor page (opened from the note menu): pinned to the top
// of the visible area, matches painted by the NoteSearch extension. The current match is
// scrolled to the upper third of what the keyboard leaves visible.

const svg = (path: string, size = 22) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><path d="${path}" fill="currentColor"/></svg>`;

export function createFindBar(editor: Editor) {
  const bar = document.createElement('div');
  bar.className = 'find-bar';
  const row = document.createElement('div');
  row.className = 'find-row';
  const input = document.createElement('input');
  input.className = 'tb-input find-input';
  input.placeholder = 'Find in note';
  input.enterKeyHint = 'search';
  const count = document.createElement('span');
  count.className = 'find-count';
  const replaceRow = document.createElement('div');
  replaceRow.className = 'find-row find-replace';
  const replaceInput = document.createElement('input');
  replaceInput.className = 'tb-input find-input';
  replaceInput.placeholder = 'Replace with';
  let caseSensitive = false;
  let replaceOpen = false;

  const iconButton = (icon: string, title: string, run: () => void) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tb-btn';
    b.title = title;
    b.setAttribute('aria-label', title);
    b.innerHTML = svg(icon);
    b.addEventListener('click', (e) => { e.preventDefault(); run(); });
    return b;
  };
  const textButton = (label: string, run: () => void) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tb-secondary';
    b.textContent = label;
    b.addEventListener('click', (e) => { e.preventDefault(); run(); });
    return b;
  };

  // The match goes to the upper third of the visible area (the keyboard covers the rest).
  const reveal = () => {
    const s = getSearchState(editor);
    const match = s.matches[s.index];
    if (!match) return;
    requestAnimationFrame(() => {
      const viewport = window.visualViewport;
      const top = (viewport?.offsetTop ?? 0) + bar.offsetHeight;
      const height = (viewport?.height ?? window.innerHeight) - bar.offsetHeight;
      const y = editor.view.coordsAtPos(match.from).top;
      if (y < top + 16 || y > top + height * 0.6) window.scrollBy({ top: y - (top + height * 0.3), behavior: 'smooth' });
    });
  };
  const render = () => {
    const s = getSearchState(editor);
    count.textContent = s.matches.length ? `${s.index + 1}/${s.matches.length}` : input.value ? '0' : '';
    caseButton.classList.toggle('active', caseSensitive);
    replaceButton.classList.toggle('active', replaceOpen);
    replaceRow.style.display = replaceOpen ? 'flex' : 'none';
  };
  const step = (direction: 1 | -1) => {
    editor.commands.searchStep(direction);
    reveal();
  };
  const caseButton = iconButton(mdiFormatLetterCase, 'Match case', () => {
    caseSensitive = !caseSensitive;
    editor.commands.setSearch(input.value, caseSensitive);
    reveal();
  });
  const replaceButton = iconButton(mdiFindReplace, 'Replace', () => {
    replaceOpen = !replaceOpen;
    render();
    if (replaceOpen) replaceInput.focus();
  });

  input.addEventListener('input', () => {
    editor.commands.setSearch(input.value, caseSensitive);
    reveal();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); step(1); }
  });
  replaceInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); editor.commands.replaceMatch(replaceInput.value); reveal(); }
  });

  row.append(input, count, iconButton(mdiChevronUp, 'Previous match', () => step(-1)), iconButton(mdiChevronDown, 'Next match', () => step(1)), caseButton, replaceButton, iconButton(mdiClose, 'Close', () => close()));
  replaceRow.append(
    replaceInput,
    textButton('Replace', () => { editor.commands.replaceMatch(replaceInput.value); reveal(); }),
    textButton('All', () => editor.commands.replaceAllMatches(replaceInput.value)),
  );
  bar.append(row, replaceRow);
  // Buttons keep the focus in the input (the keyboard stays up).
  bar.addEventListener('mousedown', (e) => {
    if (!(e.target as HTMLElement).closest('input')) e.preventDefault();
  });
  document.body.appendChild(bar);

  // Fixed elements belong to the page; the visual viewport may be scrolled inside it.
  const place = () => {
    bar.style.top = `${window.visualViewport?.offsetTop ?? 0}px`;
  };
  window.visualViewport?.addEventListener('scroll', place);
  window.visualViewport?.addEventListener('resize', place);
  window.addEventListener('scroll', place, { passive: true });
  editor.on('transaction', () => { if (bar.classList.contains('open')) render(); });

  const open = () => {
    if (editor.isFocused) (editor.view.dom as HTMLElement).blur();
    bar.classList.add('open');
    document.body.classList.add('finding');
    place();
    render();
    // The selection (when it is a few words) is what to look for.
    const { from, to } = editor.state.selection;
    const selected = editor.state.doc.textBetween(from, to, ' ');
    if (selected && !selected.includes('\n') && selected.length < 100) input.value = selected;
    editor.commands.setSearch(input.value, caseSensitive);
    setTimeout(() => { input.focus(); input.select(); }, 60);
    reveal();
  };
  function close() {
    bar.classList.remove('open');
    document.body.classList.remove('finding');
    editor.commands.clearSearch();
    (document.activeElement as HTMLElement | null)?.blur?.();
  }
  return { open, close, isOpen: () => bar.classList.contains('open') };
}
