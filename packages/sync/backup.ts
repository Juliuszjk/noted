import * as Y from 'yjs';
import { bytesToBase64, base64ToBytes, seal, unseal } from '@noted/crypto';
import type { LocalNoteStore } from './engine';
import type { LocalBlobStore } from './blobs';
import { fetchSealedBlob } from './blobs';
import { docFromSealed, sealDoc } from './doc';
import { buildNoteMeta, encodeNoteMeta, getTitleText, setTitle, getNoteSettings, getNoteTagMap, getNoteNotebookMap, isNoteDeleted, setNoteTrashed } from './note-meta';
import { isSystemNote } from './catalog';
import { noteBodyJson, noteBlobIds } from './doc-json';
import { fetchBackupVault } from './account';
import type { BackupVault } from './account';

// Backups (Settings > Backup & export): every note as it is stored, i.e. already encrypted
// with the vault's data key, optionally with the encrypted images and attachments. A backup
// opens only with the same vault (passphrase or recovery key), never in plain text. Restoring
// merges each note with the local one or replaces its content with the backup's; a backup can
// also be compared with the notes now and restored note by note.

const CHECK = 'noted-backup-v1';

export interface BackupFile {
  format: 'noted-backup';
  v: 1;
  createdAt: number;
  // Proves the backup belongs to this vault's key before anything is merged.
  check: string;
  notes: { id: string; content: string; yjs_state: string; updated_at: number }[];
  // Sealed blobs, base64 (only "with attachments").
  blobs?: { id: string; data: string }[];
  // The vault (salt, sealed keys) for setting up a new server; absent in older backups and
  // in backups made offline.
  vault?: BackupVault;
}

// The vault of a backup, readable without any key (it holds nothing secret in plain text).
export const backupVault = (text: string): BackupVault | null => {
  try {
    const file = JSON.parse(text) as BackupFile;
    const v = file?.format === 'noted-backup' ? file.vault : undefined;
    return v && typeof v.salt === 'string' && typeof v.verifier === 'string' ? v : null;
  } catch {
    return null;
  }
};

export const createBackup = async (
  masterKey: Uint8Array, store: LocalNoteStore, options: { blobs?: LocalBlobStore; vault?: BackupVault | null } = {},
): Promise<string> => {
  const notes = (await store.getAll()).filter((n) => n.yjs_state && n.yjs_state.includes('.'))
    .map((n) => ({ id: n.id, content: n.content ?? '', yjs_state: n.yjs_state!, updated_at: n.updated_at }));
  const file: BackupFile = { format: 'noted-backup', v: 1, createdAt: Date.now(), check: seal(masterKey, new TextEncoder().encode(CHECK)), notes };
  const vault = options.vault !== undefined ? options.vault : await fetchBackupVault(masterKey).catch(() => null);
  if (vault) file.vault = vault;
  if (options.blobs) {
    const ids = new Set<string>();
    for (const n of notes) {
      try {
        for (const id of noteBlobIds(noteBodyJson(docFromSealed(masterKey, n.yjs_state)))) ids.add(id);
      } catch {
        // A note this key cannot open (should not happen) is kept as it is, without blobs.
      }
    }
    file.blobs = [];
    for (const id of ids) {
      const sealed = await fetchSealedBlob(masterKey, options.blobs, id).catch(() => null);
      if (sealed) file.blobs.push({ id, data: bytesToBase64(sealed) });
    }
  }
  return JSON.stringify(file);
};

export interface RestoreResult {
  added: number;
  merged: number;
  blobs: number;
  // Rollback: notes made after the backup, moved to the trash.
  trashed: number;
}

// "replace": the note gets the backup's text, title, notebooks, tags and settings again, as a
// new edit (so it syncs and wins over later changes). "merge": both versions together: later
// edits stay, and blocks (paragraphs, images, list items...) removed since the backup come
// back. "rollback" (whole backup only): replace, and notes made after the backup go to the trash.
export type RestoreMode = 'merge' | 'replace' | 'rollback';

const replaceMap = <T,>(target: Y.Map<T>, source: Y.Map<T>) => {
  for (const key of [...target.keys()]) if (!source.has(key)) target.delete(key);
  for (const [key, value] of source.entries()) {
    if (JSON.stringify(target.get(key)) !== JSON.stringify(value)) target.set(key, (value instanceof Y.AbstractType ? value.toJSON() : value) as T);
  }
};

