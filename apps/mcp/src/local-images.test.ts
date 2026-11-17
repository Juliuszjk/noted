// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as Y from 'yjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { generateKey } from '@noted/crypto';
import { parseBlobRef } from '@noted/editor/blob-image';
import { noteBodyJson, openBlob } from '@noted/sync';
import type { LocalBlobStore } from '@noted/sync';
import { createNotes } from './notes';
import { openStore } from './store';
import { registerTools } from './tools';
import { localImagePath } from './local-images';

const server = vi.hoisted(() => ({ has: true, uploads: [] as string[], fail: false }));
vi.mock('@noted/config', async (original) => ({ ...await original<typeof import('@noted/config')>(), hasServer: () => server.has }));
vi.mock('@noted/sync', async (original) => ({
  ...await original<typeof import('@noted/sync')>(),
  uploadBlob: async (_key: Uint8Array, id: string) => {
    if (server.fail) throw new Error('HTTP 500');
    server.uploads.push(id);
  },
}));

const key = generateKey();
const dir = mkdtempSync(join(tmpdir(), 'noted-mcp-images-'));
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const png = join(dir, 'zdjęcie 1.png');
writeFileSync(png, PNG);
const src = encodeURI(png);
writeFileSync(join(dir, 'notes.txt'), 'not an image');

let blobs: Map<string, Uint8Array>;
let stores: ReturnType<typeof openStore>;
let client: Client;

const call = async (name: string, args: Record<string, unknown>) => {
  const result = await client.callTool({ name, arguments: args }) as { content: { type: string; text?: string }[]; isError?: boolean };
  return { text: result.content.map((c) => c.text ?? '').join('\n'), isError: !!result.isError };
};

const images = async () => {
  const notes = await stores.notes.getAll();
  expect(notes.length).toBeLessThanOrEqual(1);
  if (!notes.length) return [];
  const { docFromSealed } = await import('@noted/sync');
  const doc = docFromSealed(key, notes[0].yjs_state!) as Y.Doc;
  return (noteBodyJson(doc).content ?? []).filter((n) => n.type === 'image');
};

beforeEach(async () => {
  Object.assign(server, { has: true, uploads: [], fail: false });
  blobs = new Map();
  const cache: LocalBlobStore = {
    get: async (id) => blobs.get(id) ?? null,
    put: async (id, sealed) => { blobs.set(id, sealed); },
    pending: async () => [],
    markUploaded: async () => {},
  };
  stores = openStore(':memory:');
  const mcp = new McpServer({ name: 'noted', version: 'test' });
  registerTools(mcp, createNotes(key, stores, { online: false }), key, cache);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await mcp.connect(a);
  client = new Client({ name: 'test', version: '1' });
  await client.connect(b);
});

describe('images from local files', () => {
  it('finds local paths only', () => {
    expect(localImagePath('/tmp/a%20b.png')).toBe('/tmp/a b.png');
    expect(localImagePath('file:///tmp/c%20d.png')).toBe('/tmp/c d.png');
    expect(localImagePath('~/p.png')).toMatch(/\/p\.png$/);
    expect(localImagePath('https://example.com/a.png')).toBeNull();
    expect(localImagePath('//cdn.example.com/a.png')).toBeNull();
    expect(localImagePath('relative.png')).toBeNull();
  });

  it('stores, seals and uploads the file', async () => {
    const result = await call('create_note', { title: 'Pics', markdown: `Look:\n\n![](${src})\n\n![Web](https://example.com/a.png)` });
    expect(result.isError).toBe(false);
    const [local, web] = await images();
    const ref = parseBlobRef(local.attrs?.blob)!;
    expect(local.attrs?.alt).toBe('zdjęcie 1.png');
    expect(local.attrs?.src ?? null).toBeNull();
    expect(server.uploads).toEqual([ref.id]);
    expect(openBlob(blobs.get(ref.id)!, ref.key)).toEqual(PNG);
    // Web images are never downloaded.
    expect(web.attrs?.src).toBe('https://example.com/a.png');
    expect(web.attrs?.blob ?? null).toBeNull();
  });

  it('keeps the alt text and works in append and rewrite', async () => {
    await call('create_note', { title: 'Pics', markdown: 'x' });
    const id = (await stores.notes.getAll())[0].id;
    expect((await call('append_to_note', { id, markdown: `![Screenshot](file://${src})` })).isError).toBe(false);
    expect((await images())[0].attrs?.alt).toBe('Screenshot');
    expect((await call('rewrite_note', { id, markdown: `x\n\n⟦image 1⟧\n\n![Two](${src})` })).isError).toBe(false);
    expect((await images()).map((n) => n.attrs?.alt)).toEqual(['Screenshot', 'Two']);
    expect(server.uploads).toHaveLength(2);
  });

  it('refuses bad files without changing anything', async () => {
    const cases: [string, RegExp][] = [
      [join(dir, 'missing.png'), /not found/],
      [join(dir, 'notes.txt'), /Not a PNG, JPEG, GIF or WebP/],
    ];
    for (const [path, message] of cases) {
      const result = await call('create_note', { title: 'Bad', markdown: `![](${src})\n\n![](${path})` });
      expect(result.isError).toBe(true);
      expect(result.text).toMatch(message);
    }
    expect(server.uploads).toEqual([]);
    server.has = false;
    expect((await call('create_note', { title: 'Bad', markdown: `![](${src})` })).text).toMatch(/need a Noted server/);
    server.has = true;
    server.fail = true;
    expect((await call('create_note', { title: 'Bad', markdown: `![](${src})` })).text).toMatch(/Image upload failed: HTTP 500/);
    expect(await stores.notes.getAll()).toEqual([]);
  });
});
