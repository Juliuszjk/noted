import * as Y from 'yjs';
import { Editor } from '@tiptap/core';
import { createSchemaExtensions } from '@noted/editor/extensions';
import {
  getTitleText, setTitle, getNoteFont, getNoteSettings, setNoteFont, getNoteNotebooks, setNoteNotebook, getNoteTags,
  getNoteTagMap, getNoteNotebookMap, setNoteTag, getNoteFlag, setNoteFlag, getNoteCreated, getNoteTrashedAt,
  setNoteTrashed, deleteNoteForever, getNotePublish, setNotePublish, applyDefaultTitle,
} from '@noted/sync/note-meta';
import { parseEditorPrefs, editorPrefsCssVars, setLigatures } from '@noted/editor/editor-prefs';
import { setCodeThemeByLanguage } from '@noted/editor/code-block';
import type { EditorPrefs } from '@noted/editor/editor-prefs';
import { parseToolbarConfig } from '@noted/editor/toolbar-items';
import { buildPublishedNote } from '@noted/ui/src/publish-html';
import { sealPublished, AUTO_PUBLISH_DELAY_MS } from '@noted/sync/publish';
import { setNoteBodyJson } from '@noted/sync/json-to-y';
import type { NoteFlag } from '@noted/sync/note-meta';
import { NoteActions } from '@noted/editor/note-actions';
import { SlashCommands } from '@noted/editor/slash';
import { mdiBookOutline, mdiPound, mdiPlus, mdiBackupRestore, mdiCallMerge } from '@mdi/js';
import { mergeWithBackup } from '@noted/sync/merge-backup';
import { setNoteTitles } from '@noted/editor/note-link';
import { configureBlobs, parseBlobRef, isHeicFile, insertFiles, importImages } from '@noted/editor/blob-image';
import { createBlobUrlCache } from '@noted/editor/blob-url-cache';
import type { BlobRef } from '@noted/editor/blob-image';
import { base64ToBytes, bytesToBase64, unsealBytes, sealBytes, generateKey, publishPasswordKey } from '@noted/crypto';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import { compressImageBytes } from '@noted/media';
import type { MathEditRequest } from '@noted/editor/math';
import { setReminderTimes } from '@noted/editor/reminder';
import type { ReminderEditRequest } from '@noted/editor/reminder';
import { createToolbar } from './toolbar';
import { createDrawingBar } from './drawing-bar';
import { restoreDrawingTools, showPenHover } from '@noted/editor/drawing';
import { createFindBar } from './find';
import { showHistoryView } from './history-view';
import { exportNote, exportFileName } from '@noted/editor/export';
import { DEFAULT_THEME, themeToCssVars } from '@noted/theme';
import type { ThemeColors } from '@noted/theme';

// Colours (CSS variables) of the page; same roles as the desktop and the native screens.
// React Native sends the theme in use (Settings > Appearance) right after "ready".
const applyColors = (theme: ThemeColors) => {
  for (const [name, value] of Object.entries(themeToCssVars(theme))) document.documentElement.style.setProperty(name, value);
};
applyColors(DEFAULT_THEME);

// Runs inside the WebView. React Native owns storage, encryption and sync; this page only
// edits a Y.Doc and reports incremental updates. Nothing is loaded from the network.

// Origin for updates that come from React Native, so they are never sent back.
const REMOTE = 'noted-rn-remote';
const SAVE_DEBOUNCE_MS = 400;

const post = (msg: Record<string, unknown>) =>
  (window as any).ReactNativeWebView?.postMessage(JSON.stringify(msg));

// The system file picker (image / file / CSV inputs) sends the app to the background; RN must
// not take that for leaving the app (app lock).
document.addEventListener('click', (e) => {
  const t = e.target as HTMLInputElement | null;
  if (t?.tagName === 'INPUT' && t.type === 'file') post({ type: 'goingAway' });
}, true);

// Android gives key input only to the WebView that has the native focus; in a split view
// that may be the other note's. A touch here while this page has no focus asks for it, before
// the tap places the cursor.
let focusAsked = false;
document.addEventListener('touchstart', () => {
  if (document.hasFocus()) return;
  focusAsked = true;
  post({ type: 'wantFocus' });
}, { capture: true, passive: true });
// The focus came after the tap had already placed the cursor: focus the editor again now, so
// Android brings up the keyboard for it.
window.addEventListener('focus', () => {
  if (!focusAsked) return;
  focusAsked = false;
  const dom = editor?.view.dom as HTMLElement | undefined;
  if (!dom || !editor?.isFocused) return;
  post({ type: 'expectKeyboard' });
  dom.blur();
  dom.focus({ preventScroll: true });
});

const toBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
};

