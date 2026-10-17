// @vitest-environment happy-dom
import { it, expect } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';
import { Editor } from '@tiptap/core';
import * as Y from 'yjs';
import { createSchemaExtensions } from '@noted/editor';
import { NoteList, TabBar, StatusBar, TopToolbar, NavPanel, NoteProperties } from '../index';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

it('renders the new desktop UI without errors', async () => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  const editor = new Editor({ extensions: createSchemaExtensions({ ydoc: new Y.Doc(), placeholder: '' }) });
  const now = Date.now();
  await act(async () => {
    root.render(h('div', null,
      h(NoteList, { items: [
        { id: 'a', title: 'Pinned one', excerpt: '', pinned: true, updatedAt: now - 1000 },
        { id: 'b', title: 'Recent one', excerpt: 'text', pinned: false, updatedAt: now - 3 * 86400000 },
        { id: 'c', title: 'Old one', excerpt: '', pinned: false, updatedAt: now - 90 * 86400000 },
      ], activeId: 'b', title: 'Notes', sort: 'edited', onSort: () => {}, onOpen: () => {}, onAction: () => {},
        view: { kind: 'notes' }, grouping: 'notebook', onGrouping: () => {}, linksOf: () => [], folds: [], onFolds: () => {} }),
      h(NavPanel, { view: { kind: 'notes' }, onView: () => {}, counts: { notes: 3, favorites: 1, trash: 0, archive: 0 }, notebooks: [{ id: 'n', name: 'Studia', count: 2 }], tags: [], onCreate: () => {}, onRename: () => {}, onDelete: () => {} }),
      h(NoteProperties, {
        flags: { pinned: true, favorite: false, readOnly: false, archived: false, spellcheck: true }, onFlag: () => {}, font: 'sans', onFont: () => {},
        created: now, edited: now, notebooks: [{ id: 'n', name: 'Studia' }], tags: [{ id: 't', name: 'analiza' }], onPick: () => {},
        onRemoveNotebook: () => {}, onRemoveTag: () => {}, links: [], backlinks: [{ id: 'c', title: 'Old one' }], onOpenNote: () => {},
        attachments: [{ kind: 'file', blob: 'x:k', name: 'book.pdf', size: 2048 }], onOpenAttachment: () => {}, onSaveAttachment: () => {}, onShowAttachment: () => {},
        history: [{ id: 'h', startedAt: now - 60000, endedAt: now }], onOpenHistory: () => {}, toolbar: 'top', onToolbar: () => {}, onTrash: () => {}, onClose: () => {},
      }),
      h(TabBar, { tabs: [{ id: 'b', title: 'Recent one' }], activeId: 'b', canGoBack: false, canGoForward: false, onNewNote: () => {}, onBack: () => {}, onForward: () => {}, onSelect: () => {}, onClose: () => {} }),
      h(TopToolbar, { editor, noteFont: 'sans', onNoteFont: () => {} }),
      h(StatusBar, { online: true, syncing: false, synced: true, onSync: () => {}, fullWidth: false, onToggleWidth: () => {}, focusMode: false, onToggleFocus: () => {}, zoom: 1, onZoom: () => {}, stats: { words: 34, characters: 231, paragraphs: 8, spaces: 26 }, created: now }),
    ));
  });
  const text = el.textContent ?? '';
  console.log(text.slice(0, 300));
  expect(text).toContain('Pinned');
  expect(text).toContain('Recent one');
  expect(text).toContain('No notebook');
  expect(text).toContain('34 words');
  expect(text).toContain('Paragraph');
  expect(text).toContain('100%');
  expect(text).toContain('Favorites');
  expect(text).toContain('Linked from (1)');
  expect(text).toContain('analiza');
  expect(text).toContain('book.pdf');
  expect(text).toContain('Note history (1)');
  expect(text).toContain('Sans');
  // Bold through the toolbar.
  editor.commands.setContent('<p>hello</p>');
  editor.commands.selectAll();
  const bold = el.querySelector('button[title="Bold (Ctrl+B)"]')!;
  await act(async () => { bold.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
  expect(editor.getHTML()).toContain('<strong>hello</strong>');
  await act(async () => root.unmount());
  editor.destroy();
});

it('shows a history version next to the current note with the changes marked', async () => {
  const { HistoryPreview } = await import('../index');
  const { setTitle } = await import('@noted/sync');
  // Old version: "one two three"; the current note changes "two" to "2".
  const make = (text: string) => {
    const ydoc = new Y.Doc();
    setTitle(ydoc, 'Plan');
    const ed = new Editor({ extensions: createSchemaExtensions({ ydoc, placeholder: '' }) });
    return new Promise<Y.Doc>((resolve) => setTimeout(() => { ed.commands.setContent(`<p>${text}</p>`); ed.destroy(); resolve(ydoc); }, 20));
  };
  const old = await make('one two three');
  const current = await make('one 2 three');
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => {
    root.render(h(HistoryPreview, {
      state: Y.encodeStateAsUpdate(old), current, startedAt: 1, endedAt: 2, edited: 3, titles: {},
      onRestore: () => {}, onSaveCopy: () => {}, onClose: () => {},
    }));
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 120)); });
  const diff = el.querySelector('.ProseMirror.history-diff')!;
  console.log('diff:', diff?.innerHTML);
  expect(diff.querySelector('del')?.textContent).toBe('two');
  expect(diff.querySelector('ins')?.textContent).toBe('2');
  expect(el.textContent).toContain('Restore this version');
  await act(async () => root.unmount());
});

