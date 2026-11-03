import React, { useRef, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, ScrollView, StyleSheet, Pressable } from 'react-native';
import type { GestureResponderEvent } from 'react-native';
import {
  mdiNoteTextOutline, mdiStarOutline, mdiArchiveOutline, mdiTrashCanOutline, mdiHomeOutline, mdiBookOutline, mdiWeb,
  mdiPound, mdiPlus, mdiCogOutline, mdiFileTreeOutline, mdiBellOutline, mdiCreationOutline, mdiBookPlusOutline,
  mdiFolderMoveOutline, mdiPencilOutline, mdiDeleteOutline, mdiArrowUp, mdiChevronDown, mdiChevronRight,
} from '@mdi/js';
import * as SecureStore from 'expo-secure-store';
import { notebookSubtree } from '@noted/sync';
import type { NoteView } from '@noted/ui/src/note-list';
import { inBox } from '@noted/ui/src/drop-index';
import type { Box } from '@noted/ui/src/drop-index';
import { T, Icon, themed } from './ui';
import { appAlert } from './Dialog';
import { Sheet } from './Sheet';
import type { SheetRow } from './Sheet';

export interface DrawerEntry {
  id: string;
  name: string;
  count: number;
  // Notebooks: the parent notebook and the depth in the tree of sub-notebooks, shown indented
  // (the list comes in tree order).
  parent?: string | null;
  depth?: number;
}

interface Props {
  view: NoteView;
  // reminders: due now or today.
  counts: { notes: number; favorites: number; archive: number; trash: number; tree: number; published: number; reminders: number; claude?: number };
  notebooks: DrawerEntry[];
  tags: DrawerEntry[];
  onView: (view: NoteView) => void;
  // `parent`: a new sub-notebook inside that notebook (absent = top level).
  onCreate: (kind: 'notebooks' | 'tags', name: string, parent?: string) => void;
  onRename: (kind: 'notebooks' | 'tags', id: string, name: string) => void;
  // The notes stay; only the notebook / tag goes (and leaves them). Tags are confirmed here,
  // notebooks by the caller (it knows how many notes move).
  onDelete: (kind: 'notebooks' | 'tags', id: string) => void;
  // Moves a notebook into another one (null = top level).
  onMove: (id: string, parent: string | null) => void;
  onSettings: () => void;
  // Connection state under the app name (sync runs on its own; a tap syncs now).
  // localOnly: this phone works without a server.
  sync: { online: boolean; localOnly?: boolean; syncing: boolean; status: string; lastSyncAt: number | null; onSync: () => void };
  onClose: () => void;
}

type Tab = 'home' | 'notebooks' | 'tags';

const OPEN_KEY = 'noted_drawer_open_notebooks';