const replaceBody = (doc: Y.Doc, from: Y.Doc) => {
  const body = doc.getXmlFragment('default');
  body.delete(0, body.length);
  body.insert(0, from.getXmlFragment('default').toArray().map((node) => (node as Y.XmlElement | Y.XmlText).clone()));
};

const replaceWith = (doc: Y.Doc, backup: Y.Doc) => {
  doc.transact(() => {
    replaceBody(doc, backup);
    setTitle(doc, getTitleText(backup).toString());
    replaceMap(getNoteSettings(doc), getNoteSettings(backup));
    replaceMap(getNoteTagMap(doc), getNoteTagMap(backup));
    replaceMap(getNoteNotebookMap(doc), getNoteNotebookMap(backup));
  });
};

export { mergeWithBackup } from './merge-backup';
import { mergeWithBackup } from './merge-backup';

export const openBackup = (masterKey: Uint8Array, text: string): BackupFile => {
  let file: BackupFile;
  try {
    file = JSON.parse(text);
  } catch {
    throw new Error('This is not a Noted backup file.');
  }
  if (file?.format !== 'noted-backup' || !Array.isArray(file.notes)) throw new Error('This is not a Noted backup file.');
  try {
    if (new TextDecoder().decode(unseal(masterKey, file.check)) !== CHECK) throw new Error();
  } catch {
    throw new Error('This backup belongs to another vault (a different key).');
  }
  return file;
};

const hasDoc = (n: { yjs_state?: string | null } | undefined): n is { yjs_state: string } => !!n?.yjs_state && n.yjs_state.includes('.');

// One note of the backup into the store: 'added', 'changed' or null (nothing to do).
const restoreOne = async (
  masterKey: Uint8Array, note: BackupFile['notes'][number], existing: { yjs_state?: string | null } | undefined, store: LocalNoteStore, mode: RestoreMode,
): Promise<'added' | 'changed' | null> => {
  let doc = docFromSealed(masterKey, note.yjs_state);
  let outcome: 'added' | 'changed' = 'added';
  if (hasDoc(existing)) {
    const current = docFromSealed(masterKey, existing.yjs_state);
    const before = Y.snapshot(current);
    // The catalog (notebook / tag names, the vault) is always merged.
    if (mode === 'merge' || isSystemNote(note.id)) mergeWithBackup(current, doc);
    else replaceWith(current, doc);
    if (Y.equalSnapshots(before, Y.snapshot(current))) return null;
    doc = current;
    outcome = 'changed';
  }
  const content = seal(masterKey, new TextEncoder().encode(encodeNoteMeta(buildNoteMeta(doc))));
  await store.save(note.id, content, sealDoc(masterKey, doc), Date.now());
  return outcome;
};

const restoreBlobs = async (file: BackupFile, blobs: LocalBlobStore | undefined, ids?: Set<string>): Promise<number> => {
  let count = 0;
  for (const blob of file.blobs ?? []) {
    if (!blobs || (ids && !ids.has(blob.id)) || await blobs.get(blob.id)) continue;
    // Not marked uploaded: the next sync sends those the server lacks (write-once ids).
    await blobs.put(blob.id, base64ToBytes(blob.data), false);
    count++;
  }
  return count;
};

export const restoreBackup = async (
  masterKey: Uint8Array, text: string, store: LocalNoteStore, blobs?: LocalBlobStore, mode: RestoreMode = 'merge',
): Promise<RestoreResult> => {
  const file = openBackup(masterKey, text);
  const local = new Map((await store.getAll()).map((n) => [n.id, n]));
  const result: RestoreResult = { added: 0, merged: 0, blobs: 0, trashed: 0 };
  for (const note of file.notes) {
    const outcome = await restoreOne(masterKey, note, local.get(note.id), store, mode);
    if (outcome === 'added') result.added++;
    else if (outcome === 'changed') result.merged++;
  }
  if (mode === 'rollback') {
    const inBackup = new Set(file.notes.map((n) => n.id));
    for (const n of local.values()) {
      if (inBackup.has(n.id) || isSystemNote(n.id) || !hasDoc(n)) continue;
      const doc = docFromSealed(masterKey, n.yjs_state);
      if (isNoteDeleted(doc) || getNoteSettings(doc).get('trashedAt')) continue;
      setNoteTrashed(doc, true);
      const content = seal(masterKey, new TextEncoder().encode(encodeNoteMeta(buildNoteMeta(doc))));
      await store.save(n.id, content, sealDoc(masterKey, doc), Date.now());
      result.trashed++;
    }
  }
  result.blobs = await restoreBlobs(file, blobs);
  return result;
};

