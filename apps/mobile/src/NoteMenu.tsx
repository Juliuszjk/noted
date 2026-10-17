import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Modal, View, Text, TouchableOpacity, Pressable, ScrollView, StyleSheet, TextInput, Keyboard } from 'react-native';
import { keyboardHeight } from './keyboard-height';
import {
  mdiPin, mdiPinOff, mdiStar, mdiStarOutline, mdiArchiveArrowDownOutline, mdiArchiveArrowUpOutline, mdiPencilOffOutline,
  mdiSpellcheck, mdiBookOutline, mdiPound, mdiPlus, mdiVectorLink, mdiContentCopy, mdiShareVariantOutline,
  mdiContentDuplicate, mdiTrashCanOutline, mdiRestore, mdiDeleteForeverOutline, mdiArrowLeft, mdiFileDocumentOutline,
  mdiMagnify, mdiExportVariant, mdiHistory, mdiWeb, mdiOpenInNew, mdiLockOutline, mdiLanguageMarkdownOutline, mdiTextBoxOutline, mdiFilePdfBox,
  mdiPaperclip, mdiImageOutline, mdiDownload, mdiCrosshairsGps,
} from '@mdi/js';
import { relativeTime } from '@noted/ui/src/note-list';
import { formatDateTime } from '@noted/ui/src/format-date';
import { T, Icon, PasswordField, ThemedSwitch, Select } from './ui';
import { getNoteMenuLayout } from './note-menu-layout';

const HOUR = 60 * 60 * 1000;
const EXPIRY: [string, string, number | null][] = [
  ['never', 'Never', null], ['1h', 'In 1 hour', HOUR], ['1d', 'In 1 day', 24 * HOUR], ['7d', 'In 7 days', 7 * 24 * HOUR], ['30d', 'In 30 days', 30 * 24 * HOUR],
];

// A file or image of the note (note menu "Attached files").
export interface NoteAttachmentItem {
  kind: 'file' | 'image';
  blob: string;
  name: string;
  size: number | null;
}

const formatSize = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export interface NoteFlags {
  pinned: boolean;
  favorite: boolean;
  archived: boolean;
  readOnly: boolean;
  noSpellcheck: boolean;
}

type Entry = { id: string; name: string; place?: string };

interface Props {
  title: string;
  created: number | null;
  edited: number | null;
  notebooks: Entry[];
  tags: Entry[];
  flags: NoteFlags;
  trashed: boolean;
  // null = still being listed by the page.
  attachments: NoteAttachmentItem[] | null;
  onAttachment: (action: 'open' | 'save' | 'show', a: NoteAttachmentItem) => void;
  links: Entry[];
  backlinks: Entry[];
  onFlag: (flag: keyof NoteFlags, on: boolean) => void;
  onPick: (kind: 'notebooks' | 'tags') => void;
  onOpenNote: (id: string) => void;
  onCopy: () => void;
  onShare: () => void;
  onDuplicate: () => void;
  onTrash: () => void;
  onRestore: () => void;
  onDeleteForever: () => void;
  onFind: () => void;
  onExport: (format: 'markdown' | 'text' | 'pdf', share: boolean) => void;
  // Local versions of this note (newest first); loaded when the menu opens.
  history: { id: string; startedAt: number; endedAt: number }[] | null;
  onOpenHistory: (id: string) => void;
  // Published copy of the note (link and time) and the actions on it.
  published: { url: string; at: number; password: string | null; selfDestruct: boolean; autoUpdate: boolean; expiresAt: number | null } | null;
  onPublish: (settings: { password: string | null; selfDestruct: boolean; autoUpdate: boolean; expiresAt: number | null }) => Promise<void>;
  onUnpublish: () => Promise<void>;
  // Published already: "Update automatically" takes effect at once.
  onAutoUpdate: (on: boolean) => void;
  onOpenUrl: (url: string) => void;
  // Locked note (vault) and the switch.
  locked: boolean;
  onLock: (on: boolean) => void;
  // Page to open first ("/publish" opens the menu on its publish page).
  initialPage?: 'main' | 'publish' | 'links';
  // `back`: closed without picking anything (the cursor and keyboard go back to the note).
  onClose: (back: boolean) => void;
}

