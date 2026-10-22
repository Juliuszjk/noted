import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import type { CSSProperties } from 'react';
import Database from '@tauri-apps/plugin-sql';
import { openUrl } from '@tauri-apps/plugin-opener';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import { apiUrl, hasServer, SYNC_INTERVAL_MS, wsUrl, WS_STALE_MS, KEY_STORAGE, VERIFIER_STORAGE, SERVER_STORAGE, configureServerStorage } from '@noted/config';
import { NoteRecord } from '@noted/types';
import {
  runSyncEngine, uploadPendingBlobs, LocalNoteStore, mergingNoteStore, configureVerifierCache, configureLocalVault, moveVaultToServer, refreshServerInfo, buildNoteMeta, encodeNoteMeta,
  decodeNoteMeta, displayTitle, setTitle, markNoteCreated, setNoteFlag, getNoteFlag, setNoteTrashed,
  deleteNoteForever, unpublishQuietly, uploadPublished, deletePublished, publishedExists, publishExpired, getNotePublish, setNotePublish, setNoteNotebook, getNoteNotebooks, setNoteTag, getNoteTags, setNoteFont, getNoteFont, CATALOG_ID, isSystemNote,
  listCatalog, getSharedEditorPrefs, refreshStaleNoteMeta, listOwnReminders, setOwnReminder, deleteOwnReminder, updateReminderInDoc, setSharedEditorPrefs, sharedPrefsChange, SHARED_EDITOR_PREFS, ensureCatalogEntry, renameCatalogEntry, removeCatalogEntry, purgeExpiredTrash, getTitleText, getNoteSettings,
  currentAuthToken, sessionStillValid, setAuthEpoch, getAuthEpoch, exportAttachments, zipNoteWithFiles, backupVault, restoreServerVault, fetchVaultStatus, createBackup, restoreBackup, backupFileName, openBackup, compareBackup, restoreBackupNote, findUnusedBlobs, deleteServerBlobs, deletedNoteIds, purgeDeletedNotes, usedBlobIds, BLOB_GRACE_MS, noteBlobIds, docFromSealed, noteBodyText, applyDefaultTitle, setNoteBodyJson, appendNoteLink,
  fetchVault, passphraseOpens, parseVaultInfo, serializeVaultInfo, createLiveOwner, publishLive, LIVE_ORIGIN,
  getVaultSetup, createVault, openVault, changeVaultPassword, isNoteLocked, lockNote, unlockNote, readLockedBody, writeLockedBody, noteBodyJson, noteAttachments,
} from '@noted/sync';
import { formatBlobRef, parseBlobRef, parseEditorPrefs, DEFAULT_EDITOR_PREFS, newReminderId, applyReminderAction } from '@noted/editor';
import type { ReminderState, ReminderAction } from '@noted/editor';
import { exportNote } from '@noted/editor/export';
import { PINCH_EVENT } from '@noted/editor/image-viewer';
import type { CatalogKind } from '@noted/sync';

// The sync package is storage-agnostic; the desktop app caches the vault verifier in localStorage.
configureVerifierCache({
  get: () => localStorage.getItem(VERIFIER_STORAGE),
  set: (verifier) => localStorage.setItem(VERIFIER_STORAGE, verifier),
});
// The server this device talks to (chosen on the unlock screen), kept in localStorage too.
configureServerStorage(() => localStorage.getItem(SERVER_STORAGE), (text) => localStorage.setItem(SERVER_STORAGE, text));
// Without a server the vault's data (salt, verifier, envelopes) lives here instead.
configureLocalVault({ load: () => localStorage.getItem('noted_local_vault'), save: (text) => localStorage.setItem('noted_local_vault', text) });
import { bytesToBase64, base64ToBytes, seal, unseal, deriveMasterKey, generateSalt } from '@noted/crypto';
import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import { mdiDotsVertical, mdiBookOutline, mdiDockLeft, mdiFormatListText } from '@mdi/js';
import {
  SettingsDialog, LockScreen, VaultDialog, LockedNote, NotePicker, NoteEditor, UnlockScreen, NoteList, TabBar, StatusBar, NavPanel, NoteProperties, CatalogPicker, HistoryPreview,
  IconBtn, Icon, tabDropIndex, placeTab, confirmDialog, messageDialog, showDialog, linkDescendants, matchesShortcut, setShortcutOverrides, getShortcutOverrides, notesInView, Resizer, RESIZE_SNAP, LinkTree, RemindersList, reminderEntries, dueReminderCount, reminderNotices, parseNoticeId, MISSED_WITHIN_MS, NAV_MIN_WIDTH, NAV_RAIL_WIDTH,
} from '@noted/ui';
import type { NoteSummary, NoteListItem, TextStats, NoteAction, NoteView, PropertyFlags, HistoryEntry, ImportedNote, AttachmentEntry, ReminderEntry } from '@noted/ui';
import { notePlaces, parseImport, IMPORT_SOURCES, expandZips, noteFilesFor } from '@noted/ui';
import type { BlobHandlers } from '@noted/editor';
import type { JSONContent } from '@tiptap/core';
import { BLOBS_TABLE_SQL, clearAttachmentCache, createDesktopBlobStore, createDesktopBlobHandlers, migrateBlobsToFiles } from './blobs';
import { HISTORY_TABLE_SQL, listHistory, readHistoryState, recordHistory, allHistoryStates } from './history';
import type { HistorySession } from './history';
import { loadPrefs, savePrefs, PROPS_MIN_WIDTH, PROPS_MAX_WIDTH, loadShortcutOverrides, saveShortcutOverrides } from './prefs';
import type { Prefs } from './prefs';
import {
  readEpoch, writeEpoch, readAppZoom, applyAppZoom, saveFileDialog, openTextFileDialog, readAutoBackup, writeAutoBackup,
  backupFolderPath, runAutoBackupIfDue, exportAll, chooseBackupFolder, openBackupFolder,
  readEditorPrefs, applyEditorPrefs, readToolbarConfig, writeToolbarConfig, readTableToolbarConfig, writeTableToolbarConfig, readDrawingToolbarConfig, writeDrawingToolbarConfig, drawingToolsStore, spellLanguagesAvailable, getCustomWords, setCustomWords,
  readDesktopIntegration, applyDesktopIntegration, pickImportFiles, importFilesFromPaths, onFileDrop, listBackups, readAppLock, writeAppLock, cacheVaultInfo, readCachedVaultInfo,
} from './settings-host';
import type { DesktopIntegration } from './settings-host';
import { getThemeMode, setThemeMode } from './theme';
import { readDownloadFolder, writeDownloadFolder, chooseDownloadFolder } from './download-folder';
import { useMagnifier } from './magnifier';
import { UPDATES_ON, checkForUpdates } from './updates';
import { SplitPane, DropZones, zoneAt, DEFAULT_FLOAT } from './SplitPane';
import type { SplitMode, SplitSide, FloatBox } from './SplitPane';

// The user's keyboard shortcuts are known before anything renders.
setShortcutOverrides(loadShortcutOverrides());
import './index.css';

type ActiveNote = { id: string; ydoc: Y.Doc };
type Picker = { kind: CatalogKind; x: number; y: number };

const PROBE_INTERVAL_MS = 5000;
// Live published notes: the newest guest update this device merged, per link id.
const LIVE_SEQ_KEY = 'noted_live_seq';
const readLiveSeqs = (): Record<string, number> => {
  try {
    return JSON.parse(localStorage.getItem(LIVE_SEQ_KEY) ?? '{}');
  } catch {
    return {};
  }
};

