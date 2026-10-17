import React, { useRef, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, BackHandler, Keyboard, AppState, Linking, Share, Platform, ToastAndroid, Dimensions } from 'react-native';
import { appAlert, onDialogShown } from './Dialog';
import { rememberKeyboardHeight } from './keyboard-height';
import * as Clipboard from 'expo-clipboard';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import { listHistory, readHistoryState, recordHistory } from './history';
import { getEditorPrefs, getToolbarConfig, getTableToolbarConfig, onPrefsChange } from './prefs';
import { getVaultKey, setVaultKey, onVaultKeyChange } from './vault-session';
import { VaultPrompt } from './VaultPrompt';
import { deriveKeyInWebView } from './kdf';
import { updateNoteRecord } from './note-actions';
import { heicToJpegBase64 } from './heic';
import { openFileBytes, saveFileBytes, shareFileBytes } from './files';
import { KeyboardEvents } from 'react-native-keyboard-controller';
import { docFromSealed, isNoteLocked, appendNoteLink, readLockedBody, writeLockedBody, lockNote, unlockNote, openVault, sealDoc, exportAttachments, zipNoteWithFiles } from '@noted/sync';
import { exportNote } from '@noted/editor/export';
import type { VaultSetup } from '@noted/sync';
import { mdiLockOutline } from '@mdi/js';
import type { HistoryEntry, HistorySession } from './history';
import { normalizeLinkUrl } from '@noted/editor/link-utils';
import type { NoteView } from '@noted/ui/src/note-list';
import type { CatalogEntry, CatalogKind } from '@noted/sync';
import { mdiArrowLeft, mdiUndo, mdiRedo, mdiDotsVertical, mdiClose, mdiVectorLink } from '@mdi/js';
import { T, Icon } from './ui';
import { NoteMenu } from './NoteMenu';
import type { NoteAttachmentItem } from './NoteMenu';
import type { NoteFlags } from './NoteMenu';
import type { SplitSide } from './SplitIcon';
import WebView from 'react-native-webview';
import { LocalNoteStore, LocalBlobStore, applyEditorUpdate, buildNoteMeta, encodeNoteMeta, fetchSealedBlob, nextPublishInfo, putPublished, deletePublished, publishedExists, publishedUrl } from '@noted/sync';
import type { NotePublish } from '@noted/sync';
import { seal, unseal, bytesToBase64, base64ToBytes } from '@noted/crypto';
import { EDITOR_HTML } from './editorHtml.generated';
import { goingAway } from './away';

interface EditorScreenProps {
  // Settings > Backup > compare: show this note's backup version next to it once the page is ready.
  backupCompare?: { token: number; state: Uint8Array; createdAt: number } | null;
  // The comparison is on screen: the list forgets it, so opening the note again shows the note.
  onBackupShown?: () => void;
  // The text of this note got the focus (split view: this pane gets more room for typing).
  onEditorFocus?: () => void;
  noteId: string;
  // False once the user left this note: the screen is hidden at once and removes itself
  // (onClosed) after the editor handed over its last edits.
  visible: boolean;
  onClosed: () => void;
  // Notebook and tag names, for "/notebook", "/tag" and the chips above the title.
  catalog: { notebooks: CatalogEntry[]; tags: CatalogEntry[] };
  onOpenView: (view: NoteView) => void;
  onCreateEntry: (kind: CatalogKind, name: string) => Promise<CatalogEntry | undefined>;
  // "Create note" in the note link picker: a new note with this title in these notebooks.
  onCreateLinkedNote: (title: string, notebooks: string[]) => Promise<string | null>;
  tabsCount: number;
  onShowTabs: () => void;
  masterKey: Uint8Array;
  dbStore: LocalNoteStore;
  blobStore: LocalBlobStore;
  onBack: () => void;
  triggerSync: () => void;
  // Current title of every note, for note link labels.
  titles: Record<string, string>;
  // Where each note is, under titles in the note picker.
  places: Record<string, string>;
  // Archived notes (left out of the note picker).
  archivedIds: string[];
  // Tapping a note link: the screen saves pending edits first, then calls this.
  onOpenNote: (id: string) => void;
  // Long press on a note link: open it next to this note.
  onOpenSplit: (id: string, side: SplitSide) => void;
  // The note was archived / unarchived from its menu (the list offers the notes under it).
  onArchived?: (id: string, on: boolean) => void;
  // In a split view: the lower pane needs no room for the status bar; a pane can be closed.
  compact?: boolean;
  inSplit?: boolean;
  // For the note menu.
  edited: number | null;
  links: { id: string; name: string; place?: string }[];
  backlinks: { id: string; name: string; place?: string }[];
  onDuplicate: () => void;
  // "Save a copy" of an older version: a new note from that state.
  onSaveCopy: (state: Uint8Array) => void;
  // Locked notes: the vault (null = not created yet) and how to create it.
  vaultSetup: VaultSetup | null;
  onCreateVault: (password: string) => Promise<Uint8Array | null>;
  // The note went to the trash or was deleted: its tab closes.
  onRemoved: () => void;
}

const NO_FLAGS: NoteFlags = { pinned: false, favorite: false, archived: false, readOnly: false, noSpellcheck: false };

const POLL_MS = 1000;
// After leaving, how long the hidden editor waits for the WebView's last update.
const CLOSE_FLUSH_MS = 400;

