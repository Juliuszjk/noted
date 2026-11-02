import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as Y from 'yjs';
import { generateJSON } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import { NoteEditor } from '@noted/ui/src/NoteEditor';
import { buildNoteHtmlFile, buildPublishedNote } from '@noted/ui/src/publish-html';
import { createSchemaExtensions } from '@noted/editor/extensions';
import { buildSheets, mountPrintSheets } from '@noted/editor/pdf-sheets';
import type { BlobHandlers, BlobRef } from '@noted/editor/blob-image';
import { insertFiles } from '@noted/editor/blob-image';
import { compressImageBytes } from '@noted/media';
import { bytesToBase64, createVerifier, deriveAuthToken } from '@noted/crypto';
import { configureServerStorage, setServerAddress } from '@noted/config';
import { getNoteFont, getTitleText, setNoteFont, setTitle } from '@noted/sync/note-meta';
import { setNoteBodyJson } from '@noted/sync/json-to-y';
import { deletePublished, publishedUrl, uploadPublished } from '@noted/sync/publish';
import type { PublishOptions } from '@noted/sync/publish';
import { publishLive } from '@noted/sync/live-owner';
import { resolveTheme, themeToCssVars } from '@noted/theme';
import { sheetSummary } from './measure';
import { FIXTURES } from './fixtures';

// The page the release pipeline drives (apps/release-check): the shared NoteEditor as the
// desktop app mounts it, with blobs kept in memory, and the app's own PDF, HTML export and
// publishing code behind `window.__h`. No server address is built in: publishing talks only
// to the throwaway local server a test names.

for (const [name, value] of Object.entries(themeToCssVars(resolveTheme('light', null, false)))) {
  document.documentElement.style.setProperty(name, value);
}
if (/AppleWebKit/.test(navigator.userAgent) && !/Chrome|Chromium/.test(navigator.userAgent)) document.documentElement.classList.add('webkitgtk');

configureServerStorage(() => null, () => {});

// Blobs: a Map instead of the encrypted store.
const blobStore = new Map<string, { bytes: Uint8Array; type: string }>();
const blobUrls = new Map<string, string>();
let blobCounter = 0;
const remember = (bytes: Uint8Array, type: string): BlobRef => {
  const id = `00000000-0000-4000-8000-${String(++blobCounter).padStart(12, '0')}`;
  blobStore.set(id, { bytes, type });
  return { id, key: bytesToBase64(new Uint8Array(32)) };
};
const blobs: BlobHandlers = {
  upload: async (file) => {
    const { bytes, type } = await compressImageBytes(file);
    return remember(bytes, type);
  },
  uploadFile: async (file) => remember(new Uint8Array(await file.arrayBuffer()), file.type),
  resolve: async (ref) => {
    const known = blobUrls.get(ref.id);
    if (known) return known;
    const blob = blobStore.get(ref.id);
    if (!blob) return null;
    const url = URL.createObjectURL(new Blob([blob.bytes as BlobPart], { type: blob.type }));
    blobUrls.set(ref.id, url);
    return url;
  },
  release: () => {},
  saveFile: async () => {},
  openFile: async () => {},
  notify: (text) => console.warn(text),
};

const schemaExtensions = createSchemaExtensions({ ydoc: new Y.Doc(), placeholder: '' }).filter((e) => e.name !== 'collaboration');

// HTML parsing collapses runs of spaces: `~~` in a fixture stands for a typed double space.
const typedSpaces = (node: any) => {
  if (typeof node.text === 'string') node.text = node.text.replaceAll('~~', '  ');
  node.content?.forEach(typedSpaces);
  return node;
};

// A note's Y.Doc from HTML, stored the way the importer stores it.
const makeDoc = (html: string, title: string, font: string | null = null): Y.Doc => {
  const doc = new Y.Doc();
  setTitle(doc, title);
  if (font) setNoteFont(doc, font);
  setNoteBodyJson(doc, typedSpaces(generateJSON(html, schemaExtensions)));
  return doc;
};

interface Note { id: number; doc: Y.Doc; readOnly: boolean }
let show: (note: Note) => void = () => {};
let currentEditor: Editor | null = null;
let currentDoc: Y.Doc | null = null;
let noteCounter = 0;
let ready: ((editor: Editor) => void) | null = null;

function Harness() {
  const [note, setNote] = useState<Note | null>(null);
  useEffect(() => { show = setNote; (window as any).__harnessUp?.(); }, []);
  if (!note) return null;
  return (
    <main className="harness-note">
      <NoteEditor
        key={note.id}
        noteId={`note-${note.id}`}
        ydoc={note.doc}
        onUpdate={() => {}}
        blobs={blobs}
        readOnly={note.readOnly}
        onEditor={(editor) => {
          currentEditor = editor;
          if (editor) ready?.(editor);
        }}
      />
    </main>
  );
}

const up = new Promise<void>((resolve) => { (window as any).__harnessUp = resolve; });
createRoot(document.getElementById('root')!).render(<Harness />);

const need = (): Editor => {
  if (!currentEditor) throw new Error('No note is open');
  return currentEditor;
};

const open = async (html: string, title = 'Release check', options: { font?: string | null; readOnly?: boolean } = {}) => {
  await up;
  const doc = makeDoc(html, title, options.font ?? null);
  currentDoc = doc;
  const editor = await new Promise<Editor>((resolve) => {
    ready = resolve;
    show({ id: ++noteCounter, doc, readOnly: !!options.readOnly });
  });
  ready = null;
  // The collaboration binding fills the editor right after it is made.
  await new Promise((resolve) => setTimeout(resolve, 60));
  return editor.getText().length;
};

