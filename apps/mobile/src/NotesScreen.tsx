import { KeyboardEvents } from 'react-native-keyboard-controller';
import { runAutoBackupIfDue } from './backups';
import { setSharedPrefsCache, getEditorPrefs } from './prefs';
import { RemindersView } from './RemindersView';
import { reminderEntries, dueReminderCount } from '@noted/ui/src/reminder-list';
import type { ReminderEntry } from '@noted/ui/src/reminder-list';
import type { ReminderState } from '@noted/editor/reminder-time';
import { reminderNotices, parseNoticeId } from '@noted/ui/src/reminder-notify';
import { syncReminderNotifications, attachReminderHandlers, applyNoticeAction } from './reminder-notifications';
import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { View, Text, FlatList, TouchableOpacity, TextInput, StyleSheet, PanResponder, BackHandler, AppState } from 'react-native';
import { appAlert } from './Dialog';
import * as Y from 'yjs';
import {
  mdiPlus, mdiMagnify, mdiPin, mdiMenu, mdiStar, mdiPinOff, mdiStarOutline, mdiArchiveArrowDownOutline,
  mdiArchiveArrowUpOutline, mdiTrashCanOutline, mdiRestore, mdiDeleteForeverOutline, mdiDeleteSweepOutline,
  mdiTabPlus, mdiLock, mdiChevronDown, mdiChevronRight, mdiSwapHorizontal, mdiSwapVertical, mdiViewSplitVertical, mdiViewSplitHorizontal, mdiClose,
  mdiCheckboxMarkedCircle, mdiCheckboxBlankCircleOutline,
  mdiDotsVertical, mdiSelectAll, mdiSortVariant, mdiPencilOutline, mdiCalendarOutline, mdiSortAlphabeticalAscending, mdiBookOutline, mdiPound,
} from '@mdi/js';
import { searchSections, searchHighlights, relativeTime, notesInView } from '@noted/ui/src/note-list';
import { buildNoteRows, linkDescendants } from '@noted/ui/src/note-groups';
import type { ListRow, NoteGrouping } from '@noted/ui/src/note-groups';
import { File, Paths } from 'expo-file-system';
import type { NoteSort } from '@noted/ui/src/note-list';
import * as SecureStore from 'expo-secure-store';
import type { NoteView } from '@noted/ui/src/note-list';
import { buildLinkTree, filterTree, foldTree } from '@noted/ui/src/link-tree';
import { notePlaces } from '@noted/ui/src/note-place';
import { seal, unseal, decryptBlob, base64ToBytes, bytesToBase64, deriveAuthToken, generateSalt } from '@noted/crypto';
import {
  LocalNoteStore, LocalBlobStore, runSyncEngine, uploadPendingBlobs, decodeNoteMeta, displayTitle, markNoteCreated,
  isSystemNote, setNoteFlag, setNoteTrashed, deleteNoteForever, unpublishQuietly, setNoteNotebook, setNoteTag, purgeExpiredTrash,
  refreshStaleNoteMeta, listOwnReminders, setOwnReminder, deleteOwnReminder, updateReminderInDoc,
  CATALOG_ID, docFromSealed, noteBodyJson, noteBodyText, listCatalog, getSharedEditorPrefs, setSharedEditorPrefs, ensureCatalogEntry, renameCatalogEntry, removeCatalogEntry, setTitle, buildNoteMeta, encodeNoteMeta, getNoteSettings,
  currentAuthToken, sessionStillValid, getVaultSetup, createVault, changeVaultPassword, openVault,
} from '@noted/sync';
import { deriveKeyInWebView } from './kdf';
import { setVaultKey, getVaultKey } from './vault-session';
import { allHistoryStates } from './history';
import { cleanLocalStorage } from './store';
import {
  deletedNoteIds, findUnusedBlobs, purgeDeletedNotes, deleteServerBlobs, usedBlobIds, BLOB_GRACE_MS, noteBlobIds,
} from '@noted/sync';
import { SettingsScreen } from './SettingsScreen';
import type { NoteMeta, CatalogKind, CatalogEntry, SharedEditorPrefs, OwnReminder } from '@noted/sync';
import { NoteRecord } from '@noted/types';
import { WS_URL, SYNC_INTERVAL_MS, WS_STALE_MS } from '@noted/config';
import { EditorScreen } from './EditorScreen';
import { Drawer } from './Drawer';
import { Sheet } from './Sheet';
import { TabsSheet } from './TabsSheet';
import type { SplitSide } from './SplitIcon';
import type { SheetRow } from './Sheet';
import { updateNoteRecord } from './note-actions';
import { randomUUID } from './uuid';
import { T, Icon } from './ui';

interface NotesScreenProps {
  masterKey: Uint8Array;
  dbStore: LocalNoteStore;
  blobStore: LocalBlobStore;
  onLogout: (reason?: string) => void;
  onLockNow: () => void;
}

