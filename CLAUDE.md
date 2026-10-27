# Noted — project memory for Claude Code

Local-first, end-to-end encrypted, zero-knowledge notes app (Notion-like editor, Notesnook-like
encryption and UI). One vault per server, everyone runs their own (`SELF-HOSTING.md`). The
maintainer's private notes (server, status, ideas) live in `CLAUDE.local.md`, not in git.

**Feature detail lives in `docs/features.md`** (editor, desktop, mobile, publishing, live
publishing, reminders, drawing, PDF, server address / self-hosting / local-only mode, MCP,
backups, theme): read the matching section before changing a feature. Full older copies of this
file: `docs/private/claude-md-full-*.md` (not in git).

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
packages/crypto   XChaCha20-Poly1305 (@noble/ciphers), Argon2id + HKDF (@noble/hashes 1.8)
packages/sync     Yjs merge, API client, sync engine, editor bridge, backups, import/export
packages/editor   Tiptap schema (single source of truth), slash menu, toolbar model, content.css
packages/ui       desktop React components + shared list / reminder logic
packages/config   server address (runtime), timeouts, storage keys
packages/types, media (WebP compression), theme (Material 3 -> CSS variables); db, crdt empty
```

## Running, building, testing

- Desktop dev: `pnpm --filter desktop run tauri dev`. Installed build:
  `apps/desktop/scripts/install-linux.sh` (~4 min, `--no-build` only installs). Identifier
  `io.github.juliuszjk.noted`; dev and installed share one SQLite file: never run both.
- Second desktop instance (sync tests): `cargo build` in `src-tauri`, then
  `env XDG_DATA_HOME=/tmp/noted-b/data XDG_CONFIG_HOME=/tmp/noted-b/config XDG_CACHE_HOME=/tmp/noted-b/cache apps/desktop/src-tauri/target/debug/noted`.
- Mobile dev: `REACT_NATIVE_PACKAGER_HOSTNAME=$(tailscale ip -4) pnpm --filter mobile exec expo start -c`.
- **Mobile APK**: `apps/mobile/scripts/build-apk.sh` (Gradle release arm64, JDK 21 from mise,
  then `adb install -r`). `android/` is generated (`npx expo prebuild --platform android`;
  app.json + `plugins/` are the source). Release key in `~/.config/noted-android/` (outside the repo).
- **After any change in `packages/editor` or `apps/mobile/editor` (or the KDF / PDF pages) run
  `pnpm --filter mobile run build:editor`** (checks that every RN <-> page message is handled;
  writes `apps/mobile/src/*.generated.ts`, never edit those).
- Other bundles: `pnpm --filter api run build:viewer`, `pnpm --filter web run build:live` (after
  changes in apps/web or the packages it bundles; fails if a server address ends up in the page).
- Tests: `pnpm -C packages/<crypto|sync|editor|theme|ui> exec vitest run`, `pnpm -C apps/mcp exec vitest run`
  (DOM tests: `// @vitest-environment happy-dom`).
- Typecheck: `pnpm --filter <desktop|mobile|api> exec tsc --noEmit`, `pnpm -C apps/mcp exec tsc --noEmit`,
  WebView pages `pnpm --filter mobile exec tsc -p editor/tsconfig.json`. After changing Tauri
  capabilities: `cargo check` in `src-tauri`.
- After a fresh clone run `build:editor`, `build:viewer` and `build:live` (generated files are not in git).
- **Releases**: `node scripts/set-version.mjs X.Y.Z`, commit, `git tag vX.Y.Z`, push the tag:
  `release.yml` makes a draft release (Linux AppImage + deb, Windows exe + msi, Android APK) and
  `server-image.yml` pushes `ghcr.io/juliuszjk/noted-server`. Publish the draft by hand
  (`gh release edit vX.Y.Z --draft=false --latest`). License AGPL-3.0-or-later.
- **Updates** only in CI builds (`VITE_NOTED_UPDATES` / `EXPO_PUBLIC_NOTED_UPDATES`): desktop
  `src/updates.ts` (tauri-plugin-updater, signed `latest.json`), phone `src/updates.ts` (GitHub
  latest release). Repo address: `RELEASES_PAGE` / `LATEST_RELEASE_API` in `@noted/config`.

## Server

Docker (`infra/docker`), one container `noted_api`: private API (port 3000) + public publish
server (port 3001). Host, deploy and backups: **`CLAUDE.local.md`** (read it before deploying).
The server address is chosen at run time (`apiUrl()` / `publicUrl()` / `wsUrl()` in `@noted/config`,
**never read at import time**); `packages/config/server.ts` (not in git) is only an optional build
default. A new server needs a setup code to create its vault; local-only mode = stored address
`{api: '', public: ''}` (`hasServer()` false), the vault row then lives on the device. Details:
`docs/features.md` "Server address, self-hosting, local-only mode".

## Security model (do not break)

- Passphrase -> Argon2id (t=3, m=64 MiB, p=1, 32 bytes) with a salt -> key.
- Server table `vault` (single row, **create-once**): `salt`, `verifier` (seal of
  "noted-vault-v1"), `auth_hash`, `key_envelope`, `recovery_envelope`, `recovery_sealed`,
  `auth_epoch`, `created_at`. `GET /vault` is public (new devices need the salt).
- **Data key never changes.** Old vaults: data key = Argon2id(passphrase, salt). After "Change
  passphrase": new salt + `key_envelope` = seal(Argon2id(new passphrase), data key). Recovery key =
  32 random bytes (Crockford base32 + 2 check chars); `recovery_envelope` = seal(HKDF(recovery key,
  'noted-recovery-v1'), data key). The old passphrase still derives the data key (deliberate).
- Auth token = HKDF-SHA256(data key, `noted-auth-v1` or `noted-auth-v1:<epoch>`), `Bearer`;
  server stores only its SHA-256. "Log out other devices" = `POST /account/rotate-auth` with the
  next epoch's token (others get 4401 / 401 and log out). Epoch per device.
- Every text blob is `base64(nonce).base64(ciphertext)` (`seal` / `unseal`); the server never
  sees plaintext. Files: each sealed with its OWN random key (`sealBytes`), key only inside the
  note; server blobs write-once, max 30 MB.
- Before every sync the client checks its key against the verifier (`keyMatchesVault`) and
  refuses to push on mismatch.
- WebSocket `/ws`: token in the first message (never the URL); server only broadcasts
  `{type:"changed", id}`; polling every 30 s as a safety net.
- Key storage: desktop localStorage `noted_master_key`, mobile `expo-secure-store`. Mobile runs
  Argon2id in a hidden **WebView** (`src/kdf.ts`; Hermes is ~100x slower).
- Locked notes (`sync/locked.ts`): vault key wrapped by Argon2id(vault password) in the catalog;
  title stays, the body is one sealed value; no excerpt / links, skipped by export, never a link target.
- App lock: desktop LockScreen, mobile biometrics + passphrase; mobile `goingAway()` before
  share / pickers / intents so they do not lock the app.
- Publishing seals a rendered copy with a random key (only in the link fragment); external
  http(s) images are never loaded (`importImages` turns them into sealed blobs).

## Sync and local storage

- Yjs, one Y.Doc per note. `mergeRemote` merges in place and compares **snapshots** (state
  vectors miss deletions). `runSyncEngine` (`packages/sync/engine.ts`) works on any
  `LocalNoteStore`. Empty notes are not pushed; tombstones the server lacks are removed locally.
- **`mergingNoteStore(key, store)`** (`sync/merging-store.ts`): saves run one at a time and merge
  the stored state into the incoming one. **Every writer must go through it.**
- `@noted/sync` has no require cycle (`index.ts` is only a barrel). No `localStorage` in shared
  packages (desktop injects it).
- Blob cache = upload queue (`blobs/<id>` + SQLite `blobs`), `uploadPendingBlobs` before every sync.
- Maintenance: trash purged after 7 days; "Clean up storage" (unused blobs only after 30 days;
  each device knows only its own history).

## Note data model

- Body: XmlFragment `default`. Title: Y.Text `title` (`note-meta.ts`).
- Y.Map `settings` (absent = off): `pinned`, `favorite`, `archived`, `readOnly`, `noSpellcheck`,
  `trashedAt`, `deleted` (tombstone), `font`, `createdAt`, `published`, `locked`, `autoTitled`,
  legacy `notebook`. Y.Maps `tags` and `notebooks` (id -> true; several notebooks per note).
- The sealed `content` column holds **note meta JSON** (`buildNoteMeta(doc)`), never HTML.
- Catalog (`catalog.ts`): hidden note `noted-catalog` (notebooks, tags, vault, prefs,
  reminders). **`isSystemNote(id)` must keep it out of every list.** Create entries one at a time.

## Editor

- **`packages/editor/extensions.ts` -> `createSchemaExtensions` is the only place nodes and
  marks are defined.** An editor that does not know a node drops it and the loss syncs
  everywhere. `schema.test.ts` locks the names; rebuild the mobile bundle after changes.
- Module per feature in `packages/editor/` (images `blob-image.ts` / `image-drag.ts`, tables,
  code, callout, math, `note-link.ts`, reminders, `drawing*.ts`, `pdf-sheets.ts` /
  `print-pages.ts`, `page-break.ts`, ...); map and details in `docs/features.md`.
- Image drop must never land "between list items" (`blockDropTarget`).
- Drawing strokes live IN the body (never a separate Y.Map: it would leak from locked notes).
- Reminders: no Firebase / push (decided); closed phones learn them via ~15 min background sync.

## Desktop app

- Shell `App.tsx` (+ `SplitPane.tsx`); list logic `note-list.ts`, `link-tree.ts`,
  `note-groups.ts` (shared with the phone). Device prefs in localStorage (`prefs.ts`).
- **All floating menus inside NoteEditor are portalled into `<body>` (`floating()`)**.
- Note history: Restore carries `noteId` and is applied once.
- Dialogs only via `AppDialog.tsx`; never `window.confirm` or plugin-dialog `ask` / `message`.
  Own `Select` (native one paints white). Window never scrolls.
- Files pasted from a file manager: WebKitGTK gives the page no data, so Rust
  `clipboard_file_paths` + `read_local_file` -> `insertFiles`.

## Mobile app

- Editor = WebView page `apps/mobile/editor/`, RN <-> page messages `{type:...}` (requests with
  `requestId` / `reply`). Pages are not a secure context: no `crypto.randomUUID` (`src/uuid.ts`).
- The editor is an overlay over the always-mounted list; Back goes through `{type:'back'}`.
- Keyboard: `react-native-keyboard-controller`; modals call `keyboardGone()`.
- Dialogs: `src/Dialog.tsx` `appAlert`, never `Alert.alert`.
- Theme changes without reload: style sheets are `themed(() => StyleSheet.create(...))`;
  **never keep theme colours in module constants or `useMemo` / `useRef`**.

## Live publishing, MCP, PDF

- Live: removing a live link or replacing it with a static copy first merges queued guest edits
  (`afterLiveCatchUp`, 409 while newer ones wait); a note with nodes the page's schema lacks
  (`unknownSchemaParts`) opens read only for guests.
- MCP: catalog, deleted, locked and "Protected" notes stay hidden (checked on the doc, writes
  that would move a note out of reach are refused); `node:sqlite` is loaded via `createRequire`.
- PDF: the phone makes PDFs in its own WebView with `textZoom={100}` (the editor follows the
  system font size); each sheet shows its slice moved with `top` (a negative margin got paginated again).

## Incidents and gotchas

- All-zero key after a hot reload: guarded by the verifier check; restart windows after entry-file changes.
- Lost text on slow connections -> `mergingNoteStore`.
- Lost phone saves: a swiped-away app keeps its process and the expo-sqlite handle dies;
  `openHealingDatabase` (`src/store.ts`) reopens it, EditorScreen retries unsaved updates.
  Release logs: `adb logcat -s ReactNativeJS`.
- **Never swap `activeNote.ydoc` for the same note id** (opening the open note again lost edits).
- Imports: `loadNotes` keeps notes with a pending save from memory; ids are per file.
- Stale phone JS: check a fix is in the APK with `grep -a -c <string>
  apps/mobile/android/app/build/generated/assets/react/release/index.android.bundle` (page strings
  are UTF-16: `grep -a -c -P "h\x00e\x00a\x00d"`).
- `android/` keeps the version of the last prebuild: after `set-version.mjs` re-run prebuild
  (else INSTALL_FAILED_VERSION_DOWNGRADE).
- Phone page rewrites once cut helpers (`askReactNative`, `uuid`): check the bundle.
- Android IMEs restarted on relabelled task items -> `QuietTaskItem`. Task list CSS uses `> li`.
- After a server wipe, phones must clear their app data (`adb shell pm clear`) or they re-upload.
- Hermes lacks `crypto.randomUUID` and Web Crypto (`src/polyfill.ts` loads
  `react-native-get-random-values` first). `@ts-expect-error` on `<WebView>` is intentional.
- Node 25+ has a global `localStorage` without `getItem`: check `typeof localStorage.getItem === 'function'`.
