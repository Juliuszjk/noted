import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { generateKey } from '@noted/crypto';
import { createVault, getVaultSetup, openVault, changeVaultPassword, lockNote, unlockNote, readLockedBody, writeLockedBody, isNoteLocked } from './locked';
import { noteBodyJson } from './doc-json';
import { setNoteBodyJson } from './json-to-y';
import { buildNoteMeta, setTitle } from './note-meta';

const body = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'secret words' }] }] };

describe('locked notes', () => {
  it('creates a vault and changes its password without losing the key', () => {
    const catalog = new Y.Doc();
    const pw = generateKey();
    const vk = createVault(catalog, 'salt', pw);
    expect(openVault(getVaultSetup(catalog)!, pw)).toEqual(vk);
    expect(openVault(getVaultSetup(catalog)!, generateKey())).toBeNull();
    const pw2 = generateKey();
    changeVaultPassword(catalog, vk, 'salt2', pw2);
    expect(openVault(getVaultSetup(catalog)!, pw2)).toEqual(vk);
    expect(openVault(getVaultSetup(catalog)!, pw)).toBeNull();
  });

  it('locks, edits and unlocks a note; the meta shows no text', () => {
    const doc = new Y.Doc();
    setTitle(doc, 'Diary');
    setNoteBodyJson(doc, body);
    const vk = generateKey();
    lockNote(doc, vk);
    expect(isNoteLocked(doc)).toBe(true);
    expect(noteBodyJson(doc).content).toEqual([]);
    const meta = buildNoteMeta(doc);
    expect(meta).toMatchObject({ title: 'Diary', excerpt: '', locked: true });
    expect(readLockedBody(doc, vk)).toEqual(body);
    expect(readLockedBody(doc, generateKey())).toBeNull();
    const edited = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'more' }] }] };
    writeLockedBody(doc, vk, edited);
    expect(unlockNote(doc, vk)).toBe(true);
    expect(isNoteLocked(doc)).toBe(false);
    expect(noteBodyJson(doc)).toEqual(edited);
  });
});
