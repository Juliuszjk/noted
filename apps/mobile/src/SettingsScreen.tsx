import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, ScrollView, StyleSheet, TextInput, ActivityIndicator, BackHandler, Appearance, AppState } from 'react-native';
import { appAlert } from './Dialog';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import {
  mdiArrowLeft, mdiAccountOutline, mdiSync, mdiPaletteOutline, mdiBackupRestore, mdiChevronRight, mdiShieldKeyOutline,
  mdiFormatText, mdiDockBottom, mdiDotsVertical, mdiLockOutline, mdiShieldLockOutline, mdiCheck, mdiCallMerge, mdiHistory,
} from '@mdi/js';
import { ToolbarEditor } from './ToolbarEditor';
import { CODE_THEMES, CODE_LANGUAGES, codeLanguageLabel } from '@noted/editor/code-themes';
import { parseClock } from '@noted/editor/reminder-time';
import { NoteMenuEditor } from './NoteMenuEditor';
import { readDownloadFolder, writeDownloadFolder, chooseDownloadFolder, saveFileBytes } from './files';
import { readBackupSettings, writeBackupSettings, chooseBackupFolder, writeBackup, listBackupFiles } from './backups';
import type { MobileBackupSettings } from './backups';
import type { EditorPrefs } from '@noted/editor/editor-prefs-lite';
import { getEditorPrefs, setEditorPrefs, getToolbarConfig, setToolbarConfig, getTableToolbarConfig, setTableToolbarConfig, getDrawingToolbarConfig, setDrawingToolbarConfig } from './prefs';
import { MIN_PASSPHRASE_LENGTH, apiUrl, hasServer, normalizeServerUrl } from '@noted/config';
import { bytesToBase64, formatRecoveryKey, generateSalt } from '@noted/crypto';
import {
  fetchVault, openWithPassphraseKey, changePassphrase, getRecoveryKey, logoutOtherDevices, fetchAccountStats,
  createBackup, restoreBackup, backupFileName, exportAllNotes, openBackup, compareBackup, restoreBackupNote,
} from '@noted/sync';
import type { AccountStats, LocalNoteStore, LocalBlobStore, VaultInfo, BackupDiff, BackupDiffStatus, RestoreMode, SharedEditorPrefs } from '@noted/sync';
import { THEME_PRESETS } from '@noted/theme';
import { formatDateTime } from '@noted/ui/src/format-date';
import { T, Icon, PasswordField, ThemedSwitch, Segmented, Select, materialYouAvailable, readPalette, readBrightness, paletteSchemes, setThemeChoice, themed } from './ui';
import { deriveKeyInWebView } from './kdf';
import { saveAuthEpoch } from './storage';
import { readAppLock, writeAppLock } from './LockScreen';
import { VaultPrompt } from './VaultPrompt';
import type { AppLock } from './LockScreen';
import { goingAway } from './away';
import { backgroundRestricted, askUnrestricted } from './battery';

// Settings (the phone's version of the desktop's): Account, Sync, Appearance, Backup & export.

type Page = 'list' | 'compare' | 'account' | 'sync' | 'connect' | 'appearance' | 'editor' | 'toolbar' | 'noteMenu' | 'backup' | 'lock' | 'vault' | 'recovery' | 'passphrase';

interface Props {
  masterKey: Uint8Array;
  store: LocalNoteStore;
  blobs: LocalBlobStore;
  online: boolean;
  syncing: boolean;
  lastSyncAt: number | null;
  notebookNames: Map<string, string>;
  onSyncNow: () => void;
  // Only on a phone without a server: moves its vault to a server (or joins the same vault there).
  onConnectServer?: (base: string, setupCode: string) => Promise<void>;
  // "Clean up storage" (like the desktop's): find, then remove.
  cleanup: { find: (includeRecent: boolean) => Promise<CleanupPlan>; run: (plan: CleanupPlan) => Promise<string> };
  // The default title is shared by all devices (written into the synced catalog).
  // Saves editor settings shared by all devices (catalog).
  onSharedPrefs: (patch: SharedEditorPrefs) => void;
  // Opens a note with its version from a backup shown next to it.
  onCompareNote: (id: string, backupState: Uint8Array, createdAt: number) => void;
  onRestored: () => void;
  onLogout: () => void;
  onLockNow: () => void;
  vault: { exists: boolean; onCreate: (password: string) => Promise<string | null>; onChangePassword: (current: string, next: string) => Promise<string | null>; onLock: () => void };
  onClose: () => void;
}

const size = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

// Writes a file to the cache folder and opens Android's share menu (save to Files, send…).
const shareFile = async (name: string, data: string | Uint8Array, mimeType: string) => {
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  file.write(data);
  goingAway();
  await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: name });
};

function Row({ title, description, onPress, right, danger }: { title: string; description?: string; onPress?: () => void; right?: React.ReactNode; danger?: boolean }) {
  const body = (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowTitle, danger && { color: T.error }]}>{title}</Text>
        {description ? <Text style={styles.rowText}>{description}</Text> : null}
      </View>
      {right}
    </View>
  );
  return onPress ? <TouchableOpacity onPress={onPress}>{body}</TouchableOpacity> : body;
}

const Heading = ({ children }: { children: string }) => <Text style={styles.heading}>{children}</Text>;

// An action in a list (icon, title, explanation), like the settings list itself.
export interface CleanupPlan { deletedNotes: string[]; fileIds: string[]; fileBytes: number }

const sizeText = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

// Settings > Sync: notes deleted for good and files nothing uses, on the server and here.
// Background sync (battery.ts): blocked while Android optimizes the app's battery use.
function BackgroundSyncRow() {
  const [restricted, setRestricted] = useState<boolean | null>(null);
  useEffect(() => {
    const check = () => { void backgroundRestricted().then(setRestricted); };
    check();
    // Back from Android's dialog: show the new state.
    const sub = AppState.addEventListener('change', (state) => { if (state === 'active') check(); });
    return () => sub.remove();
  }, []);
  if (restricted === null) return null;
  return (
    <Row title="Background sync" onPress={restricted ? () => { void askUnrestricted(); } : undefined}
      description={restricted
        ? 'Blocked by battery saving: reminders set on other devices arrive only when you open Noted. Tap to allow.'
        : 'On: about every 15 minutes with the app closed, so reminders set on other devices still notify.'}
      right={<View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: restricted ? T.error : '#3fb950' }} />} />
  );
}