// A short message at the bottom (Android), or an alert elsewhere.
const showToast = (text: string) => (Platform.OS === 'android' ? ToastAndroid.show(text, ToastAndroid.SHORT) : appAlert('Noted', text));

export function EditorScreen({
  noteId, visible, onClosed, catalog, onOpenView, onCreateEntry, onCreateLinkedNote, tabsCount, onShowTabs,
  masterKey, dbStore, blobStore, onBack, triggerSync, titles, places, archivedIds, onOpenNote, onOpenSplit, onArchived, compact, inSplit,
  edited, links, backlinks, onDuplicate, onSaveCopy, onRemoved, vaultSetup, onCreateVault, backupCompare, onBackupShown, onEditorFocus,
}: EditorScreenProps) {
  // Locked note: closed until the vault is open; the page is reloaded (pageKey) after the lock
  // changes or the vault closes.
  const [lockedClosed, setLockedClosed] = useState(false);
  const [pageKey, setPageKey] = useState(0);
  const [vaultPrompt, setVaultPrompt] = useState<{ then: (key: Uint8Array) => void } | null>(null);
  const lockedOpenRef = useRef(false);
  // Editing session of this note for the local history (history.ts).
  const sessionRef = useRef<HistorySession | null>(null);
  const [historyList, setHistoryList] = useState<HistoryEntry[] | null>(null);
  // The keyboard was up when the note menu opened: closing the menu brings it back.
  const keyboardBeforeMenuRef = useRef(false);
  const [history, setHistory] = useState({ undo: false, redo: false });
  const [menuOpen, setMenuOpen] = useState(false);
  // Note menu "Attached files" (the page lists them when the menu opens).
  const [attachments, setAttachments] = useState<NoteAttachmentItem[] | null>(null);
  const [noteState, setNoteState] = useState<{ flags: NoteFlags; trashed: boolean; created: number | null; notebooks: string[]; tags: string[]; published: NotePublish | null; locked: boolean }>(
    { flags: NO_FLAGS, trashed: false, created: null, notebooks: [], tags: [], published: null, locked: false },
  );
  // Automatic publish started by closing the note, and its "sealed" signal.
  const autoPublishRef = useRef<Promise<void> | null>(null);
  const autoPublishDoneRef = useRef<(() => void) | null>(null);
  const noteStateRef = useRef(noteState);
  noteStateRef.current = noteState;
  // "/publish" opens the note menu on its publish page.
  const [menuPage, setMenuPage] = useState<'main' | 'publish' | 'links'>('main');
  // The page's answer to getPublishPayload.
  const payloadWaiterRef = useRef<((sealed: Uint8Array | null) => void) | null>(null);
  // Top of the keyboard on screen while it is up.
  const keyboardTopRef = useRef<number | null>(null);
  // The box around the page (it ends where the keyboard starts).
  const boxRef = useRef<View>(null);
  const note = { id: noteId };
  const webViewRef = useRef<WebView>(null);
  const readyRef = useRef(false);
  // Last sealed state the editor is known to contain; used to detect changes made by sync.
  const lastSentRef = useRef<string | null>(null);
  // Saves run one at a time so each one merges into the state the previous one wrote.
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingSavesRef = useRef(0);

  const sendToEditor = (msg: Record<string, unknown>) => {
    const literal = JSON.stringify(JSON.stringify(msg));
    webViewRef.current?.injectJavaScript(
      `window.__noted && window.__noted.receive(${literal}); true;`,
    );
  };

  const loadSealedState = async (): Promise<string | null> => {
    const store = dbStore as LocalNoteStore & { get?(id: string): Promise<{ yjs_state: string } | null> };
    const current = store.get ? await store.get(note.id) : (await dbStore.getAll()).find((n) => n.id === note.id);
    return current?.yjs_state && current.yjs_state.includes('.') ? current.yjs_state : null;
  };

  // 'init' starts the editor; 'remote' merges a newer stored state into the running editor.
  const pushState = async (type: 'init' | 'remote') => {
    const sealed = await loadSealedState();
    lastSentRef.current = sealed;
    if (!sealed) {
      if (type === 'init') sendToEditor({ type, state: '' });
      return;
    }
    try {
      const plain = unseal(masterKey, sealed);
      if (type === 'init') {
        const doc = docFromSealed(masterKey, sealed);
        if (isNoteLocked(doc)) {
          const key = getVaultKey();
          const body = key ? readLockedBody(doc, key) : null;
          if (!body) {
            lockedOpenRef.current = false;
            setLockedClosed(true);
            return;
          }
          lockedOpenRef.current = true;
          setLockedClosed(false);
          sendToEditor({ type, state: bytesToBase64(plain), lockedBody: body });
          return;
        }
        lockedOpenRef.current = false;
        setLockedClosed(false);
      }
      sendToEditor({ type, state: bytesToBase64(plain) });
    } catch (e) {
      // Never open a note we cannot decrypt: typing into a blank editor could overwrite it.
      console.error('Cannot open note state:', e);
    }
  };

  const saveFromEditor = (data: { update: string }) => {
    pendingSavesRef.current++;
    queueRef.current = queueRef.current.then(async () => {
      try {
        const sealed = await loadSealedState();
        const result = applyEditorUpdate(masterKey, sealed, base64ToBytes(data.update));
        if (!result.changed || !result.sealed) return;
        // The `content` column holds the note's metadata (title, excerpt, links), sealed.
        const content = seal(masterKey, new TextEncoder().encode(encodeNoteMeta(buildNoteMeta(result.doc))));
        const now = Date.now();
        await dbStore.save(note.id, content, result.sealed, now);
        // The stored state had changes the page has not seen (another editor of this note
        // closing, a sync): the page gets the stored state merged in. Otherwise the poll would
        // take the stored state for the page's own and the text stayed missing on screen.
        if (sealed !== lastSentRef.current) queueMicrotask(() => { pushState('remote'); });
        else lastSentRef.current = result.sealed;
        sessionRef.current = await recordHistory(note.id, result.sealed, now, sessionRef.current).catch(() => sessionRef.current);
        triggerSync();
      } catch (e) {
        console.error('Save error:', e);
      } finally {
        pendingSavesRef.current--;
      }
    });
  };

  // A backup comparison asked for while (or before) the page was ready: shown once.
  const backupShownRef = useRef(0);
  const backupCompareRef = useRef(backupCompare);
  backupCompareRef.current = backupCompare;
  const sendBackupCompare = () => {
    const c = backupCompareRef.current;
    if (!c || !readyRef.current || backupShownRef.current === c.token) return;
    backupShownRef.current = c.token;
    sendToEditor({ type: 'showBackup', state: bytesToBase64(c.state), createdAt: c.createdAt });
  };
  useEffect(sendBackupCompare, [backupCompare?.token]);
  // The note itself stays covered until the page shows the comparison (no flash of the note).
  const [comparing, setComparing] = useState(false);
  useEffect(() => {
    if (!backupCompare) return;
    setComparing(true);
    const fallback = setTimeout(() => { setComparing(false); onBackupShown?.(); }, 3000);
    return () => clearTimeout(fallback);
  }, [backupCompare?.token]);

  const handleMessage = (event: { nativeEvent: { data: string } }) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === 'ready') {
        readyRef.current = true;
        sendToEditor({ type: 'theme', colors: T });
        sendToEditor({ type: 'editorPrefs', prefs: getEditorPrefs(), toolbar: getToolbarConfig(), tableToolbar: getTableToolbarConfig() });
        sendToEditor({ type: 'titles', titles: titlesRef.current, places: placesRef.current, archived: archivedRef.current, currentId: note.id });
        sendToEditor({ type: 'catalog', ...catalogRef.current });
        pushState('init');
        sendBackupCompare();
      } else if (msg.type === 'blob' && typeof msg.id === 'string') {
        // The WebView decrypts with the key from the note; here we only fetch sealed bytes.
        fetchSealedBlob(masterKey, blobStore, msg.id).then(
          (sealed) => sendToEditor({ type: 'blobData', id: msg.id, data: sealed ? bytesToBase64(sealed) : null }),
          (err) => {
            console.warn('Blob fetch failed:', err);
            sendToEditor({ type: 'blobData', id: msg.id, data: null, error: true });
          },
        );
      } else if (msg.type === 'openNote' && typeof msg.id === 'string') {
        onOpenNote(msg.id);
      } else if (msg.type === 'linkFrom' && typeof msg.target === 'string' && msg.target !== note.id) {
        // "/linkto": a link to this note at the end of the picked note (not a locked one).
        const name = typeof msg.title === 'string' && msg.title ? `“${msg.title}”` : 'that note';
        updateNoteRecord(masterKey, dbStore, msg.target, (doc) => (isNoteLocked(doc) ? 'locked' as const : appendNoteLink(doc, note.id))).then((result) => {
          if (result === 'added') triggerSync();
          showToast(result === 'locked' ? `${name} is locked` : result === 'already' ? `${name} already links to this note`
            : result === 'added' ? `Link added at the end of ${name}` : 'Note not found');
        }, (e) => showToast(`Could not add the link: ${e instanceof Error ? e.message : String(e)}`));
      } else if (msg.type === 'openSplit' && typeof msg.id === 'string' && ['left', 'right', 'top', 'bottom'].includes(msg.side)) {
        onOpenSplit(msg.id, msg.side);
      } else if (msg.type === 'history') {
        setHistory({ undo: !!msg.undo, redo: !!msg.redo });
      } else if (msg.type === 'noteState' && msg.flags) {
        setNoteState({
          flags: { ...NO_FLAGS, ...msg.flags }, trashed: !!msg.trashed, created: typeof msg.created === 'number' ? msg.created : null,
          notebooks: Array.isArray(msg.notebooks) ? msg.notebooks : [], tags: Array.isArray(msg.tags) ? msg.tags : [],
          published: msg.published && typeof msg.published.id === 'string' ? msg.published : null,
          locked: msg.locked === true,
        });
      } else if (msg.type === 'lockedBody' && msg.body && typeof msg.body === 'object') {
        // The open locked note's text, sealed with the vault key into the stored note.
        const key = getVaultKey();
        if (!key) return;
        pendingSavesRef.current++;
        queueRef.current = queueRef.current.then(async () => {
          try {
            const sealed = await loadSealedState();
            if (!sealed) return;
            const doc = docFromSealed(masterKey, sealed);
            writeLockedBody(doc, key, msg.body);
            const state = sealDoc(masterKey, doc);
            await dbStore.save(note.id, seal(masterKey, new TextEncoder().encode(encodeNoteMeta(buildNoteMeta(doc)))), state, Date.now());
            lastSentRef.current = state;
            triggerSync();
          } catch (e) {
            console.error('Saving the locked note failed:', e);
          } finally {
            pendingSavesRef.current--;
          }
        });
      } else if (msg.type === 'publishSealed') {
        payloadWaiterRef.current?.(typeof msg.data === 'string' ? base64ToBytes(msg.data) : null);
        payloadWaiterRef.current = null;
      } else if (msg.type === 'openPublish') {
        openMenu('publish');
      } else if (msg.type === 'text' && typeof msg.text === 'string') {
        if (msg.purpose === 'share') Share.share({ message: msg.text, title: msg.title || undefined }).catch(() => {});
        else Clipboard.setStringAsync(msg.text);
      } else if (msg.type === 'openView' && msg.view && typeof msg.view.kind === 'string') {
        onOpenView(msg.view as NoteView);
      } else if (msg.type === 'openUrl' && typeof msg.href === 'string') {
        // Links come from synced notes: only http(s), mailto and tel leave the app.
        const href = normalizeLinkUrl(msg.href);
        if (href) Linking.openURL(href).catch((e) => console.warn('Cannot open link:', e));
      } else if (msg.type === 'copy' && typeof msg.text === 'string') {
        Clipboard.setStringAsync(msg.text);
      } else if (msg.type === 'createEntry' && (msg.kind === 'notebooks' || msg.kind === 'tags') && typeof msg.name === 'string') {
        onCreateEntry(msg.kind, msg.name).then((entry) => sendToEditor({ type: 'entryCreated', requestId: msg.requestId, entry: entry ?? null }));
      } else if (msg.type === 'createNote' && typeof msg.title === 'string') {
        const reply = replyTo(msg.requestId);
        const notebooks = Array.isArray(msg.notebooks) ? msg.notebooks.filter((x: unknown): x is string => typeof x === 'string') : [];
        onCreateLinkedNote(msg.title, notebooks).then((id) => reply(id ? { id } : null), (e) => reply(undefined, e));
      } else if (msg.type === 'storeBlob' && typeof msg.id === 'string' && typeof msg.data === 'string') {
        // A new image, sealed by the page: into the local cache / upload queue.
        const reply = replyTo(msg.requestId);
        blobStore.put(msg.id, base64ToBytes(msg.data), false).then(() => { reply(true); triggerSync(); }, (e) => reply(undefined, e));
      } else if ((msg.type === 'openFile' || msg.type === 'saveFile') && typeof msg.name === 'string' && typeof msg.data === 'string') {
        // An attachment or image, decrypted by the page: opened in another app or saved.
        const reply = replyTo(msg.requestId);
        const bytes = base64ToBytes(msg.data);
        const work = msg.type === 'openFile' ? openFileBytes(msg.name, bytes, msg.mime).then(() => null) : saveFileBytes(msg.name, bytes, msg.mime);
        work.then((text) => { reply(true); if (text) showToast(text); }, (e) => reply(undefined, e));
      } else if (msg.type === 'convertHeic' && typeof msg.data === 'string') {
        const reply = replyTo(msg.requestId);
        heicToJpegBase64(msg.data).then((data) => reply({ data }), (e) => reply(undefined, e));
      } else if (msg.type === 'fetchUrl' && typeof msg.url === 'string') {
        fetchImage(msg.url).then((value) => replyTo(msg.requestId)(value), (e) => replyTo(msg.requestId)(undefined, e));
      } else if (msg.type === 'autoPublishStarted') {
        // Closing with an update pending: the close waits for it (see below).
        autoPublishRef.current = new Promise<void>((resolve) => { autoPublishDoneRef.current = resolve; });
      } else if (msg.type === 'autoPublishFailed') {
        autoPublishDoneRef.current?.();
      } else if (msg.type === 'autoPublish' && typeof msg.data === 'string' && msg.info && typeof msg.info.id === 'string') {
        // "Update automatically": the page sealed the edited note; upload it, then the new time.
        const info = msg.info as NotePublish;
        putPublished(masterKey, info, base64ToBytes(msg.data)).then(
          () => sendToEditor({ type: 'setPublish', info }),
          (e) => console.warn('Automatic publish failed:', e),
        ).finally(() => autoPublishDoneRef.current?.());
      } else if (msg.type === 'attachments' && Array.isArray(msg.list)) {
        setAttachments(msg.list);
      } else if (msg.type === 'backupShown') {
        setComparing(false);
        onBackupShown?.();
      } else if (msg.type === 'editorFocus') {
        onEditorFocus?.();
      } else if (msg.type === 'backResult') {
        backWaitRef.current?.(!!msg.handled);
      } else if (msg.type === 'goingAway') {
        // The page opens the system file picker (image / file input).
        goingAway();
      } else if (msg.type === 'wantFocus') {
        webViewRef.current?.requestFocus?.();
      } else if (msg.type === 'expectKeyboard') {
        // The native keyboard handling follows the keyboard by itself.
      } else if (msg.type === 'alert' && typeof msg.text === 'string') {
        appAlert('Noted', msg.text);
      } else if (msg.type === 'exported' && typeof msg.name === 'string') {
        finishExport(msg).catch((e) => appAlert('Export failed', String(e instanceof Error ? e.message : e)));
      } else if (msg.type === 'historyCopy' && typeof msg.state === 'string') {
        onSaveCopy(base64ToBytes(msg.state));
      } else if (msg.type === 'save') {
        saveFromEditor(msg);
      } else if (msg.type === 'log') {
        console.warn('[editor]', msg.message);
      }
    } catch (e) {
      console.error('Bad editor message:', e);
    }
  };

  // Bring changes written by sync (other devices) into the open editor. The merge is a CRDT
  // apply, so a poll that overlaps with typing can never lose text.
  useEffect(() => {
    const timer = setInterval(async () => {
      if (!readyRef.current || pendingSavesRef.current > 0) return;
      const sealed = await loadSealedState();
      if (sealed && sealed !== lastSentRef.current) await pushState('remote');
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [note.id, masterKey]);

  // Leaving is instant: the parent hides this screen right away. Hidden, it asks the editor
  // for its last edits, waits until they are stored, then removes itself.
  const handleBack = () => onBack();
  useEffect(() => {
    if (visible) return;
    Keyboard.dismiss();
    sendToEditor({ type: 'flush' });
    let cancelled = false;
    (async () => {
      await new Promise((r) => setTimeout(r, CLOSE_FLUSH_MS));
      await queueRef.current;
      // An automatic publish started by the close: the hidden editor stays up to 10 s more,
      // until the page sealed the note and the upload finished (leaving was instant anyway).
      if (autoPublishRef.current) await Promise.race([autoPublishRef.current, new Promise((r) => setTimeout(r, 10_000))]);
      if (!cancelled) onClosed();
    })();
    return () => { cancelled = true; };
  }, [visible]);

  // Settings > Editor / Toolbar changed while the note is open.
  useEffect(() => onPrefsChange(() => {
    if (readyRef.current) sendToEditor({ type: 'editorPrefs', prefs: getEditorPrefs(), toolbar: getToolbarConfig(), tableToolbar: getTableToolbarConfig() });
  }), []);

  const catalogRef = useRef(catalog);
  catalogRef.current = catalog;
  useEffect(() => {
    if (readyRef.current) sendToEditor({ type: 'catalog', ...catalog });
  }, [catalog]);

  const titlesRef = useRef(titles);
  titlesRef.current = titles;
  const placesRef = useRef(places);
  placesRef.current = places;
  const archivedRef = useRef(archivedIds);
  archivedRef.current = archivedIds;
  useEffect(() => {
    if (readyRef.current) sendToEditor({ type: 'titles', titles, places: placesRef.current, archived: archivedRef.current, currentId: note.id });
  }, [titles, places, archivedIds.join(',')]);

  // The keyboard: Android tells its final height when it starts to slide in
  // (react-native-keyboard-controller). The editor's box ends where the keyboard will end, set
  // once and at once: the page shrinks one time, its bar sits where the keyboard's top will
  // be, and nothing moves back afterwards (an animated padding overshot and came back). The
  // page is told when the keyboard comes or goes (Back hides it without a blur).
  const [keyboardPad, setKeyboardPad] = useState(0);
  const fitToKeyboard = (height: number) => {
    boxRef.current?.measureInWindow((_x, y, _w, h) => {
      const top = Dimensions.get('screen').height - height;
      setKeyboardPad(Math.max(0, Math.round(y + h - top)));
    });
  };
  // The keyboard went away. Also called by hand when a modal (note menu, publish, …) takes the
  // window focus: the keyboard hides then, but its events go to the modal's window, and the page
  // kept its bar and the keyboard's room with no keyboard under them.
  const keyboardGone = () => {
    keyboardTopRef.current = null;
    setKeyboardPad(0);
    sendToEditor({ type: 'keyboard', inset: 0, shown: false });
  };
  useEffect(() => {
    if (!visible) return;
    const show = KeyboardEvents.addListener('keyboardWillShow', (e) => {
      keyboardTopRef.current = 1;
      rememberKeyboardHeight(e.height);
      fitToKeyboard(e.height);
      sendToEditor({ type: 'keyboard', inset: 0, shown: true });
    });
    // Samsung's keyboard grows once it is up (its icon row): fit again to the real height.
    const shown = KeyboardEvents.addListener('keyboardDidShow', (e) => { rememberKeyboardHeight(e.height); fitToKeyboard(e.height); });
    const hide = KeyboardEvents.addListener('keyboardWillHide', keyboardGone);
    // Another app in front (share menu, file picker, opened file): the keyboard is gone, and
    // its hide event may never reach this window.
    const app = AppState.addEventListener('change', (state) => { if (state !== 'active') keyboardGone(); });
    return () => { show.remove(); shown.remove(); hide.remove(); app.remove(); };
  }, [visible]);
  // The page focuses by code; Android's WebView takes key input only once it has the native
  // focus, which it otherwise gets from a long press. Given when the note is shown.
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => webViewRef.current?.requestFocus?.(), 300);
    return () => clearTimeout(t);
  }, [visible]);

  // ---- locked notes ----
  const withVaultKey = (then: (key: Uint8Array) => void) => {
    const key = getVaultKey();
    if (key) then(key);
    else setVaultPrompt({ then });
  };
  // A fresh page: the note opens again from what is stored (locked or not).
  const reloadPage = () => {
    readyRef.current = false;
    setPageKey((k) => k + 1);
  };
  const setLock = async (key: Uint8Array, on: boolean) => {
    // The page hands over its last edits first.
    sendToEditor({ type: 'flush' });
    await new Promise((r) => setTimeout(r, CLOSE_FLUSH_MS));
    await queueRef.current;
    await updateNoteRecord(masterKey, dbStore, note.id, (doc) => (on ? lockNote(doc, key) : unlockNote(doc, key)));
    triggerSync();
    reloadPage();
  };
  // The vault closed (App lock, Settings): an open locked note closes too.
  useEffect(() => onVaultKeyChange(() => {
    if (!getVaultKey() && lockedOpenRef.current) reloadPage();
  }), []);

  // ---- note menu ----
  const nameOf = (list: { id: string; name: string }[], ids: string[]) =>
    ids.map((id) => list.find((e) => e.id === id)).filter((e): e is { id: string; name: string } => !!e);
  const duplicate = async () => {
    // The copy is made from the stored note: hand over the last edits first.
    sendToEditor({ type: 'flush' });
    await new Promise((r) => setTimeout(r, CLOSE_FLUSH_MS));
    await queueRef.current;
    onDuplicate();
  };
  const deleteForever = () => appAlert('Delete for good?', `“${titles[note.id] ?? 'This note'}” will be deleted on every device. This cannot be undone.`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: () => {
      if (noteState.published) deletePublished(masterKey, noteState.published).catch(() => {});
      sendToEditor({ type: 'deleteForever' });
      onRemoved();
    } },
  ]);

  const replyTo = (requestId: unknown) => (value?: unknown, error?: unknown) => {
    if (typeof requestId !== 'string') return;
    sendToEditor({ type: 'reply', requestId, value: value ?? null, error: error ? String(error instanceof Error ? error.message : error) : undefined });
  };
  // "Image from URL": downloaded here (no CORS limits in React Native), only http(s) images
  // up to 25 MB; the page compresses and seals it.
  const fetchImage = async (input: string) => {
    const url = normalizeLinkUrl(input);
    if (!url || !/^https?:/i.test(url)) throw new Error('Not a web address');
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`);
    const mime = (res.headers.get('content-type') ?? '').split(';')[0].trim();
    if (mime && !mime.startsWith('image/')) throw new Error(`Not an image (${mime})`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > 25 * 1024 * 1024) throw new Error('Image is larger than 25 MB');
    const name = decodeURIComponent(url.split('?')[0].split('/').pop() || 'image');
    return { data: bytesToBase64(bytes), mime: mime || 'image/png', name };
  };

  // Export: saved into the download folder (asked once), or handed to the share menu.
  const finishExport = async (msg: { format: string; name: string; text?: string; html?: string; share?: boolean; files?: { title: string; json: object; titles: Record<string, string> } }) => {
    let data: Uint8Array | string;
    // Markdown with images / files: a zip with an "attachments" folder (like the desktop).
    if (msg.files) {
      const { links, files } = await exportAttachments(masterKey, msg.files.json as Parameters<typeof exportAttachments>[1], blobStore);
      if (files.length) {
        const zipName = msg.name.replace(/\.md$/, '.zip');
        const zip = zipNoteWithFiles(msg.name, exportNote(msg.files.title, msg.files.json, 'markdown', msg.files.titles, links), files);
        if (msg.share) return shareFileBytes(zipName, zip, 'application/zip');
        const text = await saveFileBytes(zipName, zip, 'application/zip');
        if (text) showToast(text);
        return;
      }
    }
    if (msg.format === 'pdf' && typeof msg.html === 'string') {
      // The printer's own file cannot be moved (no read access): take its bytes.
      const { base64 } = await Print.printToFileAsync({ html: msg.html, base64: true });
      if (!base64) throw new Error('The PDF printer returned nothing');
      data = base64ToBytes(base64);
    } else if (typeof msg.text === 'string') {
      data = msg.text;
    } else return;
    const mimeType = msg.format === 'pdf' ? 'application/pdf' : msg.format === 'markdown' ? 'text/markdown' : 'text/plain';
    if (msg.share) return shareFileBytes(msg.name, data, mimeType);
    const text = await saveFileBytes(msg.name, data, mimeType);
    if (text) showToast(text);
  };

  const openMenu = (page: 'main' | 'publish' | 'links' = 'main') => {
    setMenuPage(page);
    keyboardBeforeMenuRef.current = keyboardTopRef.current !== null;
    Keyboard.dismiss();
    keyboardGone();
    setHistoryList(null);
    setAttachments(null);
    sendToEditor({ type: 'listAttachments' });
    setMenuOpen(true);
    listHistory(note.id, sessionRef.current?.id).then(setHistoryList, () => setHistoryList([]));
    checkSelfDestructed();
  };
  // The WebView gets the native focus back first, so the page can bring up the keyboard.
  const focusPage = (msg: Record<string, unknown>) => {
    setTimeout(() => {
      webViewRef.current?.requestFocus?.();
      sendToEditor(msg);
    }, 250);
  };
  const closeMenu = (back: boolean) => {
    setMenuOpen(false);
    if (back && keyboardBeforeMenuRef.current) focusPage({ type: 'refocus' });
  };
  // Publish / update: the page renders the copy (HTML with images and the note's CSS), it is
  // sealed and uploaded here, and the link goes into the note's settings through the page.
  // A self-destructing copy is gone once it was read: the note goes back to not published
  // (checked when it opens, when the menu opens and every 30 s).
  const checkSelfDestructed = async () => {
    const info = noteStateRef.current.published;
    if (!info || !(info.selfDestruct || info.expiresAt)) return;
    if ((info.expiresAt && info.expiresAt <= Date.now()) || await publishedExists(masterKey, info) === false) {
      sendToEditor({ type: 'setPublish', info: null });
      setNoteState((st) => ({ ...st, published: null }));
    }
  };
  const selfDestructId = noteState.published?.selfDestruct || noteState.published?.expiresAt ? noteState.published.id : null;
  useEffect(() => {
    if (!selfDestructId || !visible) return;
    checkSelfDestructed();
    const timer = setInterval(checkSelfDestructed, 30_000);
    return () => clearInterval(timer);
  }, [selfDestructId, visible]);

  // The page also seals the copy (a password means PBKDF2, much faster there than in Hermes).
  const publish = async (settings: { password: string | null; selfDestruct: boolean; autoUpdate: boolean; expiresAt: number | null }) => {
    const info = nextPublishInfo(noteState.published, settings);
    const sealed = await new Promise<Uint8Array | null>((resolve) => {
      payloadWaiterRef.current = resolve;
      sendToEditor({ type: 'getPublishPayload', info });
      setTimeout(() => { if (payloadWaiterRef.current === resolve) { payloadWaiterRef.current = null; resolve(null); } }, 30_000);
    });
    if (!sealed) throw new Error('The note could not be prepared');
    await putPublished(masterKey, info, sealed);
    sendToEditor({ type: 'setPublish', info });
    setNoteState((st) => ({ ...st, published: info }));
  };
  const unpublish = async () => {
    if (noteState.published) await deletePublished(masterKey, noteState.published);
    sendToEditor({ type: 'setPublish', info: null });
    setNoteState((st) => ({ ...st, published: null }));
  };

  const openHistory = async (id: string) => {
    const sealed = await readHistoryState(id);
    const entry = historyList?.find((h) => h.id === id);
    if (!sealed || !entry) return;
    try {
      // The edits of the running session go first, so the comparison sees the latest text.
      sendToEditor({ type: 'showHistory', state: bytesToBase64(unseal(masterKey, sealed)), startedAt: entry.startedAt, endedAt: entry.endedAt });
    } catch (e) {
      appAlert('Cannot open this version', String(e));
    }
  };

  const backWaitRef = useRef<((handled: boolean) => void) | null>(null);
  // Modals take the window focus (see keyboardGone).
  useEffect(() => { if (vaultPrompt) keyboardGone(); }, [vaultPrompt]);
  useEffect(() => onDialogShown(() => { if (visible) keyboardGone(); }), [visible]);
  const handleBackRef = useRef(handleBack);
  handleBackRef.current = handleBack;
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      // The page first closes what is open on it (sheet, picture, history, find bar); only
      // when nothing was, Back leaves the note. No answer in time = leave anyway.
      if (!readyRef.current) { handleBackRef.current(); return true; }
      if (backWaitRef.current) return true;
      const timer = setTimeout(() => { backWaitRef.current = null; handleBackRef.current(); }, 400);
      backWaitRef.current = (handled) => {
        clearTimeout(timer);
        backWaitRef.current = null;
        if (!handled) handleBackRef.current();
      };
      sendToEditor({ type: 'back' });
      return true;
    });
    return () => sub.remove();
  }, [visible]);

  return (
    <View style={styles.container}>
      <View style={[styles.header, compact && { paddingTop: 4 }]}>
        <TouchableOpacity onPress={handleBack} style={styles.iconBtn} accessibilityLabel={inSplit ? 'Close this pane' : 'Back'}>
          <Icon path={inSplit ? mdiClose : mdiArrowLeft} />
        </TouchableOpacity>
        <View style={{ flex: 1 }} />
        {/* Greyed out when there is nothing to undo / redo. */}
        <TouchableOpacity onPress={() => sendToEditor({ type: 'undo' })} disabled={!history.undo} style={styles.iconBtn} accessibilityLabel="Undo">
          <Icon path={mdiUndo} color={history.undo ? T.on_surface : T.outline_variant} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => sendToEditor({ type: 'redo' })} disabled={!history.redo} style={styles.iconBtn} accessibilityLabel="Redo">
          <Icon path={mdiRedo} color={history.redo ? T.on_surface : T.outline_variant} />
        </TouchableOpacity>
        {/* The note menu's "Links" page (links to and from this note), count = both. */}
        <TouchableOpacity onPress={() => openMenu('links')} style={styles.linksBtn} accessibilityLabel="Links">
          <Icon path={mdiVectorLink} size={22} />
          {links.length + backlinks.length > 0 ? <Text style={styles.linksCount}>{links.length + backlinks.length}</Text> : null}
        </TouchableOpacity>
        <TouchableOpacity onPress={() => { Keyboard.dismiss(); keyboardGone(); onShowTabs(); }} style={styles.tabCount} accessibilityLabel="Open tabs">
          <Text style={styles.tabCountText}>{tabsCount}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => openMenu()} style={styles.iconBtn} accessibilityLabel="Note menu">
          <Icon path={mdiDotsVertical} />
        </TouchableOpacity>
      </View>
      <View ref={boxRef} collapsable={false} style={{ flex: 1, paddingBottom: keyboardPad }}>
        {/* @ts-expect-error - React 19 type clash with react-native-webview */}
        <WebView
          key={pageKey}
          ref={webViewRef}
          source={{ html: EDITOR_HTML }}
          originWhitelist={['*']}
          onMessage={handleMessage}
          style={styles.webview}
          keyboardDisplayRequiresUserAction={false}
          hideKeyboardAccessoryView={true}
        />
      </View>
      {comparing ? <View style={[StyleSheet.absoluteFill, { backgroundColor: T.background }]} /> : null}
      {lockedClosed ? (
        <View style={styles.lockedCover}>
          <Icon path={mdiLockOutline} size={44} color={T.primary} />
          <Text style={styles.lockedTitle}>{titles[note.id] ?? 'Untitled'}</Text>
          <Text style={styles.lockedText}>This note is locked.</Text>
          <TouchableOpacity style={styles.lockedButton} onPress={() => withVaultKey(() => reloadPage())}>
            <Text style={{ color: T.on_primary, fontWeight: 'bold', fontSize: 15 }}>Open with the vault password</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      {vaultPrompt ? (
        <VaultPrompt mode={vaultSetup ? 'unlock' : 'create'} onClose={() => setVaultPrompt(null)} onSubmit={async (password) => {
          let key: Uint8Array | null;
          if (vaultSetup) {
            key = openVault(vaultSetup, await deriveKeyInWebView(password, vaultSetup.salt));
            if (!key) return 'Wrong vault password.';
          } else {
            key = await onCreateVault(password);
            if (!key) return 'Could not create the vault.';
          }
          setVaultKey(key);
          const then = vaultPrompt.then;
          setVaultPrompt(null);
          then(key);
          return null;
        }} />
      ) : null}
      {menuOpen ? (
        <NoteMenu
          locked={noteState.locked || lockedClosed}
          onLock={(on) => withVaultKey((key) => { setLock(key, on).catch((e) => appAlert('Lock', String(e))); })}
          title={titles[note.id] ?? 'Untitled'}
          created={noteState.created}
          edited={edited}
          notebooks={nameOf(catalog.notebooks, noteState.notebooks)}
          tags={nameOf(catalog.tags, noteState.tags)}
          flags={noteState.flags}
          trashed={noteState.trashed}
          attachments={attachments}
          onAttachment={(action, a) => sendToEditor({ type: 'attachmentAction', action, blob: a.blob, name: a.name })}
          links={links}
          backlinks={backlinks}
          onFlag={(flag, on) => {
            sendToEditor({ type: 'setFlag', flag, on });
            if (flag === 'archived') onArchived?.(note.id, on);
          }}
          onPick={(kind) => sendToEditor({ type: 'openCatalog', kind })}
          onOpenNote={onOpenNote}
          onCopy={() => sendToEditor({ type: 'getText', purpose: 'copy' })}
          onShare={() => sendToEditor({ type: 'getText', purpose: 'share' })}
          onDuplicate={duplicate}
          onTrash={() => { sendToEditor({ type: 'setTrashed', on: true }); onRemoved(); }}
          onRestore={() => sendToEditor({ type: 'setTrashed', on: false })}
          onDeleteForever={deleteForever}
          onFind={() => focusPage({ type: 'find' })}
          onExport={(format, share) => sendToEditor({ type: 'export', format, share })}
          history={historyList}
          onOpenHistory={openHistory}
          initialPage={menuPage}
          published={noteState.published ? {
            url: publishedUrl(noteState.published), at: noteState.published.at,
            password: noteState.published.password ?? null, selfDestruct: !!noteState.published.selfDestruct,
            autoUpdate: !!noteState.published.autoUpdate, expiresAt: noteState.published.expiresAt ?? null,
          } : null}
          onPublish={publish}
          onUnpublish={unpublish}
          onAutoUpdate={(on) => {
            const info = noteState.published;
            if (!info) return;
            const next = { ...info, autoUpdate: on && !info.selfDestruct };
            sendToEditor({ type: 'setPublish', info: next });
            setNoteState((st) => ({ ...st, published: next }));
          }}
          onOpenUrl={(url) => { Linking.openURL(url).catch(() => {}); }}
          onClose={closeMenu}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 8, paddingTop: 48, paddingBottom: 4, backgroundColor: T.background, borderBottomWidth: 1, borderBottomColor: T.outline_variant },
  iconBtn: { padding: 9, borderRadius: 22 },
  tabCount: { minWidth: 28, height: 28, borderRadius: 8, borderWidth: 2, borderColor: T.on_surface, alignItems: 'center', justifyContent: 'center', marginHorizontal: 8 },
  linksBtn: { height: 40, paddingHorizontal: 6, flexDirection: 'row', alignItems: 'center', gap: 2 },
  linksCount: { color: T.on_surface_variant, fontSize: 12, fontWeight: 'bold' },
  tabCountText: { color: T.on_surface, fontWeight: 'bold', fontSize: 12 },
  webview: { flex: 1, backgroundColor: T.background },
  lockedCover: { position: 'absolute', left: 0, right: 0, bottom: 0, top: 100, alignItems: 'center', paddingTop: 80, backgroundColor: T.background },
  lockedTitle: { color: T.on_surface, fontSize: 20, fontWeight: 'bold', marginTop: 12 },
  lockedText: { color: T.on_surface_variant, fontSize: 14, marginTop: 4 },
  lockedButton: { marginTop: 20, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 22, backgroundColor: T.primary },
});