// Reminder notices this device has shown (kept across restarts so a restart does not notify
// them again; ids name the time, so old ones are dropped once past the "missed" window).
const SHOWN_NOTICES = 'noted_reminders_shown';
const readShownNotices = (): string[] => {
  try {
    const list = JSON.parse(localStorage.getItem(SHOWN_NOTICES) ?? '[]');
    return Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
};
const rememberShownNotice = (id: string) => {
  const oldest = Date.now() - MISSED_WITHIN_MS;
  const list = readShownNotices().filter((shown) => shown !== id && (parseNoticeId(shown)?.due ?? 0) > oldest);
  try { localStorage.setItem(SHOWN_NOTICES, JSON.stringify([...list, id])); } catch { /* not kept: may notify again after a restart */ }
};
const PROBE_TIMEOUT_MS = 3000;

const VIEW_TITLES = { notes: 'Notes', favorites: 'Favorites', archive: 'Archive', trash: 'Trash', tree: 'Links tree', published: 'Published', reminders: 'Reminders' } as const;

// `restoreText`: a backup to restore at start (the vault was just set up from it).
function NotesApp({ masterKey, onLogout, restoreText }: { masterKey: Uint8Array; onLogout: (reason?: string) => void; restoreText?: string }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [themeMode, setThemeModeState] = useState(getThemeMode);
  const [appZoom, setAppZoom] = useState(readAppZoom);
  const [autoBackup, setAutoBackupState] = useState(readAutoBackup);
  const [backupFolder, setBackupFolder] = useState('~/Documents/Noted backups');
  // Settings > App lock: locked at start (when on) and after the chosen idle time.
  const [appLock, setAppLockState] = useState(readAppLock);
  const [locked, setLocked] = useState(() => readAppLock().enabled);
  const lastActivityRef = useRef(Date.now());
  useEffect(() => {
    fetchVault().then((info) => { if (info) cacheVaultInfo(serializeVaultInfo(info)); }, () => {});
    const touch = () => { lastActivityRef.current = Date.now(); };
    const events = ['mousedown', 'keydown', 'wheel', 'mousemove'] as const;
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    const timer = setInterval(() => {
      const lock = readAppLock();
      if (lock.enabled && lock.minutes > 0 && Date.now() - lastActivityRef.current > lock.minutes * 60_000) setLocked(true);
    }, 15_000);
    return () => { events.forEach((e) => window.removeEventListener(e, touch)); clearInterval(timer); };
  }, []);
  const unlockApp = async (passphrase: string) => {
    // The server's data when it can be reached (the passphrase may have been changed
    // elsewhere), else the copy kept here.
    const fresh = await fetchVault().catch(() => null);
    if (fresh) cacheVaultInfo(serializeVaultInfo(fresh));
    const info = fresh ?? parseVaultInfo(readCachedVaultInfo());
    if (!info) throw new Error('Cannot check the passphrase (no vault data yet).');
    const salt = Uint8Array.from(atob(info.salt), (c) => c.charCodeAt(0));
    if (!passphraseOpens(info, deriveMasterKey(passphrase, salt), masterKey)) return false;
    lastActivityRef.current = Date.now();
    setLocked(false);
    return true;
  };
  const [editorPrefs, setEditorPrefs] = useState(readEditorPrefs);
  const editorPrefsRef = useRef(editorPrefs);
  editorPrefsRef.current = editorPrefs;
  const [toolbarConfig, setToolbarConfig] = useState(readToolbarConfig);
  const [tableToolbarConfig, setTableToolbarConfig] = useState(readTableToolbarConfig);
  const [drawingToolbarConfig, setDrawingToolbarConfig] = useState(readDrawingToolbarConfig);
  const [spellLanguages, setSpellLanguages] = useState<string[]>([]);
  const [desktopIntegration, setDesktopIntegration] = useState<DesktopIntegration>({ autostart: false, closeToTray: false, minimizeToTray: false });
  const [appVersion, setAppVersion] = useState('');
  useEffect(() => { getVersion().then(setAppVersion).catch(() => {}); }, []);
  useEffect(() => {
    applyAppZoom(readAppZoom());
    backupFolderPath().then(setBackupFolder, () => {});
    spellLanguagesAvailable().then((langs) => {
      setSpellLanguages(langs);
      // First start with dictionaries: check every installed language.
      const prefs = readEditorPrefs();
      if (!prefs.spellLanguages.length && langs.length) {
        const next = { ...prefs, spellLanguages: langs };
        setEditorPrefs(next);
        applyEditorPrefs(next);
      } else applyEditorPrefs(prefs);
    });
    readDesktopIntegration().then((d) => { setDesktopIntegration(d); applyDesktopIntegration(d).catch(() => {}); });
  }, []);
  const [db, setDb] = useState<Database | null>(null);
  const [notes, setNotes] = useState<NoteRecord[]>([]);
  const [activeNote, setActiveNote] = useState<ActiveNote | null>(null);
  // Split view: a second note beside the open one, or in a small window (SplitPane.tsx).
  const [split, setSplit] = useState<{ id: string; ydoc: Y.Doc; mode: SplitMode; docked: SplitSide; ratio: number; float: FloatBox } | null>(null);
  const splitAppliedRef = useRef<string | null>(null);
  const [noteArea, setNoteArea] = useState<HTMLDivElement | null>(null);
  const [noteDrag, setNoteDrag] = useState<{ id: string; x: number; y: number; zone: SplitMode | null; tabAt: number | null } | null>(null);
  const [shortcutOverrides, setShortcutState] = useState(getShortcutOverrides);
  const changeShortcuts = (next: Record<string, string[]>) => {
    setShortcutOverrides(next);
    saveShortcutOverrides(next);
    setShortcutState(next);
  };
  // Touchpad pinch magnifier of the note area (reset when another note opens).
  const magnifier = useMagnifier(activeNote?.id ?? null);
  const [syncMessage, setSyncMessage] = useState('');
  const [online, setOnline] = useState(false);
  // false = this device works without a server (nothing is sent); true after connecting one.
  const [serverOn, setServerOn] = useState(hasServer);
  const [syncing, setSyncing] = useState(false);
  // Settings > Sync: when a sync last reached the server.
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [downloadFolder, setDownloadFolder] = useState(readDownloadFolder);
  const [synced, setSynced] = useState(true);
  const [stats, setStats] = useState<TextStats | null>(null);
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [tabs, setTabs] = useState<string[]>([]);
  const [toolbarSlot, setToolbarSlot] = useState<HTMLDivElement | null>(null);
  const [tableMenuSlot, setTableMenuSlot] = useState<HTMLDivElement | null>(null);
  const [drawingMenuSlot, setDrawingMenuSlot] = useState<HTMLDivElement | null>(null);
  const [findSlot, setFindSlot] = useState<HTMLDivElement | null>(null);
  const [blobHandlers, setBlobHandlers] = useState<BlobHandlers | undefined>(undefined);
  const [picker, setPicker] = useState<Picker | null>(null);
  // "/goto" and Ctrl+P (open a note), "/linkto" (link the open note from another one).
  const [notePicker, setNotePicker] = useState<{ mode: 'goto' | 'linkto'; at: { x: number; y: number } | null } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = (text: string) => {
    setToast(text);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  };
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [preview, setPreview] = useState<{ entry: HistoryEntry; state: Uint8Array } | null>(null);
  // A history version to copy over the open note. It names its note: only that note's editor
  // applies it (it once stayed set and overwrote every note opened afterwards).
  const [restore, setRestore] = useState<{ id: number; noteId: string; content: JSONContent; title: string } | null>(null);

  const dbRef = useRef<Database | null>(null);
  const notesRef = useRef<NoteRecord[]>([]);
  const activeRef = useRef<ActiveNote | null>(null);
  const tabsRef = useRef<string[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const syncingRef = useRef(false);
  const syncAgainRef = useRef(false);
  const saveTimeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // Bumped on every local edit; a sync that started at the same version leaves nothing unsent.
  const editVersionRef = useRef(0);
  // Visited notes for the back / forward arrows.
  const historyRef = useRef<{ stack: string[]; index: number }>({ stack: [], index: -1 });
  // Version history session per note being edited; opening a note starts a new one.
  const sessionsRef = useRef<Record<string, HistorySession>>({});
  const [, setHistoryTick] = useState(0);

  activeRef.current = activeNote;
  tabsRef.current = tabs;

  useEffect(() => { dbRef.current = db; }, [db]);
  useEffect(() => {
    savePrefs({ ...prefs, tabs, activeTab: activeNote?.id ?? null });
  }, [prefs, tabs, activeNote]);

  // ---- connection state ----
  // A dropped WebSocket over Tailscale is noticed only after a TCP timeout or the missing
  // heartbeat (~1 min), so the server is also probed every few seconds. The probe drives the
  // status dot and reconnects the socket as soon as the server answers again.
  const wsReadyRef = useRef(false);
  const reconnectRef = useRef<() => void>(() => {});
  // ---- live published notes (sync/live-owner.ts): guests' edits come over the WebSocket ----
  const wsSendRef = useRef<(message: object) => boolean>(() => false);
  // Set further down (they are plain functions of this component).
  const updateNoteDocRef = useRef<(id: string, change: (doc: Y.Doc) => void) => void>(() => {});
  const docOfRef = useRef<(note: NoteRecord) => Y.Doc | null>(() => null);
  // Cursors of the open live note (this device's and the guests').
  const liveAwarenessRef = useRef<{ noteId: string; awareness: Awareness } | null>(null);
  const liveOwner = useMemo(() => createLiveOwner({
    masterKey,
    send: (message) => wsSendRef.current(message),
    readNote: async (id) => {
      const active = activeRef.current;
      if (active?.id === id) return active.ydoc;
      const note = notesRef.current.find((n) => n.id === id);
      return note ? docOfRef.current(note) : null;
    },
    applyToNote: async (id, updates) => {
      updateNoteDocRef.current(id, (doc) => doc.transact(() => updates.forEach((u) => Y.applyUpdate(doc, u)), LIVE_ORIGIN));
    },
    getSeq: (id) => readLiveSeqs()[id] ?? 0,
    setSeq: (id, seq) => localStorage.setItem(LIVE_SEQ_KEY, JSON.stringify({ ...readLiveSeqs(), [id]: seq })),
    onAwareness: (noteId, update) => {
      const live = liveAwarenessRef.current;
      if (live?.noteId === noteId) applyAwarenessUpdate(live.awareness, update, LIVE_ORIGIN);
    },
  }), [masterKey]);
  // The server may report a new public address for published notes.
  useEffect(() => { refreshServerInfo(); }, []);
  useEffect(() => {
    if (!serverOn) return;
    const probe = async () => {
      try {
        const res = await fetch(`${apiUrl()}/`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
        setOnline(res.ok);
        if (res.ok && !wsReadyRef.current) reconnectRef.current();
      } catch {
        setOnline(false);
      }
    };
    probe();
    const timer = setInterval(probe, PROBE_INTERVAL_MS);
    window.addEventListener('online', probe);
    window.addEventListener('offline', probe);
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', probe);
      window.removeEventListener('offline', probe);
    };
  }, [serverOn]);

  // ---- realtime channel ----
  useEffect(() => {
    if (!db || !serverOn) return;
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let watchdog: ReturnType<typeof setInterval> | null = null;
    let lastMessageAt = Date.now();
    let attempt = 0;
    let stopped = false;

    const detach = () => {
      if (watchdog) clearInterval(watchdog);
      watchdog = null;
      if (socket) {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onclose = null;
        socket.onerror = null;
        socket.close();
        socket = null;
      }
    };

    const scheduleReconnect = () => {
      if (stopped || retryTimer) return;
      const delay = Math.min(30000, 1000 * 2 ** attempt);
      attempt++;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        connect();
      }, delay);
    };

    const drop = () => {
      wsReadyRef.current = false;
      wsSendRef.current = () => false;
      liveOwner.disconnected();
      detach();
      scheduleReconnect();
    };
    // Called by the probe: the server is back, do not wait for the backoff.
    reconnectRef.current = () => {
      if (stopped || socket) return;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      attempt = 0;
      connect();
    };

    const connect = () => {
      if (stopped) return;
      const ws = new WebSocket(wsUrl());
      socket = ws;
      lastMessageAt = Date.now();
      ws.onopen = () =>
        ws.send(JSON.stringify({ type: 'auth', token: currentAuthToken(masterKey) }));
      ws.onmessage = (ev) => {
        lastMessageAt = Date.now();
        try {
          const msg = JSON.parse(ev.data as string);
          if (liveOwner.handleMessage(msg)) return;
          if (msg.type === 'ready') {
            attempt = 0;
            wsReadyRef.current = true;
            wsSendRef.current = (message) => {
              if (ws.readyState !== WebSocket.OPEN) return false;
              ws.send(JSON.stringify(message));
              return true;
            };
            liveOwner.connected();
            setOnline(true);
            syncWithServer(db);
          } else if (msg.type === 'changed') {
            syncWithServer(db);
          }
        } catch { }
      };
      ws.onclose = (ev) => {
        // 4401: the token is not accepted any more; logged out from another device?
        if (ev.code === 4401) {
          sessionStillValid().then((valid) => {
            if (valid === false) onLogout('This device was logged out from another device. Unlock again to continue.');
          });
        }
        drop();
      };
      ws.onerror = drop;
      watchdog = setInterval(() => {
        if (Date.now() - lastMessageAt > WS_STALE_MS) drop();
      }, 10000);
    };

    connect();
    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      detach();
    };
  }, [db, masterKey]);

 // Automatic backups: checked at start and every hour.
  useEffect(() => {
    if (!db) return;
    const check = () => runAutoBackupIfDue(masterKey, noteStore(db), createDesktopBlobStore(db))
      .then((done) => { if (done) setAutoBackupState(readAutoBackup()); })
      .catch((e) => console.warn('Automatic backup failed:', e));
    const first = setTimeout(check, 20_000);
    const timer = setInterval(check, 60 * 60 * 1000);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, [db]);

  // ---- notes ----
  const docOf = (note: NoteRecord): Y.Doc | null => {
    const ydoc = new Y.Doc();
    if (!note.yjs_state) return ydoc;
    try {
      Y.applyUpdate(ydoc, unseal(masterKey, note.yjs_state));
      return ydoc;
    } catch (err) {
      console.error('Failed to decrypt or restore Yjs state:', err);
      return null;
    }
  };

  const selectNote = (note: NoteRecord): boolean => {
    // The open note keeps its live doc. A new doc from the stored state would leave the editor
    // (created once) on the old doc while saves read the new one: edits made after opening
    // the open note again (note list, Reminders) were never saved and vanished on restart.
    if (activeRef.current?.id === note.id) return true;
    const ydoc = docOf(note);
    if (!ydoc) {
      setSyncMessage('Cannot decrypt this note');
      return false;
    }
    setStats(null);
    delete sessionsRef.current[note.id];
    setActiveNote({ id: note.id, ydoc });
    return true;
  };

  const loadNotes = async (database: Database): Promise<NoteRecord[]> => {
    const list = await database.select<NoteRecord[]>('SELECT * FROM notes ORDER BY updated_at DESC');
    const decryptedList = list.map((note) => {
      let plain = note.content;
      if (note.content && note.content.includes('.')) {
        try {
          plain = new TextDecoder().decode(unseal(masterKey, note.content));
        } catch (e) {
          console.error('Cannot decrypt note', note.id, e);
          plain = '[cannot decrypt this note]';
        }
      }
      return { ...note, content: plain };
    });
    // Notes whose save is still waiting (handleEditorUpdate writes after 500 ms) are newer in
    // memory than in the database: keep those. An import that created notebooks and reloaded
    // the list at once showed "No notebooks yet" (the catalog's last entries were not saved yet).
    const pending = new Map(notesRef.current.filter((n) => saveTimeoutsRef.current[n.id]).map((n) => [n.id, n]));
    if (pending.size) decryptedList.forEach((n, i) => { const mine = pending.get(n.id); if (mine) decryptedList[i] = mine; });
    notesRef.current = decryptedList;
    setNotes(decryptedList);
    return decryptedList;
  };

  // ---- tabs and history ----
  const pushHistory = (id: string) => {
    const h = historyRef.current;
    if (h.stack[h.index] === id) return;
    h.stack = [...h.stack.slice(0, h.index + 1), id];
    h.index = h.stack.length - 1;
    setHistoryTick((t) => t + 1);
  };

  // Opens a note: switches to its tab if it has one; otherwise replaces the current tab, or
  // opens a new tab (newTab, or no tab open yet).
  const openNote = (id: string, options: { newTab?: boolean; fromHistory?: boolean } = {}) => {
    const note = notesRef.current.find((n) => n.id === id);
    if (!note || isSystemNote(id) || !selectNote(note)) return;
    const current = activeRef.current?.id;
    const prev = tabsRef.current;
    let next = prev;
    if (!prev.includes(id)) {
      const index = current ? prev.indexOf(current) : -1;
      if (!options.newTab && index >= 0) next = prev.map((t, i) => (i === index ? id : t));
      else next = [...prev.slice(0, index + 1), id, ...prev.slice(index + 1)];
    }
    tabsRef.current = next;
    setTabs(next);
    if (!options.fromHistory) pushHistory(id);
  };

  const closeTab = (id: string) => {
    const prev = tabsRef.current;
    const index = prev.indexOf(id);
    const next = prev.filter((t) => t !== id);
    tabsRef.current = next;
    setTabs(next);
    if (activeRef.current?.id !== id) return;
    const neighbour = next[index] ?? next[index - 1];
    const note = neighbour ? notesRef.current.find((n) => n.id === neighbour) : undefined;
    if (note) selectNote(note);
    else setActiveNote(null);
  };

  const goHistory = (direction: 1 | -1) => {
    const h = historyRef.current;
    let index = h.index + direction;
    // Skip notes that no longer exist.
    while (index >= 0 && index < h.stack.length && !notesRef.current.some((n) => n.id === h.stack[index])) index += direction;
    if (index < 0 || index >= h.stack.length) return;
    h.index = index;
    setHistoryTick((t) => t + 1);
    openNote(h.stack[index], { fromHistory: true });
  };

  // ---- sync ----
  const noteStores = useRef(new WeakMap<Database, LocalNoteStore>()).current;
  // One store per database; every save is merged with what is stored (merging-store.ts), so a
  // sync that waited for the server cannot overwrite edits saved meanwhile.
  const noteStore = (database: Database): LocalNoteStore => {
    let store = noteStores.get(database);
    if (!store) {
      store = mergingNoteStore(masterKey, rawNoteStore(database));
      noteStores.set(database, store);
    }
    return store;
  };
  const rawNoteStore = (database: Database): LocalNoteStore & { get(id: string): Promise<NoteRecord | null> } => ({
    getAll: async () => database.select<NoteRecord[]>('SELECT * FROM notes'),
    get: async (id) => (await database.select<NoteRecord[]>('SELECT * FROM notes WHERE id = $1', [id]))[0] ?? null,
    save: async (id, content, yjsState, updatedAt) => {
      await database.execute(
        `INSERT INTO notes (id, content, yjs_state, updated_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT(id) DO UPDATE SET content = excluded.content, yjs_state = excluded.yjs_state, updated_at = excluded.updated_at`,
        [id, content, yjsState, updatedAt]
      );
    },
    updateTimestamp: async (id, updatedAt) => {
      await database.execute('UPDATE notes SET updated_at = $1 WHERE id = $2', [updatedAt, id]);
    },
    remove: async (id) => {
      await database.execute('DELETE FROM notes WHERE id = $1', [id]);
      await database.execute('DELETE FROM note_history WHERE note_id = $1', [id]);
    },
  });

  const syncWithServer = async (database: Database) => {
    if (!hasServer()) return;
    if (syncingRef.current) {
      syncAgainRef.current = true;
      return;
    }
    syncingRef.current = true;
    setSyncing(true);
    const versionAtStart = editVersionRef.current;
    try {
      const store = noteStore(database);
      // Images first, so other devices find them once the notes that use them arrive.
      const failedBlobs = await uploadPendingBlobs(masterKey, createDesktopBlobStore(database));

      const activeDoc = activeRef.current ? activeRef.current.ydoc : null;
      const activeId = activeRef.current ? activeRef.current.id : null;

      const { requiresReload, failedNotes } = await runSyncEngine(masterKey, store, activeId, activeDoc);

      if (requiresReload) await loadNotes(database);
      setLastSyncAt(Date.now());

      if (failedNotes > 0 || failedBlobs > 0) {
        setSyncMessage(`Sync problem (${failedNotes + failedBlobs})`);
      } else {
        setSyncMessage('');
        const pendingSaves = Object.keys(saveTimeoutsRef.current).length;
        if (versionAtStart === editVersionRef.current && pendingSaves === 0) setSynced(true);
      }
    } catch (error) {
      console.error('Sync failed:', error);
      // Being offline is shown by the status dot; only real problems get a message.
      if (error instanceof Error && error.message === 'Unauthorized') {
        sessionStillValid().then((valid) => {
          if (valid === false) onLogout('This device was logged out from another device. Unlock again to continue.');
        });
      }
      setSyncMessage(error instanceof Error && error.message.includes('Key mismatch') ? 'Key mismatch: restart the app' : error instanceof Error && error.message === 'Unauthorized' ? 'Unauthorized: wrong key?' : '');
    } finally {
      syncingRef.current = false;
      setSyncing(false);
      if (syncAgainRef.current) {
        syncAgainRef.current = false;
        syncWithServer(database);
      }
    }
  };

  useEffect(() => {
    let cancelled = false;
    async function initDB() {
      try {
        const sqlite = await Database.load('sqlite:noted.db');
        await sqlite.execute(`
          CREATE TABLE IF NOT EXISTS notes (
            id TEXT PRIMARY KEY,
            content TEXT,
            yjs_state TEXT,
            updated_at INTEGER
          )
        `);
        await sqlite.execute(BLOBS_TABLE_SQL);
        await sqlite.execute(HISTORY_TABLE_SQL);
        // Decrypted copies of attachments opened in the last session.
        clearAttachmentCache();
        if (cancelled) return;
        setDb(sqlite);
        setBlobHandlers(createDesktopBlobHandlers(masterKey, createDesktopBlobStore(sqlite), () => syncWithServer(sqlite)));
        // The vault was set up from a backup on the unlock screen: its notes (merged with any
        // this computer still has); the first sync uploads them all.
        if (restoreText) {
          try {
            const r = await restoreBackup(masterKey, restoreText, noteStore(sqlite), createDesktopBlobStore(sqlite), 'merge');
            console.info(`Restored from the backup: ${r.added} added, ${r.merged} merged, ${r.blobs} files`);
          } catch (e) {
            console.error('Restoring the backup failed:', e);
          }
        }
        // Images and files kept in the database by older versions move into files.
        migrateBlobsToFiles(sqlite).then((n) => { if (n) console.info(`Moved ${n} blobs into files`); }, (e) => console.error('Blob move failed:', e));
        // Notes in the trash for more than 7 days are deleted for good.
        if (await purgeExpiredTrash(masterKey, noteStore(sqlite))) console.info('Emptied old trash');
        // Meta saved by older versions gets its reminders (locally, nothing is uploaded).
        try {
          const indexed = await refreshStaleNoteMeta(masterKey, noteStore(sqlite));
          if (indexed) console.info(`Indexed reminders of ${indexed} notes`);
        } catch (e) {
          console.error('Indexing reminders failed:', e);
        }
        const list = await loadNotes(sqlite);
        // Reopen the tabs of the last session.
        const saved = loadPrefs();
        const restored = saved.tabs.filter((id) => list.some((n) => n.id === id && !isSystemNote(id)));
        tabsRef.current = restored;
        setTabs(restored);
        const first = saved.activeTab && restored.includes(saved.activeTab) ? saved.activeTab : restored[0];
        if (first) openNote(first);
        syncWithServer(sqlite);
        intervalRef.current = setInterval(() => syncWithServer(sqlite), SYNC_INTERVAL_MS);
      } catch (err) {
        console.error("DB Init Error:", err);
      }
    }
    initDB();
    return () => {
      cancelled = true;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [masterKey]);

  // Stores a new note record (id given, or a new one); returns its id.
  const insertNoteRecord = async (ydoc: Y.Doc, withContent: boolean, id: string = crypto.randomUUID()): Promise<string | null> => {
    const database = dbRef.current;
    if (!database) return null;
    try {
      await database.execute(
        'INSERT INTO notes (id, content, yjs_state, updated_at) VALUES ($1, $2, $3, $4)',
        [
          id,
          // An untitled new note keeps `content` empty: sync skips it until it gets some text.
          withContent ? seal(masterKey, new TextEncoder().encode(encodeNoteMeta(buildNoteMeta(ydoc)))) : '',
          seal(masterKey, Y.encodeStateAsUpdate(ydoc)),
          Date.now(),
        ]
      );
      await loadNotes(database);
      syncWithServer(database);
      return id;
    } catch (err) {
      console.error('Creating a note failed:', err);
      return null;
    }
  };

  // Creates a note (optionally titled), in the notebook / tag being viewed, and in
  // `notebooks` (a note created from a link goes where the linking note is).
  const createNoteRecord = async (title: string, notebooks: string[] = []): Promise<string | null> => {
    const ydoc = new Y.Doc();
    markNoteCreated(ydoc);
    if (title) setTitle(ydoc, title);
    for (const id of notebooks) setNoteNotebook(ydoc, id, true);
    const view = prefs.view;
    if (view.kind === 'notebook') setNoteNotebook(ydoc, view.id, true);
    if (view.kind === 'tag') setNoteTag(ydoc, view.id, true);
    if (view.kind === 'favorites') setNoteFlag(ydoc, 'favorite', true);
    return insertNoteRecord(ydoc, !!title || notebooks.length > 0 || view.kind === 'notebook' || view.kind === 'tag' || view.kind === 'favorites');
  };

  // Note properties "Attachments": open / save a file or image of the open note.
  const attachmentAction = (kind: 'open' | 'save', a: AttachmentEntry) => {
    const ref = parseBlobRef(a.blob);
    const run = kind === 'open' ? blobHandlers?.openFile : blobHandlers?.saveFile;
    if (!ref || !run) return;
    run(ref, a.kind === 'image' && kind === 'save' ? 'image' : a.name).catch((e) => blobHandlers?.notify?.(`Could not ${kind} ${a.name}: ${e instanceof Error ? e.message : String(e)}`));
  };

  const createNote = async () => {
    if (prefs.view.kind === 'trash' || prefs.view.kind === 'archive') setPref('view', { kind: 'notes' });
    const id = await createNoteRecord('');
    if (id) openNote(id, { newTab: true });
  };

  const handleEditorUpdate = (targetNoteId: string, ydoc: Y.Doc) => {
    const database = dbRef.current;
    if (!database) return;
    const now = Date.now();
    editVersionRef.current++;
    setSynced(false);
    // Settings > Editor "Default title" (once, for a note that got text but no title).
    applyDefaultTitle(ydoc, editorPrefsRef.current.titleTemplate);
    const encryptedYjsPayload = seal(masterKey, Y.encodeStateAsUpdate(ydoc));
    // The `content` column holds the note's metadata (title, excerpt, links, ...), sealed.
    const meta = encodeNoteMeta(buildNoteMeta(ydoc));
    const encryptedMetaPayload = seal(masterKey, new TextEncoder().encode(meta));

    const nextNotes = notesRef.current.map((n) => (n.id === targetNoteId ? { ...n, content: meta, yjs_state: encryptedYjsPayload, updated_at: now } : n));
    notesRef.current = nextNotes;
    setNotes(nextNotes);

    if (saveTimeoutsRef.current[targetNoteId]) clearTimeout(saveTimeoutsRef.current[targetNoteId]);
    saveTimeoutsRef.current[targetNoteId] = setTimeout(async () => {
      delete saveTimeoutsRef.current[targetNoteId];
      try {
        await noteStore(database).save(targetNoteId, encryptedMetaPayload, encryptedYjsPayload, now);
        if (!isSystemNote(targetNoteId)) {
          sessionsRef.current[targetNoteId] = await recordHistory(database, targetNoteId, encryptedYjsPayload, now, sessionsRef.current[targetNoteId]);
          if (activeRef.current?.id === targetNoteId) refreshHistory(targetNoteId);
        }
        syncWithServer(database);
      } catch (err) {
        console.error("Failed to persist encrypted note state:", err);
      }
    }, 500);
  };

  // Changes a note's doc: the open one in place, any other loaded from its stored state.
  const updateNoteDoc = <T,>(id: string, change: (doc: Y.Doc) => T): T | undefined => {
    const active = activeRef.current;
    const note = notesRef.current.find((n) => n.id === id);
    const doc = active?.id === id ? active.ydoc : note ? docOf(note) : null;
    if (!doc) return undefined;
    const result = change(doc);
    handleEditorUpdate(id, doc);
    return result;
  };
  updateNoteDocRef.current = updateNoteDoc;
  docOfRef.current = docOf;

  // ---- catalog (notebooks and tags) ----
  const catalogRecord = notes.find((n) => n.id === CATALOG_ID);
  const catalogDoc = useMemo(() => (catalogRecord ? docOf(catalogRecord) : null), [catalogRecord?.yjs_state]);
  const notebooks = useMemo(() => (catalogDoc ? listCatalog(catalogDoc, 'notebooks') : []), [catalogDoc]);
  const tagEntries = useMemo(() => (catalogDoc ? listCatalog(catalogDoc, 'tags') : []), [catalogDoc]);
  // The default title and the reminder times are shared by all devices (catalog); the other
  // editor settings are per device.
  const sharedPrefs = useMemo(() => (catalogDoc ? getSharedEditorPrefs(catalogDoc) : {}), [catalogDoc]);
  const effectivePrefs = useMemo(() => parseEditorPrefs(JSON.stringify({ ...editorPrefs, ...sharedPrefs })), [editorPrefs, sharedPrefs]);
  editorPrefsRef.current = effectivePrefs;
  const reminderTimes = useMemo(() => ({ morning: effectivePrefs.reminderMorning, evening: effectivePrefs.reminderEvening }), [effectivePrefs.reminderMorning, effectivePrefs.reminderEvening]);
  // Values set on this device before they were shared: share them once.
  useEffect(() => {
    if (!catalogDoc) return;
    const missing = Object.fromEntries(SHARED_EDITOR_PREFS
      .filter((key) => sharedPrefs[key] === undefined && editorPrefs[key] !== DEFAULT_EDITOR_PREFS[key])
      .map((key) => [key, editorPrefs[key]]));
    if (Object.keys(missing).length) changeCatalog((doc) => setSharedEditorPrefs(doc, missing));
  }, [catalogDoc, sharedPrefs]);

  const changeCatalog = async <T,>(change: (doc: Y.Doc) => T): Promise<T | undefined> => {
    if (!notesRef.current.some((n) => n.id === CATALOG_ID)) await insertNoteRecord(new Y.Doc(), false, CATALOG_ID);
    return updateNoteDoc(CATALOG_ID, change);
  };
  const createEntry = (kind: CatalogKind, name: string) => changeCatalog((doc) => ensureCatalogEntry(doc, kind, name, () => crypto.randomUUID()));

  // Settings > Import: the parsed notes become notes (with notebooks and tags from the other
  // app's names); the list reloads and sync runs once at the end. Copies of one note (same
  // title and text: Notesnook exports a note once per notebook it is in) become ONE note in all
  // those notebooks; a note already in Noted (the same export imported again) is not added
  // again, it only gets the notebooks / tags it lacks. One note failing does not stop the others.
  const importNoteDocs = async (notes: ImportedNote[], log: (line: string) => void = () => {}): Promise<{ imported: number; skipped: number; errors: string[] }> => {
    const database = dbRef.current;
    if (!database) throw new Error('Not ready yet');
    const entryIds = new Map<string, string>();
    const entry = async (kind: CatalogKind, name: string) => {
      const key = `${kind}:${name.toLowerCase()}`;
      if (!entryIds.has(key)) entryIds.set(key, (await createEntry(kind, name))?.id ?? '');
      return entryIds.get(key) || null;
    };
    const squash = (text: string) => text.replace(/\s+/g, ' ').trim();
    const sameKey = (title: string, text: string) => `${title.trim().toLowerCase()}\u0000${squash(text)}`;
    const errors: string[] = [];

    // Group the copies of one note.
    const groups = new Map<string, { note: ImportedNote; doc: Y.Doc; notebooks: Set<string>; tags: Set<string> }>();
    for (const note of notes) {
      try {
        const doc = new Y.Doc();
        setNoteBodyJson(doc, note.json);
        setTitle(doc, note.title);
        const key = sameKey(note.title, noteBodyText(noteBodyJson(doc)));
        const group = groups.get(key) ?? { note, doc, notebooks: new Set<string>(), tags: new Set<string>() };
        if (note.notebook) group.notebooks.add(note.notebook);
        note.tags.forEach((t) => group.tags.add(t));
        group.note = { ...group.note, pinned: group.note.pinned || note.pinned, created: group.note.created ?? note.created };
        groups.set(key, group);
      } catch (e) {
        errors.push(`${note.title}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    const existing = new Map(metas.map(({ note, meta }) => [sameKey(meta.title ?? '', textOf(note.id)), note.id] as const));
    const usedIds = new Set(notesRef.current.map((n) => n.id));
    let imported = 0;
    let skipped = 0;
    for (const [key, { note, doc, notebooks, tags }] of groups) {
      try {
        // One at a time: the first entry may create the catalog note.
        const notebookIds: string[] = [];
        for (const name of notebooks) { const id = await entry('notebooks', name); if (id) notebookIds.push(id); }
        const tagIds: string[] = [];
        for (const name of tags) { const id = await entry('tags', name); if (id) tagIds.push(id); }
        const present = existing.get(key);
        if (present) {
          skipped++;
          log(`Skipped ${note.title}: already in Noted`);
          const stored = notesRef.current.find((n) => n.id === present);
          const target = stored ? docOf(stored) : null;
          if (target && (notebookIds.some((id) => !getNoteNotebooks(target).includes(id)) || tagIds.some((id) => !getNoteTags(target).includes(id)))) {
            updateNoteDoc(present, (d) => {
              notebookIds.forEach((id) => setNoteNotebook(d, id, true));
              tagIds.forEach((id) => setNoteTag(d, id, true));
            });
          }
          continue;
        }
        markNoteCreated(doc, note.created ?? Date.now());
        if (note.pinned) setNoteFlag(doc, 'pinned', true);
        if (note.archived) setNoteFlag(doc, 'archived', true);
        notebookIds.forEach((id) => setNoteNotebook(doc, id, true));
        tagIds.forEach((id) => setNoteTag(doc, id, true));
        const id = usedIds.has(note.id) ? crypto.randomUUID() : note.id;
        await database.execute(
          'INSERT INTO notes (id, content, yjs_state, updated_at) VALUES ($1, $2, $3, $4)',
          [id, seal(masterKey, new TextEncoder().encode(encodeNoteMeta(buildNoteMeta(doc)))), seal(masterKey, Y.encodeStateAsUpdate(doc)), Date.now()],
        );
        usedIds.add(id);
        imported++;
        if (notebooks.size > 1) log(`${note.title}: one note in ${notebooks.size} notebooks`);
      } catch (e) {
        errors.push(`${note.title}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    await loadNotes(database);
    syncWithServer(database);
    return { imported, skipped, errors };
  };

  // ---- note actions ----
  const confirmDelete = async (what: string) => {
    return confirmDialog({ title: 'Delete for good?', message: `${what[0].toUpperCase()}${what.slice(1)} will be deleted on every device. This cannot be undone.`, confirm: 'Delete', danger: true });
  };

  // Archiving a root of a link tree (e.g. "Semestr 5") offers to archive the notes under it too
  // (linkDescendants: deeper in the tree, never its parents); unarchiving the same.
  const archiveWithTree = async (ids: string[], on: boolean) => {
    const live = metas.filter((m) => !m.meta.trashedAt).map(({ note, meta }) => ({ id: note.id, links: meta.links }));
    const archivedNow = new Map(metas.map(({ note, meta }) => [note.id, meta.archived]));
    const extra = linkDescendants(ids, live).filter((id) => !!archivedNow.get(id) !== on);
    let targets = ids;
    if (extra.length) {
      const name = ids.length === 1 ? `“${listItems.find((n) => n.id === ids[0])?.title ?? 'This note'}”` : `These ${ids.length} notes`;
      const choice = await showDialog({
        title: on ? 'Archive the notes under it too?' : 'Unarchive the notes under it too?',
        message: `${name} has ${extra.length} linked note${extra.length === 1 ? '' : 's'} under it in the link tree.`,
        buttons: [
          { label: 'Cancel', value: 'cancel' },
          { label: 'Only this', value: 'one' },
          { label: `${on ? 'Archive' : 'Unarchive'} all ${ids.length + extra.length}`, value: 'all', style: 'primary' },
        ],
      });
      if (choice !== 'one' && choice !== 'all') return;
      if (choice === 'all') targets = [...ids, ...extra];
    }
    targets.forEach((id) => updateNoteDoc(id, (doc) => setNoteFlag(doc, 'archived', on)));
  };

  // Acts on one note or a selection of several.
  const noteAction = async (ids: string[], action: NoteAction) => {
    const each = (change: (doc: Y.Doc) => void) => ids.forEach((id) => updateNoteDoc(id, change));
    switch (action) {
      case 'newTab': return ids.forEach((id) => openNote(id, { newTab: true }));
      case 'pin': case 'unpin': return each((doc) => setNoteFlag(doc, 'pinned', action === 'pin'));
      case 'favorite': case 'unfavorite': return each((doc) => setNoteFlag(doc, 'favorite', action === 'favorite'));
      case 'archive': case 'unarchive': return archiveWithTree(ids, action === 'archive');
      case 'restore': return each((doc) => setNoteTrashed(doc, false));
      case 'lock': case 'unlock': return setNoteLocked(ids[0], action === 'lock');
      case 'trash':
        each((doc) => setNoteTrashed(doc, true));
        ids.forEach((id) => { if (tabsRef.current.includes(id)) closeTab(id); });
        return;
      case 'deleteForever': {
        const what = ids.length === 1 ? `“${listItems.find((s) => s.id === ids[0])?.title ?? 'this note'}”` : `${ids.length} notes`;
        if (!(await confirmDelete(what))) return;
        ids.forEach((id) => { if (tabsRef.current.includes(id)) closeTab(id); });
        each((doc) => { unpublishQuietly(masterKey, doc); deleteNoteForever(doc); });
        return;
      }
    }
  };

  // ---- note history (this device only) ----
  const refreshHistory = (noteId: string) => {
    const database = dbRef.current;
    if (database) listHistory(database, noteId, sessionsRef.current[noteId]?.id).then(setHistory).catch((err) => console.error('History:', err));
  };
  useEffect(() => {
    if (activeNote && prefs.propsOpen) refreshHistory(activeNote.id);
  }, [activeNote?.id, prefs.propsOpen]);

  const openHistory = async (entry: HistoryEntry) => {
    const database = dbRef.current;
    if (!database) return;
    const sealed = await readHistoryState(database, entry.id);
    if (sealed) setPreview({ entry, state: unseal(masterKey, sealed) });
  };

  // "Save a copy" in the history: a new note with that version, opened in a new tab.
  const saveHistoryCopy = async (state: Uint8Array) => {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, state);
    setTitle(doc, `${getTitleText(doc).toString().trim() || 'Untitled'} (copy)`);
    const settings = getNoteSettings(doc);
    settings.set('createdAt', Date.now());
    settings.delete('trashedAt');
    const id = await insertNoteRecord(doc, true);
    setPreview(null);
    if (id) openNote(id, { newTab: true });
  };

  // Export (Markdown / text): a save dialog, then the file.
  const saveExport = async (name: string, text: string, source?: { title: string; json: object; format: 'markdown' | 'text'; titles: Record<string, string> }) => {
    try {
      // Markdown with images or files: a zip with the note and an "attachments" folder (like
      // Notesnook's single-note export).
      if (source?.format === 'markdown' && db) {
        const { links, files } = await exportAttachments(masterKey, source.json as Parameters<typeof exportAttachments>[1], createDesktopBlobStore(db));
        if (files.length) {
          const zipName = name.replace(/\.md$/, '.zip');
          const path = await save({ defaultPath: zipName, filters: [{ name: 'Zip', extensions: ['zip'] }] });
          if (!path) return;
          await writeFile(path, zipNoteWithFiles(name, exportNote(source.title, source.json, 'markdown', source.titles, links), files));
          return;
        }
      }
      const path = await save({ defaultPath: name, filters: [{ name: name.endsWith('.md') ? 'Markdown' : 'Text', extensions: [name.split('.').pop() ?? 'txt'] }] });
      if (path) await writeFile(path, new TextEncoder().encode(text));
    } catch (e) {
      console.error('Export failed:', e);
      messageDialog('Export failed', e instanceof Error ? e.message : String(e), 'error');
    }
  };

  // Publish / update (note given) or unpublish (null) the open note; the link is kept in the
  // note's settings (so other devices can update or unpublish it).
  const publishActive = async (note: { title: string; html: string; css: string; font: string | null } | null, settings?: { password: string | null; selfDestruct: boolean; autoUpdate?: boolean; expiresAt?: number | null; live?: boolean; editable?: boolean }) => {
    const current = activeRef.current;
    if (!current) return;
    const earlier = getNotePublish(current.ydoc);
    if (!note) {
      if (earlier) await deletePublished(masterKey, earlier);
      updateNoteDoc(current.id, (doc) => setNotePublish(doc, null));
      return;
    }
    const options = settings ?? { password: null, selfDestruct: false };
    const info = settings?.live
      ? await publishLive(masterKey, current.ydoc, earlier, { ...options, editable: !!settings.editable }, earlier?.live ? liveOwner.seq(earlier.id) : 0)
      : await uploadPublished(masterKey, note, earlier, options);
    updateNoteDoc(current.id, (doc) => setNotePublish(doc, info));
  };

  // A self-destructing copy is gone once it was read, an expiring one at its time: the open
  // note then shows as not published any more (checked when the note opens and every 30 s
  // while it is open).
  const activePublish = activeNote ? getNotePublish(activeNote.ydoc) : null;
  const activeSelfDestructId = activePublish && (activePublish.selfDestruct || activePublish.expiresAt) ? activePublish.id : null;
  useEffect(() => {
    if (!activeSelfDestructId || !activeNote) return;
    const noteId = activeNote.id;
    const check = async () => {
      const info = getNotePublish(activeNote.ydoc);
      if (!info || !(info.selfDestruct || info.expiresAt)) return;
      if (publishExpired(info) || await publishedExists(masterKey, info) === false) updateNoteDoc(noteId, (doc) => setNotePublish(doc, null));
    };
    check();
    const timer = setInterval(check, 30_000);
    return () => clearInterval(timer);
  }, [activeSelfDestructId]);

  // Search inside notes: the plain text of each note, made when first searched and kept until
  // the note changes (locked notes are not searched inside).
  const searchCache = useRef(new Map<string, { state: string; text: string }>());
  const textOf = useCallback((id: string): string => {
    const note = notesRef.current.find((n) => n.id === id);
    if (!note?.yjs_state) return '';
    const hit = searchCache.current.get(id);
    if (hit && hit.state === note.yjs_state) return hit.text;
    let text = '';
    try { text = noteBodyText(noteBodyJson(docFromSealed(masterKey, note.yjs_state))); } catch { /* unreadable note */ }
    searchCache.current.set(id, { state: note.yjs_state, text });
    return text;
  }, [masterKey]);

  // ---- derived data ----
  const metas = useMemo(
    () => notes.filter((n) => !isSystemNote(n.id)).map((n) => ({ note: n, meta: decodeNoteMeta(n.content) })).filter((m) => !m.meta.deleted),
    [notes],
  );
  // The live published notes of this device and their settings (from the notes themselves, so
  // a change on another device counts too).
  const liveNotesKey = metas.filter((m) => m.meta.live && !m.meta.trashedAt).map((m) => `${m.note.id}@${m.note.updated_at}`).join('|');
  useEffect(() => {
    liveOwner.setShares(metas.filter((m) => m.meta.live && !m.meta.trashedAt).flatMap(({ note }) => {
      const doc = activeRef.current?.id === note.id ? activeRef.current.ydoc : docOf(note);
      const info = doc ? getNotePublish(doc) : null;
      return info ? [{ noteId: note.id, info }] : [];
    }));
  }, [liveNotesKey, liveOwner]);
  // This device's edits of the open note go to its guests at once.
  useEffect(() => {
    if (!activeNote) return;
    return liveOwner.watchDoc(activeNote.id, activeNote.ydoc);
  }, [activeNote?.id, activeNote?.ydoc, liveOwner]);
  // Everyone's cursors in a live note. Every open note has them ready (cursors are only sent
  // and received while it is live), so going live never makes the editor again (that closed
  // the publish dialog).
  const liveAwareness = useMemo(() => (activeNote ? new Awareness(activeNote.ydoc) : null), [activeNote?.id, activeNote?.ydoc]);
  useEffect(() => {
    if (!liveAwareness || !activeNote) return;
    const noteId = activeNote.id;
    liveAwarenessRef.current = { noteId, awareness: liveAwareness };
    const onUpdate = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      if (origin === LIVE_ORIGIN || ![...added, ...updated, ...removed].includes(liveAwareness.clientID)) return;
      liveOwner.sendAwareness(noteId, encodeAwarenessUpdate(liveAwareness, [liveAwareness.clientID]));
    };
    liveAwareness.on('update', onUpdate);
    return () => {
      // Guests see the cursor go.
      liveAwareness.setLocalState(null);
      liveAwareness.off('update', onUpdate);
      liveAwareness.destroy();
      if (liveAwarenessRef.current?.awareness === liveAwareness) liveAwarenessRef.current = null;
    };
  }, [liveAwareness]);
  const liveCaret = useMemo(
    () => (liveAwareness ? [CollaborationCaret.configure({ provider: { awareness: liveAwareness }, user: { name: 'Owner', color: '#6750a4' } })] : []),
    [liveAwareness],
  );

  // Where each note outside the trash is (notebooks, tags, linking note), under titles in pickers.
  const places = useMemo(() => notePlaces(
    metas.filter((m) => !m.meta.trashedAt).map(({ note, meta }) => ({
      id: note.id, title: displayTitle(meta), notebooks: meta.notebooks, tags: meta.tags, links: meta.links, archived: meta.archived, updatedAt: note.updated_at,
    })),
    { notebooks: new Map(notebooks.map((n) => [n.id, n.name])), tags: new Map(tagEntries.map((t) => [t.id, t.name])) },
  ), [metas, notebooks, tagEntries]);
  // Titles and links of the notes outside the trash, for note links and backlinks.
  const summaries = useMemo<NoteSummary[]>(
    // Last edited first: the "[[" picker shows them in this order before anything is typed (like "/goto").
    () => metas.filter((m) => !m.meta.trashedAt).sort((a, b) => b.note.updated_at - a.note.updated_at)
      .map(({ note, meta }) => ({ id: note.id, title: displayTitle(meta), links: meta.links, place: places[note.id], archived: meta.archived })),
    [metas, places],
  );
  const listItems = useMemo<NoteListItem[]>(() => metas.map(({ note, meta }) => ({
    id: note.id, title: displayTitle(meta), excerpt: meta.excerpt, pinned: meta.pinned, updatedAt: note.updated_at,
    created: meta.created, favorite: meta.favorite, archived: meta.archived, trashedAt: meta.trashedAt, notebooks: meta.notebooks, tags: meta.tags,
    locked: meta.locked, published: meta.published,
  })), [metas]);
  const viewItems = useMemo(() => notesInView(listItems, prefs.view), [listItems, prefs.view]);
  // Note links of each note: the trees inside notebooks and tags in the note list.
  const linksById = useMemo(() => new Map(metas.map(({ note, meta }) => [note.id, meta.links])), [metas]);
  const linksOf = useCallback((id: string) => linksById.get(id) ?? [], [linksById]);
  // Links tree: the notes outside the archive and the trash.
  const treeNotes = useMemo(
    () => metas.filter((m) => !m.meta.trashedAt && !m.meta.archived).map(({ note, meta }) => ({ id: note.id, title: displayTitle(meta), links: meta.links })),
    [metas],
  );
  // Note picker ("/goto", Ctrl+P, "/linkto"): notes outside the trash, last edited first.
  const recentChoices = useMemo(
    () => metas.filter((m) => !m.meta.trashedAt).sort((a, b) => b.note.updated_at - a.note.updated_at)
      .map(({ note, meta }) => ({ id: note.id, title: displayTitle(meta), locked: meta.locked, place: places[note.id], archived: meta.archived })),
    [metas, places],
  );
  // "/linkto": a link to the open note goes at the end of the picked note.
  const linkFromNote = (targetId: string) => {
    const sourceId = activeRef.current?.id;
    if (!sourceId || sourceId === targetId) return;
    const target = recentChoices.find((n) => n.id === targetId);
    const result = updateNoteDoc(targetId, (doc) => appendNoteLink(doc, sourceId));
    const name = target?.title ?? 'the note';
    if (result) showToast(result === 'already' ? `“${name}” already links to this note` : `Link added at the end of “${name}”`);
  };
  // ---- reminders: chips of every note and reminders of their own (catalog) ----
  const reminderList = useMemo(() => reminderEntries(
    metas.map(({ note, meta }) => ({ id: note.id, title: displayTitle(meta), reminders: meta.reminders, trashedAt: meta.trashedAt })),
    catalogDoc ? listOwnReminders(catalogDoc) : [],
  ), [metas, catalogDoc]);
  // The navigation count (due now or today) follows the clock.
  const [minuteTick, setMinuteTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setMinuteTick((n) => n + 1), 60 * 1000);
    return () => clearInterval(timer);
  }, []);
  const dueReminders = useMemo(() => dueReminderCount(reminderList, new Date()), [reminderList, minuteTick]);
  const changeReminder = (entry: ReminderEntry, state: ReminderState | null, text?: string) => {
    if (!entry.noteId) {
      changeCatalog((doc) => {
        const own = listOwnReminders(doc).find((r) => r.id === entry.id);
        if (!state) deleteOwnReminder(doc, entry.id);
        else setOwnReminder(doc, { id: entry.id, text: text ?? own?.text ?? entry.text, created: own?.created ?? Date.now(), ...state });
      });
      return;
    }
    updateNoteDoc(entry.noteId, (doc) => updateReminderInDoc(doc, entry.id, state));
  };
  const createReminder = (text: string, state: ReminderState) => {
    changeCatalog((doc) => setOwnReminder(doc, { id: newReminderId(), text, created: Date.now(), ...state }));
  };
  // ---- reminder notifications: the timer and the notifications live in Rust (reminders.rs) ----
  const reminderNoticeList = useMemo(() => reminderNotices(reminderList, Date.now()), [reminderList]);
  useEffect(() => {
    invoke('set_reminder_notices', { notices: reminderNoticeList, shown: readShownNotices() }).catch((e) => console.warn('Reminder notifications:', e));
  }, [reminderNoticeList]);
  const reminderActionRef = useRef<(id: string, action: string) => void>(() => {});
  reminderActionRef.current = (id, action) => {
    const notice = parseNoticeId(id);
    const entry = notice && reminderList.find((e) => e.key === notice.key);
    if (!notice || !entry) return;
    if (action === 'default') {
      if (entry.noteId) openNote(entry.noteId, {});
      else { setPref('view', { kind: 'reminders' }); setPref('listHidden', false); }
      return;
    }
    if (action !== 'done' && action !== 'hour' && action !== 'tomorrow') return;
    const next = applyReminderAction(entry, action as ReminderAction, notice.due, Date.now(), reminderTimes);
    if (next) changeReminder(entry, next);
  };
  useEffect(() => {
    const unlistenShown = listen<string>('noted:reminder-shown', (event) => rememberShownNotice(event.payload));
    const unlistenAction = listen<{ id: string; action: string }>('noted:reminder-action', (event) =>
      reminderActionRef.current(event.payload.id, event.payload.action));
    return () => {
      void unlistenShown.then((unlisten) => unlisten());
      void unlistenAction.then((unlisten) => unlisten());
    };
  }, []);

  const counts = useMemo(() => ({
    notes: notesInView(listItems, { kind: 'notes' }).length,
    favorites: notesInView(listItems, { kind: 'favorites' }).length,
    trash: notesInView(listItems, { kind: 'trash' }).length,
    archive: notesInView(listItems, { kind: 'archive' }).length,
    published: notesInView(listItems, { kind: 'published' }).length,
    reminders: dueReminders,
  }), [listItems, dueReminders]);
  const navNotebooks = notebooks.map((e) => ({ ...e, count: notesInView(listItems, { kind: 'notebook', id: e.id }).length }));
  const navTags = tagEntries.map((e) => ({ ...e, count: notesInView(listItems, { kind: 'tag', id: e.id }).length }));
  const catalogNames = useMemo(() => ({
    notebooks: new Map(notebooks.map((n) => [n.id, n.name])),
    tags: new Map(tagEntries.map((t) => [t.id, t.name])),
  }), [notebooks, tagEntries]);
  const viewTitle = prefs.view.kind === 'notebook' ? notebooks.find((n) => n.id === (prefs.view as { id: string }).id)?.name ?? 'Notebook'
    : prefs.view.kind === 'tag' ? `#${tagEntries.find((t) => t.id === (prefs.view as { id: string }).id)?.name ?? 'tag'}`
    : VIEW_TITLES[prefs.view.kind];

  const noteTitles = useMemo(() => Object.fromEntries(summaries.map((n) => [n.id, n.title])), [summaries]);
  const titleOf = (id: string) => listItems.find((s) => s.id === id)?.title ?? 'Untitled';
  const activeMeta = activeNote ? metas.find((m) => m.note.id === activeNote.id) : undefined;
  const activeNotebooks = (activeMeta?.meta.notebooks ?? []).map((id) => notebooks.find((n) => n.id === id)).filter((n): n is NonNullable<typeof n> => !!n);
  const activeTags = (activeMeta?.meta.tags ?? []).map((id) => tagEntries.find((t) => t.id === id)).filter((t): t is NonNullable<typeof t> => !!t);
  // ---- locked notes (the vault) ----
  // The vault key stays in memory until the app locks or closes (or "Lock the vault").
  const [vaultKey, setVaultKey] = useState<Uint8Array | null>(null);
  const [vaultDialog, setVaultDialog] = useState<{ mode: 'create' | 'unlock'; then?: (key: Uint8Array) => void } | null>(null);
  useEffect(() => { if (locked) setVaultKey(null); }, [locked]);
  const withVaultKey = (then: (key: Uint8Array) => void) => {
    if (vaultKey) return then(vaultKey);
    setVaultDialog({ mode: catalogDoc && getVaultSetup(catalogDoc) ? 'unlock' : 'create', then });
  };
  const submitVault = async (password: string): Promise<string | null> => {
    const setup = catalogDoc ? getVaultSetup(catalogDoc) : null;
    let key: Uint8Array | null;
    if (setup) {
      key = openVault(setup, deriveMasterKey(password, base64ToBytes(setup.salt)));
      if (!key) return 'Wrong vault password.';
    } else {
      const salt = generateSalt();
      const passwordKey = deriveMasterKey(password, salt);
      key = (await changeCatalog((doc) => createVault(doc, bytesToBase64(salt), passwordKey))) ?? null;
      if (!key) return 'Could not create the vault.';
    }
    setVaultKey(key);
    vaultDialog?.then?.(key);
    setVaultDialog(null);
    return null;
  };
  // The open locked note is edited in a copy of its body; edits are sealed back shortly after.
  const activeLocked = activeNote ? isNoteLocked(activeNote.ydoc) : false;
  const lockedCopy = useMemo(() => {
    if (!activeNote || !activeLocked || !vaultKey) return null;
    const body = readLockedBody(activeNote.ydoc, vaultKey);
    if (!body) return null;
    const copy = new Y.Doc();
    setNoteBodyJson(copy, body);
    setTitle(copy, getTitleText(activeNote.ydoc).toString());
    return { id: activeNote.id, doc: copy };
  }, [activeNote?.id, activeLocked, vaultKey]);
  // Files and images of the open note (note properties), read again after each saved edit.
  const activeAttachments = useMemo<AttachmentEntry[]>(() => {
    const doc = lockedCopy?.doc ?? (activeNote && !activeLocked ? activeNote.ydoc : null);
    if (!doc) return [];
    try { return noteAttachments(noteBodyJson(doc)); } catch { return []; }
  }, [activeNote?.id, activeMeta?.note.updated_at, lockedCopy, activeLocked]);
  const lockedSaveRef = useRef<{ timer: ReturnType<typeof setTimeout>; run: () => void } | null>(null);
  const flushLockedSave = () => {
    const pending = lockedSaveRef.current;
    if (!pending) return;
    clearTimeout(pending.timer);
    lockedSaveRef.current = null;
    pending.run();
  };
  useEffect(() => flushLockedSave, [lockedCopy]);
  const saveLockedCopy = (noteId: string, copy: Y.Doc) => {
    const key = vaultKey;
    if (lockedSaveRef.current) clearTimeout(lockedSaveRef.current.timer);
    const run = () => {
      const real = activeRef.current?.id === noteId ? activeRef.current.ydoc : null;
      if (!real || !key) return;
      writeLockedBody(real, key, noteBodyJson(copy));
      setTitle(real, getTitleText(copy).toString());
      handleEditorUpdate(noteId, real);
    };
    lockedSaveRef.current = { timer: setTimeout(() => { lockedSaveRef.current = null; run(); }, 500), run };
  };
  const setNoteLocked = (noteId: string, on: boolean) => withVaultKey((key) => {
    flushLockedSave();
    updateNoteDoc(noteId, (doc) => (on ? lockNote(doc, key) : unlockNote(doc, key)));
  });

  const activeFlags: PropertyFlags = {
    pinned: !!activeMeta?.meta.pinned,
    locked: activeNote ? isNoteLocked(activeNote.ydoc) : false,
    favorite: !!activeMeta?.meta.favorite,
    archived: !!activeMeta?.meta.archived,
    readOnly: activeNote ? getNoteFlag(activeNote.ydoc, 'readOnly') : false,
    spellcheck: activeNote ? !getNoteFlag(activeNote.ydoc, 'noSpellcheck') : true,
  };

  // The navigation column is never narrower than the icons in its header (NavPanel measures).
  const [navMin, setNavMin] = useState(NAV_MIN_WIDTH);
  // The same for the note list (its header buttons and a few letters of the title).
  const [listMin, setListMin] = useState(160);
  const setPref = useCallback(<K extends keyof Prefs>(key: K, value: Prefs[K]) => setPrefs((p) => ({ ...p, [key]: value })), []);
  // Shows a view in the note list, bringing the columns back if they were hidden.
  const showView = (view: NoteView) => setPrefs((p) => ({ ...p, view, focusMode: false, listHidden: false }));
  const setZoom = (zoom: number) => setPref('zoom', Math.min(2, Math.max(0.5, Math.round(zoom * 100) / 100)));

  // ---- picker (notebook / tags of the open note) ----
  const pickerToggle = (entryId: string) => {
    if (!activeNote || !picker) return;
    if (picker.kind === 'notebooks') updateNoteDoc(activeNote.id, (doc) => setNoteNotebook(doc, entryId, !(activeMeta?.meta.notebooks ?? []).includes(entryId)));
    else updateNoteDoc(activeNote.id, (doc) => setNoteTag(doc, entryId, !(activeMeta?.meta.tags ?? []).includes(entryId)));
  };
  const pickerCreate = async (name: string) => {
    if (!activeNote || !picker) return;
    const noteId = activeNote.id;
    const kind = picker.kind;
    const entry = await createEntry(kind, name);
    if (!entry) return;
    if (kind === 'notebooks') updateNoteDoc(noteId, (doc) => setNoteNotebook(doc, entry.id, true));
    else updateNoteDoc(noteId, (doc) => setNoteTag(doc, entry.id, true));
  };

  // ---- split view ----
  // A click on the empty page around the text puts the cursor into the nearest text (of the
  // pane that was clicked; NoteEditor checks the area).
  const focusOnEmptyPage = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    // Menus portalled into <body> bubble here through React; only the page itself counts.
    if (!e.currentTarget.contains(target)) return;
    if (e.button !== 0 || e.shiftKey || target.closest('.ProseMirror, textarea, input, select, button, a, label, [contenteditable], [role="button"]')) return;
    e.preventDefault();
    window.dispatchEvent(new CustomEvent('noted:focus-at', { detail: { x: e.clientX, y: e.clientY } }));
  };
  const openSplit = (id: string, mode: SplitMode) => {
    if (!activeRef.current) return openNote(id);
    if (id === activeRef.current.id) return showToast('This note is already open here');
    if (split?.id === id) return setSplit({ ...split, mode, docked: mode === 'float' ? split.docked : mode });
    const note = notesRef.current.find((n) => n.id === id);
    if (!note || isSystemNote(id)) return;
    const ydoc = docOf(note);
    if (!ydoc) return;
    splitAppliedRef.current = note.yjs_state;
    setSplit((prev) => ({
      id, ydoc, mode, docked: mode === 'float' ? prev?.docked ?? 'right' : mode, ratio: prev?.ratio ?? 0.5, float: prev?.float ?? DEFAULT_FLOAT,
    }));
  };
  // The second note follows changes saved elsewhere (sync, the same note edited in the main
  // pane): the stored state is merged into its live doc (a CRDT merge, nothing is lost). It
  // closes when its note goes to the trash or becomes the main note.
  useEffect(() => {
    if (!split) return;
    const record = notes.find((n) => n.id === split.id);
    const meta = record ? decodeNoteMeta(record.content) : null;
    if (!record || meta?.trashedAt || meta?.deleted || activeNote?.id === split.id) {
      setSplit(null);
      return;
    }
    if (record.yjs_state && record.yjs_state !== splitAppliedRef.current) {
      splitAppliedRef.current = record.yjs_state;
      try { Y.applyUpdate(split.ydoc, unseal(masterKey, record.yjs_state), 'stored'); } catch (e) { console.warn('Split note merge failed:', e); }
    }
  }, [notes, split, activeNote?.id]);
  // Pressing a note in the list or a tab and moving: dragging it onto the note area opens it
  // in the split view (edges = beside, middle = small window), onto the tabs moves its tab
  // there (or opens it in a new tab there). A plain click stays a click.
  const beginNoteDrag = (id: string, e: React.MouseEvent) => {
    const start = { x: e.clientX, y: e.clientY };
    let started = false;
    const zone = (x: number, y: number) => (noteAreaRef.current && activeRef.current ? zoneAt(noteAreaRef.current.getBoundingClientRect(), x, y) : null);
    const move = (ev: MouseEvent) => {
      if (!started) {
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 6) return;
        started = true;
        document.body.style.userSelect = 'none';
      }
      ev.preventDefault();
      setNoteDrag({ id, x: ev.clientX, y: ev.clientY, zone: zone(ev.clientX, ev.clientY), tabAt: tabDropIndex(ev.clientX, ev.clientY) });
    };
    const up = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', move, true);
      window.removeEventListener('mouseup', up, true);
      if (!started) return;
      document.body.style.userSelect = '';
      setNoteDrag(null);
      // The click that ends a drag is not a click on the note / tab.
      const swallow = (c: MouseEvent) => { c.preventDefault(); c.stopPropagation(); };
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, true), 300);
      const tabAt = tabDropIndex(ev.clientX, ev.clientY);
      if (tabAt !== null) {
        const known = tabsRef.current.includes(id);
        const next = placeTab(tabsRef.current, id, tabAt);
        tabsRef.current = next;
        setTabs(next);
        if (!known) openNote(id);
        return;
      }
      const z = zone(ev.clientX, ev.clientY);
      if (z) openSplit(id, z);
    };
    window.addEventListener('mousemove', move, true);
    window.addEventListener('mouseup', up, true);
  };
  const noteAreaRef = useRef<HTMLDivElement | null>(null);
  noteAreaRef.current = noteArea;
  const swapSplit = () => {
    const main = activeRef.current;
    if (!split || !main) return;
    const mainRecord = notesRef.current.find((n) => n.id === main.id);
    const doc = mainRecord ? docOf(mainRecord) : null;
    if (!mainRecord || !doc) return;
    const other = split.id;
    splitAppliedRef.current = mainRecord.yjs_state;
    setSplit({ ...split, id: main.id, ydoc: doc });
    openNote(other);
  };
  const TURN: Record<SplitSide, SplitSide> = { left: 'top', top: 'left', right: 'bottom', bottom: 'right' };
  const resizeSplit = (e: React.MouseEvent) => {
    if (!split || e.button !== 0) return;
    e.preventDefault();
    const mode = split.mode;
    const move = (ev: MouseEvent) => {
      const r = noteAreaRef.current?.getBoundingClientRect();
      if (!r) return;
      const share = mode === 'left' ? (ev.clientX - r.left) / r.width : mode === 'right' ? (r.right - ev.clientX) / r.width
        : mode === 'top' ? (ev.clientY - r.top) / r.height : (r.bottom - ev.clientY) / r.height;
      setSplit((s) => (s ? { ...s, ratio: Math.min(0.8, Math.max(0.2, share)) } : s));
    };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); document.body.style.cursor = ''; };
    document.body.style.cursor = mode === 'left' || mode === 'right' ? 'col-resize' : 'row-resize';
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  const splitDivider = split && split.mode !== 'float' ? (
    <div
      onMouseDown={resizeSplit}
      title="Drag to resize"
      style={{ flex: '0 0 5px', cursor: split.mode === 'left' || split.mode === 'right' ? 'col-resize' : 'row-resize', backgroundColor: 'var(--border)' }}
    />
  ) : null;
  const splitLocked = split ? isNoteLocked(split.ydoc) : false;
  const splitPane = split ? (
    <div style={split.mode === 'float' ? { position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 50 } : { flex: `0 0 calc(${split.ratio * 100}% - 3px)`, display: 'flex', minWidth: 0, minHeight: 0 }}>
      <div style={split.mode === 'float' ? { position: 'absolute', inset: 0, pointerEvents: 'none' } : { display: 'flex', flex: 1, minWidth: 0, minHeight: 0 }}>
      <SplitPane
        title={titleOf(split.id)}
        mode={split.mode}
        float={split.float}
        area={noteArea}
        onClose={() => setSplit(null)}
        onSwap={swapSplit}
        onRotate={() => setSplit((s) => (s && s.mode !== 'float' ? { ...s, mode: TURN[s.mode as SplitSide], docked: TURN[s.mode as SplitSide] } : s))}
        onToggleFloat={() => setSplit((s) => (s ? { ...s, mode: s.mode === 'float' ? s.docked : 'float' } : s))}
        onFloat={(float) => setSplit((s) => (s ? { ...s, float } : s))}
      >
        <div data-note-scroll="" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }} onMouseDown={focusOnEmptyPage}>
          <div style={{ zoom: prefs.zoom, maxWidth: prefs.fullWidth ? 'none' : 860, margin: '0 auto', padding: '16px 28px 48px' } as CSSProperties}>
            {splitLocked ? (
              <div style={{ color: 'var(--text-muted)', marginTop: 40, textAlign: 'center', fontSize: 13 }}>A locked note opens only as the main note.</div>
            ) : (
              <NoteEditor
                key={split.id}
                secondary
                noteId={split.id}
                ydoc={split.ydoc}
                onUpdate={handleEditorUpdate}
                onOpenLink={(href) => { openUrl(href).catch((err) => console.error('Opening link failed:', err)); }}
                notes={summaries}
                onOpenNote={(id) => openNote(id, { newTab: true })}
                onCreateNote={(title) => createNoteRecord(title, getNoteNotebooks(split.ydoc))}
                blobs={blobHandlers}
                toolbarMode="floating"
                toolbarConfig={toolbarConfig}
                ligatures={editorPrefs.ligatures}
                codeThemeByLanguage={editorPrefs.codeThemeByLanguage}
                reminderTimes={reminderTimes}
                tableToolbarConfig={tableToolbarConfig}
                drawingToolbarConfig={drawingToolbarConfig}
                drawingTools={drawingToolsStore}
                fullWidth={prefs.fullWidth}
                readOnly={getNoteFlag(split.ydoc, 'readOnly')}
                spellcheck={!getNoteFlag(split.ydoc, 'noSpellcheck')}
                onNoteAction={(request, x, y) => { if (request.kind === 'goto') setNotePicker({ mode: 'goto', at: { x, y } }); }}
                onSaveExport={saveExport}
              />
            )}
          </div>
        </div>
      </SplitPane>
      </div>
    </div>
  ) : null;

  // ---- keyboard and wheel shortcuts ----
  const shortcutsRef = useRef<(e: KeyboardEvent) => void>(() => {});
  shortcutsRef.current = (e: KeyboardEvent) => {
    // Settings > Keyboard shortcuts (shortcuts.ts in @noted/ui). A handled key stops here so
    // the editor does not also act on it.
    const actions: Record<string, () => void> = {
      newNote: () => createNote(),
      gotoNote: () => setNotePicker({ mode: 'goto', at: null }),
      settings: () => setSettingsOpen(true),
      focusMode: () => setPref('focusMode', !prefs.focusMode),
      noteProperties: () => setPref('propsOpen', !prefs.propsOpen),
      syncNow: () => { if (dbRef.current) syncWithServer(dbRef.current); },
      zoomIn: () => setZoom(prefs.zoom + 0.1),
      zoomOut: () => setZoom(prefs.zoom - 0.1),
      zoomReset: () => { setZoom(1); magnifier.reset(); },
      closeTab: () => { if (activeRef.current) closeTab(activeRef.current.id); },
      nextTab: () => stepTab(1),
      prevTab: () => stepTab(-1),
      historyBack: () => goHistory(-1),
      historyForward: () => goHistory(1),
    };
    for (const [id, run] of Object.entries(actions)) {
      if (!matchesShortcut(e, id)) continue;
      e.preventDefault();
      e.stopPropagation();
      run();
      return;
    }
    // Ctrl+1..8 opens that tab, Ctrl+9 the last one (fixed).
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && /^Digit[1-9]$/.test(e.code)) {
      e.preventDefault();
      const list = tabsRef.current;
      const n = Number(e.code.slice(5));
      const id = n === 9 ? list[list.length - 1] : list[n - 1];
      if (id && id !== activeRef.current?.id) openNote(id);
    }
  };
  const stepTab = (step: number) => {
    const list = tabsRef.current;
    if (list.length < 2) return;
    const index = list.indexOf(activeRef.current?.id ?? '');
    openNote(list[(index + step + list.length) % list.length]);
  };
  const wheelRef = useRef<(e: WheelEvent) => void>(() => {});
  wheelRef.current = (e: WheelEvent) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    setZoom(prefs.zoom + (e.deltaY < 0 ? 0.1 : -0.1));
  };
  // Touchpad pinch magnifies the note like a browser's pinch zoom (magnifier.ts; lib.rs takes
  // the gesture from WebKit, which would magnify the whole window).
  const pinchRef = useRef<(phase: string, scale: number) => void>(() => {});
  pinchRef.current = (phase, scale) => {
    // An open picture viewer takes the pinch (it zooms the picture, not the note behind it).
    const taken = !window.dispatchEvent(new CustomEvent(PINCH_EVENT, { detail: { phase, scale }, cancelable: true }));
    if (!taken) magnifier.pinch(phase, scale);
  };
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => shortcutsRef.current(e);
    const onWheel = (e: WheelEvent) => wheelRef.current(e);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('wheel', onWheel, { passive: false });
    const unlistenPinch = listen<{ phase: string; scale: number }>('noted:pinch', (event) =>
      pinchRef.current(event.payload.phase, event.payload.scale));
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('wheel', onWheel);
      void unlistenPinch.then((unlisten) => unlisten());
    };
  }, []);

  const nav = historyRef.current;
  const chip = { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap', backgroundColor: 'var(--bg-surface-high)', color: 'var(--text-main)' } as const;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', overflow: 'hidden' }}>
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {!prefs.focusMode && !prefs.navHidden && (
          <>
            <aside style={{ width: prefs.navCompact ? NAV_RAIL_WIDTH : Math.max(prefs.navWidth, navMin), flex: '0 0 auto', backgroundColor: 'var(--bg-surface-low)', borderRight: '1px solid var(--border)' }}>
              <NavPanel
                onSettings={() => setSettingsOpen(true)}
                view={prefs.view}
                onView={(view) => { setPref('view', view); setPref('listHidden', false); }}
                counts={counts}
                notebooks={navNotebooks}
                tags={navTags}
                onCreate={(kind, name) => { createEntry(kind, name); }}
                onRename={(kind, id, name) => { changeCatalog((doc) => renameCatalogEntry(doc, kind, id, name)); }}
                onDelete={(kind, id) => {
                  changeCatalog((doc) => removeCatalogEntry(doc, kind, id));
                  if ('id' in prefs.view && prefs.view.id === id) setPref('view', { kind: 'notes' });
                }}
                onHide={() => setPref('navHidden', true)}
                compact={prefs.navCompact}
                onMinWidth={setNavMin}
                onExpand={() => setPref('navCompact', false)}
              />
            </aside>
            {/* Narrower than its icons: the column becomes a rail of icons; dragging the rail
                to the right opens it again. */}
            <Resizer
              width={prefs.navCompact ? NAV_RAIL_WIDTH : Math.max(prefs.navWidth, navMin)}
              onDrag={(w) => setPrefs((p) => (w < navMin - RESIZE_SNAP
                ? (p.navCompact ? p : { ...p, navCompact: true })
                : { ...p, navCompact: false, navWidth: Math.min(400, Math.max(navMin, w)) }))}
            />
          </>
        )}
        {!prefs.focusMode && !prefs.listHidden && (
          <>
            <aside style={{ width: Math.max(prefs.listWidth, listMin), flex: '0 0 auto', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-surface-low)', borderRight: '1px solid var(--border)' }}>
              {prefs.view.kind === 'reminders' ? (
                <RemindersList
                  entries={reminderList}
                  times={reminderTimes}
                  onOpenNote={(id, newTab) => openNote(id, { newTab })}
                  onChange={changeReminder}
                  onCreate={createReminder}
                  onHide={() => setPref('listHidden', true)}
                />
              ) : prefs.view.kind === 'tree' ? (
                <LinkTree
                  notes={treeNotes}
                  activeId={activeNote?.id ?? null}
                  onOpen={(id, newTab) => openNote(id, { newTab })}
                  onHide={() => setPref('listHidden', true)}
                />
              ) : <NoteList
                title={viewTitle}
                items={viewItems}
                activeId={activeNote?.id ?? null}
                sort={prefs.sort}
                onSort={(sort) => setPref('sort', sort)}
                view={prefs.view}
                grouping={prefs.grouping}
                onGrouping={(grouping) => setPref('grouping', grouping)}
                linksOf={linksOf}
                folds={prefs.listFolds}
                onFolds={(folds) => setPref('listFolds', folds)}
                onDragNote={beginNoteDrag}
                names={catalogNames}
                onOpen={(id, newTab) => openNote(id, { newTab })}
                onAction={noteAction}
                textOf={textOf}
                onEmptyTrash={prefs.view.kind === 'trash' ? () => noteAction(viewItems.map((n) => n.id), 'deleteForever') : undefined}
                onHide={() => setPref('listHidden', true)}
                onMinWidth={setListMin}
              />}
            </aside>
            {/* Dragged narrower than its header: the list hides (the tab bar brings it back). */}
            <Resizer
              width={Math.max(prefs.listWidth, listMin)}
              onDrag={(w) => setPrefs((p) => (w < listMin - RESIZE_SNAP
                ? { ...p, listHidden: true }
                : { ...p, listWidth: Math.min(520, Math.max(listMin, w)) }))}
            />
          </>
        )}
        <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <TabBar
            tabs={tabs.map((id) => ({ id, title: titleOf(id), place: places[id] }))}
            activeId={activeNote?.id ?? null}
            canGoBack={nav.index > 0}
            canGoForward={nav.index < nav.stack.length - 1}
            onNewNote={createNote}
            onBack={() => goHistory(-1)}
            onForward={() => goHistory(1)}
            onSelect={(id) => openNote(id)}
            onClose={closeTab}
            onDragNote={beginNoteDrag}
            dropAt={noteDrag?.tabAt ?? null}
            // Hidden columns come back from here (each column hides itself from its own header).
            left={!prefs.focusMode && (prefs.navHidden || prefs.listHidden) && (
              <>
                {prefs.navHidden && <IconBtn icon={mdiDockLeft} title="Show navigation" onClick={() => setPref('navHidden', false)} />}
                {prefs.listHidden && <IconBtn icon={mdiFormatListText} title="Show note list" onClick={() => setPref('listHidden', false)} />}
              </>
            )}
            right={activeNote && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 6 }}>
                {/* Left click: show the notes of that notebook / tag. Right click: change them. */}
                {activeNotebooks.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    title="Show this notebook (right-click to change notebooks)"
                    style={chip}
                    onClick={() => showView({ kind: 'notebook', id: n.id })}
                    onContextMenu={(e) => { e.preventDefault(); setPicker({ kind: 'notebooks', x: e.clientX - 140, y: e.clientY + 14 }); }}
                  >
                    <Icon path={mdiBookOutline} size={13} /> {n.name}
                  </button>
                ))}
                {activeNotebooks.length === 0 && (
                  <button type="button" title="Add to a notebook" style={{ ...chip, color: 'var(--text-muted)' }} onClick={(e) => setPicker({ kind: 'notebooks', x: e.clientX - 140, y: e.clientY + 14 })}>
                    <Icon path={mdiBookOutline} size={13} /> No notebook
                  </button>
                )}
                {activeTags.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    title="Show notes with this tag (right-click to change tags)"
                    style={{ ...chip, color: 'var(--primary)' }}
                    onClick={() => showView({ kind: 'tag', id: t.id })}
                    onContextMenu={(e) => { e.preventDefault(); setPicker({ kind: 'tags', x: e.clientX - 140, y: e.clientY + 14 }); }}
                  >
                    #{t.name}
                  </button>
                ))}
                <IconBtn icon={mdiDotsVertical} title="Note properties" active={prefs.propsOpen} onClick={() => setPref('propsOpen', !prefs.propsOpen)} />
              </div>
            )}
          />
          {prefs.toolbar === 'top' && activeNote && <div ref={setToolbarSlot} />}
          {/* Zero height: the table menu floats over the note under this point (TableMenu anchor). */}
          {prefs.tableMenu === 'toolbar' && activeNote && <div ref={setTableMenuSlot} style={{ height: 0 }} />}
          {/* Zero height too: the drawing menu's place when it sits at the top (DrawingMenu anchor). */}
          {prefs.drawingMenu === 'toolbar' && activeNote && <div ref={setDrawingMenuSlot} style={{ height: 0 }} />}
          {/* The find bar (Ctrl+F) hangs from here, at the top right of the note area. */}
          <div ref={setFindSlot} style={{ position: 'relative', height: 0, zIndex: 30 }} />
          {/* The note area: the open note, and in split view the second one beside it (or in a
              small window over it). Notes dragged from the list / tabs drop here (SplitPane.tsx). */}
          <div ref={setNoteArea} style={{ flex: 1, minHeight: 0, display: 'flex', position: 'relative', flexDirection: split && (split.mode === 'top' || split.mode === 'bottom') ? 'column' : 'row' }}>
          {split && (split.mode === 'left' || split.mode === 'top') && splitPane}
          {split && (split.mode === 'left' || split.mode === 'top') && splitDivider}
          <div
            data-note-scroll=""
            ref={magnifier.scrollRef}
            style={{ flex: 1, minWidth: 0, minHeight: 0, overflowY: 'auto', overflowX: magnifier.scale > 1 ? 'auto' : undefined }}
            // Clicks on the empty page beside or below the text put the cursor into the text.
            onMouseDown={focusOnEmptyPage}
          >
            <div style={magnifier.sizerStyle}>
            <div ref={magnifier.contentRef} style={magnifier.contentStyle}>
            {activeNote ? (
              <div style={{ zoom: prefs.zoom, maxWidth: prefs.fullWidth ? 'none' : 860, margin: '0 auto', padding: '24px 48px 64px' } as CSSProperties}>
                {activeLocked && !lockedCopy ? (
                  <LockedNote title={getTitleText(activeNote.ydoc).toString()} onOpen={() => withVaultKey(() => {})} />
                ) : (
                <NoteEditor
                  key={lockedCopy ? `${activeNote.id}:locked` : activeNote.id}
                  noteId={activeNote.id}
                  extraExtensions={lockedCopy ? [] : liveCaret}
                  ydoc={lockedCopy?.doc ?? activeNote.ydoc}
                  onUpdate={lockedCopy ? saveLockedCopy : handleEditorUpdate}
                  onOpenLink={(href) => { openUrl(href).catch((e) => console.error('Opening link failed:', e)); }}
                  notes={summaries}
                  onOpenNote={(id) => openNote(id, { newTab: true })}
                  onCreateNote={(title) => createNoteRecord(title, getNoteNotebooks(activeNote.ydoc))}
                  blobs={blobHandlers}
                  toolbarMode={prefs.toolbar}
                  toolbarConfig={toolbarConfig}
                  ligatures={editorPrefs.ligatures}
                  codeThemeByLanguage={editorPrefs.codeThemeByLanguage}
                reminderTimes={reminderTimes}
                  toolbarSlot={toolbarSlot}
                  tableMenuSlot={prefs.tableMenu === 'toolbar' ? tableMenuSlot : null}
                  tableToolbarConfig={tableToolbarConfig}
                  drawingMenuSlot={prefs.drawingMenu === 'toolbar' ? drawingMenuSlot : null}
                  drawingToolbarConfig={drawingToolbarConfig}
                  drawingTools={drawingToolsStore}
                  onStats={setStats}
                  fullWidth={prefs.fullWidth}
                  readOnly={activeFlags.readOnly}
                  spellcheck={activeFlags.spellcheck}
                  onNoteAction={(request, x, y) => {
                    if (request.kind === 'goto' || request.kind === 'linkto') setNotePicker({ mode: request.kind, at: { x, y } });
                    else setPicker({ kind: request.kind === 'notebook' ? 'notebooks' : 'tags', x, y });
                  }}
                  restore={restore && restore.noteId === activeNote.id ? restore : null}
                  findSlot={findSlot}
                  onSaveExport={saveExport}
                  onPublish={lockedCopy || !serverOn ? undefined : publishActive}
                />
                )}
              </div>
            ) : (
              <div style={{ color: 'var(--text-muted)', marginTop: '20vh', textAlign: 'center' }}>Select a note or create a new one (Ctrl+N).</div>
            )}
            </div>
            </div>
          </div>
          {split && (split.mode === 'right' || split.mode === 'bottom') && splitDivider}
          {split && split.mode !== 'left' && split.mode !== 'top' && splitPane}
          </div>
        </main>
        {noteDrag && (
          <DropZones area={noteArea && activeNote ? noteArea.getBoundingClientRect() : null} zone={noteDrag.zone} x={noteDrag.x} y={noteDrag.y} title={titleOf(noteDrag.id)} />
        )}
        {activeNote && prefs.propsOpen && activeMeta && (
          <>
          <Resizer
            edge="left"
            width={prefs.propsWidth}
            onDrag={(w) => setPrefs((p) => ({ ...p, propsWidth: Math.min(PROPS_MAX_WIDTH, Math.max(PROPS_MIN_WIDTH, w)) }))}
          />
          <NoteProperties
            width={prefs.propsWidth}
            flags={activeFlags}
            onFlag={(flag, on) => {
              if (flag === 'spellcheck') updateNoteDoc(activeNote.id, (doc) => setNoteFlag(doc, 'noSpellcheck', !on));
              else if (flag === 'locked') setNoteLocked(activeNote.id, on);
              else if (flag === 'archived') archiveWithTree([activeNote.id], on);
              else updateNoteDoc(activeNote.id, (doc) => setNoteFlag(doc, flag, on));
            }}
            font={getNoteFont(activeNote.ydoc) ?? 'sans'}
            onFont={(font) => updateNoteDoc(activeNote.id, (doc) => setNoteFont(doc, font === 'sans' ? null : font))}
            created={activeMeta.meta.created}
            edited={activeMeta.note.updated_at}
            notebooks={activeNotebooks}
            tags={activeTags}
            onPick={(kind, x, y) => setPicker({ kind, x: x - 290, y })}
            onRemoveNotebook={(id) => updateNoteDoc(activeNote.id, (doc) => setNoteNotebook(doc, id, false))}
            onRemoveTag={(id) => updateNoteDoc(activeNote.id, (doc) => setNoteTag(doc, id, false))}
            links={activeMeta.meta.links.map((id) => summaries.find((s) => s.id === id)).filter((s): s is NoteSummary => !!s)}
            backlinks={summaries.filter((s) => s.id !== activeNote.id && s.links.includes(activeNote.id))}
            onOpenNote={(id) => openNote(id, { newTab: true })}
            attachments={activeAttachments}
            onOpenAttachment={(a) => attachmentAction('open', a)}
            onSaveAttachment={(a) => attachmentAction('save', a)}
            onShowAttachment={(a) => window.dispatchEvent(new CustomEvent('noted:reveal-blob', { detail: a.blob }))}
            history={history}
            onOpenHistory={openHistory}
            toolbar={prefs.toolbar}
            onToolbar={(mode) => setPref('toolbar', mode)}
            tableMenu={prefs.tableMenu}
            onTableMenu={(mode) => setPref('tableMenu', mode)}
            drawingMenu={prefs.drawingMenu}
            onDrawingMenu={(mode) => setPref('drawingMenu', mode)}
            trashed={!!activeMeta.meta.trashedAt}
            onExport={() => window.dispatchEvent(new Event('noted:export'))}
            published={!!getNotePublish(activeNote.ydoc)}
            onPublish={serverOn ? () => window.dispatchEvent(new Event('noted:publish')) : undefined}
            onTrash={() => noteAction([activeNote.id], 'trash')}
            onRestore={() => noteAction([activeNote.id], 'restore')}
            onDeleteForever={() => noteAction([activeNote.id], 'deleteForever')}
            onClose={() => setPref('propsOpen', false)}
          />
          </>
        )}
      </div>
      <StatusBar
        online={online}
        localOnly={!serverOn}
        syncing={syncing}
        synced={synced}
        onSync={() => { if (db) syncWithServer(db); }}
        fullWidth={prefs.fullWidth}
        onToggleWidth={() => setPref('fullWidth', !prefs.fullWidth)}
        focusMode={prefs.focusMode}
        onToggleFocus={() => setPref('focusMode', !prefs.focusMode)}
        zoom={prefs.zoom}
        onZoom={setZoom}
        stats={activeNote ? stats : null}
        created={activeMeta?.meta.created ?? null}
        message={syncMessage}
      />
      {notePicker && (notePicker.mode === 'goto' || activeNote) && (
        <NotePicker
          title={notePicker.mode === 'goto' ? 'Go to note' : 'Add a link to this note at the end of…'}
          notes={notePicker.mode === 'goto' ? recentChoices : recentChoices.filter((n) => !n.locked)}
          excludeId={activeNote?.id ?? null}
          at={notePicker.at}
          onPick={(id) => (notePicker.mode === 'goto' ? openNote(id, { newTab: true }) : linkFromNote(id))}
          onCreate={notePicker.mode === 'linkto' && activeNote ? async (title) => {
            const id = await createNoteRecord(title, getNoteNotebooks(activeNote.ydoc));
            if (id) linkFromNote(id);
          } : undefined}
          onClose={() => setNotePicker(null)}
        />
      )}
      {toast && (
        <div style={{ position: 'fixed', bottom: 44, left: '50%', transform: 'translateX(-50%)', zIndex: 10000, padding: '8px 14px', borderRadius: 8, fontSize: 13, color: 'var(--text-main)', backgroundColor: 'var(--bg-surface-high)', border: '1px solid var(--border)', boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }}>
          {toast}
        </div>
      )}
      {picker && activeNote && (
        <CatalogPicker
          kind={picker.kind}
          entries={picker.kind === 'notebooks' ? notebooks : tagEntries}
          selected={picker.kind === 'notebooks' ? activeMeta?.meta.notebooks ?? [] : activeMeta?.meta.tags ?? []}
          x={picker.x}
          y={picker.y}
          onToggle={pickerToggle}
          onCreate={pickerCreate}
          onClose={() => setPicker(null)}
        />
      )}
      {preview && activeNote && (
        <HistoryPreview
          state={preview.state}
          current={activeNote.ydoc}
          startedAt={preview.entry.startedAt}
          endedAt={preview.entry.endedAt}
          edited={activeMeta?.note.updated_at ?? Date.now()}
          titles={noteTitles}
          right={prefs.propsOpen ? 300 : 0}
          onSaveCopy={saveHistoryCopy}
          onRestore={(content, title) => { if (activeNote) setRestore({ id: Date.now(), noteId: activeNote.id, content, title }); setPreview(null); }}
          onClose={() => setPreview(null)}
        />
      )}
      {locked && <LockScreen onUnlock={unlockApp} />}
      {vaultDialog && <VaultDialog mode={vaultDialog.mode} onSubmit={submitVault} onClose={() => setVaultDialog(null)} />}
      {settingsOpen && (
        <SettingsDialog
          onClose={() => setSettingsOpen(false)}
          host={{
            masterKey,
            deriveKey: async (passphrase, salt) => deriveMasterKey(passphrase, salt),
            onLogout: () => onLogout(),
            onEpochChanged: (epoch) => { writeEpoch(epoch); reconnectRef.current?.(); },
            saveFile: saveFileDialog,
            openTextFile: openTextFileDialog,
            serverUrl: serverOn ? apiUrl() : '',
            online,
            // A device without a server: its vault goes to (or joins) a server, then syncs.
            connectServer: serverOn ? undefined : async (base, setupCode) => {
              writeEpoch(await moveVaultToServer(masterKey, base, setupCode));
              setServerOn(true);
              refreshServerInfo();
              if (db) syncWithServer(db);
            },
            syncing,
            lastSyncAt,
            onSyncNow: () => { if (db) syncWithServer(db); },
            shortcuts: { overrides: shortcutOverrides, onChange: changeShortcuts },
            themeMode,
            onThemeMode: (mode) => { setThemeMode(mode); setThemeModeState(mode); },
            zoom: appZoom,
            onZoom: (zoom) => { applyAppZoom(zoom); setAppZoom(zoom); },
            createBackup: async (withAttachments) => {
              if (!db) throw new Error('Not ready yet');
              return { name: backupFileName(new Date(), withAttachments), text: await createBackup(masterKey, noteStore(db), withAttachments ? { blobs: createDesktopBlobStore(db) } : {}) };
            },
            // A new or replaced server without a vault, while this computer is logged in.
            setUpServer: async (text) => {
              if (!db) throw new Error('Not ready yet');
              const vault = backupVault(text);
              if (!vault) throw new Error('This backup has no vault data (made by an older version or offline). Make a new backup first.');
              openBackup(masterKey, text);
              // A fresh server's setup code can only be typed on the unlock screen.
              if ((await fetchVaultStatus()).setupCode) throw new Error('This server is new and wants its setup code: log out and set it up from the unlock screen ("Set it up from a backup").');
              await restoreServerVault(masterKey, vault, getAuthEpoch());
              const r = await restoreBackup(masterKey, text, noteStore(db), createDesktopBlobStore(db), 'merge');
              await loadNotes(db);
              syncWithServer(db);
              return `The server has this vault again (same passphrase and recovery key). ${r.added} notes came from the backup; all notes are being uploaded.`;
            },
            restoreBackup: async (text, mode) => {
              if (!db) throw new Error('Not ready yet');
              const result = await restoreBackup(masterKey, text, noteStore(db), createDesktopBlobStore(db), mode);
              await loadNotes(db);
              // The open note may have changed: open it again from what is stored now.
              if (activeRef.current) openNote(activeRef.current.id);
              syncWithServer(db);
              return result;
            },
            downloadFolder,
            onChooseDownloadFolder: async (reset) => {
              const path = reset ? null : await chooseDownloadFolder();
              if (!reset && !path) return;
              writeDownloadFolder(path);
              setDownloadFolder(path);
            },
            // Settings > Sync "Clean up storage".
            findCleanup: !serverOn ? undefined : async (includeRecent) => {
              if (!db) throw new Error('Not ready yet');
              const store = noteStore(db);
              const deleted = await deletedNoteIds(masterKey, store);
              const fromHistory = new Set<string>();
              for (const state of await allHistoryStates(db)) {
                try { for (const id of noteBlobIds(noteBodyJson(docFromSealed(masterKey, state)))) fromHistory.add(id); } catch { /* unreadable version */ }
              }
              const files = await findUnusedBlobs(masterKey, store, vaultKey, fromHistory, Date.now(), includeRecent ? 0 : BLOB_GRACE_MS);
              return { deletedNotes: deleted, fileIds: files.blobs.map((b) => b.id), fileBytes: files.bytes };
            },
            runCleanup: !serverOn ? undefined : async (plan) => {
              if (!db) throw new Error('Not ready yet');
              const store = noteStore(db);
              const notesDone = await purgeDeletedNotes(masterKey, store, plan.deletedNotes);
              const filesDone = await deleteServerBlobs(masterKey, plan.fileIds);
              // This computer: cached files no note or version uses, history of notes that are
              // gone, then the database file shrinks.
              const used = await usedBlobIds(masterKey, store, vaultKey);
              for (const state of await allHistoryStates(db)) {
                try { for (const id of noteBlobIds(noteBodyJson(docFromSealed(masterKey, state)))) used.add(id); } catch { /* unreadable version */ }
              }
              const cached = await db.select<{ id: string }[]>('SELECT id FROM blobs WHERE uploaded = 1');
              const blobStore = createDesktopBlobStore(db);
              for (const { id } of cached) if (!used.has(id)) await blobStore.remove(id);
              await db.execute('DELETE FROM note_history WHERE note_id NOT IN (SELECT id FROM notes)');
              await db.execute('VACUUM');
              await loadNotes(db);
              syncWithServer(db);
              return `Removed ${notesDone} deleted notes and ${filesDone} files from the server, and cleaned this computer's copy.`;
            },
            compareBackup: async (text) => {
              if (!db) throw new Error('Not ready yet');
              return compareBackup(masterKey, openBackup(masterKey, text), noteStore(db));
            },
            restoreBackupNote: async (text, id, mode) => {
              if (!db) throw new Error('Not ready yet');
              await restoreBackupNote(masterKey, openBackup(masterKey, text), id, noteStore(db), createDesktopBlobStore(db), mode);
              await loadNotes(db);
              if (activeRef.current?.id === id) openNote(id);
              syncWithServer(db);
            },
            listBackups,
            noteTitles,
            autoBackup: { ...autoBackup, folder: backupFolder },
            onAutoBackup: (next) => {
              const value = { ...readAutoBackup(), ...next };
              writeAutoBackup(value);
              setAutoBackupState(value);
              // Switched on: the first backup now when none is due yet.
              if (db && value.interval !== 'off') {
                runAutoBackupIfDue(masterKey, noteStore(db), createDesktopBlobStore(db))
                  .then((done) => { if (done) setAutoBackupState(readAutoBackup()); })
                  .catch((e) => console.warn('Automatic backup failed:', e));
              }
            },
            onOpenBackupFolder: () => { openBackupFolder().catch((e) => messageDialog('Cannot open the folder', String(e), 'error')); },
            onChooseBackupFolder: async (reset) => {
              const folder = reset ? null : await chooseBackupFolder();
              if (!reset && !folder) return;
              writeAutoBackup({ ...readAutoBackup(), folder });
              setAutoBackupState(readAutoBackup());
              backupFolderPath().then(setBackupFolder, () => {});
            },
            exportAll: async (format) => {
              if (!db) throw new Error('Not ready yet');
              return exportAll(masterKey, noteStore(db), format, catalogNames.notebooks, createDesktopBlobStore(db));
            },
            editorPrefs: effectivePrefs,
            onEditorPrefs: (next) => {
              setEditorPrefs(next);
              applyEditorPrefs(next);
              const shared = sharedPrefsChange(effectivePrefs, next);
              if (shared) changeCatalog((doc) => setSharedEditorPrefs(doc, shared));
            },
            spellLanguages,
            getCustomWords: () => getCustomWords(editorPrefs.spellLanguages.length ? editorPrefs.spellLanguages : spellLanguages),
            setCustomWords: (words) => setCustomWords(editorPrefs.spellLanguages.length ? editorPrefs.spellLanguages : spellLanguages, words),
            onFileDrop,
            pickImportFiles: async (source, from) => (typeof from === 'object'
              ? importFilesFromPaths(from.paths)
              : pickImportFiles(from === 'folder', IMPORT_SOURCES.find((s) => s.id === source)!.extensions)),
            runImport: async (source, picked, on) => {
              const handlers = blobHandlers;
              const storeImage = async (bytes: Uint8Array, name: string) => {
                if (!handlers?.upload) return null;
                const ext = name.split('.').pop()?.toLowerCase() ?? 'png';
                const type = ext === 'jpg' ? 'image/jpeg' : ext === 'svg' ? 'image/svg+xml' : `image/${ext}`;
                return formatBlobRef(await handlers.upload(new File([bytes as BlobPart], name, { type })));
              };
              // Attachments (videos, PDFs, ...) next to the notes: stored as they are.
              const storeFile = async (bytes: Uint8Array, name: string, mime: string) => {
                if (!handlers?.uploadFile) return null;
                return formatBlobRef(await handlers.uploadFile(new File([bytes as BlobPart], name, { type: mime })));
              };
              on.log(`Unpacking ${picked.length} file(s)...`);
              const files = await expandZips(picked);
              on.log(`Unpacked into ${files.length}...`);
              const total = noteFilesFor(source, files).length;
              on.progress(0, total);
              on.log('Preprocessing complete...');
              let done = 0;
              const report = {
                missing: [] as string[],
                onFile: (path: string) => { done++; on.progress(done, total); on.log(`Processing ${path}...`); },
              };
              const notes = await parseImport(source, files, storeImage, storeFile, report);
              on.log(`Found ${notes.length} note${notes.length === 1 ? '' : 's'}`);
              for (const path of report.missing) on.log(`Not found next to the note (pick its folder or zip): ${path}`);
              if (!notes.length) return { notes: 0, errors: [] };
              for (const n of notes) on.log(`Pushing ${n.title} into database`);
              const result = await importNoteDocs(notes, on.log);
              return { notes: result.imported, skipped: result.skipped, errors: result.errors };
            },
            vault: {
              exists: !!(catalogDoc && getVaultSetup(catalogDoc)),
              open: !!vaultKey,
              onCreate: () => setVaultDialog({ mode: 'create' }),
              onLock: () => { flushLockedSave(); setVaultKey(null); },
              onChangePassword: async (current, next) => {
                const setup = catalogDoc ? getVaultSetup(catalogDoc) : null;
                if (!setup) return 'There is no vault yet.';
                const key = openVault(setup, deriveMasterKey(current, base64ToBytes(setup.salt)));
                if (!key) return 'The current vault password is wrong.';
                const salt = generateSalt();
                const passwordKey = deriveMasterKey(next, salt);
                await changeCatalog((doc) => changeVaultPassword(doc, key, bytesToBase64(salt), passwordKey));
                return null;
              },
            },
            appLock,
            onAppLock: (next) => { const value = { enabled: next.enabled, minutes: next.minutes }; writeAppLock(value); setAppLockState(value); },
            onLockNow: () => { setSettingsOpen(false); setLocked(true); },
            toolbarPlatform: 'desktop',
            toolbarConfig,
            onToolbarConfig: (config) => { setToolbarConfig(config); writeToolbarConfig(config); },
            tableToolbarConfig,
            onTableToolbarConfig: (config) => { setTableToolbarConfig(config); writeTableToolbarConfig(config); },
            drawingToolbarConfig,
            onDrawingToolbarConfig: (config) => { setDrawingToolbarConfig(config); writeDrawingToolbarConfig(config); },
            version: appVersion ? { current: appVersion, onCheck: UPDATES_ON ? () => { checkForUpdates(true); } : undefined } : undefined,
            desktop: {
              ...desktopIntegration,
              onChange: (next) => {
                const previous = desktopIntegration;
                setDesktopIntegration(next);
                applyDesktopIntegration(next, previous).catch((e) => messageDialog('Could not change it', String(e), 'error'));
              },
            },
          }}
        />
      )}
    </div>
  );
}