function CleanupRows({ find, run }: { find: (includeRecent: boolean) => Promise<CleanupPlan>; run: (plan: CleanupPlan) => Promise<string> }) {
  const [plan, setPlan] = useState<CleanupPlan | null>(null);
  const [recent, setRecent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const work = async (job: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try { await job(); } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const nothing = plan && !plan.deletedNotes.length && !plan.fileIds.length;
  const summary = plan ? (nothing ? ' Nothing to clean up.' : ` ${plan.deletedNotes.length} deleted notes, ${plan.fileIds.length} files (${sizeText(plan.fileBytes)}).`) : '';
  return (
    <>
      <Row title="Clean up storage"
        description={`Removes notes deleted for good (kept so far so no device brings them back) and images and files that no note, and no version in this phone's note history, uses. This phone's copy is cleaned too.${summary}${message ? ` ${message}` : ''}`}
        right={plan && !nothing ? (
          <TouchableOpacity disabled={busy} style={[styles.button, { marginTop: 0, borderColor: T.error }]} onPress={() => work(async () => { setMessage(await run(plan)); setPlan(null); })}>
            <Text style={[styles.buttonText, { color: T.error }]}>{busy ? 'Cleaning…' : 'Clean up'}</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity disabled={busy} style={[styles.button, { marginTop: 0 }]} onPress={() => work(async () => setPlan(await find(recent)))}>
            <Text style={styles.buttonText}>{busy ? 'Checking…' : 'Check'}</Text>
          </TouchableOpacity>
        )} />
      <Row title="Also files added in the last 30 days" description="Normally they wait 30 days: another device may still be uploading a note that uses them. Switch on when every device has synced."
        right={<ThemedSwitch value={recent} onValueChange={(on) => { setRecent(on); setPlan(null); }} />} />
    </>
  );
}

function ActionRow({ icon, title, text, onPress, danger, disabled }: { icon: string; title: string; text?: string; onPress: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <TouchableOpacity disabled={disabled} onPress={onPress} style={[styles.listItem, { paddingHorizontal: 4, opacity: disabled ? 0.5 : 1 }]}>
      <Icon path={icon} size={24} color={danger ? T.error : T.primary} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowTitle, danger && { color: T.error }]}>{title}</Text>
        {text ? <Text style={styles.rowText}>{text}</Text> : null}
      </View>
    </TouchableOpacity>
  );
}

// "Sync now" like the desktop's: a button that spins for a moment, then says "Synced".
function SyncButton({ syncing, onPress }: { syncing: boolean; onPress: () => void }) {
  const [phase, setPhase] = useState<'idle' | 'syncing' | 'done'>('idle');
  const [startedAt, setStartedAt] = useState(0);
  useEffect(() => {
    if (phase !== 'syncing' || syncing) return;
    const wait = setTimeout(() => setPhase('done'), Math.max(0, 700 - (Date.now() - startedAt)));
    return () => clearTimeout(wait);
  }, [phase, syncing]);
  useEffect(() => {
    if (phase !== 'done') return;
    const wait = setTimeout(() => setPhase('idle'), 2500);
    return () => clearTimeout(wait);
  }, [phase]);
  const busy = phase === 'syncing' || syncing;
  return (
    <TouchableOpacity disabled={busy} onPress={() => { setStartedAt(Date.now()); setPhase('syncing'); onPress(); }}
      style={[styles.button, { flexDirection: 'row', gap: 6, paddingVertical: 8, minWidth: 116, justifyContent: 'center' }, phase === 'done' && styles.primary, phase === 'done' && { marginTop: 0 }]}>
      {busy ? <ActivityIndicator size="small" color={T.primary} /> : <Icon path={phase === 'done' ? mdiCheck : mdiSync} size={18} color={phase === 'done' ? T.on_primary : T.on_surface} />}
      <Text style={[styles.buttonText, phase === 'done' && { color: T.on_primary }]}>{busy ? 'Syncing…' : phase === 'done' ? 'Synced' : 'Sync now'}</Text>
    </TouchableOpacity>
  );
}

function VaultPage({ vault }: { vault: Props['vault'] }) {
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ current: '', next: '', repeat: '' });
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const change = async () => {
    if (form.next.length < 6) return setMessage('Use at least 6 characters.');
    if (form.next !== form.repeat) return setMessage('The new passwords do not match.');
    setBusy(true);
    const error = await vault.onChangePassword(form.current, form.next).catch((e) => String(e));
    setBusy(false);
    setMessage(error ?? 'The vault password is changed.');
    if (!error) setForm({ current: '', next: '', repeat: '' });
  };
  return (
    <>
      <Text style={styles.note}>The vault is a second lock for chosen notes (diaries, passwords…). A locked note keeps its title in the list, but its text is encrypted once more with the vault password and opens only after you enter it.</Text>
      <Text style={styles.note}>How to use it: open a note, tap ⋮ and switch on Lock (on the computer: right-click a note, Lock). The first time you choose the vault password. It cannot be recovered: the recovery key does not open the vault.</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {!vault.exists ? (
        <TouchableOpacity style={[styles.button, styles.primary, { alignSelf: 'flex-start' }]} onPress={() => setCreating(true)}>
          <Text style={[styles.buttonText, { color: T.on_primary }]}>Create the vault</Text>
        </TouchableOpacity>
      ) : (
        <>
          <Row title="Lock the vault" description="Closes the open locked notes until the password is entered again." onPress={() => { vault.onLock(); setMessage('The vault is locked.'); }} />
          <Heading>Change the vault password</Heading>
          {(['current', 'next', 'repeat'] as const).map((k) => (
            <PasswordField key={k} value={form[k]} onChangeText={(v) => setForm((f) => ({ ...f, [k]: v }))} style={styles.input}
              placeholder={k === 'current' ? 'Current vault password' : k === 'next' ? 'New vault password' : 'Repeat the new password'} />
          ))}
          <TouchableOpacity disabled={busy} style={[styles.button, styles.primary, { alignSelf: 'flex-start' }]} onPress={change}>
            <Text style={[styles.buttonText, { color: T.on_primary }]}>{busy ? 'Changing…' : 'Change password'}</Text>
          </TouchableOpacity>
        </>
      )}
      {creating ? <VaultPrompt mode="create" onClose={() => setCreating(false)} onSubmit={async (password) => {
        const error = await vault.onCreate(password);
        if (!error) { setCreating(false); setMessage('The vault is ready. Lock notes from their menu.'); }
        return error;
      }} /> : null}
    </>
  );
}

