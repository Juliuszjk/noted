import * as Y from 'yjs';
import { generateKey, seal, unseal, unwrapKey, wrapKey } from '@noted/crypto';
import { getNoteSettings } from './note-meta';
import { noteBodyJson } from './doc-json';
import { setNoteBodyJson } from './json-to-y';

// Locked notes (Notesnook's "vault"). The vault has its own password. A random vault key is
// wrapped by Argon2id(password, salt) and kept in the catalog note (Y.Map "vault"), so
// changing the password re-wraps one key. A locked note keeps its title; its body moves out
// of the CRDT into one value sealed with the vault key (settings "locked"): edits made while
// it is open replace that value (last writer wins, like Notesnook), and the server and anyone
// without the vault password see only the title.

export interface VaultSetup {
  salt: string;
  wrapped: string;
}

const vaultMap = (catalog: Y.Doc) => catalog.getMap<unknown>('vault');

export const getVaultSetup = (catalog: Y.Doc): VaultSetup | null => {
  const salt = vaultMap(catalog).get('salt');
  const wrapped = vaultMap(catalog).get('wrapped');
  return typeof salt === 'string' && typeof wrapped === 'string' ? { salt, wrapped } : null;
};

// New vault: returns its key. `passwordKey` = Argon2id(password, salt).
export const createVault = (catalog: Y.Doc, saltBase64: string, passwordKey: Uint8Array): Uint8Array => {
  const vaultKey = generateKey();
  catalog.transact(() => {
    vaultMap(catalog).set('salt', saltBase64);
    vaultMap(catalog).set('wrapped', wrapKey(passwordKey, vaultKey));
    vaultMap(catalog).set('createdAt', Date.now());
  });
  return vaultKey;
};

export const openVault = (setup: VaultSetup, passwordKey: Uint8Array): Uint8Array | null => unwrapKey(passwordKey, setup.wrapped);

export const changeVaultPassword = (catalog: Y.Doc, vaultKey: Uint8Array, saltBase64: string, passwordKey: Uint8Array): void => {
  catalog.transact(() => {
    vaultMap(catalog).set('salt', saltBase64);
    vaultMap(catalog).set('wrapped', wrapKey(passwordKey, vaultKey));
  });
};

export const isNoteLocked = (doc: Y.Doc): boolean => typeof getNoteSettings(doc).get('locked') === 'string';

type Json = ReturnType<typeof noteBodyJson>;

export const readLockedBody = (doc: Y.Doc, vaultKey: Uint8Array): Json | null => {
  const sealed = getNoteSettings(doc).get('locked');
  if (typeof sealed !== 'string') return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(unseal(vaultKey, sealed)));
    return data?.v === 1 && data.body ? data.body : null;
  } catch {
    return null;
  }
};

export const writeLockedBody = (doc: Y.Doc, vaultKey: Uint8Array, body: Json, origin?: unknown): void => {
  doc.transact(() => getNoteSettings(doc).set('locked', seal(vaultKey, new TextEncoder().encode(JSON.stringify({ v: 1, body })))), origin);
};

// Locks a note: the body is sealed and removed from the document.
export const lockNote = (doc: Y.Doc, vaultKey: Uint8Array, origin?: unknown): void => {
  if (isNoteLocked(doc)) return;
  doc.transact(() => {
    writeLockedBody(doc, vaultKey, noteBodyJson(doc));
    const body = doc.getXmlFragment('default');
    if (body.length) body.delete(0, body.length);
  }, origin);
};

// Removes the lock: the body goes back into the document.
export const unlockNote = (doc: Y.Doc, vaultKey: Uint8Array, origin?: unknown): boolean => {
  const body = readLockedBody(doc, vaultKey);
  if (!body) return false;
  doc.transact(() => {
    setNoteBodyJson(doc, body);
    getNoteSettings(doc).delete('locked');
  }, origin);
  return true;
};
