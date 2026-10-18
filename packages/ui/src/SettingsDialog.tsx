import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  mdiAccountOutline, mdiSync, mdiPaletteOutline, mdiBackupRestore, mdiClose, mdiShieldKeyOutline, mdiContentCopy,
  mdiDownload, mdiMagnify, mdiFolderOpenOutline, mdiFormatText, mdiDockTop, mdiMonitor, mdiImport, mdiCheck, mdiLockOutline, mdiShieldLockOutline,
  mdiCheckCircleOutline, mdiAlertCircleOutline, mdiChevronDown, mdiChevronUp, mdiKeyboardOutline,
} from '@mdi/js';
import { ShortcutSettings } from './ShortcutSettings';
import type { ShortcutOverrides } from './shortcuts';
import type { EditorPrefs, ToolbarConfig, ToolbarPlatform } from '@noted/editor';
import { CODE_THEMES, CODE_LANGUAGES, codeLanguageLabel } from '@noted/editor/code-themes';
import { parseClock } from '@noted/editor/reminder-time';
import { ToolbarSettings } from './ToolbarSettings';
import { IMPORT_SOURCES } from './importers';
import type { ImportSource, ImportFile } from './importers';
import { formatRecoveryKey, generateSalt } from '@noted/crypto';
import {
  fetchVault, openWithPassphraseKey, changePassphrase, getRecoveryKey, logoutOtherDevices, fetchAccountStats,
} from '@noted/sync';
import type { AccountStats, RestoreResult, RestoreMode, BackupDiff, VaultInfo } from '@noted/sync';
import { BackupCompare } from './BackupCompare';
import { Select } from './Select';
import type { ThemeMode } from '@noted/theme';
import { THEME_PRESETS } from '@noted/theme';
import { MIN_PASSPHRASE_LENGTH, normalizeServerUrl } from '@noted/config';
import { Icon } from './Icon';
import { PasswordInput } from './PasswordInput';
import { formatDateTime } from './format-date';

// Settings (like Notesnook's): sections on the left (searchable), their options on the right.
// Platform work (deriving keys, files, the theme, backups) comes from the app through `host`.

export type BackupInterval = 'off' | 'daily' | 'weekly';
export interface CleanupPlan { deletedNotes: string[]; fileIds: string[]; fileBytes: number }
export type ExportAllFormat = 'markdown' | 'text' | 'html';

export interface ImportProgress {
  log: (line: string) => void;
  // Note files read so far / all of them, and notes found.
  progress: (done: number, total: number) => void;
}

export interface SettingsHost {
  masterKey: Uint8Array;
  // Settings > Keyboard shortcuts (desktop): the user's changes to the default keys.
  shortcuts?: { overrides: ShortcutOverrides; onChange: (next: ShortcutOverrides) => void };
  // Argon2id of a passphrase (the same as unlocking).
  deriveKey: (passphrase: string, salt: Uint8Array) => Promise<Uint8Array>;
  onLogout: () => void;
  onEpochChanged: (epoch: number) => void;
  // Files: a save dialog (false = cancelled) and an open dialog for a text file.
  saveFile: (name: string, data: Uint8Array | string) => Promise<boolean>;
  openTextFile: (extensions: string[]) => Promise<string | null>;
  // Sync ('' = this device works without a server)
  serverUrl: string;
  // Only without a server: moves this device's vault to a server (or joins the same vault there).
  connectServer?: (base: string, setupCode: string) => Promise<void>;
  online: boolean;
  syncing: boolean;
  lastSyncAt: number | null;
  // Clean-up: notes deleted for good (tombstones) and files no note uses (by default only
  // those older than 30 days); running it also cleans this device's copy.
  findCleanup?: (includeRecent: boolean) => Promise<CleanupPlan>;
  runCleanup?: (plan: CleanupPlan) => Promise<string>;
  onSyncNow: () => void;
  // Appearance
  themeMode: ThemeMode;
  onThemeMode: (mode: ThemeMode) => void;
  zoom: number;
  onZoom: (zoom: number) => void;
  // Backup & export
  createBackup: (withAttachments: boolean) => Promise<{ name: string; text: string }>;
  restoreBackup: (text: string, mode: RestoreMode) => Promise<RestoreResult>;
  // New or replaced server without a vault: the vault from a backup, then its notes; a message.
  setUpServer: (text: string) => Promise<string>;
  // Comparing a backup with the notes now, and restoring single notes from it.
  compareBackup: (text: string) => Promise<BackupDiff[]>;
  restoreBackupNote: (text: string, id: string, mode: 'merge' | 'replace') => Promise<void>;
  // Backups in the backup folder, newest first.
  listBackups: () => Promise<{ name: string; read: () => Promise<string> }[]>;
  // Current note titles (note links in compared notes).
  noteTitles: Record<string, string>;
  autoBackup: { interval: BackupInterval; attachments: boolean; last: number | null; folder: string };
  onAutoBackup: (settings: { interval: BackupInterval; attachments: boolean }) => void;
  onOpenBackupFolder: () => void;
  // Picks another folder for automatic backups; null = back to the default one.
  onChooseBackupFolder: (reset?: boolean) => void;
  exportAll: (format: ExportAllFormat) => Promise<{ name: string; zip: Uint8Array; count: number }>;
  // Editor
  editorPrefs: EditorPrefs;
  onEditorPrefs: (prefs: EditorPrefs) => void;
  // Where "Save" of an attachment / image writes without asking (null = ask every time).
  downloadFolder?: string | null;
  onChooseDownloadFolder?: (reset?: boolean) => void;
  // Installed spell checker dictionaries (empty: none, or not on this platform).
  spellLanguages: string[];
  getCustomWords: () => Promise<string[]>;
  setCustomWords: (words: string[]) => Promise<void>;
  // Toolbar
  toolbarPlatform: ToolbarPlatform;
  toolbarConfig: ToolbarConfig | null;
  onToolbarConfig: (config: ToolbarConfig | null) => void;
  // The table menu's buttons (platform desktopTable).
  tableToolbarConfig?: ToolbarConfig | null;
  onTableToolbarConfig?: (config: ToolbarConfig | null) => void;
  // The drawing menu's buttons (platform desktopDrawing).
  drawingToolbarConfig?: ToolbarConfig | null;
  onDrawingToolbarConfig?: (config: ToolbarConfig | null) => void;
  // Vault of locked notes
  vault?: {
    exists: boolean;
    open: boolean;
    onCreate: () => void;
    onLock: () => void;
    // Resolves to an error message, or null.
    onChangePassword: (current: string, next: string) => Promise<string | null>;
  };
  // App lock
  appLock: { enabled: boolean; minutes: number; biometrics?: boolean };
  onAppLock: (next: { enabled: boolean; minutes: number; biometrics?: boolean }) => void;
  onLockNow: () => void;
  // Import (Notesnook-like): files are picked (or a folder, or dropped paths) and listed first;
  // "Start importing" then creates the notes, reporting progress and log lines.
  pickImportFiles?: (source: ImportSource, from: 'files' | 'folder' | { paths: string[] }) => Promise<ImportFile[] | null>;
  runImport?: (source: ImportSource, files: ImportFile[], on: ImportProgress) => Promise<{ notes: number; skipped?: number; errors: string[] }>;
  // Files dragged over the window (the import drop zone listens while it is shown).
  onFileDrop?: (listener: (event: { type: 'over' | 'leave' | 'drop'; paths: string[] }) => void) => () => void;
  // The app's version; `onCheck` (release builds only) looks for a newer one.
  version?: { current: string; onCheck?: () => void };
  // Desktop integration (absent where it does not apply)
  desktop?: {
    autostart: boolean;
    closeToTray: boolean;
    minimizeToTray: boolean;
    onChange: (next: { autostart: boolean; closeToTray: boolean; minimizeToTray: boolean }) => void;
  };
}