const fromBase64 = (b64: string): Uint8Array => {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

const ydoc = new Y.Doc();
let editor: Editor | null = null;
let pending: Uint8Array[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

// A locked note (vault): its body is edited in a document of its own, never saved as such;
// React Native seals the body JSON with the vault key (`lockedBody` messages). Title and
// settings stay in `ydoc` and save as usual.
let bodyDoc: Y.Doc | null = null;
let lockedTimer: ReturnType<typeof setTimeout> | null = null;
const flushLocked = () => {
  if (lockedTimer) clearTimeout(lockedTimer);
  lockedTimer = null;
  if (editor && bodyDoc) post({ type: 'lockedBody', body: editor.getJSON() });
};

const flush = () => {
  if (lockedTimer) flushLocked();
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!editor || pending.length === 0) return;
  const update = Y.mergeUpdates(pending);
  pending = [];
  post({ type: 'save', update: toBase64(update) });
};

ydoc.on('update', (update: Uint8Array, origin: unknown) => {
  if (origin === REMOTE || !editor) return;
  pending.push(update);
  // A live published note: guests see the typing every SAVE_DEBOUNCE_MS, not only after a pause.
  if (timer && getNotePublish(ydoc)?.live) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(flush, SAVE_DEBOUNCE_MS);
});

// Cursors of a live published note: guests' come from React Native (sealed and opened there),
// this phone's go to it while the note is live.
const awareness = new Awareness(ydoc);
awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
  if (origin === REMOTE || !getNotePublish(ydoc)?.live || ![...added, ...updated, ...removed].includes(ydoc.clientID)) return;
  post({ type: 'liveAwareness', update: toBase64(encodeAwarenessUpdate(awareness, [ydoc.clientID])) });
});

// The title is the doc's Y.Text 'title'; local edits reach React Native through the same
// ydoc 'update' listener as the body.
const titleInput = document.getElementById('title') as HTMLTextAreaElement;
const fitTitle = () => {
  titleInput.style.height = 'auto';
  titleInput.style.height = `${titleInput.scrollHeight}px`;
};
const bindTitle = () => {
  const text = getTitleText(ydoc);
  const show = () => {
    const value = text.toString();
    if (titleInput.value !== value) titleInput.value = value;
    fitTitle();
  };
  text.observe(show);
  show();
  titleInput.disabled = false;
  titleInput.addEventListener('input', () => {
    const value = titleInput.value.replace(/\r?\n/g, ' ');
    if (value !== titleInput.value) titleInput.value = value;
    setTitle(ydoc, value);
    fitTitle();
  });
  titleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      editor?.commands.focus('start');
    }
  });
};

// Note link labels: React Native sends the current title of every note (and the open note's id).
let titles: Record<string, string> = {};
// Where each note is (notebooks, tags, linking note), under titles in the note picker.
let places: Record<string, string> = {};
// Archived notes: not offered in the note picker.
let archivedIds = new Set<string>();
let currentNoteId: string | null = null;
// Set once the toolbar exists; math nodes and the insert menu open its LaTeX editor.
let openMathEditor: ((request: MathEditRequest) => void) | null = null;
let openReminderPicker: ((request: ReminderEditRequest) => void) | null = null;
let openCatalog: ((kind: 'notebooks' | 'tags') => void) | null = null;
let toolbarApi: ReturnType<typeof createToolbar> | null = null;
let findBar: ReturnType<typeof createFindBar> | null = null;
let editorPrefs: EditorPrefs = parseEditorPrefs(null);
// Kept for when the toolbar exists (the settings may arrive before the note).
let toolbarConfig: ReturnType<typeof parseToolbarConfig> = null;
let tableToolbarConfig: ReturnType<typeof parseToolbarConfig> = null;
let drawingToolbarConfig: ReturnType<typeof parseToolbarConfig> = null;
// The pen kind, colours and widths React Native keeps; read once (later changes start here).
let drawingToolsText: string | null = null;
let drawingBar: ReturnType<typeof createDrawingBar> | null = null;

// Notebook and tag names, sent by React Native (it owns the catalog and creates entries).
type Entry = { id: string; name: string };
let catalog: { notebooks: Entry[]; tags: Entry[] } = { notebooks: [], tags: [] };
const entryRequests = new Map<string, (entry: Entry | null) => void>();
let requestCounter = 0;
const createEntry = (kind: 'notebooks' | 'tags', name: string): Promise<Entry | null> => new Promise((resolve) => {
  const requestId = String(++requestCounter);
  entryRequests.set(requestId, resolve);
  post({ type: 'createEntry', kind, name, requestId });
});


// Notebooks and tags above the title. Tap: show that notebook / tag in the list. Long press:
// change them (like a right click on the desktop chips).
const chips = document.getElementById('chips')!;
const chipIcon = (path: string) => `<svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><path d="${path}" fill="currentColor"/></svg>`;
const renderChips = () => {
  const notebooks = getNoteNotebooks(ydoc).map((id) => catalog.notebooks.find((n) => n.id === id)).filter((n): n is Entry => !!n);
  const tags = getNoteTags(ydoc).map((id) => catalog.tags.find((t) => t.id === id)).filter((t): t is Entry => !!t);
  const chip = (icon: string, label: string, cls: string, onTap: () => void, kind: 'notebooks' | 'tags') => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `chip ${cls}`;
    // Icon paths are @mdi/js constants; the name goes in as text.
    el.innerHTML = chipIcon(icon);
    el.append(label);
    let timer: ReturnType<typeof setTimeout> | null = null;
    let long = false;
    el.addEventListener('pointerdown', () => { long = false; timer = setTimeout(() => { long = true; openCatalog?.(kind); }, 450); });
    el.addEventListener('pointerup', () => { if (timer) clearTimeout(timer); });
    el.addEventListener('pointercancel', () => { if (timer) clearTimeout(timer); });
    // The cursor (and the keyboard) stay where they are: the picker opens above them.
    el.addEventListener('mousedown', (e) => e.preventDefault());
    el.addEventListener('click', (e) => { e.preventDefault(); if (!long) onTap(); });
    return el;
  };
  chips.replaceChildren(
    ...notebooks.map((n) => chip(mdiBookOutline, n.name, '', () => post({ type: 'openView', view: { kind: 'notebook', id: n.id } }), 'notebooks')),
    ...(notebooks.length ? [] : [chip(mdiPlus, 'Notebook', 'chip-empty', () => openCatalog?.('notebooks'), 'notebooks')]),
    ...tags.map((t) => chip(mdiPound, t.name, 'chip-tag', () => post({ type: 'openView', view: { kind: 'tag', id: t.id } }), 'tags')),
    ...(tags.length ? [] : [chip(mdiPlus, 'Tag', 'chip-empty', () => openCatalog?.('tags'), 'tags')]),
  );
};