// Side panel like Notesnook's: Notes / Favorites / Archive / Trash, notebooks and tags.
export function Drawer({ view, counts, notebooks, tags, onView, onCreate, onRename, onDelete, onMove, onSettings, sync, onClose }: Props) {
  const [tab, setTab] = useState<Tab>(view.kind === 'notebook' ? 'notebooks' : view.kind === 'tag' ? 'tags' : 'home');
  const [creating, setCreating] = useState('');
  // A name field for a new entry: at the top (parent null) or a new sub-notebook under `parent`.
  const [creatingIn, setCreatingIn] = useState<{ parent: string | null } | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  // Hold a notebook / tag still: its menu (like the desktop's right click).
  const [menu, setMenu] = useState<DrawerEntry | null>(null);
  // "Move to…": a tree of the notebooks to pick the new parent from.
  const [mover, setMover] = useState<DrawerEntry | null>(null);
  // Hold a notebook and move the finger: it follows the finger; dropped on another notebook it
  // goes inside it, on empty space in the panel back to the top level. `over` = the notebook
  // under the finger (never itself or one inside it), `top` = empty panel space.
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; over: string | null; top: boolean } | null>(null);
  const dragRef = useRef<{ id: string; x: number; y: number; moved: boolean; over: string | null; top: boolean } | null>(null);
  const rowRefs = useRef(new Map<string, View>());
  const boxes = useRef<{ panel: Box; rows: Map<string, Box> } | null>(null);
  const panelRef = useRef<View | null>(null);

  const parentOf = new Map(notebooks.map((n) => [n.id, n.parent ?? null]));
  const hasChildren = new Set(notebooks.map((n) => n.parent).filter((p): p is string => !!p));
  // Unfolded notebooks (like the desktop sidebar: folded by default), kept on this phone. The
  // notebook shown in the list is never hidden in a folded parent.
  const [open, setOpenState] = useState<Set<string>>(() => {
    let ids: string[] = [];
    try { const v = JSON.parse(SecureStore.getItem(OPEN_KEY) ?? '[]'); if (Array.isArray(v)) ids = v.filter((k) => typeof k === 'string'); } catch { /* none kept */ }
    if (view.kind === 'notebook') {
      for (let p = parentOf.get(view.id) ?? null, guard = 0; p && guard < 100; p = parentOf.get(p) ?? null, guard++) ids.push(p);
    }
    return new Set(ids);
  });
  const setOpen = (id: string, on: boolean) => setOpenState((set) => {
    if (set.has(id) === on) return set;
    const next = new Set(set);
    if (on) next.add(id); else next.delete(id);
    try { SecureStore.setItem(OPEN_KEY, JSON.stringify([...next].slice(-500))); } catch { /* not kept */ }
    return next;
  });
  // Notebooks whose parents are all unfolded.
  const shown = (e: DrawerEntry) => {
    for (let p = e.parent ?? null, guard = 0; p && guard < 100; p = parentOf.get(p) ?? null, guard++) if (!open.has(p)) return false;
    return true;
  };
  // The notebook and every notebook below it (where it may not be moved).
  const subtree = (id: string) => notebookSubtree(notebooks.map((n) => ({ id: n.id, parent: n.parent ?? null })), id);

  const measure = (v: View | null | undefined): Promise<Box | null> => new Promise((resolve) => {
    if (!v) return resolve(null);
    v.measureInWindow((x, y, w, h) => resolve(w || h ? { x, y, w, h } : null));
  });
  const beginDrag = (e: DrawerEntry, ev: GestureResponderEvent) => {
    const { pageX, pageY } = ev.nativeEvent;
    dragRef.current = { id: e.id, x: pageX, y: pageY, moved: false, over: null, top: false };
    boxes.current = null;
    setDrag({ id: e.id, x: pageX, y: pageY, over: null, top: false });
    (async () => {
      const panel = await measure(panelRef.current);
      const rows = new Map<string, Box>();
      for (const [id, v] of rowRefs.current) { const box = await measure(v); if (box) rows.set(id, box); }
      if (panel) boxes.current = { panel, rows };
      const d = dragRef.current;
      if (d) setDrag({ id: d.id, x: d.x, y: d.y, over: d.over, top: d.top });
    })();
  };
  const targetAt = (id: string, x: number, y: number): { over: string | null; top: boolean } => {
    const b = boxes.current;
    if (!b) return { over: null, top: false };
    for (const [rowId, box] of b.rows) {
      if (inBox(box, x, y)) return { over: subtree(id).has(rowId) ? null : rowId, top: false };
    }
    return { over: null, top: inBox(b.panel, x, y) };
  };
  // Raw touch events reach the panel whichever row holds the touch.
  const onTouchMove = (ev: GestureResponderEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const { pageX, pageY } = ev.nativeEvent;
    if (!d.moved && Math.hypot(pageX - d.x, pageY - d.y) < 10) return;
    const t = targetAt(d.id, pageX, pageY);
    dragRef.current = { ...d, x: pageX, y: pageY, moved: true, ...t };
    setDrag({ id: d.id, x: pageX, y: pageY, ...t });
  };
  const onTouchEnd = () => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    setDrag(null);
    const entry = notebooks.find((n) => n.id === d.id);
    if (!entry) return;
    // Held still: the menu.
    if (!d.moved) { setMenu(entry); return; }
    const parent = parentOf.get(d.id) ?? null;
    if (d.over && d.over !== parent) onMove(d.id, d.over);
    else if (!d.over && d.top && parent) onMove(d.id, null);
  };
  const onTouchCancel = () => { dragRef.current = null; setDrag(null); };

  const same = (v: NoteView) => v.kind === view.kind && (!('id' in v) || ('id' in view && view.id === v.id));
  // `fold`: a notebook row's arrow slot (null = no sub-notebooks, an empty slot keeps names aligned).
  const row = (key: string, icon: string, label: string, count: number, target: NoteView, onLongPress?: (ev: GestureResponderEvent) => void, depth = 0, fold?: { open: boolean } | null) => {
    const active = same(target);
    const dragged = drag?.id === key;
    const dropTarget = drag?.over === key;
    return (
      <TouchableOpacity
        key={key}
        ref={target.kind === 'notebook' ? (v: View | null) => { if (v) rowRefs.current.set(key, v); else rowRefs.current.delete(key); } : undefined}
        style={[styles.row, active && styles.rowActive, depth > 0 && { paddingLeft: 14 + depth * 20 }, dragged && { opacity: 0.35 }, dropTarget && styles.rowTarget]}
        onPress={() => { onView(target); onClose(); }}
        onLongPress={onLongPress}
        delayLongPress={350}
      >
        {fold !== undefined ? (
          <TouchableOpacity
            style={styles.fold}
            disabled={!fold}
            hitSlop={10}
            onPress={() => fold && setOpen(key, !fold.open)}
            accessibilityLabel={fold ? (fold.open ? 'Collapse' : 'Expand') : undefined}
          >
            {fold ? <Icon path={fold.open ? mdiChevronDown : mdiChevronRight} size={20} color={T.on_surface_variant} /> : null}
          </TouchableOpacity>
        ) : null}
        <Icon path={icon} size={22} color={active ? T.primary : T.on_surface} />
        <Text style={[styles.rowLabel, active && { color: T.on_secondary_container }]} numberOfLines={1}>{label}</Text>
        <Text style={styles.count}>{count}</Text>
        {dropTarget ? <View pointerEvents="none" style={styles.targetRing} /> : null}
      </TouchableOpacity>
    );
  };

  const kind = tab === 'notebooks' ? 'notebooks' : 'tags';
  const list = tab === 'notebooks' ? notebooks.filter(shown) : tags;
  const confirmTagDelete = (e: DrawerEntry) => appAlert(`Delete the tag "${e.name}"?`, 'Its notes are not deleted; they only leave this tag. On every device.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: () => onDelete('tags', e.id) },
  ]);
  const menuRows = (e: DrawerEntry): SheetRow[] => [
    ...(kind === 'notebooks' ? [
      { key: 'sub', label: 'New sub-notebook', icon: mdiBookPlusOutline, onPress: () => { setOpen(e.id, true); setRenaming(null); setCreating(''); setCreatingIn({ parent: e.id }); } },
      { key: 'move', label: 'Move to…', icon: mdiFolderMoveOutline, onPress: () => setMover(e) },
    ] : []),
    { key: 'rename', label: 'Rename', icon: mdiPencilOutline, onPress: () => { setCreatingIn(null); setRenaming({ id: e.id, name: e.name }); } },
    { key: 'delete', label: 'Delete', icon: mdiDeleteOutline, danger: true, onPress: () => (kind === 'notebooks' ? onDelete('notebooks', e.id) : confirmTagDelete(e)) },
  ];
  // "Move to…": every notebook as a tree; the notebook itself and those inside it cannot be picked.
  const moverRows = (e: DrawerEntry): SheetRow[] => {
    const banned = subtree(e.id);
    const current = e.parent ?? null;
    const pick = (id: string | null) => () => { if (id !== current) onMove(e.id, id); };
    return [
      { key: 'top', label: 'Top level', icon: mdiArrowUp, active: current === null, onPress: pick(null) },
      ...notebooks.map((n) => ({ key: n.id, label: n.name, icon: mdiBookOutline, depth: n.depth ?? 0, active: n.id === current, disabled: banned.has(n.id), onPress: pick(n.id) })),
    ];
  };
  // A new sub-notebook's field goes after its parent's last visible descendant.
  const subAfter = creatingIn?.parent ? (() => {
    const inside = subtree(creatingIn.parent!);
    let last = creatingIn.parent!;
    for (const e of list) if (inside.has(e.id)) last = e.id;
    return last;
  })() : null;
  const createField = (depth: number) => (
    <TextInput
      key="new"
      autoFocus
      value={creating}
      onChangeText={setCreating}
      placeholder={tab === 'tags' ? 'Tag name' : creatingIn?.parent ? 'Sub-notebook name' : 'Notebook name'}
      placeholderTextColor={T.on_surface_variant}
      style={[styles.input, depth > 0 && { marginLeft: depth * 20 }]}
      onSubmitEditing={() => { if (creating.trim()) onCreate(kind, creating.trim(), creatingIn?.parent ?? undefined); setCreating(''); setCreatingIn(null); }}
      onBlur={() => setCreatingIn(null)}
    />
  );
  const dragged = drag ? notebooks.find((n) => n.id === drag.id) : undefined;

  return (
    <View style={StyleSheet.absoluteFill} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchCancel}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View ref={panelRef} collapsable={false} style={styles.panel}>
        <View style={styles.head}>
          <View style={{ flex: 1 }}>
            <Text style={styles.brand}>Noted</Text>
            {sync.localOnly ? (
              <View style={styles.sync}><Text style={styles.syncText}>This phone only</Text></View>
            ) : <TouchableOpacity style={styles.sync} onPress={sync.onSync} disabled={sync.syncing} accessibilityLabel="Sync now">
              <View style={[styles.syncDot, { backgroundColor: sync.online ? T.primary : T.error }]} />
              <Text style={styles.syncText} numberOfLines={1}>
                {sync.syncing ? 'Syncing…'
                  : sync.status && sync.status !== 'Synced ✓' && sync.status !== 'Offline' ? sync.status
                  : !sync.online ? 'Offline'
                  : `Online${sync.lastSyncAt ? ` · synced ${new Date(sync.lastSyncAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}`}
              </Text>
            </TouchableOpacity>}
          </View>
          <TouchableOpacity style={styles.iconBtn} onPress={onSettings} accessibilityLabel="Settings">
            <Icon path={mdiCogOutline} size={22} color={T.on_surface_variant} />
          </TouchableOpacity>
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12 }} keyboardShouldPersistTaps="handled" scrollEnabled={!drag}>
          {tab === 'home' && (
            <>
              {row('notes', mdiNoteTextOutline, 'Notes', counts.notes, { kind: 'notes' })}
              {row('favorites', mdiStarOutline, 'Favorites', counts.favorites, { kind: 'favorites' })}
              {counts.claude ? row('claude', mdiCreationOutline, 'From Claude', counts.claude, { kind: 'claude' }) : null}
              {row('reminders', mdiBellOutline, 'Reminders', counts.reminders, { kind: 'reminders' })}
              {row('archive', mdiArchiveOutline, 'Archive', counts.archive, { kind: 'archive' })}
              {row('trash', mdiTrashCanOutline, 'Trash', counts.trash, { kind: 'trash' })}
              {row('tree', mdiFileTreeOutline, 'Links tree', counts.tree, { kind: 'tree' })}
              {counts.published > 0 && row('published', mdiWeb, 'Published', counts.published, { kind: 'published' })}
            </>
          )}
          {tab !== 'home' && (
            <>
              <View style={styles.listHead}>
                <Text style={styles.listTitle}>{tab === 'notebooks' ? 'Notebooks' : 'Tags'}</Text>
                <TouchableOpacity style={styles.iconBtn} onPress={() => { setRenaming(null); setCreating(''); setCreatingIn({ parent: null }); }} accessibilityLabel="Create">
                  <Icon path={mdiPlus} size={22} color={T.primary} />
                </TouchableOpacity>
              </View>
              {creatingIn && creatingIn.parent === null ? createField(0) : null}
              {list.map((e) => (
                <React.Fragment key={e.id}>
                {renaming?.id === e.id ? (
                <TextInput
                  autoFocus
                  selectTextOnFocus
                  value={renaming.name}
                  onChangeText={(name) => setRenaming({ id: e.id, name })}
                  placeholder="Name"
                  placeholderTextColor={T.on_surface_variant}
                  style={styles.input}
                  onSubmitEditing={() => { if (renaming.name.trim()) onRename(kind, e.id, renaming.name.trim()); setRenaming(null); }}
                  onBlur={() => setRenaming(null)}
                />
              ) : row(e.id, tab === 'notebooks' ? mdiBookOutline : mdiPound, e.name, e.count, { kind: tab === 'notebooks' ? 'notebook' : 'tag', id: e.id },
                tab === 'notebooks' ? (ev) => beginDrag(e, ev) : () => setMenu(e), e.depth ?? 0,
                tab === 'notebooks' ? (hasChildren.has(e.id) ? { open: open.has(e.id) } : null) : undefined)}
                {tab === 'notebooks' && subAfter === e.id ? createField(((notebooks.find((n) => n.id === creatingIn?.parent)?.depth) ?? 0) + 1) : null}
                </React.Fragment>
              ))}
              {list.length === 0 && !creatingIn && (
                <Text style={styles.empty}>{tab === 'notebooks' ? 'No notebooks yet.' : 'No tags yet.'} Tap + to create one.</Text>
              )}
            </>
          )}
        </ScrollView>
        <View style={styles.tabs}>
          {([['home', mdiHomeOutline], ['notebooks', mdiBookOutline], ['tags', mdiPound]] as const).map(([t, icon]) => (
            <TouchableOpacity key={t} style={[styles.tab, tab === t && styles.tabActive]} onPress={() => setTab(t)}>
              <Icon path={icon} size={24} color={tab === t ? T.primary : T.on_surface_variant} />
            </TouchableOpacity>
          ))}
        </View>
        {drag && dragged && boxes.current ? (
          <View pointerEvents="none" style={[styles.ghost, { top: drag.y - boxes.current.panel.y - 26 }]}>
            <Icon path={mdiBookOutline} size={22} color={T.on_surface} />
            <Text style={styles.rowLabel} numberOfLines={1}>{dragged.name}</Text>
          </View>
        ) : null}
      </View>
      {menu ? <Sheet title={kind === 'notebooks' ? menu.name : `#${menu.name}`} rows={menuRows(menu)} onClose={() => setMenu(null)} /> : null}
      {mover ? <Sheet title={`Move “${mover.name}” to`} rows={moverRows(mover)} onClose={() => setMover(null)} /> : null}
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  sync: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 2 },
  syncDot: { width: 8, height: 8, borderRadius: 4 },
  syncText: { color: T.on_surface_variant, fontSize: 12 },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)' },
  panel: { position: 'absolute', left: 0, top: 0, bottom: 0, width: '82%', backgroundColor: T.surface_container_low, borderRightWidth: 1, borderRightColor: T.outline_variant },
  head: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 16, paddingTop: 52, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: T.outline_variant },
  brand: { fontSize: 26, fontWeight: 'bold', color: T.on_surface },
  iconBtn: { padding: 8, borderRadius: 20 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 14, paddingVertical: 13, borderRadius: 14 },
  rowActive: { backgroundColor: T.secondary_container },
  rowTarget: { backgroundColor: T.surface_container_high },
  targetRing: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 14, borderWidth: 2, borderColor: T.primary },
  ghost: { position: 'absolute', left: 12, right: 12, height: 52, flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 14, borderRadius: 14, backgroundColor: T.surface_container_highest, elevation: 8, opacity: 0.95 },
  fold: { width: 20, height: 22, marginRight: -10, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { flex: 1, fontSize: 17, color: T.on_surface },
  count: { fontSize: 14, color: T.on_surface_variant },
  listHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, marginBottom: 4 },
  listTitle: { flex: 1, fontSize: 13, fontWeight: 'bold', letterSpacing: 0.6, textTransform: 'uppercase', color: T.primary },
  input: { color: T.on_surface, fontSize: 16, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: T.primary, marginBottom: 8 },
  empty: { color: T.on_surface_variant, padding: 14 },
  tabs: { flexDirection: 'row', gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: T.outline_variant },
  tab: { padding: 12, borderRadius: 14 },
  tabActive: { backgroundColor: T.secondary_container },
}));
