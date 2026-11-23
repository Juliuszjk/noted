# Noted — project memory for Claude Code

Local-first, end-to-end encrypted, zero-knowledge notes app (Notion-like editor, Notesnook-like
encryption and UI). One vault per server, everyone runs their own (`SELF-HOSTING.md`). The
maintainer's private notes (server, status, ideas) live in `CLAUDE.local.md`, not in git.

**Before changing a feature, read its section in `docs/features.md`** (editor, desktop, mobile,
publishing, live publishing, reminders, drawing, PDF, server address / local-only mode, MCP,
backups, theme, and "Security, sync and data model" with the full details behind the rules
below). Full older copies of this file: `docs/private/claude-md-full-*.md` (not in git).

## Working rules (always apply)

- Code, comments, UI strings and commit messages in **English**; match the surrounding code.
- After any change to an app entry file (e.g. `apps/desktop/src/App.tsx`) **restart the app
  windows**, never rely on Vite hot reload (it once reset the master key to zeros).
- Small, verifiable steps: change, tests + typecheck, rebuild the affected apps, test them.
  Back up files you rewrite heavily.
- Never weaken the encryption or the zero-knowledge server to "make something work".
- Never commit personal data (server addresses, names, e-mail): grep the staged files first.
- Commit messages carry no `Co-Authored-By` (or any other attribution) trailers.

## Stack and layout

pnpm workspaces + Turborepo (default isolated layout, no .npmrc).

```
apps/desktop   Tauri v2 + React + TS ("desktop", Cargo "noted"). SQLite via tauri-plugin-sql.
apps/mobile    Expo, Android. Editor = WebView page (apps/mobile/editor). SQLite via expo-sqlite.
apps/api       Hono + better-sqlite3 + ws, Docker (self-hosted).
apps/web       guest page of live published notes (esbuild -> apps/api/src/live.generated.ts)
apps/mcp       MCP server for Claude Code (Node 22+, node:sqlite; esbuild -> dist/noted-mcp.mjs)
apps/release-check  release pipeline: harness around the real editor, browser tests (not shipped)
packages/crypto   XChaCha20-Poly1305 (@noble/ciphers), Argon2id + HKDF (@noble/hashes 1.8)
packages/sync     Yjs merge, API client, sync engine, editor bridge, backups, import/export
packages/editor   Tiptap schema (single source of truth), slash menu, toolbar model, content.css
packages/ui       desktop React components + shared list / reminder logic
packages/config   server address (runtime), timeouts, storage keys
packages/types, media (WebP compression), theme (Material 3 -> CSS variables); db, crdt empty
```

## Running, building, testing

- Desktop dev: `pnpm --filter desktop run tauri dev`. Installed build:
  `apps/desktop/scripts/install-linux.sh` (~4 min, `--no-build` only installs). Dev and installed
  share one SQLite file: never run both.
- Second desktop instance (sync tests): `cargo build` in `src-tauri`, then
  `env XDG_DATA_HOME=/tmp/noted-b/data XDG_CONFIG_HOME=/tmp/noted-b/config XDG_CACHE_HOME=/tmp/noted-b/cache apps/desktop/src-tauri/target/debug/noted`.
- Mobile dev: `REACT_NATIVE_PACKAGER_HOSTNAME=$(tailscale ip -4) pnpm --filter mobile exec expo start -c`.
- **Mobile APK**: `apps/mobile/scripts/build-apk.sh` (Gradle release arm64, JDK 21 from mise,
  then `adb install -r`). `android/` is generated (`npx expo prebuild --platform android`;
  app.json + `plugins/` are the source). Release key in `~/.config/noted-android/`.
- **After any change in `packages/editor` or `apps/mobile/editor` (or the KDF / PDF pages) run
  `pnpm --filter mobile run build:editor`** (writes `apps/mobile/src/*.generated.ts`, never edit those).
- Other bundles: `pnpm --filter api run build:viewer`, `pnpm --filter web run build:live` (after
  changes in apps/web or the packages it bundles). After a fresh clone run all three builds.
- Tests: `pnpm -C packages/<crypto|sync|editor|theme|ui> exec vitest run`, `pnpm -C apps/mcp exec vitest run`
  (DOM tests: `// @vitest-environment happy-dom`).
- Typecheck: `pnpm --filter <desktop|mobile|api> exec tsc --noEmit`, `pnpm -C apps/mcp exec tsc --noEmit`,
  WebView pages `pnpm --filter mobile exec tsc -p editor/tsconfig.json`. After changing Tauri
  capabilities: `cargo check` in `src-tauri`.
