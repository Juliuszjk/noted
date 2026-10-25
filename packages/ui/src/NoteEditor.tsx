import { useCallback, useEffect, useRef, useState } from 'react';
import { matchesShortcut, handleEditorShortcut } from './shortcuts';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useEditor, EditorContent } from '@tiptap/react';
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import {
  SlashCommands, NoteLinkSuggestion, createSchemaExtensions, normalizeLinkUrl, setNoteTitles,
  configureBlobs, insertFiles, pastedFilePaths, importImages, NoteActions, setCodeThemeByLanguage, setReminderTimes, requestReminderAtSelection,
} from '@noted/editor';
import type { AnyExtension, Editor } from '@tiptap/core';
import type { NoteActionRequest, SlashItem } from '@noted/editor';
import { slashItemsWithoutPublish } from '@noted/editor';
import type { BlobHandlers } from '@noted/editor';
import '@noted/editor/content.css';
import 'katex/dist/katex.min.css';
import * as Y from 'yjs';
import { SlashMenu } from './SlashMenu';
import { FormatMenu } from './FormatMenu';
import { TableMenu } from './TableMenu';
import { DrawingMenu } from './DrawingMenu';
import { LinkContextMenu } from './LinkContextMenu';
import { MathEditor } from './MathEditor';
import { ReminderEditor } from './ReminderEditor';
import { CalloutMenu } from './CalloutMenu';
import { ImageMenu } from './ImageMenu';
import { NoteTitle } from './NoteTitle';
import { NoteLinkMenu } from './NoteLinkMenu';
import { Backlinks } from './Backlinks';
import { ImageUrlPrompt } from './ImageUrlPrompt';
import { useNoteFont } from './note-font';
import { setNoteFont, setTitle } from '@noted/sync';
import type { JSONContent } from '@tiptap/core';
import { TopToolbar } from './TopToolbar';
import { FindBar } from './FindBar';
import { setLigatures, restoreDrawingTools, serializeDrawingTools, onDrawingChange } from '@noted/editor';
import type { ToolbarConfig } from '@noted/editor';
import { ExportDialog, printNote } from './ExportDialog';
import type { ExportFormat } from './ExportDialog';
import { exportNote, exportFileName } from '@noted/editor/export';
import { getTitleText, getNoteFont, getNotePublish, setNotePublish, getNoteSettings, publishedUrl, AUTO_PUBLISH_DELAY_MS } from '@noted/sync';
import { PublishDialog } from './PublishDialog';
import type { PublishSettings } from './PublishDialog';
import { buildPublishedNote, buildNoteHtmlFile } from './publish-html';
import { computeTextStats } from './StatusBar';
import type { TextStats } from './StatusBar';
import type { MathEditRequest, ReminderEditRequest, ReminderTimes } from '@noted/editor';
import type { LinkContextMenuState } from './LinkContextMenu';
import type { SlashMenuHandle, SlashMenuState } from './SlashMenu';

// What the editor knows about every note: for link labels, the "[[" picker and backlinks.
export interface NoteSummary {
  id: string;
  // Display title (falls back to the start of the text).
  title: string;
  // Ids of the notes it links to.
  links: string[];
  // Where it is (`notePlaces`), shown under the title in pickers.
  place?: string;
  // Left out of the "[[" menu.
  archived?: boolean;
}

// The editor the user worked in last (the split view has two), for undo / redo while nothing
// has the focus.
let lastUsedEditor: Editor | null = null;