// Read only and spell check are note settings (changed from the note menu in React Native).
const applyNoteSettings = () => {
  if (!editor) return;
  const readOnly = getNoteFlag(ydoc, 'readOnly');
  if (editor.isEditable === readOnly) editor.setEditable(!readOnly);
  titleInput.readOnly = readOnly;
  const spellcheck = getNoteFlag(ydoc, 'noSpellcheck') ? 'false' : 'true';
  if (editor.view.dom.getAttribute('spellcheck') !== spellcheck) {
    // Changing it can drop the focus (and the keyboard): take it back.
    const focused = editor.isFocused;
    editor.view.dom.setAttribute('spellcheck', spellcheck);
    if (focused) setTimeout(() => editor?.commands.focus(), 0);
  }
};

// Flags, dates, notebooks and tags for the note menu in React Native.
const reportNoteState = () => post({
  type: 'noteState',
  flags: {
    pinned: getNoteFlag(ydoc, 'pinned'), favorite: getNoteFlag(ydoc, 'favorite'), archived: getNoteFlag(ydoc, 'archived'),
    readOnly: getNoteFlag(ydoc, 'readOnly'), noSpellcheck: getNoteFlag(ydoc, 'noSpellcheck'),
  },
  trashed: getNoteTrashedAt(ydoc) !== null,
  created: getNoteCreated(ydoc),
  notebooks: getNoteNotebooks(ydoc),
  tags: getNoteTags(ydoc),
  published: getNotePublish(ydoc),
  locked: typeof getNoteSettings(ydoc).get('locked') === 'string',
});
const NOTE_FLAGS = new Set(['pinned', 'favorite', 'archived', 'readOnly', 'noSpellcheck']);

// Note menu "Attached files": the files and images of the note, in order.
const reportAttachments = () => {
  const list: { kind: 'file' | 'image'; blob: string; name: string; size: number | null }[] = [];
  let images = 0;
  editor?.state.doc.descendants((node) => {
    const blob = node.attrs.blob;
    if (typeof blob !== 'string' || !blob.includes(':')) return true;
    if (node.type.name === 'attachment') {
      const size = Number(node.attrs.size);
      list.push({ kind: 'file', blob, name: String(node.attrs.name || 'File'), size: Number.isFinite(size) ? size : null });
    } else if (node.type.name === 'image') {
      images++;
      list.push({ kind: 'image', blob, name: node.attrs.alt || `Image ${images}`, size: null });
    }
    return false;
  });
  post({ type: 'attachments', list });
};
const attachmentAction = (action: string, blob: string, name: string) => {
  if (!editor) return;
  let at = -1;
  editor.state.doc.descendants((node, pos) => {
    if (at < 0 && node.attrs.blob === blob) at = pos;
    return at < 0;
  });
  if (action === 'show') {
    if (at < 0) return;
    editor.commands.setNodeSelection(at);
    (editor.view.nodeDOM(at) as HTMLElement | null)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return;
  }
  const ref = parseBlobRef(blob);
  if (!ref) return;
  const image = at >= 0 && editor.state.doc.nodeAt(at)?.type.name === 'image';
  handFile(action === 'open' ? 'openFile' : 'saveFile', ref, image ? 'image' : name)
    .catch((e) => post({ type: 'alert', text: e instanceof Error ? e.message : String(e) }));
};

// Undo / redo arrows in the native header are greyed out when there is nothing to undo / redo.
let lastHistory = '';
const reportHistory = () => {
  if (!editor) return;
  const state = { undo: editor.can().undo(), redo: editor.can().redo() };
  const key = `${state.undo}:${state.redo}`;
  if (key === lastHistory) return;
  lastHistory = key;
  post({ type: 'history', ...state });
};

// Tapping a note link asks React Native to open that note.
document.addEventListener('click', (e) => {
  const link = (e.target as HTMLElement | null)?.closest?.('[data-note-link]');
  const id = link?.getAttribute('data-note-id');
  if (id) {
    e.preventDefault();
    post({ type: 'openNote', id });
  }
});

// Images: React Native fetches the sealed bytes (it holds the auth token), this page decrypts
// them with the blob key stored in the note and shows them as object URLs.
const blobWaiters = new Map<string, ((data: string | null, error?: boolean) => void)[]>();
const fetchSealed = (id: string): Promise<string | null> => new Promise((resolve, reject) => {
  const waiters = blobWaiters.get(id) ?? [];
  waiters.push((data, error) => (error ? reject(new Error('Blob fetch failed')) : resolve(data)));
  blobWaiters.set(id, waiters);
  if (waiters.length === 1) post({ type: 'blob', id });
});
// Decrypted images only while they are shown (blob-url-cache.ts): phones have little memory.
const blobKeys = new Map<string, string>();
const blobImages = createBlobUrlCache(async (id) => {
  const key = blobKeys.get(id);
  const data = await fetchSealed(id);
  if (!data || !key) return null;
  return new Blob([unsealBytes(base64ToBytes(key), base64ToBytes(data)) as BlobPart]);
});
const resolveBlob = (ref: BlobRef): Promise<string | null> => {
  blobKeys.set(ref.id, ref.key);
  return blobImages.acquire(ref.id);
};
const releaseBlob = (ref: BlobRef) => blobImages.release(ref.id);