export type SectionId = 'account' | 'sync' | 'appearance' | 'editor' | 'toolbar' | 'shortcuts' | 'desktop' | 'backup' | 'import' | 'lock' | 'vault';

const SECTIONS: { group: string; id: SectionId; label: string; icon: string; keywords: string }[] = [
  { group: 'Account', id: 'account', label: 'Account', icon: mdiAccountOutline, keywords: 'recovery key passphrase password change logout sessions devices vault storage' },
  { group: 'Account', id: 'sync', label: 'Sync', icon: mdiSync, keywords: 'server sync now online' },
  { group: 'Customization', id: 'appearance', label: 'Appearance', icon: mdiPaletteOutline, keywords: 'theme dark light auto matugen zoom size catppuccin nord gruvbox dracula' },
  { group: 'Customization', id: 'editor', label: 'Editor', icon: mdiFormatText, keywords: 'default title font size ligatures arrows spell check spellcheck languages dictionary words' },
  { group: 'Customization', id: 'toolbar', label: 'Toolbar', icon: mdiDockTop, keywords: 'toolbar buttons customize order hide' },
  { group: 'Customization', id: 'shortcuts', label: 'Keyboard shortcuts', icon: mdiKeyboardOutline, keywords: 'keyboard shortcuts keys hotkeys keybindings ctrl tab' },
  { group: 'Customization', id: 'desktop', label: 'Desktop integration', icon: mdiMonitor, keywords: 'autostart startup tray minimize close system version update updates' },
  { group: 'Import & export', id: 'import', label: 'Importer', icon: mdiImport, keywords: 'import markdown obsidian notesnook text html zip' },
  { group: 'Import & export', id: 'backup', label: 'Backup & export', icon: mdiBackupRestore, keywords: 'backup restore automatic export markdown text html zip attachments' },
  { group: 'Privacy & security', id: 'lock', label: 'App lock', icon: mdiLockOutline, keywords: 'app lock password idle inactivity screen' },
  { group: 'Privacy & security', id: 'vault', label: 'Vault', icon: mdiShieldLockOutline, keywords: 'vault locked notes lock note password' },
];

// ---- building blocks ----
const btn = (kind: 'plain' | 'primary' | 'danger' = 'plain') => ({
  padding: '6px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap' as const,
  border: kind === 'plain' ? '1px solid var(--border)' : 'none',
  backgroundColor: kind === 'primary' ? 'var(--primary)' : kind === 'danger' ? 'var(--error)' : 'transparent',
  color: kind === 'primary' ? 'var(--primary-fg)' : kind === 'danger' ? 'var(--bg-base)' : 'var(--text-main)',
});

function Row({ title, description, children }: { title: string; description?: ReactNode; children?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 24, padding: '14px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{title}</div>
        {description && <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.45 }}>{description}</div>}
      </div>
      {children && <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>{children}</div>}
    </div>
  );
}

const Heading = ({ children }: { children: ReactNode }) => (
  <div style={{ margin: '22px 0 2px', fontSize: 12, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--primary)' }}>{children}</div>
);

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
      {options.map(([v, label]) => (
        <button key={v} type="button" onClick={() => onChange(v)} style={{
          padding: '6px 12px', border: 'none', cursor: 'pointer', fontSize: 13,
          backgroundColor: v === value ? 'var(--secondary-container)' : 'transparent',
          color: v === value ? 'var(--on-secondary-container)' : 'var(--text-main)',
        }}>{label}</button>
      ))}
    </div>
  );
}

function Switch({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)}
      style={{ position: 'relative', width: 40, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer', padding: 0, backgroundColor: on ? 'var(--primary)' : 'var(--bg-surface-highest)' }}>
      <span style={{ position: 'absolute', top: 3, left: on ? 21 : 3, width: 16, height: 16, borderRadius: 8, transition: 'left 0.15s', backgroundColor: on ? 'var(--primary-fg)' : 'var(--text-muted)' }} />
    </button>
  );
}