const TOGGLES_PER_PAGE = 5;

// The note's menu ("⋮" in the editor header), laid out like Notesnook's: dates, notebooks and
// tags, switches, then actions as tiles.
export function NoteMenu(p: Props) {
  const layout = getNoteMenuLayout();
  const [page, setPage] = useState<'main' | 'links' | 'export' | 'history' | 'publish' | 'files'>(p.initialPage ?? 'main');
  // The switches row is split into pages (swiped sideways, like Notesnook's).
  const [togglesWidth, setTogglesWidth] = useState(0);
  const [togglePage, setTogglePage] = useState(0);
  const [busy, setBusy] = useState<'publish' | 'unpublish' | null>(null);
  const [selfDestruct, setSelfDestruct] = useState(p.published?.selfDestruct ?? false);
  const [expiresAt, setExpiresAt] = useState<number | null>(p.published?.expiresAt ?? null);
  const [password, setPassword] = useState(p.published?.password ?? '');
  const [typing, setTyping] = useState(false);
  // Back hides the keyboard but the field keeps the focus, so a second tap brings the keyboard
  // without a new onFocus: the tap itself and the keyboard coming back lift the sheet again.
  const passwordFocused = useRef(false);
  useEffect(() => {
    const hide = Keyboard.addListener('keyboardDidHide', () => setTyping(false));
    const show = Keyboard.addListener('keyboardDidShow', () => { if (passwordFocused.current) setTyping(true); });
    return () => { hide.remove(); show.remove(); };
  }, []);
  const [autoUpdate, setAutoUpdate] = useState(p.published?.autoUpdate ?? false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const runPublish = async (kind: 'publish' | 'unpublish') => {
    setBusy(kind);
    setPublishError(null);
    try {
      await (kind === 'publish' ? p.onPublish({ password: password || null, selfDestruct, autoUpdate: autoUpdate && !selfDestruct, expiresAt }) : p.onUnpublish());
    } catch (e) {
      setPublishError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const act = (run: () => void) => () => { p.onClose(false); run(); };
  const subPage = (title: string, children: React.ReactNode) => (
    <>
      <View style={styles.headRow}>
        <TouchableOpacity onPress={() => setPage('main')} style={{ padding: 6 }} accessibilityLabel="Back">
          <Icon path={mdiArrowLeft} />
        </TouchableOpacity>
        <Text style={styles.title}>{title}</Text>
      </View>
      <ScrollView style={{ maxHeight: 460 }}>{children}</ScrollView>
    </>
  );
  const listRow = (key: string, icon: string, label: string, onPress: () => void, detail?: string) => (
    <TouchableOpacity key={key} style={styles.linkRow} onPress={onPress}>
      <Icon path={icon} size={22} color={T.on_surface_variant} />
      <Text style={styles.linkText} numberOfLines={1}>{label}</Text>
      {detail ? <Text style={styles.detail}>{detail}</Text> : null}
    </TouchableOpacity>
  );
  const exportRow = (key: string, icon: string, label: string, format: 'markdown' | 'text' | 'pdf') => (
    <View key={key} style={styles.linkRow}>
      <TouchableOpacity style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 16 }} onPress={act(() => p.onExport(format, false))}>
        <Icon path={icon} size={22} color={T.on_surface_variant} />
        <Text style={styles.linkText} numberOfLines={1}>{label}</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={act(() => p.onExport(format, true))} style={{ padding: 8 }} accessibilityLabel={`Share ${label}`}>
        <Icon path={mdiShareVariantOutline} size={20} color={T.on_surface_variant} />
      </TouchableOpacity>
    </View>
  );
  const now = Date.now();

  const toggle = (flag: keyof NoteFlags, label: string, icon: string, iconOn: string, invert = false) => {
    const on = invert ? !p.flags[flag] : p.flags[flag];
    return (
      <TouchableOpacity key={flag} style={styles.toggle} onPress={() => p.onFlag(flag, !p.flags[flag])} accessibilityLabel={label}>
        <View style={[styles.toggleBox, on && styles.toggleOn]}>
          <Icon path={on ? iconOn : icon} size={24} color={on ? T.primary : T.on_surface} />
        </View>
        <Text style={styles.toggleLabel} numberOfLines={1}>{label}</Text>
      </TouchableOpacity>
    );
  };
  const tile = (key: string, label: string, icon: string, onPress: () => void, danger = false) => (
    <TouchableOpacity key={key} style={styles.tile} onPress={onPress} accessibilityLabel={label}>
      <View style={styles.tileBox}><Icon path={icon} size={24} color={danger ? T.error : T.on_surface} /></View>
      <Text style={styles.tileLabel} numberOfLines={2}>{label}</Text>
    </TouchableOpacity>
  );
  const chip = (entry: Entry, icon: string, kind: 'notebooks' | 'tags') => (
    <TouchableOpacity key={entry.id} style={styles.chip} onPress={act(() => p.onPick(kind))}>
      <Icon path={icon} size={16} color={T.primary} />
      <Text style={styles.chipText} numberOfLines={1}>{entry.name}</Text>
    </TouchableOpacity>
  );

  return (
    <Modal transparent animationType="slide" onRequestClose={() => p.onClose(true)}>
      <Pressable style={styles.backdrop} onPress={() => p.onClose(true)} />
      {/* A field being typed in: the sheet goes up above the keyboard (no keyboard events reach
          a modal, so its last known height is used). */}
      <View style={[styles.sheet, typing && { paddingBottom: 24 + keyboardHeight() }]}>
        <View style={styles.handle} />
        {page === 'publish' ? subPage('Publish to the web', (
          <View style={{ paddingHorizontal: 20, paddingBottom: 8 }}>
            <Text style={styles.detail}>{p.published ? (p.published.autoUpdate ? 'This note is published and follows your edits.' : 'This note is published. Edits appear after Update.') : 'This note will be published to a public URL.'}</Text>
            {p.published ? (
              <View style={[styles.pubBox, styles.pubLinkRow]}>
                <Text style={styles.linkUrl} numberOfLines={1}>{p.published.url}</Text>
                <TouchableOpacity onPress={() => Clipboard.setStringAsync(p.published!.url)} style={styles.pubIcon} accessibilityLabel="Copy link">
                  <Icon path={mdiContentCopy} size={20} color={T.on_surface} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => { Share.share({ message: p.published!.url }).catch(() => {}); }} style={styles.pubIcon} accessibilityLabel="Share link">
                  <Icon path={mdiShareVariantOutline} size={20} color={T.on_surface} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => p.onOpenUrl(p.published!.url)} style={styles.pubIcon} accessibilityLabel="Open">
                  <Icon path={mdiOpenInNew} size={20} color={T.on_surface} />
                </TouchableOpacity>
              </View>
            ) : null}
            <View style={styles.pubBox}>
              <View style={styles.pubRow}>
                <Text style={styles.pubLabel}>Title</Text>
                <Text style={styles.pubValue} numberOfLines={1}>{p.title || 'Untitled'}</Text>
              </View>
              <View style={styles.pubRow}>
                <Text style={styles.pubLabel}>Self destruct</Text>
                <View style={{ flex: 1 }} />
                <ThemedSwitch value={selfDestruct} onValueChange={(on) => { setSelfDestruct(on); if (on) setAutoUpdate(false); }} />
              </View>
              <View style={[styles.pubRow, selfDestruct && { opacity: 0.5 }]}>
                <Text style={styles.pubLabel}>Update automatically</Text>
                <View style={{ flex: 1 }} />
                <ThemedSwitch disabled={selfDestruct} value={autoUpdate} onValueChange={(on) => { setAutoUpdate(on); if (p.published) p.onAutoUpdate(on); }} />
              </View>
              <View style={[styles.pubRow, { alignItems: 'flex-start', paddingVertical: 8 }]}>
                <Text style={[styles.pubLabel, { marginTop: 10 }]}>Link expires</Text>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Select
                    value={expiresAt ? 'keep' : 'never'}
                    options={[...(expiresAt ? [['keep', formatDateTime(expiresAt)] as ['keep', string]] : []), ...EXPIRY.map(([id, label]) => [id, label] as [string, string])]}
                    onChange={(id) => { const choice = EXPIRY.find(([key]) => key === id); if (choice) setExpiresAt(choice[2] === null ? null : Date.now() + choice[2]); }}
                  />
                </View>
              </View>
              <View style={styles.pubRow}>
                <Text style={styles.pubLabel}>Password protection</Text>
                <View style={{ flex: 1 }}>
                  <PasswordField value={password} onChangeText={setPassword} placeholder="No password" style={styles.pubInput} onFocus={() => { passwordFocused.current = true; setTyping(true); }}
                    onBlur={() => { passwordFocused.current = false; setTyping(false); }}
                    onPressIn={() => setTyping(true)}
                  />
                </View>
              </View>
            </View>
            {publishError ? <Text style={[styles.detail, { color: T.error }]}>{publishError}</Text> : null}
            {p.published ? <Text style={styles.detail}>Last published {formatDateTime(p.published.at)}</Text> : null}
            <View style={styles.publishRow}>
              {p.published ? (
                <TouchableOpacity disabled={!!busy} onPress={() => runPublish('unpublish')} style={[styles.pubButton, { borderColor: T.error }]}>
                  {busy === 'unpublish' ? <ActivityIndicator color={T.error} /> : <Text style={[styles.pubButtonText, { color: T.error }]}>Unpublish</Text>}
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity disabled={!!busy} onPress={() => runPublish('publish')} style={[styles.pubButton, { backgroundColor: T.surface_container_highest }]}>
                {busy === 'publish' ? <ActivityIndicator color={T.primary} /> : <Text style={styles.pubButtonText}>{p.published ? 'Update' : 'Publish'}</Text>}
              </TouchableOpacity>
            </View>
          </View>
        )) : page === 'export' ? subPage('Export', (
          <>
            <Text style={styles.empty}>Saves the note into your download folder (Settings › Editor › Files). The share icon sends it somewhere instead.</Text>
            {exportRow('md', mdiLanguageMarkdownOutline, 'Markdown (.md)', 'markdown')}
            {exportRow('txt', mdiTextBoxOutline, 'Plain text (.txt)', 'text')}
            {exportRow('pdf', mdiFilePdfBox, 'PDF', 'pdf')}
          </>
        )) : page === 'files' ? subPage('Attached files', (
          <>
            {p.attachments === null ? <Text style={styles.empty}>Loading…</Text> : null}
            {p.attachments?.length === 0 ? <Text style={styles.empty}>No files or images in this note.</Text> : null}
            {(p.attachments ?? []).map((a, i) => (
              <View key={`${a.blob}-${i}`} style={styles.linkRow}>
                <Icon path={a.kind === 'image' ? mdiImageOutline : mdiPaperclip} size={22} color={T.on_surface_variant} />
                <Text style={styles.linkText} numberOfLines={1}>{a.name}</Text>
                {a.size !== null ? <Text style={styles.detail}>{formatSize(a.size)}</Text> : null}
                <TouchableOpacity onPress={act(() => p.onAttachment('show', a))} style={{ padding: 8 }} accessibilityLabel="Show in the note">
                  <Icon path={mdiCrosshairsGps} size={20} color={T.on_surface_variant} />
                </TouchableOpacity>
                {a.kind === 'file' ? (
                  <TouchableOpacity onPress={() => p.onAttachment('open', a)} style={{ padding: 8 }} accessibilityLabel="Open">
                    <Icon path={mdiOpenInNew} size={20} color={T.on_surface_variant} />
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity onPress={() => p.onAttachment('save', a)} style={{ padding: 8 }} accessibilityLabel="Save">
                  <Icon path={mdiDownload} size={20} color={T.on_surface_variant} />
                </TouchableOpacity>
              </View>
            ))}
          </>
        )) : page === 'history' ? subPage('Note history', (
          <>
            <Text style={styles.empty}>The note at the end of earlier editing sessions on this phone (a session starts when the note is opened).</Text>
            {p.history === null ? <Text style={styles.empty}>Loading…</Text> : null}
            {p.history?.length === 0 ? <Text style={styles.empty}>No versions yet.</Text> : null}
            {(p.history ?? []).map((h) => {
              const age = relativeTime(h.endedAt, now);
              return listRow(h.id, mdiHistory, `${formatDateTime(h.startedAt)} — ${formatDateTime(h.endedAt).slice(11)}`, act(() => p.onOpenHistory(h.id)), age === 'now' ? 'just now' : `${age} ago`);
            })}
          </>
        )) : page === 'links' ? (
          <>
            <View style={styles.headRow}>
              <TouchableOpacity onPress={() => setPage('main')} style={{ padding: 6 }} accessibilityLabel="Back">
                <Icon path={mdiArrowLeft} />
              </TouchableOpacity>
              <Text style={styles.title}>Links</Text>
            </View>
            <ScrollView style={{ maxHeight: 460 }}>
              <Text style={styles.section}>Linked from</Text>
              {p.backlinks.length === 0 ? <Text style={styles.empty}>No note links here.</Text> : null}
              {p.backlinks.map((n) => (
                <TouchableOpacity key={`b-${n.id}`} style={styles.linkRow} onPress={act(() => p.onOpenNote(n.id))}>
                  <Icon path={mdiFileDocumentOutline} size={20} color={T.on_surface_variant} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.linkText} numberOfLines={1}>{n.name}</Text>
                    {n.place ? <Text style={styles.linkPlace} numberOfLines={1}>{n.place}</Text> : null}
                  </View>
                </TouchableOpacity>
              ))}
              <Text style={styles.section}>Links to</Text>
              {p.links.length === 0 ? <Text style={styles.empty}>This note links to no other note.</Text> : null}
              {p.links.map((n) => (
                <TouchableOpacity key={`l-${n.id}`} style={styles.linkRow} onPress={act(() => p.onOpenNote(n.id))}>
                  <Icon path={mdiFileDocumentOutline} size={20} color={T.on_surface_variant} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.linkText} numberOfLines={1}>{n.name}</Text>
                    {n.place ? <Text style={styles.linkPlace} numberOfLines={1}>{n.place}</Text> : null}
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </>
        ) : (
          <ScrollView style={{ maxHeight: 640 }}>
            <Text style={[styles.title, { paddingHorizontal: 20 }]} numberOfLines={2}>{p.title}</Text>
            <View style={styles.block}>
              <View style={styles.dateRow}><Text style={styles.dateLabel}>Created at</Text><Text style={styles.dateValue}>{p.created ? formatDateTime(p.created) : '—'}</Text></View>
              <View style={styles.dateRow}><Text style={styles.dateLabel}>Last edited at</Text><Text style={styles.dateValue}>{p.edited ? formatDateTime(p.edited) : '—'}</Text></View>
            </View>
            <View style={[styles.block, styles.chips]}>
              {p.notebooks.map((n) => chip(n, mdiBookOutline, 'notebooks'))}
              {p.tags.map((t) => chip(t, mdiPound, 'tags'))}
              <TouchableOpacity style={styles.addChip} onPress={act(() => p.onPick('notebooks'))}>
                <Text style={styles.addText}>Add to notebook</Text><Icon path={mdiPlus} size={18} color={T.primary} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.addChip} onPress={act(() => p.onPick('tags'))}>
                <Text style={styles.addText}>Add tag</Text><Icon path={mdiPlus} size={18} color={T.primary} />
              </TouchableOpacity>
            </View>
            {p.trashed ? null : (() => {
              const toggleById: Record<string, React.ReactNode> = {
                pinned: toggle('pinned', p.flags.pinned ? 'Unpin' : 'Pin', mdiPin, mdiPinOff),
                favorite: toggle('favorite', 'Favorite', mdiStarOutline, mdiStar),
                archived: toggle('archived', p.flags.archived ? 'Unarchive' : 'Archive', mdiArchiveArrowDownOutline, mdiArchiveArrowUpOutline),
                readOnly: toggle('readOnly', 'Read only', mdiPencilOffOutline, mdiPencilOffOutline),
                lock: (
                  <TouchableOpacity key="lock" style={styles.toggle} onPress={act(() => p.onLock(!p.locked))} accessibilityLabel="Lock">
                    <View style={[styles.toggleBox, p.locked && styles.toggleOn]}>
                      <Icon path={mdiLockOutline} size={24} color={p.locked ? T.primary : T.on_surface} />
                    </View>
                    <Text style={styles.toggleLabel} numberOfLines={1}>{p.locked ? 'Unlock' : 'Lock'}</Text>
                  </TouchableOpacity>
                ),
                spellcheck: toggle('noSpellcheck', 'Spell check', mdiSpellcheck, mdiSpellcheck, true),
              };
              // Settings > Note menu decides which show and in what order.
              const items = layout.toggles.map((id) => toggleById[id]).filter(Boolean);
              if (items.length === 0) return null;
              const pages: React.ReactNode[][] = [];
              for (let i = 0; i < items.length; i += TOGGLES_PER_PAGE) pages.push(items.slice(i, i + TOGGLES_PER_PAGE));
              return (
                <View style={styles.togglesBlock} onLayout={(e) => setTogglesWidth(e.nativeEvent.layout.width)}>
                  {togglesWidth > 0 ? (
                    <ScrollView
                      horizontal
                      pagingEnabled
                      showsHorizontalScrollIndicator={false}
                      onMomentumScrollEnd={(e) => setTogglePage(Math.round(e.nativeEvent.contentOffset.x / togglesWidth))}
                    >
                      {pages.map((row, i) => (
                        <View key={i} style={[styles.toggles, { width: togglesWidth }]}>
                          {row}
                          {/* Placeholders keep a short last page aligned with the first. */}
                          {Array.from({ length: TOGGLES_PER_PAGE - row.length }, (_, k) => <View key={`pad-${k}`} style={styles.toggle} />)}
                        </View>
                      ))}
                    </ScrollView>
                  ) : null}
                  {pages.length > 1 ? (
                    <View style={styles.dots}>
                      {pages.map((_, i) => <View key={i} style={[styles.dot, i === togglePage && styles.dotOn]} />)}
                    </View>
                  ) : null}
                </View>
              );
            })()}
            <View style={styles.grid}>
              {layout.actions.map((id) => {
                switch (id) {
                  case 'notebook': return tile('nb', 'Add to notebook', mdiBookOutline, act(() => p.onPick('notebooks')));
                  case 'tag': return tile('tag', 'Add tag', mdiPound, act(() => p.onPick('tags')));
                  case 'links': return tile('links', `Links (${p.links.length + p.backlinks.length})`, mdiVectorLink, () => setPage('links'));
                  case 'copy': return tile('copy', 'Copy', mdiContentCopy, act(p.onCopy));
                  case 'share': return tile('share', 'Share', mdiShareVariantOutline, act(p.onShare));
                  case 'duplicate': return tile('dup', 'Duplicate', mdiContentDuplicate, act(p.onDuplicate));
                  case 'find': return tile('find', 'Find in note', mdiMagnify, act(p.onFind));
                  case 'export': return tile('export', 'Export', mdiExportVariant, () => setPage('export'));
                  case 'files': return tile('files', p.attachments ? `Attached files (${p.attachments.length})` : 'Attached files', mdiPaperclip, () => setPage('files'));
                  case 'history': return tile('history', 'History', mdiHistory, () => setPage('history'));
                  case 'publish': return p.locked ? null : tile('publish', p.published ? 'Published' : 'Publish', mdiWeb, () => setPage('publish'));
                  default: return null;
                }
              })}
              {p.trashed ? (
                <>
                  {tile('restore', 'Restore', mdiRestore, act(p.onRestore))}
                  {tile('delete', 'Delete forever', mdiDeleteForeverOutline, act(p.onDeleteForever), true)}
                </>
              ) : tile('trash', 'Move to trash', mdiTrashCanOutline, act(p.onTrash), true)}
            </View>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { backgroundColor: T.surface_container_high, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 24 },
  handle: { width: 48, height: 5, borderRadius: 3, backgroundColor: T.outline, opacity: 0.6, alignSelf: 'center', marginTop: 10, marginBottom: 8 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12 },
  title: { fontSize: 22, fontWeight: 'bold', color: T.on_surface, paddingVertical: 8 },
  block: { borderTopWidth: 1, borderTopColor: T.outline_variant, paddingHorizontal: 20, paddingVertical: 12 },
  dateRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  dateLabel: { color: T.on_surface, fontSize: 15 },
  dateValue: { color: T.on_surface, fontSize: 15 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: T.surface_container },
  chipText: { color: T.on_surface, fontSize: 15, fontWeight: '600', maxWidth: 200 },
  addChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: T.surface_container },
  addText: { color: T.primary, fontSize: 15 },
  togglesBlock: { borderTopWidth: 1, borderTopColor: T.outline_variant, paddingVertical: 12 },
  toggles: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 12 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 10 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: T.outline_variant },
  dotOn: { backgroundColor: T.primary },
  toggle: { alignItems: 'center', width: '19%' },
  toggleBox: { width: '100%', height: 52, borderRadius: 10, borderWidth: 1, borderColor: T.outline_variant, alignItems: 'center', justifyContent: 'center' },
  toggleOn: { borderColor: T.primary, backgroundColor: T.primary_container },
  toggleLabel: { color: T.on_surface, fontSize: 12, marginTop: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12, paddingTop: 4 },
  tile: { width: '20%', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 3 },
  tileBox: { width: '100%', height: 56, borderRadius: 12, backgroundColor: T.surface_container, alignItems: 'center', justifyContent: 'center' },
  tileLabel: { color: T.on_surface, fontSize: 12, marginTop: 6, textAlign: 'center' },
  section: { color: T.primary, fontSize: 12, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 0.6, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 6 },
  empty: { color: T.on_surface_variant, paddingHorizontal: 20, paddingVertical: 6 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, minHeight: 48 },
  linkText: { color: T.on_surface, fontSize: 16 },
  linkPlace: { color: T.on_surface_variant, fontSize: 12 },
  detail: { color: T.on_surface_variant, fontSize: 13 },
  linkUrl: { flex: 1, color: T.primary, fontFamily: 'monospace', fontSize: 13 },
  publishRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  pubBox: { borderWidth: 1, borderColor: T.outline_variant, borderRadius: 12, paddingHorizontal: 14, marginTop: 12 },
  pubLinkRow: { flexDirection: 'row', alignItems: 'center', paddingRight: 4 },
  pubIcon: { padding: 8 },
  pubRow: { flexDirection: 'row', alignItems: 'center', minHeight: 50, gap: 12 },
  pubLabel: { color: T.on_surface, fontSize: 16 },
  pubValue: { flex: 1, textAlign: 'right', color: T.on_surface_variant, fontSize: 15 },
  pubInput: { flex: 1, textAlign: 'right', color: T.on_surface, fontSize: 15, paddingVertical: 6 },
  pubButton: { flex: 1, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: T.outline_variant },
  pubButtonText: { color: T.primary, fontSize: 16 },
});
