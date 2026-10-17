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

  it('seals drawings with the body and brings them back', () => {
    const drawing = {
      type: 'doc',
      content: [{ type: 'drawing', attrs: { height: 300 }, content: [
        { type: 'drawingStroke', attrs: { points: '1:AgQG', color: 'var(--c-red)', size: 5, tool: 'pen' } },
        { type: 'drawingStroke', attrs: { points: '1:CAoM', color: null, size: 8, tool: 'highlighter' } },
      ] }],
    };
    const doc = new Y.Doc();
    setNoteBodyJson(doc, drawing);
    const vk = generateKey();
    lockNote(doc, vk);
    expect(doc.getXmlFragment('default').length).toBe(0);
    expect(unlockNote(doc, vk)).toBe(true);
    const back = noteBodyJson(doc);
    expect(back.content?.[0].content?.map((s) => s.attrs?.points)).toEqual(['1:AgQG', '1:CAoM']);
    expect(back.content?.[0].content?.[0].attrs).toMatchObject({ color: 'var(--c-red)', size: 5, tool: 'pen' });
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
