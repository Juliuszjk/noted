import { getCurrentWebview } from '@tauri-apps/api/webview';
import { insertFiles } from '@noted/editor';
import type { Editor } from '@tiptap/core';

// On Windows, Tauri's own drop target takes files dragged in from Explorer: the page never
// gets a drop event with them (WebKitGTK still delivers them to the editor's handleDrop).
// The paths arrive here instead and go into the note editor under the pointer.
export const routeFileDropsToEditors = () => {
  if (!document.documentElement.classList.contains('chromium')) return;
  getCurrentWebview().onDragDropEvent((e) => {
    const p = e.payload;
    if (p.type !== 'drop' || p.paths.length === 0) return;
    const scale = window.devicePixelRatio || 1;
    const x = p.position.x / scale;
    const y = p.position.y / scale;
    const dom = document.elementFromPoint(x, y)?.closest('.ProseMirror') as (HTMLElement & { editor?: Editor }) | null;
    const editor = dom?.editor;
    const handlers = editor?.storage.image?.handlers;
    if (!editor || !editor.isEditable || !handlers?.readPaths) return;
    const pos = editor.view.posAtCoords({ left: x, top: y })?.pos;
    handlers.readPaths(p.paths)
      .then((files) => insertFiles(editor, files, pos))
      .catch((err) => handlers.notify?.(`Cannot add the file: ${err instanceof Error ? err.message : String(err)}`));
  }).catch((err) => console.error('File drop listener failed:', err));
};
