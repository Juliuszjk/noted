import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { generateKey, seal, unseal } from '@noted/crypto';
import { applyEditorUpdate } from './bridge';

const textOf = (key: Uint8Array, sealed: string): string => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, unseal(key, sealed));
  return doc.getText('t').toString();
};

describe('applyEditorUpdate', () => {
  it('keeps changes that sync stored while the editor was open', () => {
    const key = generateKey();
    const base = new Y.Doc();
    base.getText('t').insert(0, 'hello');
    const s0 = seal(key, Y.encodeStateAsUpdate(base));

    // The editor opens on s0 and the user types.
    const editorDoc = new Y.Doc();
    Y.applyUpdate(editorDoc, unseal(key, s0));
    let captured: Uint8Array | undefined;
    editorDoc.on('update', (u: Uint8Array) => { captured = u; });
    editorDoc.getText('t').insert(5, ' phone');

    // Meanwhile sync stored a version with an edit made on the desktop.
    const desktop = new Y.Doc();
    Y.applyUpdate(desktop, unseal(key, s0));
    desktop.getText('t').insert(0, '>> ');
    const s1 = seal(key, Y.encodeStateAsUpdate(desktop));

    const result = applyEditorUpdate(key, s1, captured!);
    expect(result.changed).toBe(true);
    expect(textOf(key, result.sealed!)).toBe('>> hello phone');
  });

  it('reports no change for an update the state already contains', () => {
    const key = generateKey();
    const doc = new Y.Doc();
    let captured: Uint8Array | undefined;
    doc.on('update', (u: Uint8Array) => { captured = u; });
    doc.getText('t').insert(0, 'abc');
    const sealed = seal(key, Y.encodeStateAsUpdate(doc));

    const result = applyEditorUpdate(key, sealed, captured!);
    expect(result.changed).toBe(false);
    expect(result.sealed).toBe(sealed);
  });

  it('creates a state when the note had none', () => {
    const key = generateKey();
    const doc = new Y.Doc();
    let captured: Uint8Array | undefined;
    doc.on('update', (u: Uint8Array) => { captured = u; });
    doc.getText('t').insert(0, 'first');

    const result = applyEditorUpdate(key, null, captured!);
    expect(result.changed).toBe(true);
    expect(textOf(key, result.sealed!)).toBe('first');
  });
});
