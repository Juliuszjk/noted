import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import type { JSONContent } from '@tiptap/core';
import { drawingSvg, strokeData } from '@noted/editor/drawing-render';
import { parseBlobRef } from '@noted/editor/blob-image';
import { fetchSealedBlob, openBlob } from '@noted/sync';
import type { LocalBlobStore } from '@noted/sync';

// Images and drawings for Claude to look at: images decrypted (WebP / PNG / ... as stored),
// drawings drawn on white as PNG.

let wasm: Promise<void> | null = null;
const resvgReady = () => (wasm ??= initWasm(readFileSync(createRequire(import.meta.url).resolve('@resvg/resvg-wasm/index_bg.wasm'))));

export interface Picture {
  data: string;
  mimeType: string;
}

const mimeOf = (bytes: Uint8Array): string | null => {
  const at = (i: number, s: string) => [...s].every((c, k) => bytes[i + k] === c.charCodeAt(0));
  if (at(0, '\x89PNG')) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (at(0, 'GIF8')) return 'image/gif';
  if (at(0, 'RIFF') && at(8, 'WEBP')) return 'image/webp';
  return null;
};

export const drawingPicture = async (node: JSONContent): Promise<Picture> => {
  await resvgReady();
  const strokes = (node.content ?? []).filter((c) => c.type === 'drawingStroke').map((c) => strokeData(c.attrs ?? {}));
  const svg = drawingSvg(node.attrs?.height, strokes).replace(/^(<svg[^>]*>)/, '$1<rect width="100%" height="100%" fill="#ffffff"/>');
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1000 } }).render().asPng();
  return { data: Buffer.from(png).toString('base64'), mimeType: 'image/png' };
};

export const imagePicture = async (key: Uint8Array, blobs: LocalBlobStore, node: JSONContent): Promise<Picture | string> => {
  const ref = parseBlobRef(String(node.attrs?.blob ?? ''));
  if (!ref) return 'This image has no file.';
  const sealed = await fetchSealedBlob(key, blobs, ref.id);
  if (!sealed) return 'The image is not on the server yet (the device that added it has not synced).';
  const bytes = openBlob(sealed, ref.key);
  const mimeType = mimeOf(bytes);
  if (!mimeType) return 'This image is in a format that cannot be shown.';
  return { data: Buffer.from(bytes).toString('base64'), mimeType };
};