export function NoteEditor({
  noteId, ydoc, onUpdate, onOpenLink, notes = [], onOpenNote, onCreateNote, blobs,
  toolbarMode = 'floating', toolbarSlot = null, tableMenuSlot = null, tableToolbarConfig = null, drawingMenuSlot = null, drawingToolbarConfig = null, drawingTools, onStats, fullWidth = false, readOnly = false, spellcheck = true,
  onNoteAction, restore, findSlot = null, onSaveExport, onPublish, toolbarConfig = null, ligatures = true, codeThemeByLanguage, reminderTimes,
  secondary = false, slashItems, noteLinks = true, extraExtensions = [],
}: {
  // Guests of a live note (apps/web): fewer insert menu entries, no "[[" note links, and
  // extensions of their own (other people's cursors).
  slashItems?: SlashItem[],
  noteLinks?: boolean,
  extraExtensions?: AnyExtension[],
  // The second editor of the split view: the app-wide events (export / publish from the
  // properties panel, "show in the note") are the main editor's; Ctrl+F only while typing here.
  secondary?: boolean,
  // Settings > Toolbar (top toolbar buttons and order) and Settings > Editor ligatures.
  toolbarConfig?: ToolbarConfig | null,
  ligatures?: boolean,
  // Settings > Editor: code colours for some languages.
  codeThemeByLanguage?: Record<string, string>,
  // Settings > Editor: morning / evening of the reminder picker's quick choices.
  reminderTimes?: ReminderTimes,
  // Where the find bar goes (top right under the toolbar).
  findSlot?: HTMLElement | null,
  // Saves an exported Markdown / text / HTML file (the app shows a save dialog).
  // `source`: the note itself, so the app can add its images and files (a zip like Notesnook's).
  onSaveExport?: (name: string, text: string, source?: { title: string; json: object; format: 'markdown' | 'text'; titles: Record<string, string> }) => void,
  // Publishes this copy of the note (or, with null, removes the published copy).
  onPublish?: (note: { title: string; html: string; css: string; font: string | null } | null, settings?: PublishSettings) => Promise<void>,
  // Layout of the page: the top toolbar aligns left with full-width text.
  fullWidth?: boolean,
  readOnly?: boolean,
  spellcheck?: boolean,
  // "/notebook" and "/tag" in the slash menu (screen position of the cursor).
  onNoteAction?: (request: NoteActionRequest, x: number, y: number) => void,
  // An older version to copy over the current content (bumped id = new request).
  restore?: { id: number; content: JSONContent; title: string } | null,
  noteId: string,
  ydoc: Y.Doc,
  // 'top': fixed toolbar rendered into toolbarSlot; 'floating': bubble over the selection.
  toolbarMode?: 'top' | 'floating',
  toolbarSlot?: HTMLElement | null,
  // Set: the table menu is a row in this element (under the toolbar) instead of floating.
  tableMenuSlot?: HTMLElement | null,
  // Settings > Toolbar > Table.
  tableToolbarConfig?: ToolbarConfig | null,
  // Set: the drawing menu floats under this element (under the toolbar) instead of at the drawing.
  drawingMenuSlot?: HTMLElement | null,
  // Settings > Toolbar > Drawing menu.
  drawingToolbarConfig?: ToolbarConfig | null,
  // Where this device keeps the pen kind, colours and widths (drawing.ts serializeDrawingTools).
  drawingTools?: { load: () => string | null; save: (text: string) => void },
  // Word/character/paragraph/space counts, after every change.
  onStats?: (stats: TextStats) => void,
  // Encrypted image storage of the platform. Without it images are read only.
  blobs?: BlobHandlers,
  notes?: NoteSummary[],
  // Opens another note in the app (note links, backlinks).
  onOpenNote?: (id: string) => void,
  // Creates a note with this title for "[[" and returns its id.
  onCreateNote?: (title: string) => Promise<string | null>,
  // Called after every local change of the body or the title; the doc holds both.
  onUpdate: (id: string, ydoc: Y.Doc) => void,
  // Opens a link outside the app (the desktop passes the Tauri opener). Ctrl/Cmd+click calls it.
  onOpenLink?: (href: string) => void,
}) {
  const [slash, setSlash] = useState<SlashMenuState | null>(null);
  const [noteLinkMenu, setNoteLinkMenu] = useState<SlashMenuState | null>(null);
  const noteLinkMenuRef = useRef<SlashMenuHandle>(null);
  const openNoteRef = useRef(onOpenNote);
  openNoteRef.current = onOpenNote;
  const [linkMenu, setLinkMenu] = useState<LinkContextMenuState | null>(null);
  // Bumped to ask the FormatMenu to open its link input (after "Edit link" selected the link).
  const [linkEditRequest, setLinkEditRequest] = useState(0);
  const closeLinkMenu = useCallback(() => setLinkMenu(null), []);
  const [mathEdit, setMathEdit] = useState<MathEditRequest | null>(null);
  const [reminderEdit, setReminderEdit] = useState<ReminderEditRequest | null>(null);
  const [imageUrlPos, setImageUrlPos] = useState<number | null>(null);
  // "Export note" dialog ("/export", or the properties panel through a window event).
  const [exportOpen, setExportOpen] = useState(false);
  useEffect(() => {
    const open = () => setExportOpen(true);
    if (secondary) return;
    window.addEventListener('noted:export', open);
    return () => window.removeEventListener('noted:export', open);
  }, []);
  const runExport = (format: ExportFormat) => {
    setExportOpen(false);
    const ed = editorRef.current;
    if (!ed) return;
    const title = getTitleText(ydoc).toString();
    if (format === 'pdf') return printNote(ed, title, getNoteFont(ydoc));
    if (format === 'html') {
      buildNoteHtmlFile(ed.view.dom as HTMLElement, title, getNoteFont(ydoc)).then(
        (html) => onSaveExport?.(exportFileName(title, 'html'), html),
        (e) => console.error('HTML export failed:', e),
      );
      return;
    }
    const titles = Object.fromEntries(notes.map((n) => [n.id, n.title]));
    const json = ed.getJSON();
    onSaveExport?.(exportFileName(title, format === 'markdown' ? 'md' : 'txt'), exportNote(title, json, format, titles), { title, json, format, titles });
  };
  // "Publish" dialog ("/publish", or the properties panel through a window event). The link
  // lives in the note settings, so it follows edits from other devices too.
  const [publishOpen, setPublishOpen] = useState(false);
  const [published, setPublished] = useState(() => getNotePublish(ydoc));
  useEffect(() => {
    const open = () => { if (!secondary) setPublishOpen(true); };
    window.addEventListener('noted:publish', open);
    const settings = getNoteSettings(ydoc);
    const update = () => setPublished(getNotePublish(ydoc));
    settings.observe(update);
    update();
    return () => { window.removeEventListener('noted:publish', open); settings.unobserve(update); };
  }, [ydoc]);
  const publishNow = async (settings: PublishSettings) => {
    const ed = editorRef.current;
    if (!ed || !onPublish) return;
    const { html, css } = await buildPublishedNote(ed.view.dom as HTMLElement);
    await onPublish({ title: getTitleText(ydoc).toString().trim(), html, css, font: getNoteFont(ydoc) }, settings);
  };
  // Find and replace bar (Ctrl+F or the toolbar's magnifier).
  const [findOpen, setFindOpen] = useState(false);
  // The bar lines up with the right edge of the note text (not of the window).
  const rootRef = useRef<HTMLDivElement>(null);
  const [findPlace, setFindPlace] = useState({ right: 16, width: 380 });
  useEffect(() => {
    if (!findOpen || !findSlot) return;
    const place = () => {
      const note = rootRef.current?.getBoundingClientRect();
      const slot = findSlot.getBoundingClientRect();
      if (!note) return;
      setFindPlace({ right: Math.max(8, Math.round(slot.right - note.right)), width: Math.max(240, Math.min(380, Math.round(note.width))) });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(findSlot);
    if (rootRef.current) observer.observe(rootRef.current);
    return () => observer.disconnect();
  }, [findOpen, findSlot]);
  const openFind = useCallback(() => {
    setFindOpen(true);
    window.dispatchEvent(new Event('noted:find'));
  }, []);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (matchesShortcut(e, 'find')) {
        // Split view: the editor being typed in; otherwise the main one.
        const mine = editorRef.current?.view.dom.contains(document.activeElement);
        const other = !mine && !!(document.activeElement as HTMLElement | null)?.closest?.('.ProseMirror');
        if (other || (secondary && !mine)) return;
        e.preventDefault();
        openFind();
        return;
      }
      const ed = editorRef.current;
      // Reminder at the cursor, or the selected / touching chip opened for editing.
      if (ed && !ed.isDestroyed && ed.isEditable && ed.view.dom.contains(e.target as Node) && matchesShortcut(e, 'reminder')) {
        e.preventDefault();
        e.stopPropagation();
        requestReminderAtSelection(ed);
        return;
      }
      // Changed formatting shortcuts (Settings > Keyboard shortcuts), inside this editor.
      if (ed && !ed.isDestroyed && ed.view.dom.contains(e.target as Node) && handleEditorShortcut(ed, e)) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      // Nothing has the focus (after drawing, dragging an image or table handle, closing a
      // viewer): undo / redo still reach the note worked in last instead of going nowhere.
      const nothingFocused = !document.activeElement || document.activeElement === document.body;
      if (ed && !ed.isDestroyed && ed.isEditable && nothingFocused && lastUsedEditor === ed) {
        const undo = matchesShortcut(e, 'undo');
        if (undo || matchesShortcut(e, 'redo')) {
          e.preventDefault();
          e.stopPropagation();
          if (undo) ed.commands.undo();
          else ed.commands.redo();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [openFind]);
  const noteFont = useNoteFont(ydoc);
  const closeImageUrl = useCallback(() => setImageUrlPos(null), []);
  const closeMathEdit = useCallback(() => setMathEdit(null), []);
  const closeReminderEdit = useCallback(() => setReminderEdit(null), []);
  // The editor is created once, so the click handler reads the latest callback through a ref.
  const openLinkRef = useRef(onOpenLink);
  openLinkRef.current = onOpenLink;

  // Hrefs come from synced documents, so they are validated again before leaving the app.
  const openLink = (href: string) => {
    const safe = normalizeLinkUrl(href);
    if (safe) openLinkRef.current?.(safe);
  };
  const menuRef = useRef<SlashMenuHandle>(null);
  const isReadyRef = useRef(false);

  useEffect(() => {
    const timer = setTimeout(() => { isReadyRef.current = true; }, 150);
    return () => clearTimeout(timer);
  }, [noteId]);

  const statsRef = useRef(onStats);
  statsRef.current = onStats;
  const reportStats = (ed: { getText: (o: { blockSeparator: string }) => string; state: { doc: any } }) => {
    if (!statsRef.current) return;
    let paragraphs = 0;
    ed.state.doc.descendants((node: any) => {
      if (node.isTextblock && node.textContent.trim()) paragraphs++;
    });
    statsRef.current(computeTextStats(ed.getText({ blockSeparator: '\n' }), paragraphs));
  };

  const noteActionRef = useRef(onNoteAction);
  noteActionRef.current = onNoteAction;
  const editorRef = useRef<ReturnType<typeof useEditor>>(null);
  // A click on the empty page around the text (left / right of it, below it): the cursor goes
  // to the nearest place in the text, as if the line went on to there (the app sends the point).
  // Dragging the mouse out of the text (beside it, below it, still over the note) keeps
  // selecting, as if the lines went on to the pointer; the drag may also start there.
  useEffect(() => {
    let anchor: number | null = null;
    // Started beside the text (the browser is not selecting): every move is handled here.
    let manual = false;
    const pointPos = (x: number, y: number): number | null => {
      const ed = editorRef.current;
      if (!ed) return null;
      const box = (ed.view.dom as HTMLElement).getBoundingClientRect();
      const { doc } = ed.state;
      if (y > box.bottom) return TextSelection.atEnd(doc).head;
      if (y < box.top) return TextSelection.atStart(doc).head;
      // Beside the text there may be list markers, checkboxes or padding (no text position):
      // step inwards from the clamped point until the line's text is hit.
      const start = Math.min(Math.max(x, box.left + 2), box.right - 2);
      const step = x > box.right - 2 ? -12 : 12;
      for (let at = start; at >= box.left && at <= box.right; at += step) {
        const hit = ed.view.posAtCoords({ left: at, top: y });
        if (hit && doc.resolve(hit.pos).parent.isTextblock) return hit.pos;
      }
      const hit = ed.view.posAtCoords({ left: start, top: y });
      return hit ? TextSelection.near(doc.resolve(hit.pos)).head : null;
    };
    const focusAt = (e: Event) => {
      const ed = editorRef.current;
      const point = (e as CustomEvent<{ x: number; y: number }>).detail;
      if (!ed || !point) return;
      // Only the editor whose note area was clicked (split view has two).
      const area = (ed.view.dom as HTMLElement).closest('[data-note-scroll]')?.getBoundingClientRect();
      if (area && (point.x < area.left || point.x > area.right || point.y < area.top || point.y > area.bottom)) return;
      const box = (ed.view.dom as HTMLElement).getBoundingClientRect();
      if (point.y < box.top) return;
      const pos = pointPos(point.x, point.y) ?? TextSelection.atEnd(ed.state.doc).head;
      ed.view.focus();
      ed.view.dispatch(ed.state.tr.setSelection(TextSelection.near(ed.state.doc.resolve(pos))));
      anchor = ed.state.selection.anchor;
      manual = true;
    };
    // A plain press in the text: the selection drag is ours from the start (preventDefault also
    // keeps ProseMirror's own mousedown out). WebKit extending the native selection while the
    // pointer was beside a list fought the selection set here (it stuck or jumped). Double /
    // triple clicks, modifiers, tables, atoms and presses inside a selection (text drag and
    // drop) stay native.
    const down = (e: MouseEvent) => {
      const ed = editorRef.current;
      anchor = null;
      manual = false;
      if (!ed || e.button !== 0 || !ed.view.editable || !ed.view.dom.contains(e.target as Node)) return;
      const target = e.target as HTMLElement;
      if (e.detail !== 1 || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey
        || target.closest('table, [contenteditable="false"], a, img, .image-node, .attachment-card, .code-block > :not(pre), .outline-toggle, .heading-toggle, label, input')) {
        return;
      }
      const hit = ed.view.posAtCoords({ left: e.clientX, top: e.clientY });
      const { doc, selection } = ed.state;
      if (!hit || !doc.resolve(hit.pos).parent.isTextblock) return;
      if (!selection.empty && hit.pos >= selection.from && hit.pos <= selection.to) return;
      e.preventDefault();
      ed.view.focus();
      ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(doc, hit.pos)));
      anchor = hit.pos;
      manual = true;
    };
    // While the pointer is above / below the note area, the area scrolls (the browser's own
    // drag scrolling is off for our drags).
    let scrollFrame = 0;
    let lastPoint: { x: number; y: number } | null = null;
    const autoScroll = () => {
      scrollFrame = 0;
      const ed = editorRef.current;
      if (anchor === null || !manual || !ed || !lastPoint) return;
      const scroll = (ed.view.dom as HTMLElement).closest('[data-note-scroll]');
      if (!scroll) return;
      const r = scroll.getBoundingClientRect();
      const over = lastPoint.y < r.top + 16 ? lastPoint.y - (r.top + 16) : lastPoint.y > r.bottom - 16 ? lastPoint.y - (r.bottom - 16) : 0;
      if (!over) return;
      scroll.scrollTop += Math.max(-40, Math.min(40, over / 2));
      select(lastPoint.x, Math.max(r.top + 2, Math.min(lastPoint.y, r.bottom - 2)), null);
      scrollFrame = requestAnimationFrame(autoScroll);
    };
    const select = (x: number, y: number, target: Node | null) => {
      const ed = editorRef.current;
      if (anchor === null || !ed) return;
      const inside = target ? ed.view.dom.contains(target) : false;
      const hit = inside ? ed.view.posAtCoords({ left: x, top: y }) : null;
      const head = hit && ed.state.doc.resolve(hit.pos).parent.isTextblock ? hit.pos : pointPos(x, y);
      if (head === null) return;
      const { selection, doc } = ed.state;
      if (selection.anchor === anchor && selection.head === head) return;
      ed.view.dispatch(ed.state.tr.setSelection(TextSelection.between(doc.resolve(Math.min(anchor, doc.content.size)), doc.resolve(head))));
    };
    const move = (e: MouseEvent) => {
      const ed = editorRef.current;
      if (anchor === null || !ed) return;
      if (!(e.buttons & 1)) { anchor = null; manual = false; return; }
      if (anchor === -1) anchor = ed.state.selection.anchor;
      // A native drag (see down): over the text the browser selects by itself.
      if (!manual && ed.view.dom.contains(e.target as Node)) return;
      const scroll = (ed.view.dom as HTMLElement).closest('[data-note-scroll]');
      if (!manual && scroll && !scroll.contains(e.target as Node)) return;
      e.preventDefault();
      lastPoint = { x: e.clientX, y: e.clientY };
      select(e.clientX, e.clientY, e.target as Node);
      if (manual && !scrollFrame) scrollFrame = requestAnimationFrame(autoScroll);
    };
    const up = () => { anchor = null; manual = false; lastPoint = null; };
    window.addEventListener('noted:focus-at', focusAt);
    window.addEventListener('mousedown', down, true);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('noted:focus-at', focusAt);
      window.removeEventListener('mousedown', down, true);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      cancelAnimationFrame(scrollFrame);
    };
  }, []);
  // Note properties "Show in the note": select the image / file with this blob and scroll to it.
  useEffect(() => {
    const reveal = (e: Event) => {
      const blob = (e as CustomEvent<string>).detail;
      const ed = editorRef.current;
      if (!ed || typeof blob !== 'string') return;
      let at = -1;
      ed.state.doc.descendants((node, pos) => {
        if (at < 0 && node.attrs.blob === blob) at = pos;
        return at < 0;
      });
      if (at < 0) return;
      ed.chain().focus().setNodeSelection(at).scrollIntoView().run();
    };
    if (secondary) return;
    window.addEventListener('noted:reveal-blob', reveal);
    return () => window.removeEventListener('noted:reveal-blob', reveal);
  }, []);

  const editor = useEditor({
    extensions: [
      ...createSchemaExtensions({
        ydoc,
        placeholder: "Type here... type '/' for commands or drop an image",
        onEditMath: setMathEdit,
        onEditReminder: setReminderEdit,
      }),
      ...extraExtensions,
      ...(noteLinks ? [NoteLinkSuggestion.configure({
        suggestion: {
          // NoteLinkMenu does the searching and inserting.
          render: () => ({
            onStart: (props: any) => {
              const rect = props.clientRect?.();
              if (rect) setNoteLinkMenu({ top: rect.bottom + 8, caretTop: rect.top, left: rect.left, query: props.query, range: props.range });
            },
            onUpdate: (props: any) => {
              const rect = props.clientRect?.();
              if (rect) setNoteLinkMenu({ top: rect.bottom + 8, caretTop: rect.top, left: rect.left, query: props.query, range: props.range });
            },
            onKeyDown: (props: any) => noteLinkMenuRef.current?.handleKey(props.event) ?? false,
            onExit: () => setNoteLinkMenu(null),
          }),
        },
      })] : []),
      NoteActions.configure({
        onRequest: (request: NoteActionRequest) => {
          const ed = editorRef.current;
          const coords = ed ? ed.view.coordsAtPos(Math.min(request.pos, ed.state.doc.content.size)) : { left: 200, bottom: 200 };
          if (request.kind === 'export') setExportOpen(true);
          else if (request.kind === 'publish') setPublishOpen(true);
          else noteActionRef.current?.(request, coords.left, coords.bottom + 6);
        },
      }),
      SlashCommands.configure({
        suggestion: {
          // The menu (SlashMenu) does its own filtering and navigation.
          render: () => ({
            onStart: (props: any) => {
              const rect = props.clientRect?.();
              if (rect) setSlash({ top: rect.bottom + 8, caretTop: rect.top, left: rect.left, query: props.query, range: props.range });
            },
            onUpdate: (props: any) => {
              const rect = props.clientRect?.();
              if (rect) setSlash({ top: rect.bottom + 8, caretTop: rect.top, left: rect.left, query: props.query, range: props.range });
            },
            onKeyDown: (props: any) => menuRef.current?.handleKey(props.event) ?? false,
            onExit: () => setSlash(null),
          }),
        },
      }),
      Extension.create({
        name: 'mediaHandler',
        addProseMirrorPlugins() {
          const editor = this.editor;
          return [
            new Plugin({
              key: new PluginKey('mediaHandler'),
              props: {
                handleDOMEvents: {
                  // Plain click keeps editing the link text; Ctrl/Cmd+click opens it.
                  click(_view, event) {
                    // A plain click on a note link opens that note.
                    const noteLink = (event.target as HTMLElement | null)?.closest?.('[data-note-link]');
                    if (noteLink) {
                      const id = noteLink.getAttribute('data-note-id');
                      if (id) openNoteRef.current?.(id);
                      return true;
                    }
                    const anchor = (event.target as HTMLElement | null)?.closest?.('a[href]');
                    if (!anchor) return false;
                    event.preventDefault();
                    if (!(event.ctrlKey || event.metaKey)) return false;
                    openLink(anchor.getAttribute('href') ?? '');
                    return true;
                  },
                  contextmenu(view, event) {
                    const anchor = (event.target as HTMLElement | null)?.closest?.('a[href]');
                    if (!anchor) return false;
                    event.preventDefault();
                    // posAtDOM gives the start of the link text; +1 keeps it inside the mark.
                    const pos = Math.min(view.posAtDOM(anchor, 0) + 1, view.state.doc.content.size);
                    setLinkMenu({ x: event.clientX, y: event.clientY, href: anchor.getAttribute('href') ?? '', pos });
                    return true;
                  },
                },
                // Pasted and dropped files become encrypted blobs (see configureBlobs): images
                // compressed, anything else as an attachment. Images inside pasted web content
                // are downloaded into blobs right after the paste.
                handlePaste(_view, event) {
                  const files = Array.from(event.clipboardData?.files ?? []);
                  // Files copied in a file manager arrive as file:// paths, not as files.
                  const handlers = editor.storage.image?.handlers;
                  const data = event.clipboardData;
                  const paths = files.length === 0 && handlers?.readPaths && data
                    ? pastedFilePaths(data.getData('text/uri-list'), data.getData('text/plain'))
                    : null;
                  // WebKitGTK announces the list but hides it: the app reads the clipboard.
                  const hiddenList = files.length === 0 && !paths && !!data && Array.from(data.types).includes('text/uri-list')
                    && !data.getData('text/uri-list') && !!handlers?.readPaths && !!handlers.clipboardPaths;
                  if ((paths || hiddenList) && handlers?.readPaths) {
                    event.preventDefault();
                    const pos = editor.state.selection.from;
                    const plain = data?.getData('text/plain') ?? '';
                    (paths ? Promise.resolve(paths) : handlers.clipboardPaths!())
                      .then(async (list) => {
                        if (list.length === 0) {
                          if (plain) editor.chain().focus().insertContentAt(pos, plain).run();
                          return;
                        }
                        await insertFiles(editor, await handlers.readPaths!(list), pos);
                      })
                      .catch((err) => handlers.notify?.(`Cannot paste the file: ${err instanceof Error ? err.message : String(err)}`));
                    return true;
                  }
                  if (files.length === 0 || !editor.storage.image?.handlers) {
                    setTimeout(() => { importImages(editor).catch((err) => console.error('Image import failed:', err)); }, 300);
                    return false;
                  }
                  event.preventDefault();
                  insertFiles(editor, files);
                  return true;
                },
                handleDrop(view, event, _slice, moved) {
                  if (moved || !event.dataTransfer) return false;
                  const files = Array.from(event.dataTransfer.files);
                  if (files.length === 0 || !editor.storage.image?.handlers) return false;
                  const pos = view.posAtCoords({ left: event.clientX, top: event.clientY });
                  event.preventDefault();
                  insertFiles(editor, files, pos?.pos);
                  return true;
                }
              }
            })
          ];
        }
      })
    ],
    onCreate: ({ editor }) => reportStats(editor),
    onUpdate: ({ editor }) => {
      reportStats(editor);
      if (!isReadyRef.current) return;
      onUpdate(noteId, ydoc);
    },
  });

  // Images and files: register the blob handlers, then move images of this note that are not
  // blobs yet (old base64, pasted from the web) into blobs.
  useEffect(() => {
    if (!editor) return;
    configureBlobs(editor, blobs ?? null);
    editor.storage.image.requestUrl = blobs?.storeUrl ? setImageUrlPos : null;
    if (!blobs?.storeBytes) return;
    const timer = setTimeout(() => {
      importImages(editor)
        .then((count) => { if (count) console.info(`Moved ${count} image(s) into encrypted blobs`); })
        .catch((err) => console.error('Image import failed:', err));
    }, 500);
    return () => clearTimeout(timer);
  }, [editor, blobs]);

  editorRef.current = editor;

  // Read only and spell check (note properties).
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!readOnly);
    editor.view.dom.setAttribute('spellcheck', spellcheck ? 'true' : 'false');
  }, [editor, readOnly, spellcheck]);

  // Restoring an older version is a normal edit: it syncs and Ctrl+Z undoes it. Applied once,
  // when it is new: an editor mounted later (another note) must never apply it.
  const restoreSeen = useRef(restore?.id);
  useEffect(() => {
    if (!editor || !restore || restore.id === restoreSeen.current) return;
    restoreSeen.current = restore.id;
    editor.commands.setContent(restore.content);
    setTitle(ydoc, restore.title);
    onUpdate(noteId, ydoc);
  }, [restore?.id]);

  // "Update automatically": edits (text or title) are published a while after typing stops,
  // and at once when the note is closed with an update pending.
  const publishedRef = useRef(published);
  publishedRef.current = published;
  const publishNowRef = useRef(publishNow);
  publishNowRef.current = publishNow;
  useEffect(() => {
    if (!editor) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const run = () => {
      timer = null;
      const info = publishedRef.current;
      if (!info?.autoUpdate || (info.expiresAt && info.expiresAt <= Date.now())) return;
      publishNowRef.current({ password: info.password ?? null, selfDestruct: false, autoUpdate: true, expiresAt: info.expiresAt ?? null })
        .catch((e) => console.warn('Automatic publish failed:', e));
    };
    const schedule = () => {
      if (!publishedRef.current?.autoUpdate) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, AUTO_PUBLISH_DELAY_MS);
    };
    editor.on('update', schedule);
    const title = getTitleText(ydoc);
    title.observe(schedule);
    return () => {
      editor.off('update', schedule);
      title.unobserve(schedule);
      if (timer) { clearTimeout(timer); run(); }
    };
  }, [editor, ydoc]);
  useEffect(() => {
    if (editor) setLigatures(editor, ligatures);
  }, [editor, ligatures]);
  // The pen kind, colours and widths of this device: read once, kept on every change.
  const drawingToolsRef = useRef(drawingTools);
  drawingToolsRef.current = drawingTools;
  useEffect(() => {
    if (!editor) return;
    restoreDrawingTools(editor, drawingToolsRef.current?.load() ?? null);
    return onDrawingChange(editor, () => drawingToolsRef.current?.save(serializeDrawingTools(editor.storage.drawing.current)));
  }, [editor]);
  // This note is the one worked in last once it is touched or gets the focus (split view: the
  // other editor's undo / redo stay its own).
  useEffect(() => {
    const ed = editor;
    const root = rootRef.current;
    if (!ed || !root) return;
    const mark = () => { lastUsedEditor = ed; };
    // Elsewhere (the note list, the panels) undo / redo are not the note's any more.
    const leave = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (lastUsedEditor === ed && !root.contains(target) && !target?.closest?.('[data-editor-menu]')) lastUsedEditor = null;
    };
    root.addEventListener('pointerdown', mark, true);
    document.addEventListener('pointerdown', leave, true);
    ed.on('focus', mark);
    if (!secondary && !lastUsedEditor) lastUsedEditor = ed;
    return () => {
      root.removeEventListener('pointerdown', mark, true);
      document.removeEventListener('pointerdown', leave, true);
      ed.off('focus', mark);
      if (lastUsedEditor === ed) lastUsedEditor = null;
    };
  }, [editor]);
  useEffect(() => {
    if (editor) setCodeThemeByLanguage(editor, codeThemeByLanguage ?? {});
  }, [editor, JSON.stringify(codeThemeByLanguage ?? {})]);
  useEffect(() => {
    if (editor && reminderTimes) setReminderTimes(editor, reminderTimes);
  }, [editor, reminderTimes?.morning, reminderTimes?.evening]);

  // Note link labels follow the current titles.
  useEffect(() => {
    if (editor) setNoteTitles(editor, new Map(notes.map((n) => [n.id, n.title])));
  }, [editor, notes]);

  return (
    <div ref={rootRef} style={{ position: 'relative' }} data-note-font={noteFont ?? undefined}>
      {/* Top right of the note area, under the toolbar (findSlot); without a slot it stays at
          the top right of the visible part of the note. */}
      {editor && findOpen && (findSlot
        ? createPortal(
          <div style={{ position: 'absolute', top: 8, right: findPlace.right, width: findPlace.width }}>
            <FindBar editor={editor} onClose={() => setFindOpen(false)} />
          </div>,
          findSlot,
        )
        : (
          <div style={{ position: 'sticky', top: 8, height: 0, zIndex: 50 }}>
            <FindBar editor={editor} onClose={() => setFindOpen(false)} />
          </div>
        ))}
      <NoteTitle ydoc={ydoc} editor={editor} readOnly={readOnly} onChange={() => onUpdate(noteId, ydoc)} />
      <EditorContent editor={editor} />
      <Backlinks noteId={noteId} notes={notes} onOpenNote={onOpenNote} />
      {editor && noteLinkMenu && floating(
        <NoteLinkMenu
          ref={noteLinkMenuRef}
          editor={editor}
          state={noteLinkMenu}
          notes={notes}
          currentNoteId={noteId}
          onCreateNote={onCreateNote}
          onClose={() => setNoteLinkMenu(null)}
        />,
      )}
      {editor && slash && floating(<SlashMenu ref={menuRef} editor={editor} state={slash} items={slashItems ?? (onPublish ? undefined : slashItemsWithoutPublish)} onClose={() => setSlash(null)} />)}
      {editor && toolbarMode === 'floating' && floating(<FormatMenu editor={editor} onOpenLink={onOpenLink ? openLink : undefined} linkEditRequest={linkEditRequest} />)}
      {editor && toolbarMode === 'top' && toolbarSlot && createPortal(
        <TopToolbar
          editor={editor}
          linkEditRequest={linkEditRequest}
          align={fullWidth ? 'left' : 'center'}
          noteFont={noteFont ?? 'sans'}
          onOpenLink={onOpenLink ? openLink : undefined}
          onFind={openFind}
          toolbarConfig={toolbarConfig}
          onNoteFont={(font) => { setNoteFont(ydoc, font === 'sans' ? null : font); onUpdate(noteId, ydoc); }}
        />,
        toolbarSlot,
      )}
      {publishOpen && onPublish && (
        <PublishDialog
          title={getTitleText(ydoc).toString().trim()}
          initial={{ password: published?.password ?? null, selfDestruct: published?.selfDestruct ?? false, autoUpdate: published?.autoUpdate ?? false, expiresAt: published?.expiresAt ?? null, live: !!published?.live, editable: !!published?.editable }}
          url={published ? publishedUrl(published) : null}
          publishedAt={published?.at ?? null}
          onPublish={publishNow}
          onUnpublish={() => onPublish(null)}
          onAutoUpdate={(on) => {
            const info = getNotePublish(ydoc);
            if (!info) return;
            setNotePublish(ydoc, { ...info, autoUpdate: on && !info.selfDestruct });
            onUpdate(noteId, ydoc);
          }}
          onOpenLink={onOpenLink}
          onClose={() => setPublishOpen(false)}
        />
      )}
      {exportOpen && <ExportDialog onPick={runExport} onClose={() => setExportOpen(false)} />}
      {editor && floating(<TableMenu editor={editor} anchor={tableMenuSlot} config={tableToolbarConfig} />)}
      {editor && floating(<DrawingMenu editor={editor} anchor={drawingMenuSlot} config={drawingToolbarConfig} />)}
      {editor && floating(<CalloutMenu editor={editor} />)}
      {editor && floating(<ImageMenu editor={editor} />)}
      {editor && imageUrlPos !== null && floating(<ImageUrlPrompt editor={editor} pos={imageUrlPos} onClose={closeImageUrl} />)}
      {editor && mathEdit && floating(<MathEditor key={`${mathEdit.mode}-${mathEdit.pos}`} editor={editor} request={mathEdit} onClose={closeMathEdit} />)}
      {editor && reminderEdit && floating(<ReminderEditor key={`${reminderEdit.mode}-${reminderEdit.pos}`} editor={editor} request={reminderEdit} onClose={closeReminderEdit} />)}
      {editor && linkMenu && floating(
        <LinkContextMenu
          state={linkMenu}
          onOpen={onOpenLink ? () => openLink(linkMenu.href) : undefined}
          onEdit={() => {
            editor.chain().focus().setTextSelection(linkMenu.pos).extendMarkRange('link').run();
            setLinkEditRequest((n) => n + 1);
          }}
          onCopy={() => {
            navigator.clipboard.writeText(linkMenu.href).catch((e) => console.error('Copying link failed:', e));
          }}
          onRemove={() => {
            editor.chain().focus().setTextSelection(linkMenu.pos).extendMarkRange('link').unsetLink().run();
          }}
          onClose={closeLinkMenu}
        />,
      )}
    </div>
  );
}

// Floating menus (fixed position, viewport coordinates) live in <body>: inside the note's
// zoomed box (status bar zoom = CSS zoom) WebKit scaled their position too, so at 120 % the
// table menu sat lower, next to the next table.
// `data-editor-menu`: clicks in these menus still count as working in the note (undo / redo).
const floating = (node: ReactNode) => createPortal(<div data-editor-menu="" style={{ display: 'contents' }}>{node}</div>, document.body);