// A small dialog over the settings (confirmations, the recovery key, the passphrase form).
function Modal({ title, children, onClose, width = 460 }: { title: string; children: ReactNode; onClose: () => void; width?: number }) {
  return (
    <div onMouseDown={onClose} style={{ position: 'fixed', inset: 0, zIndex: 31000, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.4)' }}>
      <div onMouseDown={(e) => e.stopPropagation()} style={{ width, maxWidth: 'calc(100vw - 32px)', padding: 20, borderRadius: 14, backgroundColor: 'var(--bg-surface-high)', border: '1px solid var(--border)', boxShadow: '0 12px 40px rgba(0,0,0,0.45)' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ flex: 1, fontSize: 17, fontWeight: 700 }}>{title}</span>
          <button type="button" title="Close" onClick={onClose} style={{ display: 'flex', border: 'none', background: 'transparent', color: 'var(--text-main)', cursor: 'pointer' }}>
            <Icon path={mdiClose} size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const field = { width: '100%', boxSizing: 'border-box' as const, padding: '8px 10px', marginBottom: 10, fontSize: 14, color: 'var(--text-main)', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, outline: 'none' };
const note = { fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 12 } as const;
const errorText = { fontSize: 13, color: 'var(--error)', marginBottom: 10 } as const;

const size = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

// ---- Account ----
function RecoveryKeyModal({ host, onClose }: { host: SettingsHost; onClose: () => void }) {
  const [key, setKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmNew, setConfirmNew] = useState(false);
  const [copied, setCopied] = useState(false);
  const load = (renew: boolean) => {
    setKey(null);
    setError(null);
    getRecoveryKey(host.masterKey, renew).then((k) => setKey(formatRecoveryKey(k)), (e) => setError(e instanceof Error ? e.message : String(e)));
  };
  useEffect(() => load(false), []);
  const fileText = key ? `Noted data recovery key\n\n${key}\n\nKeep it somewhere safe and offline. With this key a forgotten passphrase can be replaced (Unlock screen > "Forgot your passphrase?"). Anyone who has it can open your notes.\n` : '';
  return (
    <Modal title="Data recovery key" onClose={onClose} width={520}>
      <div style={note}>
        If you forget your passphrase, this key opens your notes and lets you set a new passphrase. Write it down or save it
        somewhere safe and offline. Anyone who has it can read your notes.
      </div>
      {error && <div style={errorText}>{error}</div>}
      <div style={{ padding: 14, borderRadius: 10, backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border)', fontFamily: 'monospace', fontSize: 16, lineHeight: 1.7, letterSpacing: '0.04em', textAlign: 'center', wordSpacing: 6, userSelect: 'all' }}>
        {key ? key.split('-').join(' ') : 'Loading…'}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
        <button type="button" disabled={!key} style={{ ...btn(), display: 'flex', alignItems: 'center', gap: 6 }} onClick={() => key && navigator.clipboard.writeText(key).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}>
          <Icon path={mdiContentCopy} size={15} /> {copied ? 'Copied' : 'Copy'}
        </button>
        <button type="button" disabled={!key} style={{ ...btn(), display: 'flex', alignItems: 'center', gap: 6 }} onClick={() => host.saveFile('noted-recovery-key.txt', fileText)}>
          <Icon path={mdiDownload} size={15} /> Save as file
        </button>
        <div style={{ flex: 1 }} />
        {confirmNew
          ? <button type="button" style={btn('danger')} onClick={() => { setConfirmNew(false); load(true); }}>Yes, replace it</button>
          : <button type="button" style={btn()} onClick={() => setConfirmNew(true)}>Create a new key</button>}
      </div>
      {confirmNew && <div style={{ ...note, marginTop: 10, marginBottom: 0 }}>A new key replaces this one: the old key stops working.</div>}
    </Modal>
  );
}

function ChangePassphraseModal({ host, onClose }: { host: SettingsHost; onClose: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const submit = async () => {
    setError(null);
    if (next.length < MIN_PASSPHRASE_LENGTH) return setError(`Use at least ${MIN_PASSPHRASE_LENGTH} characters.`);
    if (next !== repeat) return setError('The new passphrases do not match.');
    setBusy(true);
    try {
      const info = await fetchVault();
      if (!info) throw new Error('No vault found.');
      const salt = Uint8Array.from(atob(info.salt), (c) => c.charCodeAt(0));
      const dataKey = openWithPassphraseKey(info, await host.deriveKey(current, salt));
      if (!dataKey || dataKey.some((b, i) => b !== host.masterKey[i])) throw new Error('The current passphrase is wrong.');
      const newSalt = generateSalt();
      await changePassphrase(host.masterKey, newSalt, await host.deriveKey(next, newSalt));
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Change passphrase" onClose={onClose}>
      {done ? (
        <>
          <div style={note}>Done. New devices unlock with the new passphrase; this and your other devices stay unlocked.</div>
          <button type="button" style={btn('primary')} onClick={onClose}>Close</button>
        </>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <div style={note}>
            Your notes stay as they are (only the key that opens them is wrapped again). If you think someone knows the old
            passphrase, also log out the other devices.
          </div>
          <PasswordInput autoFocus placeholder="Current passphrase" value={current} onChange={setCurrent} style={field} />
          <PasswordInput placeholder="New passphrase" value={next} onChange={setNext} style={field} />
          <PasswordInput placeholder="Repeat the new passphrase" value={repeat} onChange={setRepeat} style={field} />
          {error && <div style={errorText}>{error}</div>}
          <button type="submit" disabled={busy} style={btn('primary')}>{busy ? 'Changing…' : 'Change passphrase'}</button>
        </form>
      )}
    </Modal>
  );
}

function AccountSection({ host }: { host: SettingsHost }) {
  const [vault, setVault] = useState<VaultInfo | null>(null);
  const [stats, setStats] = useState<AccountStats | null>(null);
  const [modal, setModal] = useState<'recovery' | 'passphrase' | 'logout' | 'logoutOthers' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reload = () => {
    fetchVault().then(setVault, () => setVault(null));
    fetchAccountStats(host.masterKey).then(setStats, () => setStats(null));
  };
  useEffect(reload, []);
  const logoutOthers = async () => {
    setBusy(true);
    try {
      host.onEpochChanged(await logoutOtherDevices(host.masterKey));
      setMessage('The other devices are logged out: they ask for the passphrase the next time they sync.');
      setModal(null);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '6px 0 18px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ width: 64, height: 64, borderRadius: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--bg-surface-high)' }}>
          <Icon path={mdiShieldKeyOutline} size={30} style={{ color: 'var(--primary)' }} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, color: 'var(--primary)' }}>End-to-end encrypted</div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Your vault</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            {host.serverUrl ? host.serverUrl.replace(/^https?:\/\//, '') : 'This device only'} • {vault?.createdAt ? `Created ${formatDateTime(vault.createdAt).slice(0, 10)}` : 'Created before settings existed'}
          </div>
          {stats && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              {stats.notes} notes ({size(stats.noteBytes)}) • {stats.blobs} images and files ({size(stats.blobBytes)}){stats.published ? ` • ${stats.published} published` : ''}
            </div>
          )}
        </div>
      </div>
      {message && <div style={{ ...note, marginTop: 12, color: 'var(--text-main)' }}>{message}</div>}
      <Row
        title="Save data recovery key"
        description={<>Save your data recovery key in a safe place. You will need it to recover your data in case you forget your passphrase.{' '}
          <span style={{ color: vault?.recoveryEnvelope ? 'var(--primary)' : 'var(--error)' }}>{vault ? (vault.recoveryEnvelope ? 'A key is set up.' : 'No key yet.') : ''}</span></>}
      >
        <button type="button" style={btn('primary')} onClick={() => setModal('recovery')}>{vault?.recoveryEnvelope ? 'Show' : 'Create'}</button>
      </Row>
      <Heading>Authentication</Heading>
      <Row title="Change passphrase" description="The passphrase that unlocks your notes on a new device.">
        <button type="button" style={btn()} onClick={() => setModal('passphrase')}>Change passphrase</button>
      </Row>
      <Heading>Sessions</Heading>
      <Row title="Log out" description="Removes the key from this device. Its notes stay here encrypted and come back when you unlock again.">
        <button type="button" style={btn('danger')} onClick={() => setModal('logout')}>Log out</button>
      </Row>
      {host.serverUrl && (
        <Row
          title="Log out from all other devices"
          description="Every other device has to enter the passphrase again. A device that someone else already unlocked keeps the notes it has stored."
        >
          <button type="button" style={btn('danger')} onClick={() => setModal('logoutOthers')}>Log out from all other devices</button>
        </Row>
      )}

      {modal === 'recovery' && <RecoveryKeyModal host={host} onClose={() => { setModal(null); reload(); }} />}
      {modal === 'passphrase' && <ChangePassphraseModal host={host} onClose={() => setModal(null)} />}
      {modal === 'logout' && (
        <Modal title="Log out?" onClose={() => setModal(null)}>
          <div style={note}>You will need the passphrase (or the recovery key) to unlock Noted on this device again.</div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" style={btn()} onClick={() => setModal(null)}>Cancel</button>
            <button type="button" style={btn('danger')} onClick={host.onLogout}>Log out</button>
          </div>
        </Modal>
      )}
      {modal === 'logoutOthers' && (
        <Modal title="Log out the other devices?" onClose={() => setModal(null)}>
          <div style={note}>They will ask for the passphrase the next time they connect. This device stays logged in.</div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" style={btn()} onClick={() => setModal(null)}>Cancel</button>
            <button type="button" disabled={busy} style={btn('danger')} onClick={logoutOthers}>{busy ? 'Logging out…' : 'Log them out'}</button>
          </div>
        </Modal>
      )}
    </>
  );
}

// ---- Sync ----
function SyncSection({ host }: { host: SettingsHost }) {
  // A sync usually takes a fraction of a second: the button shows it for a moment anyway,
  // then "Synced".
  const [phase, setPhase] = useState<'idle' | 'syncing' | 'done'>('idle');
  const [startedAt, setStartedAt] = useState(0);
  useEffect(() => {
    if (phase !== 'syncing' || host.syncing) return;
    const wait = setTimeout(() => setPhase('done'), Math.max(0, 700 - (Date.now() - startedAt)));
    return () => clearTimeout(wait);
  }, [phase, host.syncing]);
  useEffect(() => {
    if (phase !== 'done') return;
    const wait = setTimeout(() => setPhase('idle'), 2500);
    return () => clearTimeout(wait);
  }, [phase]);
  const busy = phase === 'syncing' || host.syncing;
  if (!host.serverUrl) return host.connectServer ? <ConnectServerRow connect={host.connectServer} /> : null;
  return (
    <>
      <Row title="Server" description={host.serverUrl}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-muted)' }}>
          <span style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: host.online ? '#3fb950' : 'var(--error)' }} />
          {host.online ? 'Connected' : 'Offline'}
        </span>
      </Row>
      <Row
        title="Sync now"
        description={<>Notes sync by themselves the moment they change (and every 30 seconds). This runs it at once.
          {host.lastSyncAt ? <> Last sync: <b>{formatDateTime(host.lastSyncAt).slice(11)}</b>.</> : null}</>}
      >
        <button type="button" disabled={busy} style={{ ...btn(phase === 'done' ? 'primary' : 'plain'), display: 'flex', alignItems: 'center', gap: 6, minWidth: 112, justifyContent: 'center' }}
          onClick={() => { setStartedAt(Date.now()); setPhase('syncing'); host.onSyncNow(); }}>
          <Icon path={phase === 'done' ? mdiCheck : mdiSync} size={16} style={busy ? { animation: 'noted-spin 0.9s linear infinite' } : undefined} />
          {busy ? 'Syncing…' : phase === 'done' ? 'Synced' : 'Sync now'}
        </button>
        <style>{'@keyframes noted-spin { to { transform: rotate(-360deg); } }'}</style>
      </Row>
      {host.findCleanup && host.runCleanup && <CleanupRow find={host.findCleanup} run={host.runCleanup} />}
    </>
  );
}

// A device without a server: notes stay here until the vault goes to a server.
function ConnectServerRow({ connect }: { connect: (base: string, setupCode: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setError(null);
    const base = normalizeServerUrl(address);
    if (!base) return setError('Enter the server address, e.g. https://notes.example.com or 100.64.0.1:3333.');
    setBusy(true);
    try {
      await connect(base, code);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Row title="Server" description="None: your notes are kept on this device only, so make backups (Backup & export). With a server of your own they sync between your devices.">
        <button type="button" style={btn('primary')} onClick={() => setOpen(true)}>Connect a server…</button>
      </Row>
      {open && (
        <Modal title="Connect a server" onClose={() => setOpen(false)}>
          <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <div style={note}>
              Your vault (the same passphrase and recovery key) moves to the server, then every note is uploaded, encrypted
              as always. A new server asks for the setup code from its log; a server that already holds this vault needs none.
            </div>
            <input autoFocus placeholder="https://notes.example.com" value={address} spellCheck={false} onChange={(e) => setAddress(e.target.value)} style={field} />
            <input placeholder="Setup code (new server only)" value={code} spellCheck={false} onChange={(e) => setCode(e.target.value)} style={{ ...field, fontFamily: 'monospace' }} />
            {error && <div style={errorText}>{error}</div>}
            <button type="submit" disabled={busy} style={btn('primary')}>{busy ? 'Connecting…' : 'Connect'}</button>
          </form>
        </Modal>
      )}
    </>
  );
}

function CleanupRow({ find, run }: { find: (includeRecent: boolean) => Promise<CleanupPlan>; run: (plan: CleanupPlan) => Promise<string> }) {
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
  return (
    <>
      <Row
        title="Clean up storage"
        description={<>Removes notes deleted for good (kept so far so no device brings them back) and images and files that no
          note, and no version in this computer's note history, uses. This computer's copy is cleaned too.
          {plan && <> <b>{nothing ? 'Nothing to clean up.' : `${plan.deletedNotes.length} deleted notes, ${plan.fileIds.length} files (${size(plan.fileBytes)}).`}</b></>}
          {message && <> <span style={{ color: 'var(--text-main)' }}>{message}</span></>}</>}
      >
        {plan && !nothing ? (
          <button type="button" disabled={busy} style={btn('danger')} onClick={() => work(async () => { setMessage(await run(plan)); setPlan(null); })}>{busy ? 'Cleaning…' : 'Clean up'}</button>
        ) : (
          <button type="button" disabled={busy} style={btn()} onClick={() => work(async () => setPlan(await find(recent)))}>{busy ? 'Checking…' : 'Check'}</button>
        )}
      </Row>
      <Row title="Also files added in the last 30 days" description="Normally they wait 30 days: another device may still be uploading a note that uses them, and backups without images rely on the server. Switch on when every device has synced.">
        <Switch on={recent} onChange={(on) => { setRecent(on); setPlan(null); }} />
      </Row>
    </>
  );
}

// ---- Appearance ----
function AppearanceSection({ host }: { host: SettingsHost }) {
  return (
    <>
      <Heading>Theme</Heading>
      <Row title="Theme" description="Auto follows the system: on Linux the colours of your wallpaper (matugen), light or dark as matugen is set.">
        <Segmented value={['auto', 'light', 'dark'].includes(host.themeMode) ? host.themeMode : ''} options={[['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']]} onChange={host.onThemeMode} />
      </Row>
      <div style={{ padding: '14px 0', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>Ready-made themes</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', margin: '4px 0 12px' }}>Instead of the wallpaper colours. Auto above goes back to matugen.</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
          {THEME_PRESETS.map((preset) => {
            const c = preset.colors;
            const active = host.themeMode === preset.id;
            return (
              <button key={preset.id} type="button" onClick={() => host.onThemeMode(preset.id)} title={preset.label} style={{
                padding: 0, borderRadius: 10, overflow: 'hidden', cursor: 'pointer', textAlign: 'left',
                border: active ? '2px solid var(--primary)' : '1px solid var(--border)', backgroundColor: c.background,
              }}>
                <div style={{ display: 'flex', gap: 5, padding: '10px 10px 6px' }}>
                  {[c.primary, c.on_surface, c.surface_container_highest, c.error].map((color, i) => (
                    <span key={i} style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: color, border: '1px solid rgba(127,127,127,0.3)' }} />
                  ))}
                </div>
                <div style={{ padding: '0 10px 9px', fontSize: 12, fontWeight: 600, color: c.on_surface }}>{preset.label}</div>
              </button>
            );
          })}
        </div>
      </div>
      <Heading>General</Heading>
      <Row title="Zoom factor" description="Zoom the whole app in or out (the note's own zoom is in the status bar).">
        <button type="button" style={btn()} onClick={() => host.onZoom(Math.max(0.5, Math.round((host.zoom - 0.1) * 10) / 10))}>−</button>
        <span style={{ width: 48, textAlign: 'center', fontSize: 13 }}>{Math.round(host.zoom * 100)}%</span>
        <button type="button" style={btn()} onClick={() => host.onZoom(Math.min(2, Math.round((host.zoom + 0.1) * 10) / 10))}>+</button>
        <button type="button" style={btn()} onClick={() => host.onZoom(1)}>Reset</button>
      </Row>
    </>
  );
}

// ---- Editor ----
const LANGUAGE_NAMES: Record<string, string> = {
  pl_PL: 'Polish', en_US: 'English (US)', en_GB: 'English (UK)', de_DE: 'German', fr_FR: 'French', es_ES: 'Spanish', it_IT: 'Italian',
};

// "HH:MM" field saved on Enter / leaving it; anything that is not a time goes back.
function ClockField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => {
    const clock = parseClock(text);
    if (!clock) return setText(value);
    const next = `${String(clock.hours).padStart(2, '0')}:${String(clock.minutes).padStart(2, '0')}`;
    setText(next);
    if (next !== value) onChange(next);
  };
  return (
    <input value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
      style={{ ...field, width: 70, marginBottom: 0, textAlign: 'center' }} />
  );
}

function EditorSection({ host }: { host: SettingsHost }) {
  const p = host.editorPrefs;
  const set = (patch: Partial<EditorPrefs>) => host.onEditorPrefs({ ...p, ...patch });
  const [template, setTemplate] = useState(p.titleTemplate);
  const [words, setWords] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (host.spellLanguages.length) host.getCustomWords().then((w) => setWords(w.join('\n')), () => setWords(''));
  }, []);
  return (
    <>
      <Heading>New notes</Heading>
      <Row title="Default title" description="Title for notes you leave without one, once they have text. $date$ and $time$ become the creation date and time. Empty = off.">
        <input value={template} placeholder="e.g. Note $date$ $time$" onChange={(e) => setTemplate(e.target.value)} onBlur={() => set({ titleTemplate: template.trim() })}
          onKeyDown={(e) => { if (e.key === 'Enter') set({ titleTemplate: template.trim() }); }}
          style={{ ...field, width: 230, marginBottom: 0 }} />
      </Row>
      <Heading>Reminders</Heading>
      <Row title="Morning" description="Time of “Tomorrow morning” and “Next Monday” in the reminder picker.">
        <ClockField value={p.reminderMorning} onChange={(reminderMorning) => set({ reminderMorning })} />
      </Row>
      <Row title="Evening" description="Time of “This evening”.">
        <ClockField value={p.reminderEvening} onChange={(reminderEvening) => set({ reminderEvening })} />
      </Row>
      <Heading>Text</Heading>
      <Row title="Default font" description="For notes without a font of their own.">
        <Segmented value={p.defaultFont} options={[['sans', 'Sans'], ['serif', 'Serif'], ['mono', 'Mono']]} onChange={(defaultFont) => set({ defaultFont })} />
      </Row>
      <Row title="Default font size" description="The base size of the text in every note.">
        <button type="button" style={btn()} onClick={() => set({ fontSize: Math.max(10, p.fontSize - 1) })}>−</button>
        <span style={{ width: 48, textAlign: 'center', fontSize: 13 }}>{p.fontSize}px</span>
        <button type="button" style={btn()} onClick={() => set({ fontSize: Math.min(32, p.fontSize + 1) })}>+</button>
        <button type="button" style={btn()} onClick={() => set({ fontSize: 16 })}>Reset</button>
      </Row>
      <Row title="Symbol ligatures" description="Typing -> gives →, <- ←, => ⇒, != ≠, <= ≤, >= ≥, ... … (not in code).">
        <Switch on={p.ligatures} onChange={(ligatures) => set({ ligatures })} />
      </Row>
      <Heading>Code blocks</Heading>
      <Row title="Code colours" description="Syntax colours of code blocks. The language is detected by itself; pick another under a block.">
        <Select value={p.codeTheme} width={200} options={CODE_THEMES.map((t) => [t.id, t.label] as [string, string])} onChange={(codeTheme) => set({ codeTheme })} />
      </Row>
      {Object.entries(p.codeThemeByLanguage).map(([lang, themeId]) => (
        <Row key={lang} title={codeLanguageLabel(lang)} description="Colours for this language only.">
          <Select value={themeId} width={180} options={CODE_THEMES.filter((t) => t.id !== 'app').map((t) => [t.id, t.label] as [string, string])}
            onChange={(id) => set({ codeThemeByLanguage: { ...p.codeThemeByLanguage, [lang]: id } })} />
          <button type="button" title="Remove" style={btn()} onClick={() => {
            const next = { ...p.codeThemeByLanguage };
            delete next[lang];
            set({ codeThemeByLanguage: next });
          }}>×</button>
        </Row>
      ))}
      {CODE_LANGUAGES.some(([id]) => !p.codeThemeByLanguage[id]) && (
        <Row title="Colours for one language" description="Another theme for, say, Python than for everything else.">
          <Select value="" width={200} options={[['', 'Add a language…'] as [string, string], ...CODE_LANGUAGES.filter(([id]) => !p.codeThemeByLanguage[id])]}
            onChange={(lang) => { if (lang) set({ codeThemeByLanguage: { ...p.codeThemeByLanguage, [lang]: 'github-dark' } }); }} />
        </Row>
      )}
      {host.onChooseDownloadFolder && (
        <>
          <Heading>Files</Heading>
          <Row title="Download folder" description={host.downloadFolder ? <>“Save” on an attachment or image puts it straight into <b>{host.downloadFolder}</b>.</> : '“Save” on an attachment or image asks where to put it every time.'}>
            <button type="button" style={btn()} onClick={() => host.onChooseDownloadFolder!()}>Choose…</button>
            {host.downloadFolder && <button type="button" style={btn()} onClick={() => host.onChooseDownloadFolder!(true)}>Ask every time</button>}
          </Row>
        </>
      )}
      <Heading>Spell check</Heading>
      <Row title="Spell check" description="Underlines misspelled words (each note can still turn it off in its properties).">
        <Switch on={p.spellcheck} onChange={(spellcheck) => set({ spellcheck })} />
      </Row>
      {host.spellLanguages.length === 0 ? (
        <Row title="Languages" description="No dictionaries are installed. On Arch: sudo pacman -S hunspell-pl hunspell-en_us, then restart Noted." />
      ) : (
        <>
          <Row title="Languages" description="Words are checked against every language ticked here.">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-end', maxWidth: 360 }}>
              {host.spellLanguages.map((lang) => {
                const on = p.spellLanguages.includes(lang);
                return (
                  <button key={lang} type="button" onClick={() => set({ spellLanguages: on ? p.spellLanguages.filter((l) => l !== lang) : [...p.spellLanguages, lang] })} style={{
                    ...btn(), backgroundColor: on ? 'var(--secondary-container)' : 'transparent', color: on ? 'var(--on-secondary-container)' : 'var(--text-main)',
                  }}>{LANGUAGE_NAMES[lang] ?? lang}</button>
                );
              })}
            </div>
          </Row>
          <div style={{ padding: '14px 0', borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Custom dictionary words</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', margin: '4px 0 8px' }}>One word per line; never marked as misspelled.</div>
            <textarea value={words ?? ''} disabled={words === null} rows={6} onChange={(e) => { setWords(e.target.value); setSaved(false); }}
              style={{ ...field, fontFamily: 'monospace', resize: 'vertical' }} />
            <button type="button" style={btn()} onClick={() => host.setCustomWords((words ?? '').split('\n')).then(() => setSaved(true))}>{saved ? 'Saved' : 'Save words'}</button>
          </div>
        </>
      )}
    </>
  );
}

// ---- Desktop integration ----
function DesktopSection({ host }: { host: SettingsHost }) {
  const d = host.desktop;
  if (!d) return <div style={note}>Not available here.</div>;
  const set = (patch: Partial<{ autostart: boolean; closeToTray: boolean; minimizeToTray: boolean }>) => d.onChange({ autostart: d.autostart, closeToTray: d.closeToTray, minimizeToTray: d.minimizeToTray, ...patch });
  return (
    <>
      <Row title="Start with the system" description="Noted opens when you log in.">
        <Switch on={d.autostart} onChange={(autostart) => set({ autostart })} />
      </Row>
      <Row title="Minimize to the system tray" description="Minimizing hides the window; the tray icon brings it back.">
        <Switch on={d.minimizeToTray} onChange={(minimizeToTray) => set({ minimizeToTray })} />
      </Row>
      <Row title="Close to the system tray" description="Closing the window keeps Noted running in the tray (Quit from the tray menu ends it).">
        <Switch on={d.closeToTray} onChange={(closeToTray) => set({ closeToTray })} />
      </Row>
      {host.version && (
        <Row title={`Noted ${host.version.current}`} description={host.version.onCheck ? 'Noted looks for a new version at start and twice a day.' : 'Built from source: updates come with the next build.'}>
          {host.version.onCheck && <button type="button" style={btn()} onClick={host.version.onCheck}>Check for updates</button>}
        </Row>
      )}
    </>
  );
}

// ---- App lock ----
function LockSection({ host }: { host: SettingsHost }) {
  const l = host.appLock;
  return (
    <>
      <Row title="App lock" description="Asks for the passphrase when Noted starts and after it was not used for a while. It hides your notes from people at the screen; the notes on this device stay readable to someone with the disk and the key (Log out removes the key).">
        <Switch on={l.enabled} onChange={(enabled) => host.onAppLock({ ...l, enabled })} />
      </Row>
      <Row title="Lock after" description="Time without using the app.">
        <Segmented value={String(l.minutes)} options={[['1', '1 min'], ['5', '5 min'], ['15', '15 min'], ['30', '30 min'], ['60', '1 h'], ['0', 'Only at start']]} onChange={(v) => host.onAppLock({ ...l, minutes: Number(v) })} />
      </Row>
      <Row title="Lock now">
        <button type="button" disabled={!l.enabled} style={btn()} onClick={host.onLockNow}>Lock now</button>
      </Row>
    </>
  );
}

// ---- Vault ----
function VaultSection({ host }: { host: SettingsHost }) {
  const v = host.vault;
  const [changing, setChanging] = useState(false);
  const [form, setForm] = useState({ current: '', next: '', repeat: '' });
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!v) return <div style={note}>Not available here.</div>;
  const change = async () => {
    if (form.next.length < 6) return setMessage('Use at least 6 characters.');
    if (form.next !== form.repeat) return setMessage('The new passwords do not match.');
    setBusy(true);
    const error = await v.onChangePassword(form.current, form.next);
    setBusy(false);
    setMessage(error ?? 'The vault password is changed.');
    if (!error) { setChanging(false); setForm({ current: '', next: '', repeat: '' }); }
  };
  return (
    <>
      <div style={{ ...note, marginTop: 8 }}>
        The vault is for notes that need a second lock: diaries, passwords, anything you would not want someone to read
        on an unlocked computer. A locked note keeps its title in the list, but its text is encrypted once more with the
        vault password and opens only after you enter it (until the vault or the app locks again).
      </div>
      <div style={{ ...note }}>
        <b>How to use it:</b> right-click a note in the list and choose <b>Lock (vault)</b>, or switch on <b>Lock</b> in the
        note's properties (⋮ in the tab bar). On the phone: the note's ⋮ menu. The first time you lock a note you choose the
        vault password. It cannot be recovered: the recovery key does not open the vault.
      </div>
      {message && <div style={{ ...note, color: 'var(--text-main)' }}>{message}</div>}
      {!v.exists ? (
        <Row title="Create the vault" description="Choose the vault password.">
          <button type="button" style={btn('primary')} onClick={v.onCreate}>Create vault</button>
        </Row>
      ) : (
        <>
          <Row title="Vault" description={v.open ? 'Open: locked notes can be read until Noted locks or closes.' : 'Closed.'}>
            {v.open && <button type="button" style={btn()} onClick={v.onLock}>Lock the vault</button>}
          </Row>
          <Row title="Change the vault password" description="The locked notes stay as they are; only the key that opens them is wrapped again.">
            <button type="button" style={btn()} onClick={() => setChanging((c) => !c)}>Change password</button>
          </Row>
          {changing && (
            <form onSubmit={(e) => { e.preventDefault(); change(); }} style={{ padding: '12px 0', maxWidth: 360 }}>
              <PasswordInput autoFocus placeholder="Current vault password" value={form.current} onChange={(current) => setForm((f) => ({ ...f, current }))} style={field} />
              <PasswordInput placeholder="New vault password" value={form.next} onChange={(next) => setForm((f) => ({ ...f, next }))} style={field} />
              <PasswordInput placeholder="Repeat the new password" value={form.repeat} onChange={(repeat) => setForm((f) => ({ ...f, repeat }))} style={field} />
              <button type="submit" disabled={busy} style={btn('primary')}>{busy ? 'Changing…' : 'Change password'}</button>
            </form>
          )}
        </>
      )}
    </>
  );
}

// ---- Import ----
// Like Notesnook's importer: pick (or drop) files, see them listed, start; then the progress,
// a log, and a summary with "Start over".
function ImportSection({ host }: { host: SettingsHost }) {
  const [source, setSource] = useState<ImportSource>('markdown');
  const [files, setFiles] = useState<ImportFile[]>([]);
  const [listOpen, setListOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(true);
  const [over, setOver] = useState(false);
  const [phase, setPhase] = useState<'select' | 'running' | 'done'>('select');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [log, setLog] = useState<string[]>([]);
  const [result, setResult] = useState<{ notes: number; skipped?: number; errors: string[] } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const info = IMPORT_SOURCES.find((s) => s.id === source)!;

  const add = async (from: 'files' | 'folder' | { paths: string[] }) => {
    if (!host.pickImportFiles || phase !== 'select') return;
    setMessage(null);
    try {
      const picked = await host.pickImportFiles(source, from);
      if (!picked) return;
      setFiles((prev) => {
        const seen = new Set(prev.map((f) => f.path));
        return [...prev, ...picked.filter((f) => !seen.has(f.path))];
      });
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };
  const start = async () => {
    if (!host.runImport || !files.length) return;
    setPhase('running');
    setLog([]);
    setProgress({ done: 0, total: 0 });
    const time = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`; };
    try {
      const r = await host.runImport(source, files, {
        log: (line) => setLog((l) => [...l, `[${time()}] ${line}`]),
        progress: (done, total) => setProgress({ done, total }),
      });
      setResult(r);
    } catch (e) {
      setResult({ notes: 0, errors: [e instanceof Error ? e.message : String(e)] });
    }
    setPhase('done');
  };
  const startOver = () => { setFiles([]); setResult(null); setLog([]); setPhase('select'); setListOpen(false); };

  useEffect(() => host.onFileDrop?.((e) => {
    setOver(e.type === 'over');
    if (e.type === 'drop' && e.paths.length) add({ paths: e.paths });
  }), [source, phase]);
  if (!host.pickImportFiles) return <div style={note}>Importing is done on the computer.</div>;
  const list = [...info.extensions, 'zip'].map((x) => `.${x}`);
  const box = { border: '1px solid var(--border)', borderRadius: 8 } as const;

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 24, padding: '8px 0 18px' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Select a notes app or format to import from</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>Notes are added; nothing you have is changed.</div>
        </div>
        <Select value={source} width={240} options={IMPORT_SOURCES.map((s) => [s.id, s.label] as [ImportSource, string])} onChange={(v) => { if (phase === 'select') { setSource(v); setMessage(null); } }} />
      </div>

      {phase === 'select' && (
        <>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Select {info.files}</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', margin: '4px 0 12px', lineHeight: 1.5 }}>{info.description}</div>
          <button
            type="button"
            onClick={() => add('files')}
            style={{
              display: 'block', width: '100%', padding: '28px 16px', borderRadius: 10, cursor: 'pointer', textAlign: 'center',
              border: `2px dashed ${over ? 'var(--primary)' : 'var(--border)'}`, backgroundColor: over ? 'var(--secondary-container)' : 'transparent',
              color: 'var(--text-main)',
            }}
          >
            <div style={{ fontSize: 15 }}>{over ? 'Drop to add' : 'Drag & drop files here, or click to select files'}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
              Only {list.slice(0, -1).join(', ')} files are supported. You can also select .zip files containing them, or drop a whole folder.
              Images and files next to a note come along when you pick its folder or zip.
            </div>
          </button>
          <div style={{ marginTop: 10 }}>
            <button type="button" onClick={() => add('folder')} style={{ padding: 0, border: 'none', background: 'transparent', color: 'var(--primary)', cursor: 'pointer', fontSize: 13, textDecoration: 'underline' }}>
              Or pick a folder…
            </button>
          </div>
          {files.length > 0 && (
            <div style={{ ...box, marginTop: 14 }}>
              <button type="button" onClick={() => setListOpen((o) => !o)} style={{ display: 'flex', alignItems: 'center', width: '100%', padding: '10px 12px', border: 'none', background: 'transparent', color: 'var(--text-main)', cursor: 'pointer', fontSize: 15, fontWeight: 700 }}>
                <span style={{ flex: 1, textAlign: 'left' }}>{files.length} file{files.length === 1 ? '' : 's'} selected</span>
                <Icon path={listOpen ? mdiChevronUp : mdiChevronDown} size={18} />
              </button>
              {listOpen && (
                <div style={{ maxHeight: 200, overflowY: 'auto', padding: '0 6px 8px' }}>
                  {files.map((f) => (
                    <div key={f.path} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px', fontSize: 13 }}>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.path}>{f.path}</span>
                      <button type="button" title="Remove" onClick={() => setFiles((l) => l.filter((x) => x !== f))} style={{ display: 'flex', border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', padding: 2 }}>
                        <Icon path={mdiClose} size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {files.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
              <button type="button" onClick={start} style={{ ...btn('primary'), padding: '8px 22px' }}>Start importing</button>
            </div>
          )}
          {message && <div style={{ ...note, marginTop: 14, color: 'var(--text-main)' }}>{message}</div>}
        </>
      )}

      {phase !== 'select' && (
        <>
          {phase === 'running' && (
            <>
              <div style={{ fontSize: 15, fontWeight: 700 }}>Processing {Math.min(progress.done, progress.total)} of {progress.total} file(s)</div>
            </>
          )}
          <div style={{ ...box, marginTop: 12 }}>
            <button type="button" onClick={() => setLogOpen((o) => !o)} style={{ display: 'flex', alignItems: 'center', width: '100%', padding: '10px 12px', border: 'none', background: 'transparent', color: 'var(--text-main)', cursor: 'pointer', fontSize: 15, fontWeight: 700 }}>
              <span style={{ flex: 1, textAlign: 'left' }}>Logs</span>
              <Icon path={logOpen ? mdiChevronUp : mdiChevronDown} size={18} />
            </button>
            {logOpen && (
              <pre style={{ margin: 0, padding: '0 12px 12px', maxHeight: 220, overflowY: 'auto', fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono, monospace)' }}>{log.join('\n')}</pre>
            )}
          </div>
          {phase === 'done' && result && (
            <div style={{ textAlign: 'center', marginTop: 18 }}>
              <Icon path={result.errors.length ? mdiAlertCircleOutline : mdiCheckCircleOutline} size={30} style={{ color: result.errors.length ? 'var(--error)' : 'var(--primary)' }} />
              <div style={{ fontSize: 14, marginTop: 10 }}>
                Import completed. {result.notes} note{result.notes === 1 ? '' : 's'} successfully imported.{result.skipped ? ` ${result.skipped} already in Noted (skipped).` : ''} {result.errors.length} error{result.errors.length === 1 ? '' : 's'} occurred.
              </div>
              {result.errors.map((e, i) => <div key={i} style={{ ...note, color: 'var(--error)', marginTop: 6 }}>{e}</div>)}
              <button type="button" onClick={startOver} style={{ marginTop: 14, padding: '6px 14px', border: 'none', background: 'transparent', color: 'var(--text-main)', cursor: 'pointer', fontSize: 14 }}>Start over</button>
            </div>
          )}
        </>
      )}
    </>
  );
}

// ---- Backup & export ----
// Date of a backup file from its name (noted-backup-2026-10-02-1430...).
const backupDate = (name: string): number | null => {
  const m = /noted-backup-(\d{4})-(\d\d)-(\d\d)-(\d\d)(\d\d)/.exec(name);
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime() : null;
};

function BackupSection({ host }: { host: SettingsHost }) {
  const [withAttachments, setWithAttachments] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  // The result of an action, shown under the row it came from (the top of the page may be
  // scrolled away).
  const [message, setMessage] = useState<{ at: string; text: string } | null>(null);
  // A backup opened for comparing.
  const [compare, setCompare] = useState<{ name: string; text: string; createdAt: number } | null>(null);
  const [files, setFiles] = useState<{ name: string; read: () => Promise<string> }[] | null>(null);
  const [exportFormat, setExportFormat] = useState<ExportAllFormat>('markdown');
  const loadFiles = () => { host.listBackups().then(setFiles, () => setFiles([])); };
  useEffect(loadFiles, [host.autoBackup.folder, host.autoBackup.last]);
  const run = async (label: string, work: () => Promise<string | null>) => {
    const at = ['backup', 'restore', 'server', 'export'].includes(label) ? label : 'files';
    setBusy(label);
    setMessage(null);
    try {
      const text = await work();
      setMessage(text ? { at, text } : null);
    } catch (e) {
      setMessage({ at, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };
  const openCompare = (name: string, text: string) => {
    let createdAt = backupDate(name) ?? Date.now();
    try { createdAt = JSON.parse(text).createdAt ?? createdAt; } catch { /* the compare view reports a broken file */ }
    setCompare({ name, text, createdAt });
  };
  const auto = host.autoBackup;
  const messageAt = (at: string) => (message?.at === at
    ? <div style={{ ...note, margin: '8px 0', padding: '8px 10px', borderRadius: 8, color: 'var(--text-main)', backgroundColor: 'var(--bg-surface-high)' }}>{message.text}</div>
    : null);

  return (
    <>
      <Heading>Backups</Heading>
      <Row title="Backup now" description="One file with all your notes, encrypted like on the server: it opens only with this vault's passphrase or recovery key.">
        <button type="button" disabled={!!busy} style={btn('primary')} onClick={() => run('backup', async () => {
          const { name, text } = await host.createBackup(withAttachments);
          return (await host.saveFile(name, text)) ? `Saved ${name}.` : null;
        })}>{busy === 'backup' ? 'Working…' : 'Backup now'}</button>
      </Row>
      {messageAt('backup')}
      <Row title="Include images and files" description="Makes the backup bigger, but complete without the server.">
        <Switch on={withAttachments} onChange={setWithAttachments} />
      </Row>
      <Row title="Restore or compare a backup" description="Opens a backup file next to your notes: see which notes differ and how, then restore or merge single notes, all of them, or return everything to that day.">
        <button type="button" disabled={!!busy} style={btn()} onClick={() => run('restore', async () => {
          const text = await host.openTextFile(['nbackup', 'json']);
          if (text !== null) openCompare('Picked file', text);
          return null;
        })}>Open backup…</button>
      </Row>
      {messageAt('restore')}
      {host.serverUrl && (
        <Row title="Set up the server from a backup" description="Only for a new or replaced server that has no vault yet: the vault comes back from the backup (same passphrase and recovery key), then all notes are uploaded.">
          <button type="button" disabled={!!busy} style={btn()} onClick={() => run('server', async () => {
            const text = await host.openTextFile(['nbackup', 'json']);
            return text === null ? null : host.setUpServer(text);
          })}>{busy === 'server' ? 'Working…' : 'Choose backup…'}</button>
        </Row>
      )}
      {host.serverUrl && messageAt('server')}
      <Heading>Automatic backups</Heading>
      <Row title="Automatic backups" description={`Made when Noted runs and one is due; the newest 10 are kept.${auto.last ? ` Last one: ${formatDateTime(auto.last)}.` : ''}`}>
        <Segmented value={auto.interval} options={[['off', 'Never'], ['daily', 'Daily'], ['weekly', 'Weekly']]} onChange={(interval) => host.onAutoBackup({ ...auto, interval })} />
      </Row>
      <Row title="Backup folder" description={auto.folder}>
        <button type="button" title="Open the folder" style={{ ...btn(), display: 'flex', alignItems: 'center', gap: 6 }} onClick={host.onOpenBackupFolder}>
          <Icon path={mdiFolderOpenOutline} size={16} /> Open
        </button>
        <button type="button" style={btn()} onClick={() => host.onChooseBackupFolder()}>Change…</button>
        <button type="button" title="Back to ~/Documents/Noted backups" style={btn()} onClick={() => host.onChooseBackupFolder(true)}>Default</button>
      </Row>
      <Row title="Automatic backups with images and files">
        <Switch on={auto.attachments} onChange={(attachments) => host.onAutoBackup({ ...auto, attachments })} />
      </Row>
      <div style={{ padding: '14px 0', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>Backups in the folder</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', margin: '4px 0 8px' }}>Compare one with your notes now.</div>
        {files === null ? <div style={note}>Reading the folder…</div> : files.length === 0 ? <div style={note}>None yet.</div> : files.map((f) => {
          const at = backupDate(f.name);
          return (
            <div key={f.name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
              <span style={{ flex: 1, fontSize: 13 }}>
                {at ? formatDateTime(at) : f.name}
                {f.name.includes('with-attachments') && <span style={{ color: 'var(--text-muted)' }}> • with images and files</span>}
              </span>
              <button type="button" disabled={!!busy} style={btn()} onClick={() => run(f.name, async () => { openCompare(f.name, await f.read()); return null; })}>
                {busy === f.name ? 'Opening…' : 'Compare…'}
              </button>
            </div>
          );
        })}
        {messageAt('files')}
      </div>
      <Heading>Export</Heading>
      <Row title="Export all notes" description="A zip of readable files (not encrypted), one per note, in folders by notebook. The trash is left out.">
        <Select value={exportFormat} options={[['markdown', 'Markdown'], ['text', 'Text'], ['html', 'HTML']]} onChange={setExportFormat} />
        <button type="button" disabled={!!busy} style={btn('primary')} onClick={() => run('export', async () => {
          const { name, zip, count } = await host.exportAll(exportFormat);
          return (await host.saveFile(name, zip)) ? `Exported ${count} notes to ${name}.` : null;
        })}>{busy === 'export' ? 'Exporting…' : 'Export'}</button>
      </Row>
      {messageAt('export')}
      {compare && (
        <BackupCompare
          name={compare.name}
          createdAt={compare.createdAt}
          titles={host.noteTitles}
          load={() => host.compareBackup(compare.text)}
          onRestoreNote={(id, mode) => host.restoreBackupNote(compare.text, id, mode)}
          onRestoreAll={async (mode) => {
            const r = await host.restoreBackup(compare.text, mode);
            return `Done: ${r.added} notes brought back, ${r.merged} ${mode === 'merge' ? 'merged' : 'restored'}${r.trashed ? `, ${r.trashed} newer notes moved to the trash` : ''}${r.blobs ? `, ${r.blobs} images and files` : ''}.`;
          }}
          onClose={() => setCompare(null)}
        />
      )}
    </>
  );
}

// The toolbars: the normal one, and the table and drawing menus (when the host has them).
function ToolbarSection({ host, initialTab }: { host: SettingsHost; initialTab: 'normal' | 'table' | 'drawing' }) {
  const [tab, setTab] = useState<'normal' | 'table' | 'drawing'>(host.onTableToolbarConfig ? initialTab : 'normal');
  const options: ['normal' | 'table' | 'drawing', string][] = [['normal', 'Normal']];
  if (host.onTableToolbarConfig) options.push(['table', 'Table menu']);
  if (host.onDrawingToolbarConfig) options.push(['drawing', 'Drawing menu']);
  return (
    <>
      {options.length > 1 && (
        <div style={{ marginBottom: 6 }}>
          <Segmented value={tab} options={options} onChange={setTab} />
        </div>
      )}
      {tab === 'normal'
        ? <ToolbarSettings key="normal" platform={host.toolbarPlatform} config={host.toolbarConfig} onChange={host.onToolbarConfig} />
        : tab === 'table'
          ? <ToolbarSettings key="table" platform="desktopTable" config={host.tableToolbarConfig ?? null} onChange={(c) => host.onTableToolbarConfig?.(c)} />
          : <ToolbarSettings key="drawing" platform="desktopDrawing" config={host.drawingToolbarConfig ?? null} onChange={(c) => host.onDrawingToolbarConfig?.(c)} />}
    </>
  );
}

export function SettingsDialog({ host, initial = 'account', initialToolbarTab = 'normal', onClose }: {
  host: SettingsHost;
  initial?: SectionId;
  initialToolbarTab?: 'normal' | 'table' | 'drawing';
  onClose: () => void;
}) {
  const [section, setSection] = useState<SectionId>(initial);
  const [query, setQuery] = useState('');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? SECTIONS.filter((s) => `${s.label} ${s.keywords}`.toLowerCase().includes(q)) : SECTIONS;
  }, [query]);
  useEffect(() => {
    if (shown.length && !shown.some((s) => s.id === section)) setSection(shown[0].id);
  }, [shown]);
  const current = SECTIONS.find((s) => s.id === section)!;

  return (
    <div onMouseDown={onClose} style={{ position: 'fixed', inset: 0, zIndex: 30000, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)' }}>
      <div onMouseDown={(e) => e.stopPropagation()} style={{ display: 'flex', width: 'min(1100px, calc(100vw - 48px))', height: 'min(760px, calc(100vh - 48px))', borderRadius: 14, overflow: 'hidden', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border)', boxShadow: '0 16px 48px rgba(0,0,0,0.5)' }}>
        <nav style={{ width: 290, flexShrink: 0, padding: 8, overflowY: 'auto', backgroundColor: 'var(--bg-surface-low)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px', height: 38, margin: '0 0 6px', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-muted)' }}>
            <Icon path={mdiMagnify} size={16} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', color: 'var(--text-main)', fontSize: 14 }} />
          </div>
          {shown.map((s, i) => (
            <div key={s.id}>
              {(i === 0 || shown[i - 1].group !== s.group) && <div style={{ padding: '14px 10px 6px', fontSize: 12, fontWeight: 700 }}>{s.group}</div>}
              <button type="button" onClick={() => setSection(s.id)} style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 12px', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 15, textAlign: 'left',
                backgroundColor: s.id === section ? 'var(--secondary-container)' : 'transparent',
                color: s.id === section ? 'var(--on-secondary-container)' : 'var(--text-main)',
              }}>
                <Icon path={s.icon} size={18} /> {s.label}
              </button>
            </div>
          ))}
          {shown.length === 0 && <div style={{ padding: 12, fontSize: 13, color: 'var(--text-muted)' }}>Nothing matches.</div>}
        </nav>
        <main style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '18px 32px 40px' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ flex: 1, fontSize: 20, fontWeight: 700 }}>{current.label}</span>
            <button type="button" title="Close (Esc)" onClick={onClose} style={{ display: 'flex', padding: 6, border: 'none', borderRadius: 8, background: 'transparent', color: 'var(--text-main)', cursor: 'pointer' }}>
              <Icon path={mdiClose} size={20} />
            </button>
          </div>
          {section === 'account' && <AccountSection host={host} />}
          {section === 'sync' && <SyncSection host={host} />}
          {section === 'appearance' && <AppearanceSection host={host} />}
          {section === 'editor' && <EditorSection host={host} />}
          {section === 'toolbar' && <ToolbarSection host={host} initialTab={initialToolbarTab} />}
          {section === 'shortcuts' && (host.shortcuts
            ? <ShortcutSettings overrides={host.shortcuts.overrides} onChange={host.shortcuts.onChange} />
            : <div style={note}>Not available here.</div>)}
          {section === 'desktop' && <DesktopSection host={host} />}
          {section === 'backup' && <BackupSection host={host} />}
          {section === 'import' && <ImportSection host={host} />}
          {section === 'lock' && <LockSection host={host} />}
          {section === 'vault' && <VaultSection host={host} />}
        </main>
      </div>
    </div>
  );
}