const readStoredKey = (): Uint8Array | null => {
  const stored = localStorage.getItem(KEY_STORAGE);
  return stored ? base64ToBytes(stored) : null;
};

// The auth token epoch of this device ("log out from all other devices" moves it on).
setAuthEpoch(readEpoch());

export default function App() {
  const [masterKey, setMasterKey] = useState<Uint8Array | null>(readStoredKey());
  const [notice, setNotice] = useState<string | null>(null);
  const [restoreText, setRestoreText] = useState<string | undefined>(undefined);

  if (masterKey) {
    return (
      <NotesApp
        masterKey={masterKey}
        restoreText={restoreText}
        onLogout={(reason) => {
          localStorage.removeItem(KEY_STORAGE);
          setNotice(reason ?? null);
          setMasterKey(null);
        }}
      />
    );
  }

  return (
    <>
      {notice && <div style={{ position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)', padding: '8px 14px', borderRadius: 8, fontSize: 13, backgroundColor: 'var(--bg-surface-high)', border: '1px solid var(--border)' }}>{notice}</div>}
      <UnlockScreen knownVerifier={parseVaultInfo(readCachedVaultInfo())?.verifier ?? null} onUnlock={(key: Uint8Array, epoch: number, backupText?: string) => {
        setRestoreText(backupText);
        localStorage.setItem(KEY_STORAGE, bytesToBase64(key));
        writeEpoch(epoch);
        setAuthEpoch(epoch);
        setNotice(null);
        setMasterKey(key);
      }} />
    </>
  );
}
