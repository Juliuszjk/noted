import { Editor } from '@tiptap/core';
import type { JSONContent } from '@tiptap/core';
import * as Y from 'yjs';
import { mdiBackupRestore, mdiContentCopy, mdiClose } from '@mdi/js';
import { createSchemaExtensions } from '@noted/editor/extensions';
import { setNoteTitles } from '@noted/editor/note-link';
import { diffHtml } from '@noted/editor/html-diff';
import { getTitleText } from '@noted/sync/note-meta';

// An older version of the note (the mobile counterpart of the desktop HistoryPreview): the old
// version, or the current note with added words in green and removed ones struck out in red.
// "Restore this version" copies the old content over the note as a normal edit; "Save a copy"
// asks React Native to make a new note of it.

const svg = (path: string, size = 20) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><path d="${path}" fill="currentColor"/></svg>`;

const formatDate = (ms: number) => {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export interface HistoryViewOptions {
  state: Uint8Array;
  startedAt: number;
  endedAt: number;
  current: { editor: Editor; ydoc: Y.Doc };
  titles: Record<string, string>;
  onRestore: (content: JSONContent, title: string) => void;
  onSaveCopy: () => void;
  // Image blobs etc. for the read-only editor of the old version.
  prepareEditor?: (editor: Editor) => void;
  // A backup instead of a history version (Settings > Backup > compare): its labels and
  // buttons in place of the history ones.
  whenText?: string;
  oldLabel?: string;
  actions?: { icon: string; label: string; run: (old: { json: JSONContent; title: string }) => void; danger?: boolean }[];
}

export function showHistoryView(o: HistoryViewOptions) {
  document.querySelector('.history-view')?.remove();
  const root = document.createElement('div');
  root.className = 'history-view';
  const oldDoc = new Y.Doc();
  Y.applyUpdate(oldDoc, o.state);
  const oldTitle = getTitleText(oldDoc).toString();
  const currentTitle = getTitleText(o.current.ydoc).toString();

  const head = document.createElement('div');
  head.className = 'history-head';
  const title = document.createElement('div');
  title.className = 'history-title';
  title.textContent = currentTitle || oldTitle || 'Untitled';
  const when = document.createElement('div');
  when.className = 'history-when';
  when.textContent = o.whenText ?? `Version of ${formatDate(o.startedAt)} — ${formatDate(o.endedAt).slice(11)}`;

  const tabs = document.createElement('div');
  tabs.className = 'history-tabs';
  const body = document.createElement('div');
  body.className = 'history-body';
  const oldPane = document.createElement('div');
  oldPane.className = 'history-pane';
  const diffPane = document.createElement('div');
  diffPane.className = 'history-pane history-diff';
  body.append(oldPane, diffPane);

  const tab = (label: string, pane: HTMLElement) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'history-tab';
    b.textContent = label;
    b.addEventListener('click', () => {
      tabs.querySelectorAll('.history-tab').forEach((t) => t.classList.toggle('active', t === b));
      oldPane.style.display = pane === oldPane ? '' : 'none';
      diffPane.style.display = pane === diffPane ? '' : 'none';
    });
    return b;
  };
  const oldTab = tab(o.oldLabel ?? 'Older version', oldPane);
  const diffTab = tab('Changes since', diffPane);
  tabs.append(oldTab, diffTab);

  // The old version, read-only, with the same schema as the editor.
  const oldTitleEl = document.createElement('div');
  oldTitleEl.className = 'history-note-title';
  oldTitleEl.textContent = oldTitle || 'Untitled';
  const oldContent = document.createElement('div');
  oldPane.append(oldTitleEl, oldContent);
  const oldEditor = new Editor({ element: oldContent, editable: false, extensions: createSchemaExtensions({ ydoc: oldDoc, placeholder: '' }) });
  setNoteTitles(oldEditor, o.titles);
  o.prepareEditor?.(oldEditor);

  // The current note with the differences marked (our own editor's HTML; links do nothing).
  const diffTitle = document.createElement('div');
  diffTitle.className = 'history-note-title';
  const diffContent = document.createElement('div');
  diffContent.className = 'ProseMirror';
  diffContent.textContent = 'Comparing…';
  diffPane.append(diffTitle, diffContent);
  if (oldTitle === currentTitle) diffTitle.textContent = currentTitle || 'Untitled';
  else {
    const del = document.createElement('del');
    del.textContent = oldTitle || 'Untitled';
    const ins = document.createElement('ins');
    ins.textContent = currentTitle || 'Untitled';
    diffTitle.append(del, ' ', ins);
  }
  diffPane.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('a')) e.preventDefault(); }, true);
  // The collaboration binding fills the old editor on the next tick.
  setTimeout(() => {
    try {
      diffContent.innerHTML = diffHtml(oldEditor.getHTML(), o.current.editor.getHTML());
    } catch {
      diffContent.textContent = 'Could not compare the versions.';
    }
  }, 60);

  const close = () => {
    oldEditor.destroy();
    root.remove();
    document.body.classList.remove('history-open');
  };
  (root as HTMLElement & { closeView?: () => void }).closeView = close;
  const action = (icon: string, label: string, run: () => void, cls = '') => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `history-action ${cls}`.trim();
    b.innerHTML = svg(icon);
    b.append(label);
    b.addEventListener('click', run);
    return b;
  };
  const actions = document.createElement('div');
  actions.className = 'history-actions';
  actions.append(
    ...(o.actions
      ? o.actions.map((a) => action(a.icon, a.label, () => { a.run({ json: oldEditor.getJSON(), title: oldTitle }); close(); }, a.danger ? 'danger' : ''))
      : [
        action(mdiBackupRestore, 'Restore', () => { o.onRestore(oldEditor.getJSON(), oldTitle); close(); }),
        action(mdiContentCopy, 'Save a copy', () => { o.onSaveCopy(); close(); }),
      ]),
    action(mdiClose, 'Close', close, 'danger'),
  );

  head.append(title, when, actions, tabs);
  root.append(head, body);
  document.body.appendChild(root);
  document.body.classList.add('history-open');
  (document.activeElement as HTMLElement | null)?.blur?.();
  diffTab.click();
  return { close };
}