- **Releases**: `node scripts/set-version.mjs X.Y.Z`, commit, `git tag vX.Y.Z`, push the tag:
  `release.yml` makes a draft release (Linux, Windows, Android) and `server-image.yml` pushes
  `ghcr.io/juliuszjk/noted-server`. Publish the draft by hand
  (`gh release edit vX.Y.Z --draft=false --latest`). License AGPL-3.0-or-later.
- Updates only in CI builds (`VITE_NOTED_UPDATES` / `EXPO_PUBLIC_NOTED_UPDATES`); details in
  `docs/features.md`.

## Release check

- **`pnpm verify:release`** before every release and after changes to the editor, PDF, exports
  or publishing (~2 min, exit 1 = failure). First time in a checkout: `pnpm install`, then
  `pnpm verify:release:setup` (downloads browsers).
- Report: `apps/release-check/dist/runs/latest/report.md`; `--quick`, `--only=<step>`, `--list`.
- Safe at any time (no push / publish / install, local throwaway API). Never add `build-apk.sh` to it.
- WebKitGTK tests need `weston` + python-gobject; skipped is not a pass for the Linux app.
- `docs/release-matrix.md`: what is automated, what stays manual, known issues (`test.fail`).

## Server

Docker (`infra/docker`), one container `noted_api`: private API (port 3000) + public publish
server (port 3001). Host, deploy and backups: **`CLAUDE.local.md`** (read it before deploying).
The server address is chosen at run time (`apiUrl()` / `publicUrl()` / `wsUrl()` in `@noted/config`,
**never read at import time**); `packages/config/server.ts` (not in git) is only a build default.

## Security invariants (do not break)

- The server never sees plaintext: every text blob is `base64(nonce).base64(ciphertext)`
  (`seal` / `unseal`); files are sealed each with their OWN random key, kept only in the note.
- The data key never changes (passphrase change / recovery only re-wrap it); the server `vault`
  row is create-once and stores only the SHA-256 of the auth token.
- Before every sync the client checks its key against the verifier (`keyMatchesVault`) and
  refuses to push on mismatch.
- WebSocket `/ws`: token in the first message, never in the URL.
- Locked notes: the body is one sealed value; no excerpt / links, skipped by export, never a link target.
- Publishing: the key only in the link fragment; external http(s) images are never loaded.

## Sync, data model, editor

- **`mergingNoteStore(key, store)`**: every writer of note state must go through it.
- `mergeRemote` compares **snapshots** (state vectors miss deletions).
- `@noted/sync` has no require cycle (`index.ts` is only a barrel); no `localStorage` in shared
  packages (desktop injects it).
- The sealed `content` column holds note meta JSON (`buildNoteMeta`), never HTML.
- Catalog note `noted-catalog`: **`isSystemNote(id)` must keep it out of every list.**
- **`packages/editor/extensions.ts` -> `createSchemaExtensions` is the only place nodes and
  marks are defined** (an editor that does not know a node drops it, and the loss syncs).
  `schema.test.ts` locks the names.
- Drawing strokes live IN the body (never a separate Y.Map: it would leak from locked notes).

## App gotchas

- Desktop: all floating menus inside NoteEditor are portalled into `<body>` (`floating()`);
  dialogs only via `AppDialog.tsx`, never `window.confirm` or plugin-dialog `ask` / `message`.
- **Never swap `activeNote.ydoc` for the same note id** (opening the open note again lost edits).
- Mobile theme: style sheets are `themed(() => StyleSheet.create(...))`; **never keep theme
  colours in module constants or `useMemo` / `useRef`**.
- Mobile dialogs: `src/Dialog.tsx` `appAlert`, never `Alert.alert`.
- `android/` keeps the version of the last prebuild: after `set-version.mjs` re-run prebuild
  (else INSTALL_FAILED_VERSION_DOWNGRADE).
- After moving the repo, delete `apps/mobile/android/build`, `android/app/build` and
  `android/app/.cxx` (Gradle autolinking keeps the old path).
- Stale phone JS: check a fix is in the APK with `grep -a -c <string>
  apps/mobile/android/app/build/generated/assets/react/release/index.android.bundle` (page strings
  are UTF-16: `grep -a -c -P "h\x00e\x00a\x00d"`).
- Node 25+ has a global `localStorage` without `getItem`: check `typeof localStorage.getItem === 'function'`.