// Requests answered by React Native ({requestId} in, {type: 'reply', requestId} back).
const replies = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void }>();
let replyCounter = 0;
const askReactNative = <T,>(msg: Record<string, unknown>): Promise<T> => new Promise<T>((resolve, reject) => {
  const requestId = `q${++replyCounter}`;
  replies.set(requestId, { resolve, reject });
  post({ ...msg, requestId });
});

// A random UUID (v4). The page is not a secure context, so there is no crypto.randomUUID.
const uuid = (): string => {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

// New images (picked on the phone, or downloaded by React Native from a URL): sealed here with
// their own random key (the key stays in the note), handed to React Native as sealed bytes
// for the upload queue, shown at once from the plain bytes.
const MAX_IMAGE_BYTES = 30 * 1024 * 1024 - 40;
const storeImage = async (bytes: Uint8Array, type = 'image/webp'): Promise<BlobRef> => {
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error(`${type.startsWith('image/') ? 'Image' : 'File'} is larger than 30 MB`);
  const id = uuid();
  const key = generateKey();
  await askReactNative({ type: 'storeBlob', id, data: bytesToBase64(sealBytes(key, bytes)) });
  blobKeys.set(id, bytesToBase64(key));
  blobImages.put(id, new Blob([bytes as BlobPart], { type }));
  return { id, key: bytesToBase64(key) };
};

// The decrypted bytes of a blob, to React Native (open in another app / save).
const handFile = async (type: 'openFile' | 'saveFile', ref: BlobRef, name: string): Promise<void> => {
  const url = await resolveBlob(ref);
  if (!url) throw new Error('This file is not downloaded yet (the device that added it has not uploaded it).');
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  } finally {
    releaseBlob(ref);
  }
  await askReactNative({ type, name, data: bytesToBase64(bytes) });
};

// Settings > Backup > compare: this note as it was in a backup, next to the note now.
let pendingBackup: { state: string; createdAt?: number } | null = null;
function showBackup(msg: { state: string; createdAt?: number }) {
  if (!editor) return;
  flush();
  const state = fromBase64(msg.state);
  const backupDoc = new Y.Doc();
  Y.applyUpdate(backupDoc, state);
  const at = Number(msg.createdAt) || 0;
  const day = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  showHistoryView({
    state, startedAt: at, endedAt: at, current: { editor, ydoc }, titles,
    prepareEditor: (e) => { setNoteTitles(e, titles); configureBlobs(e, { resolve: resolveBlob, release: releaseBlob }); },
    onRestore: () => {},
    onSaveCopy: () => {},
    whenText: `Backup of ${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())} ${pad(day.getHours())}:${pad(day.getMinutes())}`,
    oldLabel: 'In the backup',
    actions: [
      // Normal edits: saved, synced, and Ctrl+Z / undo can take them back.
      { icon: mdiBackupRestore, label: 'As in the backup', run: (old) => {
        editor?.commands.setContent(old.json);
        setTitle(ydoc, old.title);
        if (!getNoteSettings(backupDoc).get('trashedAt')) setNoteTrashed(ydoc, false);
      } },
      { icon: mdiCallMerge, label: 'Merge both', run: () => { mergeWithBackup(ydoc, backupDoc); } },
    ],
  });
  // React Native uncovers the page now.
  requestAnimationFrame(() => post({ type: 'backupShown' }));
}

// Whole-note font (set on desktop for now); content.css styles [data-note-font].
const bindNoteFont = () => {
  const apply = () => {
    const font = getNoteFont(ydoc);
    if (font) document.body.setAttribute('data-note-font', font);
    else document.body.removeAttribute('data-note-font');
  };
  getNoteSettings(ydoc).observe(apply);
  apply();
};

