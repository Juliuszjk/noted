// @vitest-environment happy-dom
import { it, expect } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';
import { NavPanel } from '../index';
import type { NavEntry } from './NavPanel';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const tree: NavEntry[] = [
  { id: 'linux', name: 'Linux', count: 5, parent: null, depth: 0 },
  { id: 'todo', name: 'TODO', count: 3, parent: 'linux', depth: 1 },
  { id: 'studia', name: 'Studia', count: 9, parent: null, depth: 0 },
  { id: 's5', name: 'Semestr 5', count: 7, parent: 'studia', depth: 1 },
  { id: 'algo', name: 'Algorithms', count: 4, parent: 's5', depth: 2 },
];

it('shows notebooks as a folding tree with a Move to… picker', async () => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  let open: string[] = ['studia'];
  const moves: [string, string | null][] = [];
  const render = () => root.render(h(NavPanel, {
    view: { kind: 'notebook', id: 'linux' }, onView: () => {}, counts: { notes: 3, favorites: 1, trash: 0, archive: 0 },
    notebooks: tree, tags: [], onCreate: () => {}, onRename: () => {}, onDelete: () => {},
    onMove: (id, parent) => moves.push([id, parent]),
    openNotebooks: open, onOpenNotebooks: (ids) => { open = ids; render(); },
  }));
  await act(async () => render());
  const names = () => [...el.querySelectorAll('[data-nb]')].map((b) => b.textContent);
  // Studia is open, Semestr 5 and Linux are folded.
  expect(names()).toEqual(['Linux5', 'Studia9', 'Semestr 57']);
  const s5 = el.querySelector('[data-nb="s5"]')!;
  await act(async () => { (s5.querySelector('[title="Unfold"]') as HTMLElement).click(); });
  expect(open).toContain('s5');
  expect(names()).toEqual(['Linux5', 'Studia9', 'Semestr 57', 'Algorithms4']);

  // Right-click Studia: Move to… lists every notebook, Studia and the ones inside it cannot be picked.
  await act(async () => { el.querySelector('[data-nb="studia"]')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 })); });
  const menu = [...el.querySelectorAll('button')].map((b) => b.textContent?.trim());
  expect(menu).toEqual(expect.arrayContaining(['New sub-notebook', 'Move to…', 'Rename', 'Delete']));
  await act(async () => { [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Move to…')!.click(); });
  const picker = [...el.querySelectorAll('button')].filter((b) => !b.dataset.nb && ['Top level', 'Linux', 'TODO', 'Studia', 'Semestr 5', 'Algorithms'].includes(b.textContent?.trim() ?? ''));
  expect(picker.map((b) => [b.textContent?.trim(), b.disabled])).toEqual([
    ['Top level', false], ['Linux', false], ['TODO', false], ['Studia', true], ['Semestr 5', true], ['Algorithms', true],
  ]);
  await act(async () => { picker.find((b) => b.textContent?.trim() === 'TODO')!.click(); });
  expect(moves).toEqual([['studia', 'todo']]);
  root.unmount();
});