function LockPage({ onLockNow }: { onLockNow: () => void }) {
  const [lock, setLock] = useState(readAppLock);
  const set = (patch: Partial<AppLock>) => { const next = { ...lock, ...patch }; setLock(next); writeAppLock(next); };
  return (
    <>
      <Row title="App lock" description="Asks for your fingerprint, face or passphrase when Noted opens and after it was in the background."
        right={<ThemedSwitch value={lock.enabled} onValueChange={(enabled) => set({ enabled })} />} />
      <Row title="Use fingerprint or face" description="The passphrase always works too."
        right={<ThemedSwitch value={lock.biometrics} onValueChange={(biometrics) => set({ biometrics })} />} />
      <Text style={[styles.rowTitle, { marginTop: 16 }]}>Lock after</Text>
      <Text style={[styles.rowText, { marginBottom: 10 }]}>Time in the background.</Text>
      <Segmented value={lock.minutes} options={[[0, 'At once'], [1, '1 min'], [5, '5 min'], [15, '15 min']]} onChange={(minutes) => set({ minutes })} />
      <TouchableOpacity disabled={!lock.enabled} style={[styles.button, { marginTop: 18, alignSelf: 'flex-start', opacity: lock.enabled ? 1 : 0.5 }]} onPress={onLockNow}>
        <Text style={styles.buttonText}>Lock now</Text>
      </TouchableOpacity>
      <Text style={styles.note}>It hides your notes from people holding the phone; the notes stored on it stay encrypted as always.</Text>
    </>
  );
}

// Where "Save" of an attachment or image writes (otherwise the share menu opens).
function DownloadFolderRow() {
  const [folder, setFolder] = useState(readDownloadFolder);
  return (
    <>
      <Heading>Files</Heading>
      <Row title="Download folder" description={folder ? `“Save” on an attachment or image puts it into ${folder.folderName}.` : '“Save” on an attachment or image opens the share menu.'}
        onPress={async () => { const picked = await chooseDownloadFolder(); if (picked) { writeDownloadFolder(picked); setFolder(picked); } }}
        right={<Text style={{ color: T.primary, fontWeight: '600' }}>{folder ? 'Change' : 'Choose'}</Text>} />
      {folder ? <Row title="Use the share menu instead" onPress={() => { writeDownloadFolder(null); setFolder(null); }} /> : null}
    </>
  );
}

// "HH:MM" field saved when typing ends; anything that is not a time goes back.
function ClockInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [text, setText] = useState(value);
  const commit = () => {
    const clock = parseClock(text);
    if (!clock) return setText(value);
    const next = `${String(clock.hours).padStart(2, '0')}:${String(clock.minutes).padStart(2, '0')}`;
    setText(next);
    if (next !== value) onChange(next);
  };
  return (
    <TextInput value={text} onChangeText={setText} onEndEditing={commit} keyboardType="numbers-and-punctuation" maxLength={5}
      style={[styles.input, { width: 80, textAlign: 'center', marginBottom: 0 }]} />
  );
}