const startEditor = () => {
  if (editor) return;
  editor = new Editor({
    element: document.getElementById('editor')!,
    extensions: [
      // Others' cursors (live published notes; never locked ones, whose body is another doc).
      ...(bodyDoc ? [] : [CollaborationCaret.configure({ provider: { awareness }, user: { name: 'Owner', color: '#6750a4' } })]),
      ...createSchemaExtensions({
        ydoc: bodyDoc ?? ydoc,
        placeholder: 'Start typing...',
        onEditMath: (request) => openMathEditor?.(request),
        onEditReminder: (request) => openReminderPicker?.(request),
      }),
      // "/notebook" and "/tag" in the insert menu.
      NoteActions.configure({
        onRequest: (request) => {
          if (request.kind === 'export') toolbarApi?.openExport();
          else if (request.kind === 'goto' || request.kind === 'linkto') toolbarApi?.openNotePicker(request.kind);
          else if (request.kind === 'publish') post({ type: 'openPublish' });
          else openCatalog?.(request.kind === 'notebook' ? 'notebooks' : 'tags');
        },
      }),
      // "/" in the text: the toolbar shows the insert menu, searched as you type.
      SlashCommands.configure({
        suggestion: {
          render: () => ({
            onStart: (props: any) => toolbarApi?.slash.onStart(props),
            onUpdate: (props: any) => toolbarApi?.slash.onUpdate(props),
            onKeyDown: (props: any) => toolbarApi?.slash.onKeyDown(props) ?? false,
            onExit: () => toolbarApi?.slash.onExit(),
          }),
        },
      }),
    ],
    // The toolbar keeps the cursor line in the middle of the screen (toolbar.ts), so the
    // editor's own scrolling only needs a small margin.
    // ProseMirror does not know what the keyboard covers; toolbar.ts does all the scrolling
    // (typewriter centring, selection edges), so the two never fight.
    editorProps: {
      handleScrollToSelection: () => true,
      // Pasted / dropped files (an image copied in the gallery, Gboard's image paste, a drag
      // from another app in split screen) become sealed blobs like on the desktop. Images
      // inside pasted web content are downloaded (React Native fetches them) right after.
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []);
        if (files.length === 0) {
          setTimeout(() => { if (editor) importImages(editor).catch((err) => console.error('Image import failed:', err)); }, 300);
          return false;
        }
        event.preventDefault();
        if (editor) insertFiles(editor, files);
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        if (moved || !event.dataTransfer || !editor) return false;
        const files = Array.from(event.dataTransfer.files);
        if (files.length === 0) return false;
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY });
        event.preventDefault();
        insertFiles(editor, files, pos?.pos);
        return true;
      },
    },
  });
  // Word count above the title, like Notesnook.
  const wordCount = document.getElementById('wordcount')!;
  const countWords = () => {
    const words = (editor!.getText().match(/\S+/g) ?? []).length;
    wordCount.textContent = `${words} ${words === 1 ? 'word' : 'words'}`;
  };
  editor.on('update', countWords);
  countWords();
  const toolbar = createToolbar(editor, {
    titles: () => titles,
    places: () => places,
    archived: () => archivedIds,
    currentNoteId: () => currentNoteId,
    noteFont: () => getNoteFont(ydoc) ?? 'sans',
    setNoteFont: (font) => setNoteFont(ydoc, font === 'sans' ? null : font),
    catalog: () => catalog,
    noteNotebooks: () => getNoteNotebooks(ydoc),
    noteTags: () => getNoteTags(ydoc),
    toggleNotebook: (id) => setNoteNotebook(ydoc, id, !getNoteNotebooks(ydoc).includes(id)),
    toggleTag: (id) => setNoteTag(ydoc, id, !getNoteTags(ydoc).includes(id)),
    createEntry,
    createNote: async (title) => {
      const reply = await askReactNative<{ id: string } | null>({ type: 'createNote', title, notebooks: getNoteNotebooks(ydoc) });
      if (!reply?.id) return null;
      // The link shows the title at once (React Native sends the full list later).
      titles = { ...titles, [reply.id]: title };
      if (editor) setNoteTitles(editor, titles);
      return reply.id;
    },
    openUrl: (href) => post({ type: 'openUrl', href }),
    copy: (text) => post({ type: 'copy', text }),
    openNote: (id) => post({ type: 'openNote', id }),
    linkFrom: (id, title) => post({ type: 'linkFrom', target: id, title }),
    openSplit: (id, side) => post({ type: 'openSplit', id, side }),
    exportNote: (format, share) => { exportCurrent(format, share); },
    expectKeyboard: () => post({ type: 'expectKeyboard' }),
  });
  toolbarApi = toolbar;
  drawingBar = createDrawingBar(editor, { pickColor: toolbar.pickColor, saveTools: (text) => post({ type: 'drawingTools', text }) });
  drawingBar.setConfig(drawingToolbarConfig);
  if (drawingToolsText) restoreDrawingTools(editor, drawingToolsText);
  // The S Pen above the screen, from the native side (plugins/with-stylus.js): eraser ring.
  (window as unknown as { __notedPenHover?: (x: number | null, y: number, sideButton: boolean) => void }).__notedPenHover = (x, y, sideButton) => {
    if (editor) showPenHover(editor, x, y, sideButton);
  };
  toolbar.setToolbarConfig(toolbarConfig, tableToolbarConfig);
  openMathEditor = toolbar.openMathEditor;
  openReminderPicker = toolbar.openReminderPicker;
  openCatalog = toolbar.openCatalog;
  getNoteSettings(ydoc).observe(renderChips);
  getNoteTagMap(ydoc).observe(renderChips);
  getNoteNotebookMap(ydoc).observe(renderChips);
  renderChips();
  getNoteSettings(ydoc).observe(applyNoteSettings);
  applyNoteSettings();
  getNoteSettings(ydoc).observe(reportNoteState);
  getNoteTagMap(ydoc).observe(reportNoteState);
  getNoteNotebookMap(ydoc).observe(reportNoteState);
  reportNoteState();
  editor.on('transaction', () => setTimeout(reportHistory, 0));
  reportHistory();
  findBar = createFindBar(editor);
  // "Update automatically" (published notes): a while after the last edit of the text or the
  // title, the copy is sealed here and React Native uploads it. Closing the note sends a
  // pending update at once (flush).
  editor.on('update', scheduleAutoPublish);
  // Settings > Editor "Default title": an untitled note gets one once it has text.
  editor.on('update', () => applyDefaultTitle(ydoc, editorPrefs.titleTemplate));
  // Split view: React Native gives the note being typed in more room above the keyboard.
  editor.on('focus', () => post({ type: 'editorFocus' }));
  setLigatures(editor, editorPrefs.ligatures);
  setCodeThemeByLanguage(editor, editorPrefs.codeThemeByLanguage);
  setReminderTimes(editor, { morning: editorPrefs.reminderMorning, evening: editorPrefs.reminderEvening });
  getTitleText(ydoc).observe(scheduleAutoPublish);
  setNoteTitles(editor, titles);
  configureBlobs(editor, {
    resolve: resolveBlob,
    release: releaseBlob,
    upload: async (file) => {
      // HEIC (the camera's photos): Chromium cannot decode it, React Native makes a JPEG.
      if (isHeicFile(file)) {
        const { data } = await askReactNative<{ data: string }>({ type: 'convertHeic', data: toBase64(new Uint8Array(await file.arrayBuffer())) });
        file = new File([fromBase64(data) as BlobPart], file.name.replace(/\.(heic|heif)$/i, '') + '.jpg', { type: 'image/jpeg' });
      }
      const { bytes, type } = await compressImageBytes(file);
      return storeImage(bytes, type);
    },
    storeBytes: (bytes) => storeImage(bytes),
    storeUrl: async (url) => {
      const { data, mime, name } = await askReactNative<{ data: string; mime: string; name: string }>({ type: 'fetchUrl', url });
      const compressed = await compressImageBytes(new File([fromBase64(data) as BlobPart], name || 'image', { type: mime || 'image/png' }));
      return storeImage(compressed.bytes, compressed.type);
    },
    // Attachments: stored as they are; opening / saving hands the decrypted bytes to React Native.
    uploadFile: async (file) => storeImage(new Uint8Array(await file.arrayBuffer()), file.type || 'application/octet-stream'),
    openFile: (ref, name) => handFile('openFile', ref, name),
    saveFile: (ref, name) => handFile('saveFile', ref, name),
    notify: (text) => post({ type: 'alert', text }),
  });
  bindTitle();
  bindNoteFont();
};

