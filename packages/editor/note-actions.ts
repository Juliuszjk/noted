import { Extension } from '@tiptap/core';
import type { Editor } from '@tiptap/core';

// Note-level actions started from inside the editor (slash menu "Notebook" / "Tag" /
// "Export" / "PDF preview" / "Publish" / "Go to note" / "Link from another note"), handled by
// the app UI.
// Without a handler the request does nothing.
export type NoteActionKind = 'notebook' | 'tag' | 'export' | 'pdf' | 'publish' | 'goto' | 'linkto';
export type NoteActionRequest = { kind: NoteActionKind; pos: number };

export const NoteActions = Extension.create<{ onRequest: ((request: NoteActionRequest) => void) | null }>({
  name: 'noteActions',
  addOptions() {
    return { onRequest: null };
  },
});

export const requestNoteAction = (editor: Editor, request: NoteActionRequest): boolean => {
  const extension = editor.extensionManager.extensions.find((e) => e.name === 'noteActions');
  const onRequest = extension?.options.onRequest as ((r: NoteActionRequest) => void) | null | undefined;
  if (!onRequest) return false;
  onRequest(request);
  return true;
};