function EditorPage({ onSharedPrefs }: { onSharedPrefs: (patch: SharedEditorPrefs) => void }) {
  const [prefs, setPrefsState] = useState(getEditorPrefs);
  const [template, setTemplate] = useState(prefs.titleTemplate);
  const set = (patch: Partial<EditorPrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefsState(next);
    setEditorPrefs(next);
  };
  return (
    <>
      <Heading>New notes</Heading>
      <Text style={styles.rowTitle}>Default title</Text>
      <Text style={styles.rowText}>For notes left without a title once they have text. $date$ and $time$ become the creation date and time. Empty = off.</Text>
      <TextInput value={template} onChangeText={setTemplate} onEndEditing={() => { if (template.trim() !== prefs.titleTemplate) { set({ titleTemplate: template.trim() }); onSharedPrefs({ titleTemplate: template.trim() }); } }} placeholder="e.g. Note $date$ $time$"
        placeholderTextColor={T.on_surface_variant} style={[styles.input, { marginTop: 8 }]} />
      <Heading>Reminders</Heading>
      <Row title="Morning" description="Time of “Tomorrow morning” and “Next Monday” in the reminder picker."
        right={<ClockInput value={prefs.reminderMorning} onChange={(reminderMorning) => { set({ reminderMorning }); onSharedPrefs({ reminderMorning }); }} />} />
      <Row title="Evening" description="Time of “This evening”."
        right={<ClockInput value={prefs.reminderEvening} onChange={(reminderEvening) => { set({ reminderEvening }); onSharedPrefs({ reminderEvening }); }} />} />
      <Heading>Text</Heading>
      <Text style={[styles.rowTitle, { marginBottom: 2 }]}>Default font</Text>
      <Text style={[styles.rowText, { marginBottom: 10 }]}>For notes without a font of their own.</Text>
      <Segmented value={prefs.defaultFont} options={[['sans', 'Sans'], ['serif', 'Serif'], ['mono', 'Mono']]} onChange={(defaultFont) => set({ defaultFont })} />
      <Row title="Default font size" description="The base size of the text in every note." right={
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <TouchableOpacity style={styles.stepper} onPress={() => set({ fontSize: Math.max(10, prefs.fontSize - 1) })}><Text style={styles.buttonText}>−</Text></TouchableOpacity>
          <Text style={{ color: T.on_surface, fontSize: 15, minWidth: 44, textAlign: 'center' }}>{prefs.fontSize}px</Text>
          <TouchableOpacity style={styles.stepper} onPress={() => set({ fontSize: Math.min(32, prefs.fontSize + 1) })}><Text style={styles.buttonText}>+</Text></TouchableOpacity>
        </View>
      } />
      {prefs.fontSize !== 16 ? (
        <TouchableOpacity style={[styles.button, { alignSelf: 'flex-end', marginTop: 8, paddingVertical: 6 }]} onPress={() => set({ fontSize: 16 })}>
          <Text style={styles.buttonText}>Reset to 16px</Text>
        </TouchableOpacity>
      ) : null}
      <Row title="Symbol ligatures" description="Typing -> gives →, != ≠, <= ≤, ... … (not in code)."
        right={<ThemedSwitch value={prefs.ligatures} onValueChange={(ligatures) => set({ ligatures })} />} />
      <Text style={[styles.rowTitle, { marginTop: 20, color: T.primary }]}>Code blocks</Text>
      <Row title="Code colours" description="Syntax colours of code blocks; the language is detected by itself." />
      <Select value={prefs.codeTheme} options={CODE_THEMES.map((t) => [t.id, t.label] as [string, string])} onChange={(codeTheme) => set({ codeTheme })} />
      {Object.entries(prefs.codeThemeByLanguage).map(([lang, themeId]) => (
        <View key={lang} style={{ marginTop: 12 }}>
          <Row title={codeLanguageLabel(lang)} description="Colours for this language only." right={
            <TouchableOpacity onPress={() => { const next = { ...prefs.codeThemeByLanguage }; delete next[lang]; set({ codeThemeByLanguage: next }); }} style={{ padding: 8 }}>
              <Text style={styles.buttonText}>Remove</Text>
            </TouchableOpacity>
          } />
          <Select value={themeId} options={CODE_THEMES.filter((t) => t.id !== 'app').map((t) => [t.id, t.label] as [string, string])}
            onChange={(id) => set({ codeThemeByLanguage: { ...prefs.codeThemeByLanguage, [lang]: id } })} />
        </View>
      ))}
      <View style={{ marginTop: 12 }}>
        <Select value="" options={[['', 'Colours for one language…'] as [string, string], ...CODE_LANGUAGES.filter(([id]) => !prefs.codeThemeByLanguage[id])]}
          onChange={(lang) => { if (lang) set({ codeThemeByLanguage: { ...prefs.codeThemeByLanguage, [lang]: 'github-dark' } }); }} />
      </View>
      <DownloadFolderRow />
      <Text style={styles.note}>Spell checking on the phone is the keyboard's (Android settings); each note can turn the underlines off in its menu.</Text>
    </>
  );
}

// The toolbars: the normal one, the extra buttons while the cursor is in a table, the drawing bar.
function ToolbarPage({ onDragging }: { onDragging: (dragging: boolean) => void }) {
  const [tab, setTab] = useState<'normal' | 'table' | 'drawing'>('normal');
  const [config, setConfig] = useState(getToolbarConfig);
  const [tableConfig, setTableConfig] = useState(getTableToolbarConfig);
  const [drawingConfig, setDrawingConfig] = useState(getDrawingToolbarConfig);
  return (
    <>
      <View style={{ marginBottom: 14 }}>
        <Segmented value={tab} options={[['normal', 'Normal'], ['table', 'Table'], ['drawing', 'Drawing']]} onChange={setTab} />
      </View>
      {tab === 'normal'
        ? <ToolbarEditor key="normal" config={config} onDragging={onDragging} onChange={(next) => { setConfig(next); setToolbarConfig(next); }} />
        : tab === 'table'
          ? <ToolbarEditor key="table" platform="mobileTable" config={tableConfig} onDragging={onDragging} onChange={(next) => { setTableConfig(next); setTableToolbarConfig(next); }} />
          : <ToolbarEditor key="drawing" platform="mobileDrawing" config={drawingConfig} onDragging={onDragging} onChange={(next) => { setDrawingConfig(next); setDrawingToolbarConfig(next); }} />}
    </>
  );
}

