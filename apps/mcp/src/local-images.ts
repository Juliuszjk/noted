import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { JSONContent } from '@tiptap/core';
import { formatBlobRef } from '@noted/editor/blob-image';
import type { BlobRef } from '@noted/editor/blob-image';
import { MAX_BLOB_PLAINTEXT_BYTES } from '@noted/sync';
import { mimeOf } from './render';

// Images Claude adds from files on this computer: "![alt](/abs/path.png)" (also "file:///..."
// and "~/..."). The bytes are stored as they are (no canvas here to compress them), sealed
// like the apps' images. Other sources (http(s), ...) stay as they are: external images are
// never loaded.

// The local file an image's src points to, or null when it is not a local path.
export const localImagePath = (src: unknown): string | null => {
  if (typeof src !== 'string') return null;
  if (src.startsWith('file://')) {
    try {
      return fileURLToPath(src);
    } catch {
      return null;
    }
  }
  // "//host/x.png" is a web address without its scheme.
  if ((!src.startsWith('/') || src.startsWith('//')) && !src.startsWith('~/')) return null;
  // The Markdown parser percent-encodes the path ("a%20b.png").
  let path = src;
  try {
    path = decodeURIComponent(src);
  } catch {}
  return path.startsWith('~/') ? join(homedir(), path.slice(2)) : path;
};

const readImage = (path: string): Uint8Array => {
  let size: number;
  try {
    const stat = statSync(path);
    if (!stat.isFile()) throw new Error();
    size = stat.size;
  } catch {
    throw new Error(`Image file not found: ${path}`);
  }
  if (size > MAX_BLOB_PLAINTEXT_BYTES) throw new Error(`Image file is too large (max ${Math.floor(MAX_BLOB_PLAINTEXT_BYTES / 1024 / 1024)} MB): ${path}`);
  const bytes = new Uint8Array(readFileSync(path));
  if (!mimeOf(bytes)) throw new Error(`Not a PNG, JPEG, GIF or WebP image: ${path}`);
  return bytes;
};

const imageNodes = (nodes: JSONContent[], out: JSONContent[] = []): JSONContent[] => {
  for (const node of nodes) {
    if (node.type === 'image' && localImagePath(node.attrs?.src)) out.push(node);
    if (node.content) imageNodes(node.content, out);
  }
  return out;
};

// Turns images with a local path into stored images (in place). Every file is read and checked
// before anything is stored; throws with a message for Claude when one cannot be used.
export const storeLocalImages = async (nodes: JSONContent[], store: (bytes: Uint8Array) => Promise<BlobRef>): Promise<void> => {
  const found = imageNodes(nodes).map((node) => {
    const path = localImagePath(node.attrs!.src)!;
    return { node, path, bytes: readImage(path) };
  });
  // A file used several times is stored once.
  const refs = new Map<string, BlobRef>();
  for (const { node, path, bytes } of found) {
    const ref = refs.get(path) ?? await store(bytes);
    refs.set(path, ref);
    node.attrs = { ...node.attrs, src: null, blob: formatBlobRef(ref), alt: node.attrs?.alt || basename(path) };
  }
};