// ---- comparing a backup with the notes now ----

export type BackupDiffStatus =
  // In the backup, not here (or deleted for good here).
  | 'missing'
  // Here and in the backup, with different text, title, notebooks or tags.
  | 'changed'
  // In the backup, in the trash here.
  | 'trashed'
  // Made after the backup.
  | 'new';

export interface BackupDiff {
  id: string;
  status: BackupDiffStatus;
  title: string;
  // Both versions as Yjs states (null where the note does not exist).
  backup: Uint8Array | null;
  current: Uint8Array | null;
  backupTitle: string;
  currentTitle: string;
  // Last change of the note here (or in the backup when it is not here).
  updatedAt: number;
}

const compareKey = (doc: Y.Doc) => JSON.stringify([
  noteBodyJson(doc), getTitleText(doc).toString(), [...getNoteTagMap(doc).keys()].sort(), [...getNoteNotebookMap(doc).keys()].sort(),
]);

// Every note that differs between the backup and now, most recently changed first.
export const compareBackup = async (masterKey: Uint8Array, file: BackupFile, store: LocalNoteStore): Promise<BackupDiff[]> => {
  const local = new Map((await store.getAll()).map((n) => [n.id, n]));
  const out: BackupDiff[] = [];
  const inBackup = new Set<string>();
  for (const note of file.notes) {
    inBackup.add(note.id);
    if (isSystemNote(note.id)) continue;
    const backup = docFromSealed(masterKey, note.yjs_state);
    if (isNoteDeleted(backup)) continue;
    const existing = local.get(note.id);
    const current = hasDoc(existing) ? docFromSealed(masterKey, existing.yjs_state) : null;
    const backupTitle = getTitleText(backup).toString();
    const base = { id: note.id, backup: Y.encodeStateAsUpdate(backup), backupTitle, updatedAt: (existing as { updated_at?: number } | undefined)?.updated_at ?? note.updated_at };
    if (!current || isNoteDeleted(current)) {
      out.push({ ...base, status: 'missing', title: backupTitle, current: null, currentTitle: '' });
      continue;
    }
    const currentTitle = getTitleText(current).toString();
    const trashedNow = !!getNoteSettings(current).get('trashedAt') && !getNoteSettings(backup).get('trashedAt');
    if (!trashedNow && compareKey(current) === compareKey(backup)) continue;
    out.push({ ...base, status: trashedNow ? 'trashed' : 'changed', title: currentTitle || backupTitle, current: Y.encodeStateAsUpdate(current), currentTitle });
  }
  for (const n of local.values()) {
    if (inBackup.has(n.id) || isSystemNote(n.id) || !hasDoc(n)) continue;
    const current = docFromSealed(masterKey, n.yjs_state);
    if (isNoteDeleted(current) || getNoteSettings(current).get('trashedAt')) continue;
    const currentTitle = getTitleText(current).toString();
    const body = noteBodyJson(current);
    if (!currentTitle && !body.content?.length) continue;
    out.push({ id: n.id, status: 'new', title: currentTitle, backup: null, current: Y.encodeStateAsUpdate(current), backupTitle: '', currentTitle, updatedAt: n.updated_at });
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
};

// One note from the backup: "replace" (as in the backup) or "merge" (both versions together).
export const restoreBackupNote = async (
  masterKey: Uint8Array, file: BackupFile, id: string, store: LocalNoteStore, blobs: LocalBlobStore | undefined, mode: 'merge' | 'replace',
): Promise<boolean> => {
  const note = file.notes.find((n) => n.id === id);
  if (!note) return false;
  const existing = (await store.getAll()).find((n) => n.id === id);
  const outcome = await restoreOne(masterKey, note, existing, store, mode);
  try {
    await restoreBlobs(file, blobs, new Set(noteBlobIds(noteBodyJson(docFromSealed(masterKey, note.yjs_state)))));
  } catch {
    // The note is restored; its images come from the server as usual.
  }
  return outcome !== null;
};

export const backupFileName = (at = new Date(), attachments = false): string => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `noted-backup-${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}${attachments ? '-with-attachments' : ''}.nbackup`;
};