export function NotesScreen({ masterKey, dbStore, blobStore, onLogout, onLockNow }: NotesScreenProps) {
  const [notes, setNotes] = useState<NoteRecord[]>([]);
  const [syncStatus, setSyncStatus] = useState<string>('');
  const [syncing, setSyncing] = useState(false);
  // WebSocket connected (Settings > Sync shows it).
  const [online, setOnline] = useState(false);
  // The last sync reached the server (the WebSocket can be down while syncing works).
  const [serverOk, setServerOk] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const syncingRef = useRef(false);
  const syncAgainRef = useRef(false);

  // The notes have been read once (notifications wait for it: an empty list would cancel them).
  const [loaded, setLoaded] = useState(false);
  const loadNotes = async () => {
    const list = await dbStore.getAll();
    const sorted = list.sort((a, b) => b.updated_at - a.updated_at);
    setNotes(sorted);
    setLoaded(true);
  };

  const syncWithServer = async () => {
    if (syncingRef.current) {
      syncAgainRef.current = true;
      return;
    }
    syncingRef.current = true;
    setSyncing(true);
    try {
      // Nothing creates blobs on mobile yet, but a queue left behind must not get stuck.
      await uploadPendingBlobs(masterKey, blobStore);
      const { changedAnything, requiresReload, failedNotes } = await runSyncEngine(masterKey, dbStore, null, null);
      if (requiresReload) await loadNotes();
      setServerOk(true);
      setLastSyncAt(Date.now());

      if (failedNotes > 0) {
        setSyncStatus(`Sync problem (${failedNotes})`);
      } else if (requiresReload || changedAnything) {
        setSyncStatus('Synced ✓');
        setTimeout(() => setSyncStatus(''), 3000);
      } else {
        setSyncStatus('');
      }
    } catch (error) {
      setServerOk(false);
      setSyncStatus('Offline');
    } finally {
      syncingRef.current = false;
      setSyncing(false);
      if (syncAgainRef.current) {
        syncAgainRef.current = false;
        syncWithServer();
      }
    }
  };

  useEffect(() => {
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
      retryTimer = setTimeout(() => { retryTimer = null; connect(); }, delay);
    };

    const drop = () => { setOnline(false); detach(); scheduleReconnect(); };

    const connect = () => {
      if (stopped) return;
      const ws = new WebSocket(WS_URL);
      socket = ws;
      lastMessageAt = Date.now();
      
      ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token: currentAuthToken(masterKey) }));
      ws.onmessage = (ev) => {
        lastMessageAt = Date.now();
        try {
          const msg = JSON.parse(ev.data as string);
          if (msg.type === 'ready') setOnline(true);
          if (msg.type === 'ready' || msg.type === 'changed') { attempt = 0; syncWithServer(); }
        } catch { }
      };
      ws.onclose = (ev: { code?: number }) => {
        // 4401: the token is not accepted any more; logged out from another device?
        if (ev.code === 4401) {
          sessionStillValid().then((valid) => {
            if (valid === false) onLogout('This phone was logged out from another device. Unlock again to continue.');
          });
        }
        drop();
      };
      ws.onerror = drop;
      
      watchdog = setInterval(() => { if (Date.now() - lastMessageAt > WS_STALE_MS) drop(); }, 10000);
    };

    connect();
    // Notes in the trash for more than 7 days are deleted for good, then the list loads.
    // Meta saved by older versions gets its reminders indexed (locally, nothing is uploaded).
    purgeExpiredTrash(masterKey, dbStore).catch(() => 0)
      .then(() => refreshStaleNoteMeta(masterKey, dbStore).catch(() => 0))
      .then(() => loadNotes());
    // Settings > Backup: an automatic backup when one is due (after the first sync).
    const backupTimer = setTimeout(() => { runAutoBackupIfDue(masterKey, dbStore, blobStore).catch(() => {}); }, 15000);
    syncWithServer();
    intervalRef.current = setInterval(syncWithServer, SYNC_INTERVAL_MS);

    return () => {
      stopped = true;
      clearTimeout(backupTimer);
      if (retryTimer) clearTimeout(retryTimer);
      if (intervalRef.current) clearInterval(intervalRef.current);
      detach();
    };
  }, [masterKey]);

  // Decrypted metadata of every note: list, views, titles of note links.
  const metas = useMemo(() => {
    const map = new Map<string, NoteMeta>();
    for (const note of notes) {
      // The notebook/tag catalog is not a note.
      if (isSystemNote(note.id)) continue;
      let plain = '';
      if (note.content && note.content.includes('.')) {
        try {
          const [n, c] = note.content.split('.');
          plain = new TextDecoder().decode(decryptBlob(masterKey, base64ToBytes(n), base64ToBytes(c)));
        } catch (e) {}
      }
      const meta = decodeNoteMeta(plain);
      if (!meta.deleted) map.set(note.id, meta);
    }
    return map;
  }, [notes, masterKey]);
  const titles = useMemo(() => {
    // Last edited first: the note pickers ("[[", "/goto", "/linkto") show them in this order
    // before anything is typed.
    const out: Record<string, string> = {};
    [...notes].sort((a, b) => b.updated_at - a.updated_at).forEach((note) => {
      const meta = metas.get(note.id);
      if (meta && !meta.trashedAt) out[note.id] = displayTitle(meta);
    });
    return out;
  }, [notes, metas]);

  // Notebook and tag names (the hidden catalog note).
  const catalogRecord = notes.find((n) => n.id === CATALOG_ID);
  // Locked notes: the vault set up in the catalog (null = none yet).
  const vaultSetup = useMemo(() => {
    try {
      return catalogRecord?.yjs_state ? getVaultSetup(docFromSealed(masterKey, catalogRecord.yjs_state)) : null;
    } catch {
      return null;
    }
  }, [catalogRecord?.yjs_state, masterKey]);
  // Settings > Sync "Clean up storage" (the same steps as the desktop's). Images used only by
  // a version in this phone's history stay.
  const historyBlobIds = async () => {
    const ids = new Set<string>();
    for (const state of await allHistoryStates()) {
      try { for (const id of noteBlobIds(noteBodyJson(docFromSealed(masterKey, state)))) ids.add(id); } catch { /* unreadable version */ }
    }
    return ids;
  };
  const cleanup = {
    find: async (includeRecent: boolean) => {
      const deleted = await deletedNoteIds(masterKey, dbStore);
      const files = await findUnusedBlobs(masterKey, dbStore, getVaultKey(), await historyBlobIds(), Date.now(), includeRecent ? 0 : BLOB_GRACE_MS);
      return { deletedNotes: deleted, fileIds: files.blobs.map((b) => b.id), fileBytes: files.bytes };
    },
    run: async (plan: { deletedNotes: string[]; fileIds: string[] }) => {
      const notesDone = await purgeDeletedNotes(masterKey, dbStore, plan.deletedNotes);
      const filesDone = await deleteServerBlobs(masterKey, plan.fileIds);
      const used = await usedBlobIds(masterKey, dbStore, getVaultKey());
      for (const id of await historyBlobIds()) used.add(id);
      const local = await cleanLocalStorage(used);
      await loadNotes();
      syncWithServer();
      return `Removed ${notesDone} deleted notes and ${filesDone} files from the server, and ${local} cached files from this phone.`;
    },
  };

  const createVaultWith = async (password: string) => {
    const salt = generateSalt();
    const passwordKey = await deriveKeyInWebView(password, bytesToBase64(salt));
    const key = await updateNoteRecord(masterKey, dbStore, CATALOG_ID, (doc) => createVault(doc, bytesToBase64(salt), passwordKey));
    await loadNotes();
    syncWithServer();
    return key ?? null;
  };
  const changeVaultPasswordWith = async (current: string, next: string): Promise<string | null> => {
    if (!vaultSetup) return 'There is no vault yet.';
    const key = openVault(vaultSetup, await deriveKeyInWebView(current, vaultSetup.salt));
    if (!key) return 'The current vault password is wrong.';
    const salt = generateSalt();
    const passwordKey = await deriveKeyInWebView(next, bytesToBase64(salt));
    await updateNoteRecord(masterKey, dbStore, CATALOG_ID, (doc) => changeVaultPassword(doc, key, bytesToBase64(salt), passwordKey));
    await loadNotes();
    syncWithServer();
    return null;
  };
  const catalog = useMemo(() => {
    if (!catalogRecord?.yjs_state) return { notebooks: [] as CatalogEntry[], tags: [] as CatalogEntry[], shared: {} as SharedEditorPrefs, reminders: [] as OwnReminder[] };
    try {
      const doc = docFromSealed(masterKey, catalogRecord.yjs_state);
      return { notebooks: listCatalog(doc, 'notebooks'), tags: listCatalog(doc, 'tags'), shared: getSharedEditorPrefs(doc), reminders: listOwnReminders(doc) };
    } catch {
      return { notebooks: [], tags: [], shared: {}, reminders: [] };
    }
  }, [catalogRecord?.yjs_state, masterKey]);
  useEffect(() => { setSharedPrefsCache(catalog.shared); }, [catalog]);
  // Where each note is (notebooks, tags, linking note): under titles in the note pickers.
  const places = useMemo(() => notePlaces(
    [...metas.entries()].filter(([, meta]) => !meta.trashedAt).map(([id, meta]) => ({
      id, title: displayTitle(meta), notebooks: meta.notebooks, tags: meta.tags, links: meta.links, archived: meta.archived,
      updatedAt: notes.find((n) => n.id === id)?.updated_at,
    })),
    { notebooks: new Map(catalog.notebooks.map((e) => [e.id, e.name])), tags: new Map(catalog.tags.map((e) => [e.id, e.name])) },
  ), [metas, notes, catalog]);
  const archivedIds = useMemo(() => [...metas.entries()].filter(([, m]) => m.archived && !m.trashedAt).map(([id]) => id).sort(), [metas]);
  const setSharedPrefs = async (patch: SharedEditorPrefs) => {
    await updateNoteRecord(masterKey, dbStore, CATALOG_ID, (doc) => setSharedEditorPrefs(doc, patch));
    await loadNotes();
    syncWithServer();
  };

  // Search inside notes: the plain text of each note, made when first searched and kept until
  // the note changes.
  const searchCache = useRef(new Map<string, { state: string; text: string }>());
  const textOf = (id: string): string => {
    const note = notes.find((n) => n.id === id);
    if (!note?.yjs_state) return '';
    const hit = searchCache.current.get(id);
    if (hit && hit.state === note.yjs_state) return hit.text;
    let text = '';
    try { text = noteBodyText(noteBodyJson(docFromSealed(masterKey, note.yjs_state))); } catch { /* unreadable note */ }
    searchCache.current.set(id, { state: note.yjs_state, text });
    return text;
  };

  const items = useMemo(() => [...metas.entries()].map(([id, meta]) => ({
    id, title: displayTitle(meta), excerpt: meta.excerpt, pinned: meta.pinned,
    updatedAt: notes.find((n) => n.id === id)?.updated_at ?? 0, created: meta.created, favorite: meta.favorite,
    archived: meta.archived, trashedAt: meta.trashedAt, notebooks: meta.notebooks, tags: meta.tags, locked: meta.locked, published: meta.published,
  })), [metas, notes]);

  // ---- views, search ----
  const [view, setView] = useState<NoteView>({ kind: 'notes' });
  const [drawerOpen, setDrawerOpen] = useState(false);
  useEffect(() => {
    if (!drawerOpen) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { setDrawerOpen(false); return true; });
    return () => sub.remove();
  }, [drawerOpen]);
  const [query, setQuery] = useState('');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const viewItems = useMemo(() => notesInView(items, view), [items, view]);
  // Links tree view: notes outside the archive and the trash, drawn like `tree`.
  const treeRows = useMemo(() => buildLinkTree(items.filter((n) => !n.trashedAt && !n.archived)
    .map((n) => ({ id: n.id, title: n.title, links: metas.get(n.id)?.links ?? [] }))), [items, metas]);
  // Folded branches (row keys) of the tree.
  const [folded, setFolded] = useState<Set<string>>(() => new Set());
  const visibleTree = useMemo(() => (query.trim() ? filterTree(treeRows, query) : foldTree(treeRows, folded)), [treeRows, query, folded]);
  const toggleFold = (key: string) => setFolded((set) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  // Search matches in bold.
  const marked = (text: string) => (query.trim()
    ? searchHighlights(text, query).map((p, i) => (p.hit ? <Text key={i} style={styles.hit}>{p.text}</Text> : p.text))
    : text);
  // Sort / group of the list (like the desktop's), kept on this phone.
  const [sort, setSortState] = useState<NoteSort>(() => {
    try {
      const v = SecureStore.getItem(SORT_KEY);
      return v === 'created' || v === 'title' ? v : 'edited';
    } catch { return 'edited'; }
  });
  const setSort = (value: NoteSort) => {
    setSortState(value);
    try { SecureStore.setItem(SORT_KEY, value); } catch { /* not kept */ }
  };
  // Grouping of the Notes view below Pinned / Recent ("By notebook" / "By tag" were sorts).
  const [grouping, setGroupingState] = useState<NoteGrouping>(() => {
    try {
      const v = SecureStore.getItem(GROUPING_KEY) ?? SecureStore.getItem(SORT_KEY);
      return v === 'tag' || v === 'az' || v === 'date' ? v : 'notebook';
    } catch { return 'notebook'; }
  });
  const setGrouping = (value: NoteGrouping) => {
    setGroupingState(value);
    try { SecureStore.setItem(GROUPING_KEY, value); } catch { /* not kept */ }
  };
  // Folded / unfolded groups and branches (note-groups.ts), kept in a small file.
  const [folds, setFolds] = useState<string[]>([]);
  useEffect(() => {
    const file = new File(Paths.document, FOLDS_FILE);
    if (file.exists) file.text().then((t) => { const v = JSON.parse(t); if (Array.isArray(v)) setFolds(v.filter((k) => typeof k === 'string')); }).catch(() => {});
  }, []);
  const toggleListFold = (key: string) => setFolds((list) => {
    const next = list.includes(key) ? list.filter((k) => k !== key) : [...list, key].slice(-300);
    try { new File(Paths.document, FOLDS_FILE).write(JSON.stringify(next)); } catch { /* not kept */ }
    return next;
  });
  const toggledFolds = useMemo(() => new Set(folds), [folds]);
  const [sortOpen, setSortOpen] = useState(false);
  const catalogNames = useMemo(() => ({
    notebooks: new Map(catalog.notebooks.map((e) => [e.id, e.name])),
    tags: new Map(catalog.tags.map((e) => [e.id, e.name])),
  }), [catalog]);
  // Pinned / Recent / groups with trees from note links (note-groups.ts, like the desktop);
  // searching: title matches first, then notes with the words in their text.
  const linksOf = useCallback((id: string) => metas.get(id)?.links ?? [], [metas]);
  const rows = useMemo<ListRow[]>(() => {
    if (!query.trim()) return buildNoteRows(viewItems, { view, grouping, sort, now, names: catalogNames, linksOf, toggled: toggledFolds });
    return searchSections(viewItems, query, sort, textOf).flatMap((sec) => [
      { kind: 'header' as const, key: `search:${sec.title}`, title: sec.title, count: sec.items.length, collapsed: false },
      ...sec.items.map((n) => ({ kind: 'note' as const, key: `search:${sec.title}/${n.id}`, item: n, depth: 0, hasChildren: false, collapsed: false, foldKey: '' })),
    ]);
  }, [viewItems, query, now, sort, grouping, view, catalogNames, linksOf, toggledFolds]);
  // ---- reminders: chips of every note and reminders of their own (catalog) ----
  const reminderList = useMemo(() => reminderEntries(
    [...metas.entries()].map(([id, meta]) => ({ id, title: displayTitle(meta), reminders: meta.reminders, trashedAt: meta.trashedAt })),
    catalog.reminders,
  ), [metas, catalog]);
  const [creatingReminder, setCreatingReminder] = useState(false);
  const changeReminder = async (entry: ReminderEntry, state: ReminderState | null, text?: string) => {
    if (!entry.noteId) {
      await changeCatalog((doc) => {
        const own = listOwnReminders(doc).find((r) => r.id === entry.id);
        if (!state) deleteOwnReminder(doc, entry.id);
        else setOwnReminder(doc, { id: entry.id, text: text ?? own?.text ?? entry.text, created: own?.created ?? Date.now(), ...state });
      });
      return;
    }
    await updateNoteRecord(masterKey, dbStore, entry.noteId, (doc) => updateReminderInDoc(doc, entry.id, state));
    await loadNotes();
    syncWithServer();
  };
  const createReminder = (text: string, state: ReminderState) =>
    changeCatalog((doc) => setOwnReminder(doc, { id: randomUUID(), text, created: Date.now(), ...state }));
  // ---- reminder notifications (reminder-notifications.ts): alarms follow the list ----
  useEffect(() => {
    if (loaded) void syncReminderNotifications(reminderNotices(reminderList, Date.now()));
  }, [reminderList, loaded]);
  const reminderHandlers = useRef({ open: (_: string) => {}, changed: () => {} });
  reminderHandlers.current = {
    open: (noticeId) => {
      const notice = parseNoticeId(noticeId);
      const noteId = notice && !notice.key.startsWith('own/') ? notice.key.slice(0, notice.key.indexOf('/')) : null;
      if (noteId && metas.has(noteId)) openFromList(noteId);
      else openView({ kind: 'reminders' });
    },
    changed: () => { void loadNotes(); syncWithServer(); },
  };
  // After the first load: a tap that started the app opens its note.
  useEffect(() => (loaded ? attachReminderHandlers({
    apply: async (noticeId, action) => {
      if (await applyNoticeAction(masterKey, dbStore, noticeId, action)) reminderHandlers.current.changed();
    },
    changed: () => reminderHandlers.current.changed(),
    open: (noticeId) => reminderHandlers.current.open(noticeId),
  }) : undefined), [masterKey, dbStore, loaded]);
  // A button pressed while the app was closed changed the database behind the list.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => { if (state === 'active') void loadNotes(); });
    return () => sub.remove();
  }, [dbStore]);

  const counts = useMemo(() => ({
    notes: notesInView(items, { kind: 'notes' }).length,
    favorites: notesInView(items, { kind: 'favorites' }).length,
    archive: notesInView(items, { kind: 'archive' }).length,
    trash: notesInView(items, { kind: 'trash' }).length,
    tree: treeRows.filter((r) => r.depth === 0).length,
    published: notesInView(items, { kind: 'published' }).length,
    reminders: dueReminderCount(reminderList, new Date(now)),
  }), [items, treeRows, reminderList, now]);
  const viewTitle = view.kind === 'notebook' ? catalog.notebooks.find((n) => n.id === view.id)?.name ?? 'Notebook'
    : view.kind === 'tag' ? `#${catalog.tags.find((t) => t.id === view.id)?.name ?? 'tag'}`
    : { notes: 'Notes', favorites: 'Favorites', archive: 'Archive', trash: 'Trash', tree: 'Links tree', published: 'Published', reminders: 'Reminders' }[view.kind];

  // ---- open notes: tabs, back history, editors, split view ----
  // The editor lies over the list. Leaving it hides it at once; it stays mounted (hidden) until
  // the WebView has handed over its last edits, then it is removed ("closing"). In a split
  // view a second editor shows another note next to the main one; editors keep their place in
  // the tree, so entering or leaving the split never reloads a note.
  const [tabs, setTabs] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [split, setSplit] = useState<{ id: string; side: SplitSide } | null>(null);
  const [backStack, setBackStack] = useState<string[]>([]);
  const [editors, setEditors] = useState<{ key: string; id: string; closing: boolean }[]>([]);
  const [tabsOpen, setTabsOpen] = useState(false);
  const [actionsFor, setActionsFor] = useState<string | null>(null);
  // Several notes selected (hold a note to start; taps then add / remove notes).
  const [selected, setSelected] = useState<string[]>([]);
  const selecting = selected.length > 0;
  const toggleSelected = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  useEffect(() => {
    if (!selecting) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { setSelected([]); return true; });
    return () => sub.remove();
  }, [selecting]);
  // Leaving the view (or a search) ends the selection.
  useEffect(() => { setSelected([]); }, [view]);
  const changeNotes = async (ids: string[], change: (doc: Y.Doc) => void) => {
    for (const id of ids) await updateNoteRecord(masterKey, dbStore, id, change);
    await loadNotes();
    syncWithServer();
  };
  const editorCounter = useRef(0);
  const splitRef = useRef(split);
  splitRef.current = split;
  // Share of the left (or upper) pane; the line between the panes can be dragged.
  const [splitRatio, setSplitRatio] = useState(0.5);
  // Typing in the lower note of a split above the keyboard: the upper note shrinks for that
  // time (the keyboard would cover nearly all of the lower one).
  const [typingIn, setTypingIn] = useState<string | null>(null);
  const [keyboardUp, setKeyboardUp] = useState(false);
  useEffect(() => {
    const show = KeyboardEvents.addListener('keyboardWillShow', () => setKeyboardUp(true));
    const hide = KeyboardEvents.addListener('keyboardWillHide', () => setKeyboardUp(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  // Tapping the grip on the line opens a small menu: swap the notes, turn the split.
  const [splitMenu, setSplitMenu] = useState(false);
  const sizeRef = useRef({ width: 1, height: 1 });
  const dragRef = useRef({ start: 0.5 });
  const ratioRef = useRef(splitRatio);
  ratioRef.current = splitRatio;
  const divider = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { dragRef.current.start = ratioRef.current; },
    onPanResponderMove: (_e, g) => {
      const side = splitRef.current?.side;
      if (!side) return;
      const across = side === 'left' || side === 'right';
      const delta = across ? g.dx / sizeRef.current.width : g.dy / sizeRef.current.height;
      setSplitRatio(Math.min(0.8, Math.max(0.2, dragRef.current.start + delta)));
    },
    // A tap (no drag) on the line or its grip.
    onPanResponderRelease: (_e, g) => {
      if (Math.abs(g.dx) < 6 && Math.abs(g.dy) < 6) setSplitMenu((open) => !open);
      else setSplitMenu(false);
    },
  }), []);
  const TURNED: Record<SplitSide, SplitSide> = { left: 'top', right: 'bottom', top: 'left', bottom: 'right' };
  const changeSplit = (side: SplitSide) => {
    setSplitMenu(false);
    if (split) showEditors(activeId, { id: split.id, side });
  };

  const showEditors = (main: string | null, nextSplit: { id: string; side: SplitSide } | null) => {
    const second = main && nextSplit && nextSplit.id !== main ? nextSplit : null;
    const wanted = [main, second?.id].filter((id): id is string => !!id);
    setEditors((list) => {
      const out = list.map((e) => (e.closing || wanted.includes(e.id) ? e : { ...e, closing: true }));
      for (const id of wanted) {
        if (out.some((e) => !e.closing && e.id === id)) continue;
        // The same note is still closing (handing over its last edits): it comes back as it is.
        // A new editor would read the note before those edits were stored.
        const closing = out.findIndex((e) => e.closing && e.id === id);
        if (closing >= 0) { out[closing] = { ...out[closing], closing: false }; continue; }
        editorCounter.current += 1;
        out.push({ key: `${id}:${editorCounter.current}`, id, closing: false });
      }
      return out;
    });
    setActiveId(main);
    setSplit(second);
  };
  // The main pane shows `id` (the split stays); null = back to the list.
  const showEditor = (id: string | null) => showEditors(id, id ? splitRef.current : null);
  const addTab = (id: string) => setTabs((list) => (list.includes(id) ? list : [...list, id]));
  const openSplit = (id: string, side: SplitSide) => {
    if (!metas.has(id)) return;
    addTab(id);
    if (!activeId) return showEditors(id, null);
    if (id === activeId) {
      // The open note itself goes to that side; another tab takes the main pane.
      const other = tabs.find((t) => t !== id);
      return other ? showEditors(other, { id, side }) : undefined;
    }
    showEditors(activeId, { id, side });
  };
  const closeSplit = () => showEditors(activeId, null);

  // From the list: the current tab shows this note (a new tab when none is open).
  const openFromList = (id: string) => {
    setTabs((list) => (list.includes(id) ? list : activeId && list.includes(activeId) ? list.map((t) => (t === activeId ? id : t)) : [...list, id]));
    setBackStack([]);
    showEditor(id);
  };
  // From a note link: a new tab, and Back returns to the note we came from.
  const openFromLink = (id: string) => {
    if (!metas.has(id)) return;
    setTabs((list) => {
      if (list.includes(id)) return list;
      const at = activeId ? list.indexOf(activeId) : -1;
      return [...list.slice(0, at + 1), id, ...list.slice(at + 1)];
    });
    if (activeId) setBackStack((stack) => [...stack, activeId]);
    showEditor(id);
  };
  const goBack = () => {
    const previous = backStack[backStack.length - 1];
    setBackStack((stack) => stack.slice(0, -1));
    loadNotes();
    if (previous && metas.has(previous)) return showEditor(previous);
    // Leaving the main pane of a split: the other note fills the screen.
    if (split) return showEditors(split.id, null);
    showEditor(null);
  };
  const closeTab = (id: string) => {
    setTabs((list) => list.filter((t) => t !== id));
    if (split?.id === id) closeSplit();
    else if (activeId === id) {
      if (split) showEditors(split.id, null);
      else showEditor(null);
    }
  };
  // Duplicate: a new note from the stored state, titled "… (copy)", opened in a new tab.
  const duplicateNote = async (id: string) => {
    const record = (await dbStore.getAll()).find((n) => n.id === id);
    if (record?.yjs_state) await saveCopy(unseal(masterKey, record.yjs_state));
  };
  // A new note "… (copy)" from a note state (Duplicate, or "Save a copy" of an older version).
  const saveCopy = async (state: Uint8Array) => {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, state);
    setTitle(doc, `${displayTitle(buildNoteMeta(doc))} (copy)`);
    getNoteSettings(doc).set('createdAt', Date.now());
    getNoteSettings(doc).delete('trashedAt');
    const newId = randomUUID();
    const content = seal(masterKey, new TextEncoder().encode(encodeNoteMeta(buildNoteMeta(doc))));
    await dbStore.save(newId, content, seal(masterKey, Y.encodeStateAsUpdate(doc)), Date.now());
    await loadNotes();
    syncWithServer();
    openFromLink(newId);
  };
  // Opening a notebook / tag from inside a note: back to the list, showing that view.
  const openView = (next: NoteView) => {
    setView(next);
    setBackStack([]);
    showEditor(null);
  };

  const handleCreateNote = async () => {
    const newId = randomUUID();
    // The doc records its creation time; `content` stays empty, so an untouched note is not
    // uploaded until it gets some text. Inside a notebook / tag view it gets that one.
    const ydoc = new Y.Doc();
    markNoteCreated(ydoc);
    if (view.kind === 'notebook') setNoteNotebook(ydoc, view.id, true);
    if (view.kind === 'tag') setNoteTag(ydoc, view.id, true);
    if (view.kind === 'favorites') setNoteFlag(ydoc, 'favorite', true);
    if (view.kind === 'trash' || view.kind === 'archive') setView({ kind: 'notes' });
    await dbStore.save(newId, '', seal(masterKey, Y.encodeStateAsUpdate(ydoc)), Date.now());
    await loadNotes();
    syncWithServer();
    setTabs((list) => [...list, newId]);
    setBackStack([]);
    showEditor(newId);
  };

  // ---- note actions (long press) ----
  // Archiving a root of a link tree offers to take the notes under it along (like the
  // desktop). `rootsDone`: the roots were changed already (the open note, through its page).
  const archiveTree = (ids: string[], on: boolean, rootsDone = false) => {
    const live = items.filter((n) => !n.trashedAt).map((n) => ({ id: n.id, links: metas.get(n.id)?.links ?? [] }));
    const extra = linkDescendants(ids, live).filter((id) => !!metas.get(id)?.archived !== on);
    const apply = (list: string[]) => { if (list.length) changeNotes(list, (d) => setNoteFlag(d, 'archived', on)).catch((e) => appAlert('Noted', String(e))); };
    if (!extra.length) return rootsDone ? undefined : apply(ids);
    const name = ids.length === 1 ? `“${titles[ids[0]] ?? 'This note'}”` : `These ${ids.length} notes`;
    appAlert(on ? 'Archive the notes under it too?' : 'Unarchive the notes under it too?',
      `${name} has ${extra.length} linked note${extra.length === 1 ? '' : 's'} under it in the link tree.`, [
        ...(rootsDone ? [] : [{ text: 'Cancel', style: 'cancel' as const }]),
        { text: 'Only this', onPress: () => { if (!rootsDone) apply(ids); } },
        { text: `${on ? 'Archive' : 'Unarchive'} all ${ids.length + extra.length}`, onPress: () => apply(rootsDone ? extra : [...ids, ...extra]) },
      ]);
  };
  const changeNote = async (id: string, change: (doc: Y.Doc) => void) => {
    await updateNoteRecord(masterKey, dbStore, id, change);
    await loadNotes();
    syncWithServer();
  };
  // A note made from the note link picker: titled, in the linking note's notebooks.
  const createLinkedNote = async (title: string, notebooks: string[]): Promise<string | null> => {
    const ydoc = new Y.Doc();
    markNoteCreated(ydoc);
    setTitle(ydoc, title);
    for (const id of notebooks) setNoteNotebook(ydoc, id, true);
    const newId = randomUUID();
    const content = seal(masterKey, new TextEncoder().encode(encodeNoteMeta(buildNoteMeta(ydoc))));
    await dbStore.save(newId, content, seal(masterKey, Y.encodeStateAsUpdate(ydoc)), Date.now());
    await loadNotes();
    syncWithServer();
    return newId;
  };
  const changeCatalog = async (change: (doc: Y.Doc) => void) => {
    await updateNoteRecord(masterKey, dbStore, CATALOG_ID, change);
    await loadNotes();
    syncWithServer();
  };
  const createEntry = async (kind: CatalogKind, name: string): Promise<CatalogEntry | undefined> => {
    const entry = await updateNoteRecord(masterKey, dbStore, CATALOG_ID, (doc) => ensureCatalogEntry(doc, kind, name, randomUUID));
    await loadNotes();
    syncWithServer();
    return entry;
  };
  const confirmDelete = (what: string, run: () => void) =>
    appAlert('Delete for good?', `${what} will be deleted on every device. This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: run },
    ]);

  const actionRows = (id: string): SheetRow[] => {
    const meta = metas.get(id);
    if (!meta) return [];
    if (meta.trashedAt) {
      return [
        { key: 'restore', label: 'Restore', icon: mdiRestore, onPress: () => changeNote(id, (d) => setNoteTrashed(d, false)) },
        { key: 'delete', label: 'Delete forever', icon: mdiDeleteForeverOutline, danger: true, onPress: () => confirmDelete(`“${displayTitle(meta)}”`, () => changeNote(id, (doc) => { unpublishQuietly(masterKey, doc); deleteNoteForever(doc); })) },
      ];
    }
    return [
      { key: 'tab', label: 'Open in new tab', icon: mdiTabPlus, onPress: () => openFromLink(id) },
      { key: 'pin', label: meta.pinned ? 'Unpin' : 'Pin', icon: meta.pinned ? mdiPinOff : mdiPin, onPress: () => changeNote(id, (d) => setNoteFlag(d, 'pinned', !meta.pinned)) },
      { key: 'fav', label: meta.favorite ? 'Remove from favorites' : 'Add to favorites', icon: meta.favorite ? mdiStar : mdiStarOutline, onPress: () => changeNote(id, (d) => setNoteFlag(d, 'favorite', !meta.favorite)) },
      { key: 'archive', label: meta.archived ? 'Unarchive' : 'Archive', icon: meta.archived ? mdiArchiveArrowUpOutline : mdiArchiveArrowDownOutline, onPress: () => archiveTree([id], !meta.archived) },
      { key: 'trash', label: 'Move to trash', icon: mdiTrashCanOutline, danger: true, onPress: () => { closeTab(id); changeNote(id, (d) => setNoteTrashed(d, true)); } },
    ];
  };

  // Header buttons while notes are selected; "⋮" has the rest (and every action of one note).
  const selectionActions = (): { key: string; label: string; icon: string; danger?: boolean; onPress: () => void }[] => {
    const ids = selected;
    const done = (work: Promise<void>) => { setSelected([]); work.catch((e) => appAlert('Noted', String(e))); };
    const metasOf = ids.map((id) => metas.get(id)).filter((m): m is NoteMeta => !!m);
    if (view.kind === 'trash') {
      return [
        { key: 'restore', label: 'Restore', icon: mdiRestore, onPress: () => done(changeNotes(ids, (d) => setNoteTrashed(d, false))) },
        { key: 'delete', label: 'Delete forever', icon: mdiDeleteForeverOutline, danger: true, onPress: () => confirmDelete(`${ids.length} note${ids.length === 1 ? '' : 's'}`, () => done(changeNotes(ids, (doc) => { unpublishQuietly(masterKey, doc); deleteNoteForever(doc); }))) },
      ];
    }
    const allPinned = metasOf.every((m) => m.pinned);
    const allFav = metasOf.every((m) => m.favorite);
    return [
      { key: 'pin', label: allPinned ? 'Unpin' : 'Pin', icon: allPinned ? mdiPinOff : mdiPin, onPress: () => done(changeNotes(ids, (d) => setNoteFlag(d, 'pinned', !allPinned))) },
      { key: 'fav', label: allFav ? 'Remove from favorites' : 'Add to favorites', icon: allFav ? mdiStar : mdiStarOutline, onPress: () => done(changeNotes(ids, (d) => setNoteFlag(d, 'favorite', !allFav))) },
      { key: 'trash', label: 'Move to trash', icon: mdiTrashCanOutline, danger: true, onPress: () => { ids.forEach(closeTab); done(changeNotes(ids, (d) => setNoteTrashed(d, true))); } },
      { key: 'more', label: 'More', icon: mdiDotsVertical, onPress: () => setSelectionSheet(true) },
    ];
  };
  const [selectionSheet, setSelectionSheet] = useState(false);
  // Settings > Backup > compare: a note opened with its backup version shown next to it.
  const [backupCompare, setBackupCompare] = useState<{ id: string; token: number; state: Uint8Array; createdAt: number } | null>(null);
  const selectionSheetRows = (): SheetRow[] => {
    const ids = selected;
    const close = (work: Promise<void>) => { setSelectionSheet(false); setSelected([]); work.catch((e) => appAlert('Noted', String(e))); };
    const metasOf = ids.map((id) => metas.get(id)).filter((m): m is NoteMeta => !!m);
    const allArchived = metasOf.every((m) => m.archived);
    const shown = [...new Set(rows.flatMap((r) => (r.kind === 'note' ? [r.item.id] : [])))];
    return [
      ...(shown.length > ids.length ? [{ key: 'all', label: 'Select all', icon: mdiSelectAll, onPress: () => { setSelectionSheet(false); setSelected(shown); } }] : []),
      ...(ids.length === 1 ? [{ key: 'tab', label: 'Open in new tab', icon: mdiTabPlus, onPress: () => { setSelectionSheet(false); setSelected([]); openFromLink(ids[0]); } }] : []),
      { key: 'archive', label: allArchived ? 'Unarchive' : 'Archive', icon: allArchived ? mdiArchiveArrowUpOutline : mdiArchiveArrowDownOutline, onPress: () => { setSelectionSheet(false); setSelected([]); archiveTree(ids, !allArchived); } },
      { key: 'trash', label: `Move ${ids.length === 1 ? 'it' : `${ids.length} notes`} to trash`, icon: mdiTrashCanOutline, danger: true, onPress: () => { ids.forEach(closeTab); close(changeNotes(ids, (d) => setNoteTrashed(d, true))); } },
    ];
  };

  const emptyTrash = () => {
    const ids = viewItems.map((n) => n.id);
    if (ids.length) confirmDelete(`${ids.length} note${ids.length === 1 ? '' : 's'} in the trash`, async () => {
      for (const id of ids) await updateNoteRecord(masterKey, dbStore, id, (doc) => { unpublishQuietly(masterKey, doc); deleteNoteForever(doc); });
      await loadNotes();
      syncWithServer();
    });
  };

  // Connection for the sync button's dot: the WebSocket, or the last sync reached the server.
  const isOnline = online || serverOk;
  const typingBelow = keyboardUp && !!split && typingIn !== null
    && (split.side === 'bottom' ? typingIn === split.id : split.side === 'top' && typingIn === activeId);
  const paneRatio = typingBelow ? 0.22 : splitRatio;
  return (
    <View style={styles.container} onLayout={(e) => { sizeRef.current = { width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height }; }}>
      {selecting ? (
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setSelected([])} style={styles.iconBtn} accessibilityLabel="Cancel selection">
            <Icon path={mdiClose} size={26} />
          </TouchableOpacity>
          <Text style={styles.title} numberOfLines={1}>{selected.length} selected</Text>
          {selectionActions().map((a) => (
            <TouchableOpacity key={a.key} onPress={a.onPress} style={styles.iconBtn} accessibilityLabel={a.label}>
              <Icon path={a.icon} size={24} color={a.danger ? T.error : T.on_surface} />
            </TouchableOpacity>
          ))}
        </View>
      ) : (
      <View style={styles.header}>
        <TouchableOpacity onPress={() => setDrawerOpen(true)} style={styles.iconBtn} accessibilityLabel="Menu">
          <Icon path={mdiMenu} size={26} />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>{viewTitle}</Text>
        {view.kind === 'trash' && viewItems.length > 0 ? (
          <TouchableOpacity onPress={emptyTrash} style={styles.iconBtn} accessibilityLabel="Empty trash">
            <Icon path={mdiDeleteSweepOutline} size={24} color={T.error} />
          </TouchableOpacity>
        ) : null}
        {view.kind !== 'tree' && view.kind !== 'reminders' ? (
          <TouchableOpacity onPress={() => setSortOpen(true)} style={styles.iconBtn} accessibilityLabel="Sort">
            <Icon path={mdiSortVariant} size={24} />
          </TouchableOpacity>
        ) : null}
        {tabs.length > 0 ? (
          <TouchableOpacity onPress={() => setTabsOpen(true)} style={styles.tabCount} accessibilityLabel="Open tabs">
            <Text style={styles.tabCountText}>{tabs.length}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      )}
      <View style={styles.search}>
        <Icon path={mdiMagnify} size={20} color={T.on_surface_variant} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={view.kind === 'reminders' ? 'Search reminders' : 'Search in notes'}
          placeholderTextColor={T.on_surface_variant}
          style={styles.searchInput}
        />
        {query ? (
          <TouchableOpacity onPress={() => setQuery('')} hitSlop={10} accessibilityLabel="Clear search">
            <Icon path={mdiClose} size={20} color={T.on_surface_variant} />
          </TouchableOpacity>
        ) : null}
      </View>

      {view.kind === 'reminders' ? (
        <RemindersView
          entries={reminderList}
          query={query}
          times={{ morning: getEditorPrefs().reminderMorning, evening: getEditorPrefs().reminderEvening }}
          creating={creatingReminder}
          onCreated={() => setCreatingReminder(false)}
          onOpenNote={(id) => openFromList(id)}
          onChange={(entry, state, text) => { changeReminder(entry, state, text); }}
          onCreate={(text, state) => { createReminder(text, state); }}
        />
      ) : view.kind === 'tree' ? (
        <FlatList
          data={visibleTree}
          keyExtractor={(row) => row.key}
          renderItem={({ item: row }) => (
            <TouchableOpacity style={styles.treeRow} onPress={() => openFromList(row.id)} onLongPress={() => setActionsFor(row.id)} delayLongPress={350}>
              <Text style={styles.treePrefix}>{row.prefix}</Text>
              <Text style={[styles.treeTitle, row.depth === 0 && { fontWeight: 'bold' }, row.cycle && { opacity: 0.6 }]} numberOfLines={1}>
                {row.title}{row.cycle ? ' ↻' : ''}
              </Text>
              <View style={{ flex: 1 }} />
              {row.hasChildren && !row.cycle && !query.trim() ? (
                <TouchableOpacity onPress={() => toggleFold(row.key)} style={styles.treeFold} accessibilityLabel={folded.has(row.key) ? 'Expand' : 'Collapse'}>
                  <Icon path={folded.has(row.key) ? mdiChevronRight : mdiChevronDown} size={22} color={T.on_surface_variant} />
                </TouchableOpacity>
              ) : null}
            </TouchableOpacity>
          )}
          ListEmptyComponent={<Text style={styles.empty}>{query ? 'No notes match' : 'No note links yet. Link notes with the note link button; notes that link to others become branches here.'}</Text>}
          contentContainerStyle={{ paddingBottom: 96 }}
        />
      ) : <FlatList
        data={rows}
        keyExtractor={(row) => row.key}
        renderItem={({ item: row }) => {
          if (row.kind === 'header') {
            const foldable = !row.key.startsWith('search:');
            return (
              <TouchableOpacity style={styles.sectionRow} disabled={!foldable} onPress={() => toggleListFold(row.key)}>
                {foldable ? <Icon path={row.collapsed ? mdiChevronRight : mdiChevronDown} size={18} color={T.primary} /> : null}
                <Text style={styles.sectionText} numberOfLines={1}>{row.title}</Text>
                <Text style={styles.sectionCount}>{row.count}</Text>
              </TouchableOpacity>
            );
          }
          const item = row.item;
          return (
          <TouchableOpacity
            style={[styles.noteItem, { paddingLeft: 8 }, selected.includes(item.id) && { backgroundColor: T.secondary_container }]}
            onPress={() => (selecting ? toggleSelected(item.id) : openFromList(item.id))}
            onLongPress={() => toggleSelected(item.id)}
            delayLongPress={350}
          >
            {/* One guide line per level of the tree (note links inside a notebook / tag). */}
            {Array.from({ length: row.depth }, (_, i) => <View key={i} style={[styles.treeGuide, i === 0 && { marginLeft: 12 }]} />)}
            {row.hasChildren ? (
              <TouchableOpacity onPress={() => toggleListFold(row.foldKey)} hitSlop={10} style={styles.branchToggle} accessibilityLabel={row.collapsed ? 'Expand' : 'Collapse'}>
                <Icon path={row.collapsed ? mdiChevronRight : mdiChevronDown} size={20} color={T.on_surface_variant} />
              </TouchableOpacity>
            ) : <View style={styles.branchToggle} />}
            {selecting ? (
              <Icon path={selected.includes(item.id) ? mdiCheckboxMarkedCircle : mdiCheckboxBlankCircleOutline} size={22} color={selected.includes(item.id) ? T.primary : T.on_surface_variant} />
            ) : null}
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                {item.pinned ? <Icon path={mdiPin} size={14} color={T.primary} /> : null}
                {item.favorite ? <Icon path={mdiStar} size={14} color={T.primary} /> : null}
                {item.locked ? <Icon path={mdiLock} size={14} color={T.on_surface_variant} /> : null}
                <Text style={[styles.noteTitle, row.hasChildren && { fontWeight: row.depth === 0 ? '700' : '600' }, row.depth > 0 && !row.hasChildren && { color: T.on_surface_variant }]} numberOfLines={1}>{marked(item.title)}</Text>
                <Text style={styles.noteAge}>{relativeTime(item.updatedAt, now)}</Text>
              </View>
              {/* While searching: the text around the match. */}
              {query.trim() && item.excerpt ? <Text style={styles.snippet} numberOfLines={2}>{marked(item.excerpt)}</Text> : null}
            </View>
          </TouchableOpacity>
          );
        }}
        ListEmptyComponent={<Text style={styles.empty}>{query ? 'No notes match' : 'Nothing here yet'}</Text>}
        contentContainerStyle={{ paddingBottom: 96 }}
      />}

      {/* Only over the list: Android draws elevated views above the editor overlay. */}
      {editors.some((e) => !e.closing) ? null : (
        <TouchableOpacity onPress={view.kind === 'reminders' ? () => setCreatingReminder(true) : handleCreateNote} style={styles.fab} accessibilityLabel={view.kind === 'reminders' ? 'New reminder' : 'New note'}>
          <Icon path={mdiPlus} size={28} color={T.on_primary_container} />
        </TouchableOpacity>
      )}

      {drawerOpen ? (
        <Drawer
          view={view}
          counts={counts}
          notebooks={catalog.notebooks.map((e) => ({ ...e, count: notesInView(items, { kind: 'notebook', id: e.id }).length }))}
          tags={catalog.tags.map((e) => ({ ...e, count: notesInView(items, { kind: 'tag', id: e.id }).length }))}
          onView={setView}
          onCreate={(kind, name) => { createEntry(kind, name); }}
          onRename={(kind, id, name) => { changeCatalog((doc) => renameCatalogEntry(doc, kind, id, name)); }}
          onDelete={(kind, id) => {
            changeCatalog((doc) => removeCatalogEntry(doc, kind, id));
            if ('id' in view && view.id === id) setView({ kind: 'notes' });
          }}
          onSettings={() => { setDrawerOpen(false); setSettingsOpen(true); }}
          sync={{ online: isOnline, syncing, status: syncStatus, lastSyncAt, onSync: () => syncWithServer() }}
          onClose={() => setDrawerOpen(false)}
        />
      ) : null}

      {editors.map((e) => {
        const isSplit = !e.closing && split?.id === e.id;
        const isMain = !e.closing && !!split && e.id === activeId;
        const side = split ? (isSplit ? split.side : OPPOSITE[split.side]) : null;
        const ratio = paneRatio;
        const backlinks = items.filter((n) => n.id !== e.id && !n.trashedAt && (metas.get(n.id)?.links ?? []).includes(e.id));
        return (
          <View
            key={e.key}
            style={[side && (isSplit || isMain) ? paneStyle(side, ratio) : StyleSheet.absoluteFill, e.closing && styles.hidden]}
            pointerEvents={e.closing ? 'none' : 'auto'}
          >
            <EditorScreen
              noteId={e.id}
              visible={!e.closing}
              onEditorFocus={() => setTypingIn(e.id)}
              onClosed={() => setEditors((list) => list.filter((x) => x.key !== e.key))}
              titles={titles}
              catalog={catalog}
              onOpenNote={isSplit ? (id) => { if (metas.has(id)) { addTab(id); showEditors(activeId, { id, side: split!.side }); } } : openFromLink}
              onOpenSplit={openSplit}
              onArchived={(id, on) => archiveTree([id], on, true)}
              onOpenView={openView}
              onCreateEntry={createEntry}
              onCreateLinkedNote={createLinkedNote}
              tabsCount={tabs.length}
              onShowTabs={() => setTabsOpen(true)}
              masterKey={masterKey}
              dbStore={dbStore}
              blobStore={blobStore}
              onBack={isSplit ? closeSplit : goBack}
              triggerSync={syncWithServer}
              compact={side === 'bottom'}
              inSplit={isSplit}
              edited={notes.find((n) => n.id === e.id)?.updated_at ?? null}
              places={places}
              archivedIds={archivedIds}
              links={(metas.get(e.id)?.links ?? []).filter((id) => titles[id]).map((id) => ({ id, name: titles[id], place: places[id] }))}
              backlinks={backlinks.map((n) => ({ id: n.id, name: n.title, place: places[n.id] }))}
              onDuplicate={() => duplicateNote(e.id)}
              onSaveCopy={saveCopy}
              vaultSetup={vaultSetup}
              onCreateVault={createVaultWith}
              onRemoved={() => { closeTab(e.id); setTimeout(loadNotes, 600); }}
              backupCompare={backupCompare?.id === e.id ? backupCompare : null}
              onBackupShown={() => setBackupCompare((c) => (c?.id === e.id ? null : c))}
            />
          </View>
        );
      })}
      {split && activeId ? (
        <View style={dividerStyle(split.side, paneRatio)} {...divider.panHandlers} accessibilityLabel="Drag to resize the notes">
          <View style={[styles.dividerLine, split.side === 'left' || split.side === 'right' ? { width: 2, height: '100%' } : { height: 2, width: '100%' }]} />
          <View style={[styles.dividerGrip, split.side === 'left' || split.side === 'right' ? { width: 6, height: 44 } : { width: 44, height: 6 }]} />
        </View>
      ) : null}
      {split && activeId && splitMenu ? (
        <View style={[styles.splitMenu, split.side === 'left' || split.side === 'right'
          ? { left: pct(splitRatio), top: '50%', marginLeft: -84, marginTop: 30 }
          : { top: pct(splitRatio), left: '50%', marginLeft: -84, marginTop: 20 }]}
        >
          {(() => {
            const across = split.side === 'left' || split.side === 'right';
            const item = (icon: string, label: string, run: () => void) => (
              <TouchableOpacity key={label} onPress={run} style={styles.splitMenuBtn} accessibilityLabel={label}>
                <Icon path={icon} size={22} color={T.on_surface} />
              </TouchableOpacity>
            );
            return [
              item(across ? mdiSwapHorizontal : mdiSwapVertical, 'Swap the notes', () => changeSplit(OPPOSITE[split.side])),
              item(across ? mdiViewSplitHorizontal : mdiViewSplitVertical, across ? 'One above the other' : 'Side by side', () => changeSplit(TURNED[split.side])),
              item(mdiClose, 'Close the menu', () => setSplitMenu(false)),
            ];
          })()}
        </View>
      ) : null}

      {tabsOpen ? (
        <TabsSheet
          tabs={tabs}
          titles={titles}
          places={places}
          activeId={activeId}
          onOpen={(id) => { setBackStack([]); if (split?.id === id) showEditors(id, null); else showEditor(id); }}
          onCloseTab={closeTab}
          onCloseAll={() => { setTabs([]); showEditors(null, null); }}
          onSplit={openSplit}
          onClose={() => setTabsOpen(false)}
        />
      ) : null}
      {settingsOpen ? (
        <SettingsScreen
          masterKey={masterKey}
          cleanup={cleanup}
          store={dbStore}
          blobs={blobStore}
          online={online || serverOk}
          lastSyncAt={lastSyncAt}
          syncing={syncing}
          notebookNames={new Map(catalog.notebooks.map((n) => [n.id, n.name]))}
          onSyncNow={syncWithServer}
          onSharedPrefs={setSharedPrefs}
          onCompareNote={(id, state, createdAt) => {
            setSettingsOpen(false);
            setBackupCompare({ id, token: Date.now(), state, createdAt });
            openFromList(id);
          }}
          onRestored={() => { loadNotes(); syncWithServer(); }}
          onLogout={() => { setSettingsOpen(false); onLogout(); }}
          onLockNow={() => { setSettingsOpen(false); onLockNow(); }}
          vault={{
            exists: !!vaultSetup,
            onCreate: async (password) => { const key = await createVaultWith(password); if (key) setVaultKey(key); return key ? null : 'Could not create the vault.'; },
            onChangePassword: changeVaultPasswordWith,
            onLock: () => setVaultKey(null),
          }}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
      {sortOpen ? (
        <Sheet
          title="Sort by"
          rows={[
            ...([['notebook', 'Group: notebooks', mdiBookOutline], ['tag', 'Group: tags', mdiPound], ['az', 'Group: A–Z', mdiSortAlphabeticalAscending], ['date', 'Group: date', mdiCalendarOutline]] as [NoteGrouping, string, string][])
              .map(([value, label, icon]) => ({ key: `g-${value}`, label, icon, active: grouping === value, onPress: () => { setGrouping(value); setSortOpen(false); } })),
            ...([['edited', 'Sort: last edited', mdiPencilOutline], ['created', 'Sort: date created', mdiCalendarOutline], ['title', 'Sort: title (A–Z)', mdiSortAlphabeticalAscending]] as [NoteSort, string, string][])
              .map(([value, label, icon]) => ({ key: `s-${value}`, label, icon, active: sort === value, onPress: () => { setSort(value); setSortOpen(false); } })),
          ]}
          onClose={() => setSortOpen(false)}
        />
      ) : null}
      {selectionSheet ? <Sheet title={`${selected.length} selected`} rows={selectionSheetRows()} onClose={() => setSelectionSheet(false)} /> : null}
      {actionsFor ? (
        <Sheet title={titles[actionsFor] ?? displayTitle(metas.get(actionsFor) ?? decodeNoteMeta(''))} rows={actionRows(actionsFor)} onClose={() => setActionsFor(null)} />
      ) : null}
    </View>
  );
}

const SORT_KEY = 'noted_note_sort';
const GROUPING_KEY = 'noted_note_grouping';
const FOLDS_FILE = 'list-folds.json';
const OPPOSITE: Record<SplitSide, SplitSide> = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' };
const pct = (n: number) => `${Math.round(n * 1000) / 10}%` as const;
// A pane of the split view; `ratio` is the share of the left (or upper) pane.
const paneStyle = (side: SplitSide, ratio: number) => ({
  position: 'absolute' as const,
  ...(side === 'left' ? { left: 0, top: 0, bottom: 0, width: pct(ratio) }
    : side === 'right' ? { right: 0, top: 0, bottom: 0, width: pct(1 - ratio) }
    : side === 'top' ? { left: 0, right: 0, top: 0, height: pct(ratio) }
    : { left: 0, right: 0, bottom: 0, height: pct(1 - ratio) }),
});
// The line between the panes, with a wider area to grab it.
const DIVIDER_TOUCH = 28;
const dividerStyle = (side: SplitSide, ratio: number) => ({
  position: 'absolute' as const,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
  ...(side === 'left' || side === 'right'
    ? { top: 0, bottom: 0, left: pct(ratio), width: DIVIDER_TOUCH, marginLeft: -DIVIDER_TOUCH / 2 }
    : { left: 0, right: 0, top: pct(ratio), height: DIVIDER_TOUCH, marginTop: -DIVIDER_TOUCH / 2 }),
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.background },
  dividerLine: { position: 'absolute', backgroundColor: T.outline },
  dividerGrip: { borderRadius: 3, backgroundColor: T.primary },
  splitMenu: { position: 'absolute', width: 168, flexDirection: 'row', justifyContent: 'space-around', padding: 6, borderRadius: 16, backgroundColor: T.surface_container_high, elevation: 6 },
  splitMenuBtn: { padding: 10, borderRadius: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingTop: 52, paddingBottom: 6 },
  title: { flex: 1, fontSize: 26, fontWeight: 'bold', color: T.on_surface },
  iconBtn: { padding: 8, borderRadius: 20 },
  tabCount: { minWidth: 30, height: 30, borderRadius: 8, borderWidth: 2, borderColor: T.on_surface, alignItems: 'center', justifyContent: 'center', marginHorizontal: 6 },
  tabCountText: { color: T.on_surface, fontWeight: 'bold', fontSize: 13 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginVertical: 8, paddingHorizontal: 14, height: 48, borderRadius: 24, backgroundColor: T.surface_container_high },
  searchInput: { flex: 1, color: T.on_surface, fontSize: 16 },
  hit: { fontWeight: 'bold', color: T.primary },
  section: { color: T.primary, fontSize: 12, fontWeight: 'bold', letterSpacing: 0.6, textTransform: 'uppercase', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 6 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 12, paddingRight: 20, paddingTop: 16, paddingBottom: 8 },
  sectionText: { flex: 1, color: T.primary, fontSize: 12, fontWeight: 'bold', letterSpacing: 0.6, textTransform: 'uppercase' },
  sectionCount: { color: T.on_surface_variant, fontSize: 12 },
  treeGuide: { alignSelf: 'stretch', width: 16, borderLeftWidth: 1, borderLeftColor: T.outline_variant, marginVertical: -14 },
  branchToggle: { width: 24, alignItems: 'center' },
  noteItem: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingVertical: 14 },
  treeRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, minHeight: 40 },
  treePrefix: { color: T.on_surface_variant, fontFamily: 'monospace', fontSize: 15 },
  treeTitle: { flexShrink: 1, color: T.on_surface, fontSize: 16 },
  treeFold: { padding: 8 },
  noteTitle: { flex: 1, color: T.on_surface, fontSize: 16 },
  noteAge: { color: T.on_surface_variant, fontSize: 12 },
  snippet: { color: T.on_surface_variant, fontSize: 13, marginTop: 3, lineHeight: 18 },
  empty: { color: T.on_surface_variant, textAlign: 'center', marginTop: 48 },
  fab: { position: 'absolute', right: 20, bottom: 32, width: 60, height: 60, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: T.primary_container, elevation: 4 },
  hidden: { opacity: 0 },
});
