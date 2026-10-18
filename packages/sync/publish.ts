import { API_URL, PUBLIC_URL } from '@noted/config';
import { sealBytes, publishPasswordKey } from '@noted/crypto';
import { apiFetch } from './client';
import { getNotePublish } from './note-meta';
import type { NotePublish } from './note-meta';
import type * as Y from 'yjs';

// Publishing a note (like Notesnook's monographs): a rendered copy of the note is sealed with
// a random key and uploaded; the link carries the key in its #fragment, which browsers never
// send to a server. Anyone with the link (and the password, when one is set) can read the
// copy, nobody else (the server included). Optionally the server deletes it after one view.

export interface PublishedNote {
  v: 1;
  title: string;
  // The note body as HTML (rendered by the editor, images inlined) and the CSS it needs.
  html: string;
  css: string;
  font?: string | null;
  publishedAt: number;
}

export interface PublishOptions {
  password: string | null;
  selfDestruct: boolean;
  // Off with self destruct (an update would bring a destroyed copy back).
  autoUpdate?: boolean;
  // The server deletes the copy at this time (ms); null = never.
  expiresAt?: number | null;
}

// How long after the last edit an automatic update is published.
export const AUTO_PUBLISH_DELAY_MS = 15_000;

// Uploaded bytes: "N", format 1, flags (bit 0 = password), then nonce || ciphertext.
export const PUBLISH_MAGIC = 0x4e;
export const PUBLISH_FORMAT = 1;
export const PUBLISH_FLAG_PASSWORD = 1;

export const toBase64Url = (bytes: Uint8Array): string => {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
export const fromBase64Url = (text: string): Uint8Array => {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
};
const random = (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n));

export const publishedUrl = (info: Pick<NotePublish, 'id' | 'key'>): string => `${PUBLIC_URL}/p/${info.id}#${info.key}`;

// Id and key of a new publish, or those of the earlier one (the link stays the same).
export const nextPublishInfo = (earlier: NotePublish | null, options: PublishOptions): NotePublish => ({
  id: earlier?.id ?? toBase64Url(random(12)),
  key: earlier?.key ?? toBase64Url(random(32)),
  at: Date.now(),
  password: options.password || null,
  selfDestruct: options.selfDestruct,
  autoUpdate: !!options.autoUpdate && !options.selfDestruct,
  expiresAt: options.expiresAt ?? null,
});

// Has the link's time run out?
export const publishExpired = (info: NotePublish, now = Date.now()): boolean => !!info.expiresAt && info.expiresAt <= now;

// The bytes to upload. With a password this runs PBKDF2 (on mobile: in the WebView, which is
// much faster than Hermes).
export const sealPublished = (note: Omit<PublishedNote, 'v' | 'publishedAt'>, info: NotePublish): Uint8Array => {
  const payload: PublishedNote = { v: 1, ...note, publishedAt: info.at };
  const linkKey = fromBase64Url(info.key);
  const key = info.password ? publishPasswordKey(linkKey, info.password) : linkKey;
  const sealed = sealBytes(key, new TextEncoder().encode(JSON.stringify(payload)));
  const out = new Uint8Array(3 + sealed.length);
  out.set([PUBLISH_MAGIC, PUBLISH_FORMAT, info.password ? PUBLISH_FLAG_PASSWORD : 0], 0);
  out.set(sealed, 3);
  return out;
};

export const putPublished = async (masterKey: Uint8Array, info: NotePublish, bytes: Uint8Array): Promise<void> => {
  // The server would keep a copy with a past expiry forever: choose a new expiry instead.
  if (publishExpired(info)) throw new Error('The link has expired: choose a new expiry date.');
  const res = await apiFetch(`${API_URL}/publish/${info.id}`, masterKey, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Self-Destruct': info.selfDestruct ? '1' : '0',
      ...(info.expiresAt ? { 'X-Expires-At': String(info.expiresAt) } : {}),
    },
    body: bytes as BodyInit,
  }, 60_000);
  if (!res.ok) throw new Error(res.status === 413 ? 'The note is too large to publish (30 MB)' : `Publishing failed (HTTP ${res.status})`);
};

export const uploadPublished = async (
  masterKey: Uint8Array, note: Omit<PublishedNote, 'v' | 'publishedAt'>, earlier: NotePublish | null, options: PublishOptions,
): Promise<NotePublish> => {
  const info = nextPublishInfo(earlier, options);
  await putPublished(masterKey, info, sealPublished(note, info));
  return info;
};

// Is the published copy still on the server? null = could not ask (offline).
export const publishedExists = async (masterKey: Uint8Array, info: NotePublish): Promise<boolean | null> => {
  try {
    const res = await apiFetch(`${API_URL}/publish/${info.id}`, masterKey);
    if (!res.ok) return null;
    return (await res.json()).exists === true;
  } catch {
    return null;
  }
};

export const deletePublished = async (masterKey: Uint8Array, info: NotePublish): Promise<void> => {
  const res = await apiFetch(`${API_URL}/publish/${info.id}`, masterKey, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) throw new Error(`Unpublishing failed (HTTP ${res.status})`);
};

// Before a note is deleted for good: its published copy goes too (best effort; offline it
// stays on the server, readable only with the link).
export const unpublishQuietly = (masterKey: Uint8Array, doc: Y.Doc): void => {
  const info = getNotePublish(doc);
  if (info) deletePublished(masterKey, info).catch((e) => console.warn('Unpublishing a deleted note failed:', e));
};
