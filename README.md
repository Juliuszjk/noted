# Noted

A local-first, end-to-end encrypted, zero-knowledge notes app: a Notion-like block editor with
Notesnook-like encryption. Desktop (Tauri, Linux), Android (Expo) and a small sync server
(Hono + SQLite in Docker). The server only ever stores ciphertext.

> Status: a personal project. The server is single-user (one vault per server) and the server
> address is built into the apps (see "Server address" below).

## Features

- Rich editor (Tiptap): tables, code blocks, callouts, math (KaTeX), task lists, images and
  file attachments, links between notes (`[[`), slash menu, Markdown paste.
- Notebooks, tags, pinned / favourite / archived notes, trash, note history (desktop).
- Live sync between devices (Yjs CRDT, WebSocket + polling), works offline.
- Locked notes with a separate password, app lock, recovery key, "log out other devices".
- Publishing a read-only copy by link (the key stays in the link fragment).
- Encrypted backups, export to Markdown / HTML, import (e.g. from Notesnook).

## Security model in short

- Passphrase -> Argon2id -> key; notes, files and metadata are sealed with
  XChaCha20-Poly1305 on the device before they leave it.
- The server stores sealed blobs and a verifier; it never sees plaintext or the key.
- Every file is sealed with its own random key, kept only inside its (sealed) note.

## Repository layout

```
apps/desktop    Tauri v2 + React desktop app
apps/mobile     Expo (Android) app; the editor runs as a WebView page (apps/mobile/editor)
apps/api        Hono API + public publish server (better-sqlite3, ws)
apps/web        placeholder
packages/       crypto, sync, editor (shared Tiptap schema), ui, config, theme, types, media
infra/docker    Dockerfile and docker-compose for the server
```

## Requirements

- Node.js 22+ and pnpm 10
- Desktop: Rust (stable) and the Tauri v2 Linux prerequisites (WebKitGTK 4.1 etc.)
- Android: Android SDK + JDK 21 (newer JDKs break the CMake step)
- Server: Docker with Compose

## First setup after cloning

Some files are machine-specific or generated, so they are not in the repository.

```bash
pnpm install

# 1. Server address used by the apps (not in git)
cp packages/config/server.example.ts packages/config/server.ts
#    edit API_URL / PUBLIC_URL if the server is not on this machine

# 2. Generated bundles (not in git)
pnpm --filter mobile run build:editor   # editor + KDF pages for the Android WebView
pnpm --filter api run build:viewer      # viewer for published notes
```

Run `build:editor` again after every change in `packages/editor` or `apps/mobile/editor`.

## Running

Server (development, ports 3000 = API, 3001 = published notes):

```bash
pnpm --filter api run dev
```

Desktop:

```bash
pnpm --filter desktop run tauri dev          # development
apps/desktop/scripts/install-linux.sh        # release build, installs ~/.local/bin/noted
```

Android (the `android/` folder is generated from `app.json` and `plugins/`):

```bash
cd apps/mobile && npx expo prebuild --platform android && cd ../..
apps/mobile/scripts/build-apk.sh             # release APK, installs it over adb
```

Release builds are signed with the key described in `~/.config/noted-android/signing.properties`
(see `apps/mobile/plugins/with-release-signing.js`); without it the debug key is used.

## Server with Docker

```bash
echo "NOTED_BIND_IP=127.0.0.1" > infra/docker/.env   # address the private API binds to
docker volume create docker_noted_data
docker compose -f infra/docker/docker-compose.yml up -d --build
```

The private API listens on `NOTED_BIND_IP:3333`; the public server for published notes on
`127.0.0.1:3334` (put a TLS proxy or tunnel in front of it). Keep the private API off the
public internet (e.g. bind it to a VPN address such as Tailscale).

## Server address

`packages/config/server.ts` is compiled into the apps, so each build talks to one server.
Choosing the server at first start (and a local-only mode) is planned.

## Tests

```bash
pnpm -C packages/sync exec vitest run        # also: crypto, editor, ui, theme
pnpm --filter desktop exec tsc --noEmit      # also: mobile, api
```