const bytesOf = (doc: Y.Doc) => bytesToBase64(Y.encodeStateAsUpdate(doc));

// One fixed test vault: creating it twice is fine, the server keeps the first.
const OWNER_KEY = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const owner = {
  connect: async (api: string, publicAddress: string, setupCode: string) => {
    setServerAddress({ api, public: publicAddress });
    const { ciphertext, nonce } = createVerifier(OWNER_KEY);
    const res = await fetch(`${api}/vault`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Setup-Code': setupCode },
      body: JSON.stringify({
        salt: bytesToBase64(new Uint8Array(16)),
        verifier: `${bytesToBase64(nonce)}.${bytesToBase64(ciphertext)}`,
        auth_token: bytesToBase64(deriveAuthToken(OWNER_KEY)),
      }),
    });
    if (!res.ok && res.status !== 409) throw new Error(`Vault setup failed (HTTP ${res.status})`);
  },
  // A static published copy, as the app makes it. Returns the link.
  publishStatic: async (options: Partial<PublishOptions> = {}) => {
    const editor = need();
    const doc = currentDoc!;
    const { html, css } = await buildPublishedNote(editor.view.dom as HTMLElement);
    const settings: PublishOptions = { password: options.password ?? null, selfDestruct: !!options.selfDestruct, expiresAt: options.expiresAt ?? null };
    const info = await uploadPublished(OWNER_KEY, { title: getTitleText(doc).toString(), html, css, font: getNoteFont(doc) }, null, settings);
    (window as any).__lastPublished = info;
    return { url: publishedUrl(info), id: info.id };
  },
  unpublishStatic: () => deletePublished(OWNER_KEY, (window as any).__lastPublished),
  publishLive: async (editable: boolean, password: string | null = null) => {
    const info = await publishLive(OWNER_KEY, currentDoc!, null, { password, selfDestruct: false, editable }, 0);
    return { url: publishedUrl(info), id: info.id };
  },
};

(window as any).__h = {
  open,
  openFixture: (name: keyof typeof FIXTURES) => open(FIXTURES[name].html, FIXTURES[name].title),
  editor: () => currentEditor,
  json: () => need().getJSON(),
  html: () => need().getHTML(),
  text: () => need().getText(),
  // Base64 Yjs state of a note: what React Native hands the phone's editor page.
  noteState: (html: string, title: string) => bytesOf(makeDoc(html, title)),
  fixtureState: (name: keyof typeof FIXTURES) => bytesOf(makeDoc(FIXTURES[name].html, FIXTURES[name].title)),
  // PDF: the sheets Save PDF prints.
  sheets: async () => {
    const editor = need();
    const sheets = await buildSheets(editor, getTitleText(currentDoc!).toString(), getNoteFont(currentDoc!));
    const box = document.createElement('div');
    box.className = 'harness-measure';
    box.append(...sheets);
    document.body.append(box);
    const summary = sheetSummary(sheets);
    box.remove();
    return summary;
  },
  // Puts the sheets where printing finds them, like savePdf in the desktop App.tsx.
  mountPrint: async () => {
    const editor = need();
    const sheets = await buildSheets(editor, getTitleText(currentDoc!).toString(), getNoteFont(currentDoc!));
    mountPrintSheets(sheets);
    return sheets.length;
  },
  htmlFile: () => {
    const editor = need();
    return buildNoteHtmlFile(editor.view.dom as HTMLElement, getTitleText(currentDoc!).toString(), getNoteFont(currentDoc!));
  },
  insertFile: async (name: string, type: string, text: string) => {
    const editor = need();
    const before = blobStore.size;
    insertFiles(editor, [new File([text], name, { type })]);
    for (let i = 0; i < 400 && blobStore.size === before; i++) await new Promise((r) => setTimeout(r, 25));
    return [...blobStore.values()].at(-1)?.type ?? null;
  },
  compress: async (name: string, type: string, text: string) => {
    const { bytes, type: out } = await compressImageBytes(new File([text], name, { type }));
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: out }));
    const img = new Image();
    img.src = url;
    await img.decode();
    return { type: out, width: img.naturalWidth, height: img.naturalHeight, bytes: bytes.length };
  },
  // A press and a tiny drag on the first fold arrow, made of DOM events (WebKitGTK's driver has
  // no mouse), with the cursor in "Gamma text": the selection must not move (1b1ac9a).
  foldPressProbe: async () => {
    const editor = need();
    let at = 0;
    editor.state.doc.descendants((node, pos) => { if (node.isText && node.text!.startsWith('Gamma')) at = pos + 3; });
    editor.commands.focus();
    editor.commands.setTextSelection(at);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const arrow = editor.view.dom.querySelector('.heading-toggle') as HTMLElement;
    const box = arrow.getBoundingClientRect();
    const point = { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2, bubbles: true, cancelable: true, composed: true, view: window };
    arrow.dispatchEvent(new MouseEvent('mousedown', { ...point, button: 0, buttons: 1, detail: 1 }));
    for (const step of [1, 2]) window.dispatchEvent(new MouseEvent('mousemove', { ...point, clientX: point.clientX + step, buttons: 1 }));
    await new Promise((resolve) => setTimeout(resolve, 60));
    const native = document.getSelection();
    const result = { from: editor.state.selection.from, to: editor.state.selection.to, expected: at, nativeCollapsed: native?.isCollapsed ?? null, collapsedHeading: !!editor.state.doc.firstChild?.attrs.collapsed };
    window.dispatchEvent(new MouseEvent('mouseup', { ...point, button: 0 }));
    return result;
  },
  owner,
};
