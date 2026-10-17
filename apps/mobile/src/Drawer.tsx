import React, { useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, ScrollView, StyleSheet, Pressable } from 'react-native';
import {
  mdiNoteTextOutline, mdiStarOutline, mdiArchiveOutline, mdiTrashCanOutline, mdiHomeOutline, mdiBookOutline, mdiWeb,
  mdiPound, mdiPlus, mdiCogOutline, mdiFileTreeOutline, mdiBellOutline,
} from '@mdi/js';
import type { NoteView } from '@noted/ui/src/note-list';
import { T, Icon, themed } from './ui';
import { appAlert } from './Dialog';

export interface DrawerEntry {
  id: string;
  name: string;
  count: number;
}

interface Props {
  view: NoteView;
  // reminders: due now or today.
  counts: { notes: number; favorites: number; archive: number; trash: number; tree: number; published: number; reminders: number };
  notebooks: DrawerEntry[];
  tags: DrawerEntry[];
  onView: (view: NoteView) => void;
  onCreate: (kind: 'notebooks' | 'tags', name: string) => void;
  onRename: (kind: 'notebooks' | 'tags', id: string, name: string) => void;
  // The notes stay; only the notebook / tag goes (and leaves them).
  onDelete: (kind: 'notebooks' | 'tags', id: string) => void;
  onSettings: () => void;
  // Connection state under the app name (sync runs on its own; a tap syncs now).
  sync: { online: boolean; syncing: boolean; status: string; lastSyncAt: number | null; onSync: () => void };
  onClose: () => void;
}

type Tab = 'home' | 'notebooks' | 'tags';

// Side panel like Notesnook's: Notes / Favorites / Archive / Trash, notebooks and tags.
export function Drawer({ view, counts, notebooks, tags, onView, onCreate, onRename, onDelete, onSettings, sync, onClose }: Props) {
  const [tab, setTab] = useState<Tab>(view.kind === 'notebook' ? 'notebooks' : view.kind === 'tag' ? 'tags' : 'home');
  const [creating, setCreating] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  // Hold a notebook / tag: rename or delete it.
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

  const same = (v: NoteView) => v.kind === view.kind && (!('id' in v) || ('id' in view && view.id === v.id));
  const row = (key: string, icon: string, label: string, count: number, target: NoteView, onLongPress?: () => void) => {
    const active = same(target);
    return (
      <TouchableOpacity key={key} style={[styles.row, active && styles.rowActive]} onPress={() => { onView(target); onClose(); }} onLongPress={onLongPress} delayLongPress={350}>
        <Icon path={icon} size={22} color={active ? T.primary : T.on_surface} />
        <Text style={[styles.rowLabel, active && { color: T.on_secondary_container }]} numberOfLines={1}>{label}</Text>
        <Text style={styles.count}>{count}</Text>
      </TouchableOpacity>
    );
  };

  const kind = tab === 'notebooks' ? 'notebooks' : 'tags';
  const list = tab === 'notebooks' ? notebooks : tags;
  const what = kind === 'notebooks' ? 'notebook' : 'tag';
  const entryActions = (e: DrawerEntry) => appAlert(kind === 'notebooks' ? e.name : `#${e.name}`, undefined, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: () => appAlert(`Delete the ${what} "${e.name}"?`, `Its notes are not deleted; they only leave this ${what}. On every device.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => onDelete(kind, e.id) },
    ]) },
    { text: 'Rename', onPress: () => setRenaming({ id: e.id, name: e.name }) },
  ]);

  return (
    <View style={StyleSheet.absoluteFill}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.panel}>
        <View style={styles.head}>
          <View style={{ flex: 1 }}>
            <Text style={styles.brand}>Noted</Text>
            <TouchableOpacity style={styles.sync} onPress={sync.onSync} disabled={sync.syncing} accessibilityLabel="Sync now">
              <View style={[styles.syncDot, { backgroundColor: sync.online ? T.primary : T.error }]} />
              <Text style={styles.syncText} numberOfLines={1}>
                {sync.syncing ? 'Syncing…'
                  : sync.status && sync.status !== 'Synced ✓' && sync.status !== 'Offline' ? sync.status
                  : !sync.online ? 'Offline'
                  : `Online${sync.lastSyncAt ? ` · synced ${new Date(sync.lastSyncAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}`}
              </Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={styles.iconBtn} onPress={onSettings} accessibilityLabel="Settings">
            <Icon path={mdiCogOutline} size={22} color={T.on_surface_variant} />
          </TouchableOpacity>
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12 }} keyboardShouldPersistTaps="handled">
          {tab === 'home' && (
            <>
              {row('notes', mdiNoteTextOutline, 'Notes', counts.notes, { kind: 'notes' })}
              {row('favorites', mdiStarOutline, 'Favorites', counts.favorites, { kind: 'favorites' })}
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
                <TouchableOpacity style={styles.iconBtn} onPress={() => setIsCreating(true)} accessibilityLabel="Create">
                  <Icon path={mdiPlus} size={22} color={T.primary} />
                </TouchableOpacity>
              </View>
              {isCreating && (
                <TextInput
                  autoFocus
                  value={creating}
                  onChangeText={setCreating}
                  placeholder={tab === 'notebooks' ? 'Notebook name' : 'Tag name'}
                  placeholderTextColor={T.on_surface_variant}
                  style={styles.input}
                  onSubmitEditing={() => { if (creating.trim()) onCreate(kind, creating.trim()); setCreating(''); setIsCreating(false); }}
                  onBlur={() => setIsCreating(false)}
                />
              )}
              {list.map((e) => (renaming?.id === e.id ? (
                <TextInput
                  key={e.id}
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
              ) : row(e.id, tab === 'notebooks' ? mdiBookOutline : mdiPound, e.name, e.count, { kind: tab === 'notebooks' ? 'notebook' : 'tag', id: e.id }, () => entryActions(e))))}
              {list.length === 0 && !isCreating && (
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
      </View>
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
