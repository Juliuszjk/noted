import * as Y from 'yjs';
import * as SecureStore from 'expo-secure-store';
import { createLiveOwner, docFromSealed, LIVE_ORIGIN } from '@noted/sync';
import type { LiveOwner, LocalNoteStore } from '@noted/sync';
import { updateNoteRecord } from './note-actions';

// Live published notes on the phone (sync/live-owner.ts). NotesScreen creates the owner with
// the WebSocket; the open note's EditorScreen sends its edits and cursors through it and is
// told when guests changed a note (it then merges the stored state into the page at once
// instead of at its next poll).

const SEQ_KEY = 'noted_live_seq';
const readSeqs = (): Record<string, number> => {
  try {
    return JSON.parse(SecureStore.getItem(SEQ_KEY) ?? '{}');
  } catch {
    return {};
  }
};

let owner: LiveOwner | null = null;
const touched = new Set<(noteId: string) => void>();
const cursors = new Set<(noteId: string, update: Uint8Array) => void>();

export const getLiveOwner = (): LiveOwner | null => owner;

// Guests changed this note (stored already).
export const onLiveNoteChanged = (fn: (noteId: string) => void): (() => void) => {
  touched.add(fn);
  return () => touched.delete(fn);
};
// Someone's cursor in a live note (raw awareness update for the page).
export const onLiveAwareness = (fn: (noteId: string, update: Uint8Array) => void): (() => void) => {
  cursors.add(fn);
  return () => cursors.delete(fn);
};

export const startLiveOwner = (masterKey: Uint8Array, store: LocalNoteStore, send: (message: object) => boolean, saved: () => void): LiveOwner => {
  owner = createLiveOwner({
    masterKey,
    send,
    readNote: async (id) => {
      const record = (await store.getAll()).find((n) => n.id === id);
      return record?.yjs_state && record.yjs_state.includes('.') ? docFromSealed(masterKey, record.yjs_state) : null;
    },
    applyToNote: async (id, updates) => {
      await updateNoteRecord(masterKey, store, id, (doc) => doc.transact(() => updates.forEach((u) => Y.applyUpdate(doc, u)), LIVE_ORIGIN));
      touched.forEach((fn) => fn(id));
      saved();
    },
    getSeq: (id) => readSeqs()[id] ?? 0,
    setSeq: (id, seq) => {
      try {
        SecureStore.setItem(SEQ_KEY, JSON.stringify({ ...readSeqs(), [id]: seq }));
      } catch {
        // merged again after a restart: harmless
      }
    },
    onAwareness: (noteId, update) => cursors.forEach((fn) => fn(noteId, update)),
  });
  return owner;
};