it('renders every settings section', async () => {
  const { SettingsDialog } = await import('../index');
  const div = document.createElement('div');
  document.body.appendChild(div);
  const root = createRoot(div);
  const host = {
    masterKey: new Uint8Array(32), deriveKey: async () => new Uint8Array(32), onLogout: () => {}, onEpochChanged: () => {},
    saveFile: async () => true, openTextFile: async () => null, serverUrl: 'http://127.0.0.1:1', online: true, onSyncNow: () => {},
    themeMode: 'auto' as const, onThemeMode: () => {}, zoom: 1, onZoom: () => {},
    createBackup: async () => ({ name: 'b', text: '' }), restoreBackup: async () => ({ added: 0, merged: 0, blobs: 0 }),
    autoBackup: { interval: 'off' as const, attachments: false, last: null, folder: '~/Documents/Noted backups' },
    onAutoBackup: () => {}, onOpenBackupFolder: () => {}, exportAll: async () => ({ name: 'x.zip', zip: new Uint8Array(), count: 0 }),
    syncing: false, lastSyncAt: null, compareBackup: async () => [], restoreBackupNote: async () => {}, listBackups: async () => [], noteTitles: {},
    toolbarPlatform: 'desktop' as const, toolbarConfig: null, onToolbarConfig: () => {},
    pickImportFiles: async () => null, runImport: async () => ({ notes: 0, errors: [] }), onFileDrop: () => () => {},
    vault: { exists: false, open: false, onCreate: () => {}, onLock: () => {}, onChangePassword: async () => null },
  };
  await act(async () => { root.render(h(SettingsDialog, { host, onClose: () => {} })); });
  const texts: string[] = [];
  for (const label of ['Account', 'Sync', 'Appearance', 'Backup & export', 'Toolbar', 'Importer', 'Vault']) {
    const button = [...div.querySelectorAll('nav button')].find((b) => b.textContent?.trim() === label) as HTMLButtonElement;
    await act(async () => { button.click(); });
    texts.push(div.querySelector('main')!.textContent ?? '');
  }
  expect(texts[0]).toContain('Save data recovery key');
  expect(texts[0]).toContain('Log out from all other devices');
  expect(texts[2]).toContain('Zoom factor');
  expect(texts[3]).toContain('Export all notes');
  expect(texts[4]).toContain('opens this row (group 1)');
  expect(texts[4]).toContain('Not in the toolbar');
  expect(texts[5]).toContain('Drag & drop files here');
  expect(texts[6]).toContain('Lock (vault)');
  act(() => root.unmount());
});

it('renders the backup comparison', async () => {
  const { BackupCompare } = await import('./BackupCompare');
  const Yjs = await import('yjs');
  const state = (text: string) => {
    const d = new Yjs.Doc();
    const p = new Yjs.XmlElement('paragraph');
    p.insert(0, [new Yjs.XmlText(text)]);
    d.getXmlFragment('default').push([p]);
    d.getText('title').insert(0, 'Plan');
    return Yjs.encodeStateAsUpdate(d);
  };
  const div = document.createElement('div');
  document.body.appendChild(div);
  const root = createRoot(div);
  const diffs = [{ id: 'n1', status: 'changed' as const, title: 'Plan', backup: state('old text'), current: state('new text'), backupTitle: 'Plan', currentTitle: 'Plan', updatedAt: Date.now() }];
  await act(async () => {
    root.render(h(BackupCompare, { name: 'b.nbackup', createdAt: Date.now() - 86400000, load: async () => diffs, titles: {}, onRestoreNote: async () => {}, onRestoreAll: async () => '', onClose: () => {} }));
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 80)); });
  expect(div.textContent).toContain('1 note differs from now');
  expect(div.textContent).toContain('Changed since');
  expect(div.textContent).toContain('Merge both');
  act(() => root.unmount());
});

it('applies a history restore once, never in an editor opened later', async () => {
  const { NoteEditor } = await import('../index');
  const { noteBodyJson } = await import('@noted/sync');
  const make = (text: string) => {
    const d = new Y.Doc();
    const p = new Y.XmlElement('paragraph');
    p.insert(0, [new Y.XmlText(text)]);
    d.getXmlFragment('default').push([p]);
    return d;
  };
  const other = make('other note');
  const restore = { id: 1, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'restored' }] }] }, title: 'R' };
  const div = document.createElement('div');
  document.body.appendChild(div);
  const root = createRoot(div);
  await act(async () => { root.render(h(NoteEditor as any, { key: 'x', noteId: 'x', ydoc: other, onUpdate: () => {}, restore })); });
  await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
  expect(JSON.stringify(noteBodyJson(other))).toContain('other note');
  await act(async () => { root.render(h(NoteEditor as any, { key: 'x', noteId: 'x', ydoc: other, onUpdate: () => {}, restore: { ...restore, id: 2 } })); });
  await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
  expect(JSON.stringify(noteBodyJson(other))).toContain('restored');
  act(() => root.unmount());
});