const receive = (raw: string) => {
  const msg = JSON.parse(raw);
  if (msg.type === 'init') {
    if (msg.state) Y.applyUpdate(ydoc, fromBase64(msg.state), REMOTE);
    if (msg.lockedBody && typeof msg.lockedBody === 'object') {
      bodyDoc = new Y.Doc();
      setNoteBodyJson(bodyDoc, msg.lockedBody);
      bodyDoc.on('update', () => {
        if (lockedTimer) clearTimeout(lockedTimer);
        lockedTimer = setTimeout(flushLocked, 600);
      });
    }
    startEditor();
    if (pendingBackup) {
      const waiting = pendingBackup;
      pendingBackup = null;
      // After the collaboration binding filled the editor.
      setTimeout(() => showBackup(waiting), 150);
    }
  } else if (msg.type === 'remote') {
    if (editor && msg.state) Y.applyUpdate(ydoc, fromBase64(msg.state), REMOTE);
  } else if (msg.type === 'blobData') {
    const waiters = blobWaiters.get(msg.id) ?? [];
    blobWaiters.delete(msg.id);
    for (const done of waiters) done(msg.data ?? null, !!msg.error);
  } else if (msg.type === 'undo') {
    editor?.commands.undo();
  } else if (msg.type === 'redo') {
    editor?.commands.redo();
  } else if (msg.type === 'titles') {
    titles = msg.titles ?? {};
    places = msg.places ?? {};
    archivedIds = new Set(Array.isArray(msg.archived) ? msg.archived : []);
    currentNoteId = typeof msg.currentId === 'string' ? msg.currentId : currentNoteId;
    if (editor) setNoteTitles(editor, titles);
  } else if (msg.type === 'catalog') {
    catalog = { notebooks: msg.notebooks ?? [], tags: msg.tags ?? [] };
    if (editor) renderChips();
  } else if (msg.type === 'entryCreated') {
    entryRequests.get(msg.requestId)?.(msg.entry ?? null);
    entryRequests.delete(msg.requestId);
  } else if (msg.type === 'flush') {
    flush();
    if (autoPublishTimer) {
      // The note is closing: React Native waits for this update before removing the page.
      clearTimeout(autoPublishTimer);
      post({ type: 'autoPublishStarted' });
      autoPublish();
    }
  } else if (msg.type === 'back') {
    // Back closes what is open on the page (picture viewer, history, find bar, a sheet) before
    // the note itself.
    const viewer = document.querySelector('.niv');
    const history = document.querySelector('.history-view');
    let handled = true;
    if (viewer) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    else if (history) (history as HTMLElement & { closeView?: () => void }).closeView?.();
    else if (findBar?.isOpen()) findBar.close();
    else handled = toolbarApi?.back() ?? false;
    post({ type: 'backResult', handled });
  } else if (msg.type === 'keyboard') {
    toolbarApi?.setKeyboard(Number(msg.inset) || 0, typeof msg.shown === 'boolean' ? msg.shown : undefined);
  } else if (msg.type === 'reply' && typeof msg.requestId === 'string') {
    const waiter = replies.get(msg.requestId);
    replies.delete(msg.requestId);
    if (msg.error) waiter?.reject(new Error(String(msg.error)));
    else waiter?.resolve(msg.value ?? null);
  } else if (msg.type === 'openCatalog' && (msg.kind === 'notebooks' || msg.kind === 'tags')) {
    openCatalog?.(msg.kind);
  } else if (msg.type === 'listAttachments') {
    reportAttachments();
  } else if (msg.type === 'attachmentAction' && typeof msg.blob === 'string') {
    attachmentAction(String(msg.action), msg.blob, String(msg.name ?? 'file'));
  } else if (msg.type === 'setFlag' && NOTE_FLAGS.has(msg.flag)) {
    // Note menu changes go into this doc, so they are saved like any other edit.
    setNoteFlag(ydoc, msg.flag as NoteFlag, !!msg.on);
  } else if (msg.type === 'setTrashed') {
    setNoteTrashed(ydoc, !!msg.on);
    flush();
  } else if (msg.type === 'deleteForever') {
    deleteNoteForever(ydoc);
    flush();
  } else if (msg.type === 'liveAwareness' && typeof msg.update === 'string') {
    try {
      applyAwarenessUpdate(awareness, fromBase64(msg.update), REMOTE);
    } catch {
      // not a cursor
    }
  } else if (msg.type === 'livePasswordKey' && typeof msg.key === 'string' && typeof msg.password === 'string') {
    // Live link with a password: PBKDF2 is much faster here than in Hermes.
    let key: string | null = null;
    try {
      key = toBase64(publishPasswordKey(fromBase64(msg.key), msg.password));
    } catch (e) {
      console.warn('Password key failed:', e);
    }
    post({ type: 'livePasswordKey', key });
  } else if (msg.type === 'getPublishPayload' && editor && msg.info && typeof msg.info.key === 'string') {
    // The copy of the note, sealed for the link (and the password): React Native uploads it.
    const ed = editor;
    buildPublishedNote(ed.view.dom as HTMLElement).then(
      ({ html, css }) => {
        const sealed = sealPublished({ title: getTitleText(ydoc).toString().trim(), html, css, font: getNoteFont(ydoc) }, msg.info);
        post({ type: 'publishSealed', data: bytesToBase64(sealed) });
      },
      (err) => { post({ type: 'log', message: `Publish failed: ${String(err)}` }); post({ type: 'publishSealed' }); },
    );
  } else if (msg.type === 'setPublish') {
    // Saved like any edit, so the link reaches the other devices.
    const info = msg.info;
    setNotePublish(ydoc, info && typeof info.id === 'string' && typeof info.key === 'string' && typeof info.at === 'number' ? {
      id: info.id, key: info.key, at: info.at, password: typeof info.password === 'string' ? info.password : null, selfDestruct: info.selfDestruct === true,
      autoUpdate: info.autoUpdate === true, expiresAt: typeof info.expiresAt === 'number' ? info.expiresAt : null,
      // Live published (sync/live.ts): without these the note was saved as not live.
      ...(info.live === true ? { live: true, editable: info.editable === true, passwordKey: typeof info.passwordKey === 'string' ? info.passwordKey : null } : {}),
    } : null);
    flush();
  } else if (msg.type === 'editorPrefs') {
    // Settings > Editor and Settings > Toolbar of this phone.
    editorPrefs = parseEditorPrefs(JSON.stringify(msg.prefs ?? {}));
    for (const [name, value] of Object.entries(editorPrefsCssVars(editorPrefs))) document.documentElement.style.setProperty(name, value);
    if (editor) {
      setLigatures(editor, editorPrefs.ligatures);
      setCodeThemeByLanguage(editor, editorPrefs.codeThemeByLanguage);
      setReminderTimes(editor, { morning: editorPrefs.reminderMorning, evening: editorPrefs.reminderEvening });
    }
    toolbarConfig = parseToolbarConfig(JSON.stringify(msg.toolbar ?? null));
    tableToolbarConfig = parseToolbarConfig(JSON.stringify(msg.tableToolbar ?? null));
    toolbarApi?.setToolbarConfig(toolbarConfig, tableToolbarConfig);
    drawingToolbarConfig = parseToolbarConfig(JSON.stringify(msg.drawingToolbar ?? null));
    drawingBar?.setConfig(drawingToolbarConfig);
    if (typeof msg.drawingTools === 'string' && drawingToolsText === null) {
      drawingToolsText = msg.drawingTools;
      if (editor) restoreDrawingTools(editor, drawingToolsText);
    }
  } else if (msg.type === 'theme' && msg.colors && typeof msg.colors.background === 'string') {
    applyColors({ ...DEFAULT_THEME, ...msg.colors });
  } else if (msg.type === 'refocus') {
    // Back from the note menu: the cursor (and the keyboard) where they were.
    toolbarApi?.refocus();
  } else if (msg.type === 'find') {
    findBar?.open();
  } else if (msg.type === 'export' && ['markdown', 'text', 'pdf'].includes(msg.format)) {
    exportCurrent(msg.format, !!msg.share);
  } else if (msg.type === 'showHistory' && typeof msg.state === 'string' && editor) {
    flush();
    const state = fromBase64(msg.state);
    showHistoryView({
      state, startedAt: Number(msg.startedAt) || 0, endedAt: Number(msg.endedAt) || 0,
      current: { editor, ydoc }, titles,
      prepareEditor: (e) => { setNoteTitles(e, titles); configureBlobs(e, { resolve: resolveBlob, release: releaseBlob }); },
      // A normal edit: it is saved, synced and can be undone.
      onRestore: (content, title) => {
        editor?.commands.setContent(content);
        setTitle(ydoc, title);
      },
      onSaveCopy: () => post({ type: 'historyCopy', state: msg.state }),
    });
  } else if (msg.type === 'showBackup' && typeof msg.state === 'string') {
    // React Native may ask before the note arrived (init is sent after reading the store):
    // then it is shown once the editor exists.
    if (editor) showBackup(msg);
    else pendingBackup = msg;
  } else if (msg.type === 'getText') {
    // Copy / share from the note menu: the title and the text of the note.
    const title = getTitleText(ydoc).toString().trim();
    const body = editor?.getText({ blockSeparator: '\n' }) ?? '';
    post({ type: 'text', purpose: msg.purpose, title, text: title ? `${title}\n\n${body}` : body });
  }
};