export function SettingsScreen(p: Props) {
  const [page, setPage] = useState<Page>('list');
  const [vault, setVault] = useState<VaultInfo | null>(null);
  const [stats, setStats] = useState<AccountStats | null>(null);
  const [recovery, setRecovery] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [backup, setBackupState] = useState<MobileBackupSettings>(readBackupSettings);
  const setBackup = (patch: Partial<MobileBackupSettings>) => { const next = { ...readBackupSettings(), ...patch }; setBackupState(next); writeBackupSettings(next); };
  const [exportFormat, setExportFormat] = useState<'markdown' | 'text'>('markdown');
  const [scrollLocked, setScrollLocked] = useState(false);
  // A backup opened for comparing (page 'compare').
  const [compare, setCompare] = useState<{ name: string; text: string; createdAt: number; diffs: BackupDiff[] | null } | null>(null);
  const loadCompare = async (name: string, text: string) => {
    const file = openBackup(p.masterKey, text);
    setCompare({ name, text, createdAt: file.createdAt, diffs: null });
    setPage('compare');
    const diffs = await compareBackup(p.masterKey, file, p.store);
    setCompare({ name, text, createdAt: file.createdAt, diffs });
  };
  const refreshCompare = async () => {
    if (!compare) return;
    const diffs = await compareBackup(p.masterKey, openBackup(p.masterKey, compare.text), p.store);
    setCompare({ ...compare, diffs });
  };
  const [form, setForm] = useState({ current: '', next: '', repeat: '' });
  const [connectForm, setConnectForm] = useState({ address: '', code: '' });
  const connect = () => run('connect', async () => {
    const base = normalizeServerUrl(connectForm.address);
    if (!base) throw new Error('Enter the server address, e.g. https://notes.example.com or 100.64.0.1:3333.');
    await p.onConnectServer!(base, connectForm.code);
    setPage('sync');
    return 'Connected: every note is being uploaded (encrypted).';
  });

  const back = () => {
    setMessage(null);
    if (page === 'recovery' || page === 'passphrase') setPage('account');
    else if (page === 'connect') setPage('sync');
    else if (page === 'compare') setPage('backup');
    else if (page !== 'list') setPage('list');
    else p.onClose();
  };
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { back(); return true; });
    return () => sub.remove();
  }, [page]);
  useEffect(() => {
    if (page !== 'account') return;
    fetchVault().then(setVault, () => setVault(null));
    fetchAccountStats(p.masterKey).then(setStats, () => setStats(null));
  }, [page]);

  const run = async (label: string, work: () => Promise<string | null | void>) => {
    setBusy(label);
    setMessage(null);
    try {
      const text = await work();
      if (text) setMessage(text);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const openRecovery = (renew = false) => {
    setPage('recovery');
    setRecovery(null);
    run('recovery', async () => { setRecovery(formatRecoveryKey(await getRecoveryKey(p.masterKey, renew))); });
  };

  const submitPassphrase = () => run('passphrase', async () => {
    if (form.next.length < MIN_PASSPHRASE_LENGTH) throw new Error(`Use at least ${MIN_PASSPHRASE_LENGTH} characters.`);
    if (form.next !== form.repeat) throw new Error('The new passphrases do not match.');
    const info = await fetchVault();
    if (!info) throw new Error('No vault on the server.');
    const dataKey = openWithPassphraseKey(info, await deriveKeyInWebView(form.current, info.salt));
    if (!dataKey || dataKey.some((b, i) => b !== p.masterKey[i])) throw new Error('The current passphrase is wrong.');
    const salt = generateSalt();
    await changePassphrase(p.masterKey, salt, await deriveKeyInWebView(form.next, bytesToBase64(salt)));
    setForm({ current: '', next: '', repeat: '' });
    setPage('account');
    return 'Passphrase changed. New devices unlock with the new one; this and your other devices stay unlocked.';
  });

  const titles: Record<Page, string> = {
    list: 'Settings', compare: 'Compare backup', lock: 'App lock', vault: 'Vault', account: 'Account', sync: 'Sync', appearance: 'Appearance', editor: 'Editor', toolbar: 'Toolbar', noteMenu: 'Note menu', backup: 'Backup & export',
    recovery: 'Data recovery key', passphrase: 'Change passphrase', connect: 'Connect a server',
  };

  return (
    <Modal animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={back}>
      <View style={styles.screen}>
        <View style={styles.header}>
          <TouchableOpacity onPress={back} style={styles.iconBtn} accessibilityLabel="Back"><Icon path={mdiArrowLeft} /></TouchableOpacity>
          <Text style={styles.title}>{titles[page]}</Text>
          {busy ? <ActivityIndicator color={T.primary} style={{ marginRight: 12 }} /> : null}
        </View>
        <ScrollView scrollEnabled={!scrollLocked} contentContainerStyle={{ padding: 16, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
          {message ? <Text style={styles.message}>{message}</Text> : null}

          {page === 'list' && (
            <>
              {([
                ['account', 'Account', 'Recovery key, passphrase, sessions', mdiAccountOutline],
                ['sync', 'Sync', 'Server and syncing', mdiSync],
                ['appearance', 'Appearance', 'Light, dark, auto or a ready-made theme', mdiPaletteOutline],
                ['editor', 'Editor', 'Default title, reminders, font, size, ligatures', mdiFormatText],
                ['toolbar', 'Toolbar', 'Buttons above the keyboard', mdiDockBottom],
                ['noteMenu', 'Note menu', 'Switches and actions of the ⋮ menu in a note', mdiDotsVertical],
                ['backup', 'Backup & export', 'Backups, restore, export all notes', mdiBackupRestore],
                ['lock', 'App lock', 'Fingerprint or passphrase', mdiLockOutline],
                ['vault', 'Vault', 'Locked notes and their password', mdiShieldLockOutline],
              ] as const).map(([id, label, text, icon]) => (
                <TouchableOpacity key={id} style={styles.listItem} onPress={() => setPage(id)}>
                  <Icon path={icon} size={24} color={T.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{label}</Text>
                    <Text style={styles.rowText}>{text}</Text>
                  </View>
                  <Icon path={mdiChevronRight} size={22} color={T.on_surface_variant} />
                </TouchableOpacity>
              ))}
            </>
          )}

          {page === 'account' && (
            <>
              <View style={styles.card}>
                <View style={styles.avatar}><Icon path={mdiShieldKeyOutline} size={30} color={T.primary} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: T.primary, fontSize: 12 }}>End-to-end encrypted</Text>
                  <Text style={styles.cardTitle}>Your vault</Text>
                  {!hasServer() ? <Text style={styles.rowText}>This phone only (no server)</Text> : null}
                  <Text style={styles.rowText}>{vault?.createdAt ? `Created ${formatDateTime(vault.createdAt).slice(0, 10)}` : 'Created before settings existed'}</Text>
                  {stats ? <Text style={styles.rowText}>{stats.notes} notes ({size(stats.noteBytes)}) • {stats.blobs} images and files ({size(stats.blobBytes)})</Text> : null}
                </View>
              </View>
              <Row
                title="Save data recovery key"
                description={`You need it to recover your notes if you forget your passphrase. ${vault ? (vault.recoveryEnvelope ? 'A key is set up.' : 'No key yet.') : ''}`}
                onPress={() => openRecovery(false)}
                right={<Icon path={mdiChevronRight} size={22} color={T.on_surface_variant} />}
              />
              <Heading>Authentication</Heading>
              <Row title="Change passphrase" description="The passphrase that unlocks your notes on a new device." onPress={() => setPage('passphrase')}
                right={<Icon path={mdiChevronRight} size={22} color={T.on_surface_variant} />} />
              <Heading>Sessions</Heading>
              <Row title="Log out" danger description="Removes the key from this phone. Its notes stay here encrypted."
                onPress={() => appAlert('Log out?', 'You will need the passphrase (or the recovery key) to unlock Noted here again.', [
                  { text: 'Cancel', style: 'cancel' }, { text: 'Log out', style: 'destructive', onPress: p.onLogout },
                ])} />
              {hasServer() ? <Row title="Log out from all other devices" danger description="Every other device has to enter the passphrase again."
                onPress={() => appAlert('Log out the other devices?', 'They will ask for the passphrase the next time they connect. This phone stays logged in.', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Log them out', style: 'destructive', onPress: () => run('logout', async () => {
                    await saveAuthEpoch(await logoutOtherDevices(p.masterKey));
                    return 'The other devices are logged out.';
                  }) },
                ])} /> : null}
            </>
          )}

          {page === 'recovery' && (
            <>
              <Text style={styles.note}>
                If you forget your passphrase, this key opens your notes and lets you set a new passphrase. Keep it somewhere safe and
                offline. Anyone who has it can read your notes.
              </Text>
              <View style={styles.keyBox}>
                <Text selectable style={styles.keyText}>{recovery ? recovery.split('-').join(' ') : 'Loading…'}</Text>
              </View>
              <View style={styles.buttons}>
                <TouchableOpacity disabled={!recovery} style={styles.button} onPress={() => recovery && Clipboard.setStringAsync(recovery).then(() => setMessage('Copied.'))}>
                  <Text style={styles.buttonText}>Copy</Text>
                </TouchableOpacity>
                <TouchableOpacity disabled={!recovery} style={styles.button} onPress={() => recovery && run('share', () => shareFile('noted-recovery-key.txt',
                  `Noted data recovery key\n\n${recovery}\n\nKeep it somewhere safe and offline. Anyone who has it can open your notes.\n`, 'text/plain'))}>
                  <Text style={styles.buttonText}>Save as file</Text>
                </TouchableOpacity>
              </View>
              <Row title="Create a new key" danger description="The new key replaces this one: the old key stops working."
                onPress={() => appAlert('Create a new recovery key?', 'The old key stops working.', [
                  { text: 'Cancel', style: 'cancel' }, { text: 'Create', style: 'destructive', onPress: () => openRecovery(true) },
                ])} />
            </>
          )}

          {page === 'passphrase' && (
            <>
              <Text style={styles.note}>Your notes stay as they are (only the key that opens them is wrapped again). If you think someone knows the old passphrase, also log out the other devices.</Text>
              {(['current', 'next', 'repeat'] as const).map((k) => (
                <PasswordField key={k} value={form[k]} onChangeText={(v) => setForm((f) => ({ ...f, [k]: v }))}
                  placeholder={k === 'current' ? 'Current passphrase' : k === 'next' ? 'New passphrase' : 'Repeat the new passphrase'}
                  style={styles.input} />
              ))}
              <TouchableOpacity disabled={!!busy} style={[styles.button, styles.primary]} onPress={submitPassphrase}>
                <Text style={[styles.buttonText, { color: T.on_primary }]}>{busy === 'passphrase' ? 'Changing…' : 'Change passphrase'}</Text>
              </TouchableOpacity>
            </>
          )}

          {page === 'sync' && !hasServer() && (
            <Row title="Server" description="None: your notes are kept on this phone only, so make backups (Backup & export). With a server of your own they sync between your devices."
              onPress={p.onConnectServer ? () => setPage('connect') : undefined}
              right={<Text style={{ color: T.primary }}>Connect…</Text>} />
          )}

          {page === 'connect' && (
            <>
              <Text style={styles.note}>
                Your vault (the same passphrase and recovery key) moves to the server, then every note is uploaded, encrypted as always.
                A new server asks for the setup code from its log; a server that already holds this vault needs none.
              </Text>
              <TextInput value={connectForm.address} onChangeText={(address) => setConnectForm((f) => ({ ...f, address }))} placeholder="https://notes.example.com"
                autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholderTextColor={T.on_surface_variant} style={styles.input} />
              <TextInput value={connectForm.code} onChangeText={(code) => setConnectForm((f) => ({ ...f, code }))} placeholder="Setup code (new server only)"
                autoCapitalize="characters" autoCorrect={false} placeholderTextColor={T.on_surface_variant} style={[styles.input, { fontFamily: 'monospace' }]} />
              <TouchableOpacity disabled={!!busy} style={[styles.button, styles.primary]} onPress={connect}>
                <Text style={[styles.buttonText, { color: T.on_primary }]}>{busy === 'connect' ? 'Connecting…' : 'Connect'}</Text>
              </TouchableOpacity>
            </>
          )}

          {page === 'sync' && hasServer() && (
            <>
              <Row title="Server" description={apiUrl()} right={
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: p.online ? '#3fb950' : T.error }} />
                  <Text style={{ color: T.on_surface_variant }}>{p.online ? 'Connected' : 'Offline'}</Text>
                </View>
              } />
              <Row title="Sync now" description={`Notes sync by themselves when they change (and every 30 seconds).${p.lastSyncAt ? ` Last sync: ${formatDateTime(p.lastSyncAt).slice(11)}.` : ''}`}
                right={<SyncButton syncing={p.syncing} onPress={p.onSyncNow} />} />
              <BackgroundSyncRow />
              <CleanupRows find={p.cleanup.find} run={p.cleanup.run} />
            </>
          )}

          {page === 'appearance' && (() => {
            const palette = readPalette();
            const brightness = readBrightness();
            const presetOn = THEME_PRESETS.some((pr) => pr.id === palette);
            const systemDark = Appearance.getColorScheme() !== 'light';
            // Material You and Noted's own colours show the scheme they would be used in.
            const own = (id: string) => {
              const schemes = paletteSchemes(id);
              return brightness === 'light' || (brightness === 'auto' && !systemDark) ? schemes.light : schemes.dark;
            };
            const choices = [
              ...(materialYouAvailable ? [{ id: 'material-you', label: 'Material You', hint: 'Your wallpaper\'s colours', colors: own('material-you') }] : []),
              { id: 'noted', label: 'Noted', hint: null, colors: own('noted') },
              ...THEME_PRESETS.map((pr) => ({ id: pr.id, label: pr.label, hint: null, colors: pr.colors })),
            ];
            return (
              <>
                <Heading>Brightness</Heading>
                <Segmented value={brightness} options={[['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']]}
                  onChange={(b) => setThemeChoice(presetOn ? { brightness: b, palette: materialYouAvailable ? 'material-you' : 'noted' } : { brightness: b })} />
                <Text style={styles.note}>{presetOn ? 'Ready-made themes have their own brightness; choosing one here switches back to ' + (materialYouAvailable ? 'Material You.' : 'Noted.') : 'Auto follows the system\'s light / dark setting.'}</Text>
                <Heading>Theme</Heading>
                {choices.map((c) => (
                  <TouchableOpacity key={c.id} onPress={() => setThemeChoice({ palette: c.id })} style={[styles.presetRow, { backgroundColor: c.colors.background, borderColor: palette === c.id ? T.primary : T.outline_variant }]}>
                    {[c.colors.primary, c.colors.on_surface, c.colors.surface_container_highest, c.colors.error].map((color, i) => (
                      <View key={i} style={[styles.swatch, { backgroundColor: color }]} />
                    ))}
                    <Text style={{ marginLeft: 8, color: c.colors.on_surface, fontWeight: '600' }}>{c.label}</Text>
                    <Text style={{ flex: 1, marginLeft: 6, color: c.colors.on_surface_variant, fontSize: 13 }} numberOfLines={1}>{c.hint ?? ''}</Text>
                    {palette === c.id ? <Icon path={mdiCheck} size={20} color={c.colors.primary} /> : null}
                  </TouchableOpacity>
                ))}
              </>
            );
          })()}

          {page === 'compare' && compare && (() => {
            const when = formatDateTime(compare.createdAt);
            const all = (mode: RestoreMode) => run('all', async () => {
              const r = await restoreBackup(p.masterKey, compare.text, p.store, p.blobs, mode);
              p.onRestored();
              await refreshCompare();
              return `Done: ${r.added} notes brought back, ${r.merged} ${mode === 'merge' ? 'merged' : 'restored'}${r.trashed ? `, ${r.trashed} newer notes moved to the trash` : ''}${r.blobs ? `, ${r.blobs} images and files` : ''}.`;
            });
            const STATUS: Record<BackupDiffStatus, [string, string]> = {
              changed: ['Changed since', T.primary], missing: ['Not here any more', T.error], trashed: ['In the trash now', T.error], new: ['New since the backup', '#3fb950'],
            };
            return (
              <>
                <Text style={styles.note}>Backup of {when}. {compare.diffs === null ? 'Comparing…' : compare.diffs.length ? `${compare.diffs.length} ${compare.diffs.length === 1 ? 'note differs' : 'notes differ'} from now. Tap one to see it next to the note.` : 'Your notes are the same as in the backup.'}</Text>
                {compare.diffs?.length ? (
                  <>
                    <ActionRow icon={mdiCallMerge} title="Merge all" text="Every note keeps its later changes and gets back what was removed since; missing notes come back." disabled={!!busy} onPress={() => all('merge')} />
                    <ActionRow icon={mdiBackupRestore} title="Restore all as in the backup" text="The notes in the backup get their content from then; notes made since stay." disabled={!!busy} onPress={() => all('replace')} />
                    <ActionRow icon={mdiHistory} title={`Return everything to ${when.slice(0, 10)}`} danger disabled={!!busy} text="As in the backup, and notes made since go to the trash." onPress={() => {
                      const newer = compare.diffs?.filter((d) => d.status === 'new').length ?? 0;
                      appAlert(`Return everything to ${when}?`, `Every note in the backup gets its content from then; later changes to them are replaced.${newer ? ` ${newer} notes made after the backup go to the trash (7 days to restore them).` : ''}`, [
                        { text: 'Cancel', style: 'cancel' }, { text: 'Return everything', style: 'destructive', onPress: () => all('rollback') },
                      ]);
                    }} />
                    <Heading>Notes that differ</Heading>
                  </>
                ) : null}
                {compare.diffs?.map((d) => (
                  <Row key={d.id} title={d.title || 'Untitled'} description={`${STATUS[d.status][0]} • ${formatDateTime(d.updatedAt)}`}
                    right={<View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: STATUS[d.status][1] }} />}
                    onPress={() => {
                      if (d.status === 'new') return appAlert(d.title || 'Untitled', 'Made after the backup. "Return everything" would move it to the trash.');
                      if (d.status === 'missing') {
                        return appAlert(d.title || 'Untitled', 'This note is not here any more. Bring it back from the backup?', [
                          { text: 'Cancel', style: 'cancel' },
                          { text: 'Bring it back', onPress: () => run('note', async () => {
                            await restoreBackupNote(p.masterKey, openBackup(p.masterKey, compare.text), d.id, p.store, p.blobs, 'replace');
                            p.onRestored();
                            await refreshCompare();
                            return `“${d.title || 'Untitled'}” is back.`;
                          }) },
                        ]);
                      }
                      if (d.backup) p.onCompareNote(d.id, d.backup, compare.createdAt);
                    }} />
                ))}
              </>
            );
          })()}
          {page === 'lock' && <LockPage onLockNow={p.onLockNow} />}
          {page === 'vault' && <VaultPage vault={p.vault} />}
          {page === 'editor' && <EditorPage onSharedPrefs={p.onSharedPrefs} />}
          {page === 'toolbar' && <ToolbarPage onDragging={setScrollLocked} />}
          {page === 'noteMenu' && <NoteMenuEditor onDragging={setScrollLocked} />}

          {page === 'backup' && (
            <>
              <Heading>Backups</Heading>
              <Row title="Backup now" description={backup.folder ? `Saved into ${backup.folderName ?? 'the backup folder'}. Encrypted: it opens only with this vault's passphrase or recovery key.` : 'Pick a folder for backups first (asked now). Encrypted: it opens only with this vault.'}
                onPress={() => run('backup', async () => {
                  let folder = backup.folder;
                  if (!folder) {
                    const picked = await chooseBackupFolder();
                    if (!picked) return null;
                    setBackup(picked);
                    folder = picked.folder;
                  }
                  const name = await writeBackup(p.masterKey, p.store, p.blobs, folder, backup.attachments);
                  setBackup({ last: Date.now() });
                  return `Saved ${name}.`;
                })} />
              <Row title="Include images and files" description="Makes the backup bigger, but complete without the server."
                right={<ThemedSwitch value={backup.attachments} onValueChange={(attachments) => setBackup({ attachments })} />} />
              <Row title="Backup folder" description={backup.folderName ?? 'Not chosen yet'} onPress={() => run('folder', async () => {
                const picked = await chooseBackupFolder();
                if (picked) setBackup(picked);
              })} right={<Text style={{ color: T.primary, fontWeight: '600' }}>Change</Text>} />
              <Row title="Share a backup" description="Send a backup to another app instead (Drive, mail…)."
                onPress={() => run('share', async () => {
                  const text = await createBackup(p.masterKey, p.store, backup.attachments ? { blobs: p.blobs } : {});
                  await shareFile(backupFileName(new Date(), backup.attachments), text, 'application/octet-stream');
                })} />
              <Row title="Restore or compare a backup" description="Opens a backup file next to your notes: which notes differ and how; restore or merge single notes, all of them, or return everything to that day."
                onPress={() => run('restore', async () => {
                  goingAway();
                  const picked = await File.pickFileAsync();
                  // Older versions of the module returned the file itself.
                  const file = picked && 'canceled' in picked ? (picked.canceled ? null : picked.result) : (picked as unknown as File | null);
                  if (!file) return null;
                  await loadCompare(file.name ?? 'Picked file', await file.text());
                  return null;
                })} />
              {backup.folder ? (
                <>
                  <Heading>Backups in the folder</Heading>
                  {listBackupFiles(backup.folder).slice(0, 10).map((f) => (
                    <Row key={f.name} title={f.at ? formatDateTime(f.at) : f.name} description={f.name.includes('with-attachments') ? 'With images and files' : undefined}
                      onPress={() => run('compare', async () => { await loadCompare(f.name, await f.read()); return null; })}
                      right={<Text style={{ color: T.primary, fontWeight: '600' }}>Compare</Text>} />
                  ))}
                </>
              ) : null}
              <Heading>Automatic backups</Heading>
              <Text style={[styles.rowText, { marginBottom: 10 }]}>{`Checked when Noted opens; written into the backup folder, the newest 10 are kept.${backup.last ? ` Last one: ${formatDateTime(backup.last)}.` : ''}`}</Text>
              <Segmented value={backup.interval} options={[['off', 'Never'], ['daily', 'Daily'], ['weekly', 'Weekly']]} onChange={(interval) => run('folder', async () => {
                if (interval !== 'off' && !backup.folder) {
                  const picked = await chooseBackupFolder();
                  if (!picked) return 'Automatic backups need a folder.';
                  setBackup(picked);
                }
                setBackup({ interval });
              })} />
              <Heading>Export</Heading>
              <Text style={[styles.rowText, { marginBottom: 10 }]}>All notes as a zip of readable files (not encrypted), one per note, saved into your download folder.</Text>
              <Select value={exportFormat} options={[['markdown', 'Markdown (.md)'], ['text', 'Plain text (.txt)']]} onChange={setExportFormat} />
              <TouchableOpacity disabled={!!busy} style={[styles.button, styles.primary, { alignSelf: 'flex-start', marginTop: 12 }]} onPress={() => run('export', async () => {
                const { zip, count } = await exportAllNotes(p.masterKey, p.store, exportFormat, { notebookNames: p.notebookNames, blobs: p.blobs });
                const d = new Date();
                const saved = await saveFileBytes(`noted-export-${d.toISOString().slice(0, 10)}-${exportFormat}.zip`, zip, 'application/zip');
                return saved ? `Exported ${count} notes. ${saved}` : 'Export cancelled (no folder picked).';
              })}>
                <Text style={[styles.buttonText, { color: T.on_primary }]}>{busy === 'export' ? 'Exporting…' : 'Export all notes'}</Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = themed(() => StyleSheet.create({
  screen: { flex: 1, backgroundColor: T.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingTop: 44, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: T.outline_variant },
  iconBtn: { padding: 9 },
  title: { flex: 1, fontSize: 22, fontWeight: 'bold', color: T.on_surface, marginLeft: 4 },
  listItem: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 16, paddingHorizontal: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: T.outline_variant },
  rowTitle: { color: T.on_surface, fontSize: 16, fontWeight: '600' },
  rowText: { color: T.on_surface_variant, fontSize: 13, marginTop: 3, lineHeight: 18 },
  heading: { color: T.primary, fontSize: 12, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 22, marginBottom: 2 },
  message: { color: T.on_surface, fontSize: 14, padding: 12, borderRadius: 12, backgroundColor: T.surface_container_high, marginBottom: 8 },
  note: { color: T.on_surface_variant, fontSize: 13, lineHeight: 19, marginVertical: 12 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: T.outline_variant },
  avatar: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', backgroundColor: T.surface_container_high },
  cardTitle: { color: T.on_surface, fontSize: 18, fontWeight: 'bold' },
  keyBox: { padding: 16, borderRadius: 12, borderWidth: 1, borderColor: T.outline_variant, backgroundColor: T.surface_container },
  keyText: { color: T.on_surface, fontFamily: 'monospace', fontSize: 17, lineHeight: 28, textAlign: 'center', letterSpacing: 1 },
  buttons: { flexDirection: 'row', gap: 10, marginTop: 14 },
  button: { paddingHorizontal: 18, paddingVertical: 11, borderRadius: 20, borderWidth: 1, borderColor: T.outline_variant, alignItems: 'center' },
  primary: { backgroundColor: T.primary, borderColor: T.primary, marginTop: 6 },
  buttonText: { color: T.on_surface, fontSize: 15, fontWeight: '600' },
  input: { backgroundColor: T.surface_container_high, color: T.on_surface, padding: 12, borderRadius: 10, marginBottom: 10, fontSize: 16 },
  stepper: { width: 40, height: 36, borderRadius: 18, borderWidth: 1, borderColor: T.outline_variant, alignItems: 'center', justifyContent: 'center' },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, borderWidth: 1, borderColor: T.outline_variant },
  chipOn: { backgroundColor: T.secondary_container, borderColor: T.secondary_container },
  chipText: { color: T.on_surface, fontSize: 14 },
  presetRow: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 12, borderRadius: 12, borderWidth: 2, marginTop: 8 },
  swatch: { width: 18, height: 18, borderRadius: 9, borderWidth: 1, borderColor: 'rgba(127,127,127,0.3)' },
}));