// ---- export (note menu): Markdown, plain text, or HTML that React Native prints to a PDF ----
const blobToDataUrl = (url: string): Promise<string> => fetch(url).then((r) => r.blob()).then((blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
}));
const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
// Light colours for paper, whatever the app's theme is.
const PRINT_CSS = `
  :root { color-scheme: light; --text-main: #1b1b1f; --text-muted: #5f5f66; --bg-base: #ffffff; --bg-surface: #f3f3f5;
    --bg-surface-low: #f7f7f9; --bg-surface-high: #ececef; --bg-surface-highest: #e4e4e8; --border: #cfcfd6; --primary: #6750a4; }
  html, body { background: #fff; color: #1b1b1f; margin: 0; padding: 0; }
  body { padding: 0 8px; font-family: var(--font-sans); }
  .export-title { font-size: 1.9em; font-weight: 700; margin: 0 0 16px; }
  .ProseMirror { outline: none; }
  .ProseMirror img { max-width: 100%; }
  .ProseMirror input[type=checkbox] { pointer-events: none; }
`;
const exportHtml = async (): Promise<string> => {
  const clone = editor!.view.dom.cloneNode(true) as HTMLElement;
  clone.removeAttribute('contenteditable');
  clone.querySelectorAll('[contenteditable]').forEach((el) => el.removeAttribute('contenteditable'));
  clone.querySelectorAll('.is-empty, .ProseMirror-trailingBreak, .ProseMirror-separator').forEach((el) => el.classList.remove('is-empty'));
  // Decrypted images are object URLs of this page: the PDF printer needs the bytes inline.
  await Promise.all([...clone.querySelectorAll('img')].map(async (img) => {
    const src = img.getAttribute('src') ?? '';
    if (src.startsWith('blob:')) img.setAttribute('src', await blobToDataUrl(src).catch(() => ''));
  }));
  const styles = [...document.querySelectorAll('style')].map((s) => s.textContent ?? '').join('\n');
  const font = document.body.getAttribute('data-note-font');
  const title = getTitleText(ydoc).toString().trim();
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title || 'Untitled')}</title>`
    + `<style>${styles}</style><style>${PRINT_CSS}</style></head><body${font ? ` data-note-font="${escapeHtml(font)}"` : ''}>`
    + `<div class="export-title note-title">${escapeHtml(title || 'Untitled')}</div>${clone.outerHTML}</body></html>`;
};
const exportCurrent = async (format: 'markdown' | 'text' | 'pdf', share = false) => {
  if (!editor) return;
  const title = getTitleText(ydoc).toString();
  try {
    if (format === 'pdf') {
      post({ type: 'exported', format, share, name: exportFileName(title, 'pdf'), html: await exportHtml() });
    } else {
      const json = editor.getJSON();
      const text = exportNote(title, json, format, titles);
      // Markdown: React Native zips it with the decrypted files when the note has any
      // (the toolbar sheet and the note menu both come here).
      const files = format === 'markdown' ? { title, json, titles } : undefined;
      post({ type: 'exported', format, share, name: exportFileName(title, format === 'markdown' ? 'md' : 'txt'), text, files });
    }
  } catch (err) {
    post({ type: 'log', message: `Export failed: ${err instanceof Error ? err.message : String(err)}` });
  }
};

let autoPublishTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleAutoPublish() {
  if (!getNotePublish(ydoc)?.autoUpdate) return;
  if (autoPublishTimer) clearTimeout(autoPublishTimer);
  autoPublishTimer = setTimeout(autoPublish, AUTO_PUBLISH_DELAY_MS);
}
function autoPublish() {
  autoPublishTimer = null;
  const earlier = getNotePublish(ydoc);
  if (!editor || !earlier?.autoUpdate || (earlier.expiresAt && earlier.expiresAt <= Date.now())) return;
  const info = { ...earlier, at: Date.now() };
  buildPublishedNote(editor.view.dom as HTMLElement).then(({ html, css }) => {
    const sealed = sealPublished({ title: getTitleText(ydoc).toString().trim(), html, css, font: getNoteFont(ydoc) }, info);
    post({ type: 'autoPublish', data: bytesToBase64(sealed), info });
  }, (err) => {
    post({ type: 'log', message: `Automatic publish failed: ${String(err)}` });
    post({ type: 'autoPublishFailed' });
  });
}

(window as any).__noted = { receive };
window.addEventListener('error', (e) => post({ type: 'log', message: String(e.message) }));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) flush();
});
post({ type: 'ready' });
