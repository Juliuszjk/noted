# Noted — project memory for Claude Code

Local-first, end-to-end encrypted, zero-knowledge notes app (Notion-like editor, Notesnook-like
encryption and UI). One vault per server, everyone runs their own (`SELF-HOSTING.md`). The
maintainer's private notes (working rules, server, status, ideas) live in `CLAUDE.local.md`, not in git.

**More detail lives in `docs/`** (read the relevant part before changing a feature):
- `docs/features.md`: full notes on Editor, Desktop, Mobile, Publishing, Settings/backups/import, Theme.
- `docs/private/claude-md-history-2026-10-12.md` (not in git): history of all rounds (1-25), rejected ideas, old TODO detail.
- `docs/private/claude-md-full-2026-10-15.md` (not in git): the complete CLAUDE.md before it was trimmed.

## Working rules (always apply)

- Write all code and code comments in **English**; match the surrounding code.
- After any change to an app entry file (e.g. `apps/desktop/src/App.tsx`) **restart the app
  windows**, do not rely on Vite hot reload (a hot reload once reset the master key to zeros).
- Small, verifiable steps: change, then tests + typecheck, then rebuild the affected apps (see
  "Running") and test them. Make a backup copy of files you rewrite heavily.
- Never weaken the encryption or the zero-knowledge server to "make something work".
- Never commit personal data (server addresses, names, e-mail): grep the staged files first.
- Commit messages carry no `Co-Authored-By` (or any other attribution) trailers: the maintainer
  is the only author, on every machine.

## Stack and layout

pnpm workspaces + Turborepo (pnpm's default isolated layout, no .npmrc).

```
apps/desktop   Tauri v2 + React + TS. Package "desktop", Cargo package "noted". SQLite via tauri-plugin-sql.
apps/mobile    Expo, Android. Release APK on the phone. Editor = WebView page (apps/mobile/editor). SQLite via expo-sqlite.
apps/api       Hono + better-sqlite3 + ws, Docker (self-hosted).
apps/web       guest page of live published notes (React + NoteEditor, esbuild -> apps/api/src/live.generated.ts)
apps/mcp       MCP server for Claude Code (Node 22+, node:sqlite; esbuild -> dist/noted-mcp.mjs)
packages/crypto   XChaCha20-Poly1305 (@noble/ciphers), Argon2id + HKDF (@noble/hashes 1.8)
packages/sync     Yjs merge, API client, sync engine, editor bridge, backups, import/export helpers
packages/editor   Tiptap schema (single source of truth), slash menu, toolbar model, content.css
packages/ui       Desktop React components (NoteEditor, menus, dialogs, settings, importers) + shared list logic
packages/config   server address (runtime), timeouts, storage keys
packages/types    NoteRecord, RemoteNote, VaultMode
packages/media    image compression (WebP)
packages/theme    Material 3 colour roles -> CSS variables, presets
packages/db, crdt   empty
```

## Running, building, testing

- Desktop dev: `pnpm --filter desktop run tauri dev`
- Desktop production (installed): `apps/desktop/scripts/install-linux.sh` builds
  (`tauri build --no-bundle`, ~4 min) and installs `~/.local/bin/noted`, icons and
  `~/.local/share/applications/noted.desktop`. `--no-build` only installs. Identifier
  `io.github.juliuszjk.noted` (same SQLite file as dev, own localStorage; until 0.1 it was
  `com.apollo.desktop`: `main.rs move_old_data` renames those XDG folders once). Do not run dev and the
  installed app at the same time (one database). Icons: `pnpm tauri icon src-tauri/icons/icon-source-1024.png`.
- Second desktop instance (sync testing; debug builds skip single-instance):
  `mkdir -p /tmp/noted-b && env XDG_DATA_HOME=/tmp/noted-b/data XDG_CONFIG_HOME=/tmp/noted-b/config XDG_CACHE_HOME=/tmp/noted-b/cache apps/desktop/src-tauri/target/debug/noted`
  (needs a debug build first: `cargo build` in `src-tauri`; no debug binary exists by default). Without one:
  close the installed Noted and run `~/.local/bin/noted` with the same `env XDG_...` (release keeps single-instance).
- Mobile dev (Expo Go; phone and computer on one network, e.g. Tailscale):
  `REACT_NATIVE_PACKAGER_HOSTNAME=$(tailscale ip -4) pnpm --filter mobile exec expo start -c`
- **Mobile APK** (package `io.github.juliuszjk.noted`; `com.apollo.noted` before 0.1 is a separate app): `apps/mobile/scripts/build-apk.sh` = Gradle
  `assembleRelease` (arm64-v8a) with JDK 21 from mise (Java 25 breaks CMake), then
  `adb install -r`. `android/` is generated (`npx expo prebuild --platform android`, CNG;
  app.json + plugins are the source: icons, `allowBackup: false`, cleartext HTTP to the
  Tailscale API, `plugins/with-release-signing.js`). Release key:
  `~/.config/noted-android/noted-release.keystore` + `signing.properties` (outside the repo).
  A phone over adb works for testing (screencap, input, screenrecord + ffmpeg).
- **After any change in `packages/editor` or `apps/mobile/editor` (or the KDF page) run
  `pnpm --filter mobile run build:editor`** (runs `scripts/check-messages.mjs` first: every
  RN <-> page message type sent must be handled on the other side; esbuild ->
  `apps/mobile/src/editorHtml.generated.ts`, `kdfHtml.generated.ts`, never edit those; fails if
  the template lacks `/*__BUNDLE__*/` or `/*__CONTENT_CSS__*/`). Editor page ~1.7 MB.
- Tests: `pnpm -C packages/<crypto|sync|editor|theme|ui> exec vitest run` (DOM tests use
  `// @vitest-environment happy-dom`; ui has `ui-smoke.test.tsx`).
- Typecheck: `pnpm --filter desktop exec tsc --noEmit`, `pnpm --filter mobile exec tsc --noEmit`,
  `pnpm --filter api exec tsc --noEmit`, WebView pages: `pnpm --filter mobile exec tsc -p editor/tsconfig.json`.
- After changing Tauri capabilities (`src-tauri/capabilities/default.json`) run `cargo check` in `src-tauri`.
- Viewer bundle: `pnpm --filter api run build:viewer` -> `src/viewer.generated.ts`. Live note page:
  `pnpm --filter web run build:live` -> `apps/api/src/live.generated.ts` (after changes in apps/web or the
  shared packages it bundles; the build swaps `packages/config/server.ts` for a stub and fails if a server
  address ends up in the page).

- **Releases**: `node scripts/set-version.mjs X.Y.Z` (desktop package.json, tauri.conf.json,
  Cargo.toml, app.json + versionCode = major*1e6 + minor*1e3 + patch), commit, `git tag vX.Y.Z`,
  push the tag: `.github/workflows/release.yml` makes a draft release (Linux AppImage + deb on
  ubuntu-22.04, Windows exe + msi, Android arm64 APK signed with secrets `NOTED_ANDROID_*`) and
  `server-image.yml` pushes the image. Builds use `server.example.ts` (no default server).
  License AGPL-3.0-or-later (`LICENSE`). Publish the draft by hand (`gh release edit vX.Y.Z --draft=false --latest`).
- **Updates** (only CI release builds: `VITE_NOTED_UPDATES=1` / `EXPO_PUBLIC_NOTED_UPDATES=1` in
  release.yml; local builds never check): desktop `src/updates.ts` (tauri-plugin-updater, manifest
  `releases/latest/download/latest.json` uploaded by tauri-action with `createUpdaterArtifacts`,
  signed with secrets `TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)`, public key in tauri.conf.json;
  installs itself on Windows and in an AppImage (`can_self_update`), otherwise opens the releases
  page), at start + 20 s and every 12 h, Settings > Desktop integration "Check for updates".
  Phone `src/updates.ts`: GitHub API latest release, dialog opens the APK download; Settings list
  shows the version. Repo address: `RELEASES_PAGE` / `LATEST_RELEASE_API` in `@noted/config`.

## Server

Docker (`infra/docker`: `Dockerfile.api`, `docker-compose.yml`), one container `noted_api` with the
private API (port 3000) and the public publish server (port 3001). Host, addresses, deploy
commands, backups and Tailscale rules: **`CLAUDE.local.md`** (not in git, read it before deploying).
Server address (2026-10-18, phase 1 of distribution): chosen at run time, `apiUrl()` / `publicUrl()` /
`wsUrl()` in `@noted/config`, stored per app via `configureServerStorage` (desktop localStorage
`noted_server` in App.tsx, phone SecureStore in `src/server-address.ts` imported first by index.ts for
the headless tasks, MCP `~/.config/noted-mcp/server.json`). Never read the address at import time.
`packages/config/server.ts` (not in git; template `server.example.ts`, empty) is only an optional build
default, stored on first start. Unlock screens ask for the address when none is set ("Server: … ·
change" link; `normalizeServerUrl`: IP / localhost -> http, host name -> https) and check it with
`GET /info` (`{app:'noted', version, publicUrl}`, env `NOTED_PUBLIC_URL`; `connectServer`,
`refreshServerInfo` at start adopts a reported public address). `putPublished` refuses without a
public address. Compose: `infra/docker/.env` (`NOTED_BIND_IP`, `NOTED_PUBLIC_URL`, not in git).
Self-hosting (phase 3, 2026-10-18): a server without a vault needs a **setup code** to create it
(`apps/api/src/setup-code.ts`: env `NOTED_SETUP_CODE` or generated into `data/setup-code`, printed
to the log; `GET /vault` 404 says `setupCode: true`; `PUT /vault` header `X-Setup-Code`, 403 + 1 s
delay when wrong; dropped once the vault exists). Clients: `fetchVaultStatus`, `setupCodeHeader`,
`restoreServerVault(.., setupCode)`; unlock screens show the field (desktop Settings "set up the
server" refuses on such a server: use the unlock screen). Image `ghcr.io/juliuszjk/noted-server`
(`.github/workflows/server-image.yml`, amd64 + arm64, on `v*` tags or by hand), friends' compose
`infra/docker/compose.example.yml`, guide `SELF-HOSTING.md`. Dockerfile TZ defaults to UTC, the
maintainer's compose sets `TZ`.
Local-only mode (phase 2, 2026-10-18): server address `{api: '', public: ''}` stored = no server
(`hasServer()` false). `apiFetch` then rejects without sending (`NO_SERVER_MESSAGE`),
`runSyncEngine` / `uploadPendingBlobs` return at once (blobs stay queued). The vault row lives on
the device: `configureLocalVault` (desktop localStorage `noted_local_vault`, phone SecureStore
`noted_local_vault` in `src/server-address.ts`), record = `BackupVault`; `fetchVaultStatus`,
`changePassphrase`, `getRecoveryKey`, `fetchBackupVault`, `restoreServerVault` use it without a
server; `createLocalVault`. Unlock screens: "Use without a server", and refuse a vault other than
the one whose notes the device holds (`knownVerifier` = cached vault info `noted_vault_info`).
Later "Settings > Sync > Connect a server" = `moveVaultToServer` (empty server: PUT /vault with the
envelopes + setup code; same vault there: joins with its epoch; other vault: refused; failure
restores "no server"), then the apps flip `serverOn` and sync. Hidden without a server: publish
(desktop NoteProperties / NoteEditor `onPublish`, phone menu tile + `openPublish`), log out other
devices, clean up storage, set up the server from a backup, background sync row; status bar /
drawer say "This device / phone only".

## Security model (do not break)

- Passphrase -> Argon2id (t=3, m=64 MiB, p=1, 32 bytes) with a salt -> key.
- Server table `vault` (single row, **create-once**): `salt`, `verifier` (seal of
  "noted-vault-v1"), `auth_hash`, `key_envelope`, `recovery_envelope`, `recovery_sealed`,
  `auth_epoch`, `created_at`. `GET /vault` is public (new devices need the salt).
  `PUT /vault/auth` registers a token once for old vaults; `PUT /vault` (create-once) also takes
  the envelopes (setting up a new server from a backup).
- **Data key never changes.** Old vaults: data key = Argon2id(passphrase, salt). After "Change
  passphrase": new salt + `key_envelope` = seal(Argon2id(new passphrase), data key)
  (`openWithPassphraseKey`). Recovery key = 32 random bytes, Crockford base32 + 2 check chars
  (`formatRecoveryKey` / `parseRecoveryKey`); `recovery_envelope` = seal(HKDF(recovery key,
  'noted-recovery-v1'), data key), `recovery_sealed` = seal(data key, recovery key). The old
  passphrase still derives the data key (no rotation, no OS keyring: a deliberate choice).
- Auth token = HKDF-SHA256(data key, `noted-auth-v1`, or `noted-auth-v1:<epoch>` for epoch > 0),
  `Authorization: Bearer`; server stores only its SHA-256. `/notes`, `/blobs`, `/account/*`,
  private `/publish/*` require it. "Log out other devices" = `POST /account/rotate-auth` with the
  next epoch's token; server closes all WebSockets; others get 4401 / 401 and log out
  (`sessionStillValid()`). Epoch per device (desktop localStorage `noted_auth_epoch`, mobile
  SecureStore), `setAuthEpoch`, used by `apiFetch` / `currentAuthToken`.
- Every text blob is `base64(nonce).base64(ciphertext)` (`seal` / `unseal`). Server
  `server_notes`: `id`, `encrypted_html` (sealed note meta), `encrypted_yjs`, `updated_at`.
  The server never sees plaintext.
- Files: each sealed with its OWN random key (`sealBytes`: nonce || ciphertext), key stored only
  inside the note. Server `server_blobs` (`PUT/GET/DELETE /blobs/:id`, `GET /blobs`),
  write-once, max 30 MB (`apps/api/src/blobs.ts`).
- Before every sync the client checks its key against the verifier (`keyMatchesVault`) and
  refuses to push on mismatch.
- WebSocket `/ws`: token in the first message (never the URL), 4401 after 5 s without it;
  server only broadcasts `{type:"changed", id}`; heartbeat 25 s; polling every 30 s as a safety net.
- Key storage: desktop localStorage `noted_master_key`, mobile `expo-secure-store`. Mobile runs
  Argon2id in a hidden, always-mounted **WebView** (`src/kdf.ts`; Hermes: 174 s vs ~1-2 s).
- Locked notes (`sync/locked.ts`): vault key wrapped by Argon2id(vault password) in the catalog
  (Y.Map `vault`); a locked note keeps its title, its body is one sealed value in settings
  `locked` (LWW); no excerpt / links, skipped by export, never a `/linkto` target. Desktop edits
  a copy doc sealed back after 500 ms; the phone page edits a separate body doc and posts
  `lockedBody`, RN seals it.
- App lock: desktop LockScreen (passphrase vs vault data, idle minutes); mobile
  (expo-local-authentication + passphrase after time in the background). Locking closes the
  locked-notes vault. Mobile `src/away.ts` `goingAway()` before share / pickers / intents / print
  (page: `{type:'goingAway'}`): a background within 4 s does not lock (unless > 30 min).
- Publishing seals a rendered copy with a random key (key only in the link fragment); external
  http(s) images are never loaded, `importImages` downloads them into sealed blobs.

## Sync and local storage

- CRDT: Yjs, one Y.Doc per note. `mergeRemote` merges in place and compares **snapshots**
  (state vectors miss deletions). Push with `Date.now()` when we hold content the server lacks;
  adopt the server timestamp when we only received.
- `runSyncEngine` (`packages/sync/engine.ts`) works on any `LocalNoteStore` (desktop Tauri SQL,
  mobile expo-sqlite); the open note's live doc is merged in place. Empty notes are not pushed
  (new untitled notes store `content = ''`). Tombstones the server lacks are removed locally,
  never uploaded.
- **`mergingNoteStore(key, store)`** (`sync/merging-store.ts`): saves run one at a time and
  merge the stored state into the incoming one, so no writer can overwrite another's edits.
  **Every writer must go through it** (mobile App wraps `dbStore`; desktop `noteStore(db)`, one
  per database). Mobile EditorScreen pushes stored changes the page has not seen (`pushState('remote')`).
- `applyEditorUpdate` (bridge.ts): incremental Yjs updates from the phone page merged on top.
- `@noted/sync` has no require cycle: `index.ts` is only a barrel. No `localStorage` in shared
  packages (desktop injects it, `configureVerifierCache`).
- Blob cache = upload queue: desktop `$APPDATA/blobs/<id>`, phone `<documents>/blobs/<id>`, plus
  SQLite `blobs(id, data '', uploaded)`. `uploadPendingBlobs` at the start of every sync.
  Decrypted images = object URLs from `createBlobUrlCache` (`BlobHandlers.release`).
- Maintenance: `purgeExpiredTrash` (trash > 7 days). "Clean up storage" (desktop Settings >
  Sync, phone too): tombstones, unused blobs (`findUnusedBlobs`, includes locked notes and
  history; only older than 30 days `BLOB_GRACE_MS` unless chosen), local blobs, orphan history, VACUUM.

## Note data model

- Body: XmlFragment `default`. Title: Y.Text `title` (`note-meta.ts`: `getTitleText`, `setTitle`
  with a minimal diff).
- Y.Map `settings` (absent = off): `pinned`, `favorite`, `archived`, `readOnly`, `noSpellcheck`
  (`getNoteFlag` / `setNoteFlag`), `trashedAt`, `deleted` (`deleteNoteForever` -> tombstone),
  `font`, `createdAt`, `published`, `locked`, `autoTitled`, legacy `notebook`.
- Y.Map `tags` and Y.Map `notebooks` (id -> true; several notebooks per note;
  `setNoteNotebook(doc, id, on)`).
- The sealed `content` column holds **note meta JSON** from `buildNoteMeta(doc)` (`{v:1, title,
  excerpt, links, ...flags, notebooks, tags, published, locked}`); every writer stores meta,
  never HTML (`decodeNoteMeta` still reads old HTML).
- Catalog (`catalog.ts`): hidden note `noted-catalog`, Y.Maps `notebooks`, `tags`, `vault`,
  `prefs`. **`isSystemNote(id)` must keep it out of every list.** `ensureCatalogEntry` reuses
  names case/accent-insensitively; create entries one at a time.

## Editor (shared; details in `docs/features.md`)

- **`packages/editor/extensions.ts` -> `createSchemaExtensions` is the only place nodes and
  marks are defined.** An editor that does not know a node can drop it and the loss syncs
  everywhere. `schema.test.ts` locks the names; rebuild the mobile bundle after changes.
- Module map: images `blob-image.ts` (attr `blob` = "<id>:<base64 key>", align / `x`, no float
  wrap) + `image-drag.ts` (`blockDropTarget`: lands after the last line block above, never
  between list items) + `image-tools.ts` / `image-viewer.ts`; `attachment.ts`; tables
  `table-tools.ts` + `TableResize`; `code-block.ts` / `code-themes.ts`; `callout.ts`; math
  (KaTeX); `note-link.ts` (atom `noteLink` {noteId}, `[[` suggestion, ranking `note-search.ts`);
  `list-convert.ts` (skips `y-sync$` transactions); `indent.ts` (block attr `indent` on paragraphs /
  headings); `heading-fold.ts` (collapsible headings, attrs `foldable` / `collapsed`); `search.ts`; `select-all.ts`;
  `clipboard-text.ts` (formulas copied as `$…$`); `markdown-paste.ts` (`markdownMath`: formulas
  before marked, also used by MCP); `export.ts`; `slash-items.ts` / `slash-nav.ts`;
  `toolbar-items.ts` (tested); reminders: inline atom `reminder` {id, at (ms), repeat
  (null|daily|weekly|monthly|yearly), done} in `reminder.ts` (pasted copies get new ids),
  dates in `reminder-time.ts` (pure, local-time repeats, tested), picker `reminder-picker.ts`
  (plain DOM: desktop `ReminderEditor.tsx` popover, phone sheet with the toolbar row hidden,
  `hideBar`), shortcut `reminder` (Ctrl+Alt+R, `requestReminderAtSelection`), copied text
  "» <date>" (no emoji), published copy shows the full date (publish-html.ts), morning / evening = EditorPrefs `reminderMorning` / `reminderEvening`,
  shared via the catalog (`SHARED_EDITOR_PREFS` with `titleTemplate`). Reminders view (NoteView
  `reminders`): note meta `reminders` [{id, at, repeat, done, text of the line}] (absent = old
  meta; `refreshStaleNoteMeta` re-indexes locally at start, same timestamp, no upload),
  reminders of their own in the catalog Y.Map `reminders` (`sync/reminders.ts`, also
  `updateReminderInDoc` for chips outside the editor), list logic `ui/src/reminder-list.ts`,
  desktop `RemindersList.tsx` + `ReminderPopover.tsx`, phone `RemindersView.tsx` +
  RN `ReminderSheet.tsx` (same pure functions as the page picker). Notifications: attr / field
  `snooze` (ms, null = none; due = `reminderDue` = snooze || at, keeps a repeating series),
  buttons Done / In 1 hour / Tomorrow = `applyReminderAction` (ignores stale notices: due must
  match), notice list `ui/src/reminder-notify.ts` (id "<entry key>@<due>", missed ones within
  12 h notify once). Desktop: Rust `src-tauri/src/reminders.rs` (timer thread + notify-rust
  D-Bus actions, `set_reminder_notices`, events `noted:reminder-shown` / `noted:reminder-action`,
  shown ids in localStorage `noted_reminders_shown`). Phone: `src/reminder-notifications.ts`
  (expo-notifications exact alarms, `USE_EXACT_ALARM`; buttons run the headless task
  `noted-reminder-action` defined via `index.ts`: opens the DB, changes the reminder, reschedules,
  syncs once; scheduled / shown ids in `<documents>/reminder-notices.json`; `noted-background-sync`
  (expo-background-task, ~15 min) syncs with the app closed). No Firebase / push: decided
  against (2026-10-17), reminders set elsewhere reach a closed phone within ~15 min. Colours `palette.ts` (CSS variable refs, custom = raw hex);
  shared `content.css`.
- **Drawing** (S Pen step 1, 2026-10-17): block `drawing` {height} (`drawing.ts`) whose content is
  `drawingStroke*` atoms {points, color, size, tool} -> strokes live IN the body (merge, Yjs undo,
  locked notes, copy / paste, history, export for free; a separate Y.Map would have leaked from
  locked notes). Points: `drawing-codec.ts` ("1:" + base64 zigzag varint deltas, x/y in drawing
  units, width 1000 = note width, pressure 0..1); shapes `drawing-render.ts` (perfect-freehand,
  `drawingSize` grows right / down beyond the strokes, `drawingSvg` for Markdown). Node view: pen
  or mouse draws, finger scrolls (a finger tap blurs = keyboard away), the block scrolls sideways
  and follows a stroke ending at the right edge, pointer down blurs the editor and saving keeps
  the scroll (WebKit scrolled to the selection). Slash rows all carry an MDI `icon`
  (`SlashItem.icon`, shared by desktop and phone, test enforces it).
  Step 2 (phone): pen kinds `DRAWING_TOOLS` pen / fountain / pencil / marker / highlighter
  (`TOOL_LOOK` in drawing-render.ts; unknown kinds draw as pen); tool state in
  `editor.storage.drawing` (`mode` pen / eraser, `eraser` 'stroke' | 'part', `tool`, `pens` =
  colour + width per kind, `active` + `onDrawingChange` for platform tool bars, cleared on
  editor focus); eraser geometry `drawing-erase.ts` (one transaction per eraser movement); pen
  eraser = `buttons & 32` / `button 5`. Phone: `apps/mobile/plugins/with-stylus.js` (MainActivity:
  `requestUnbufferedDispatch` on stylus down = ~480 Hz; side button held at contact start ->
  TOOL_TYPE_ERASER, button bits cleared, BUTTON_PRESS swallowed), floating bar
  `editor/drawing-bar.ts` (pen kinds, erasers, palette + custom colour via toolbar `pickColor`,
  width slider with a sample stroke); drawings are in the page's `NATIVE_TAP` (a tap never opens
  the keyboard).
  Step 3: toolbar platforms `desktopDrawing` / `mobileDrawing` (toolbar-items.ts: drawTool, one
  item per kind `DRAWING_TOOL_ITEMS`, eraseStroke / erasePart, drawColor, drawWidth, drawUndo /
  drawRedo), Settings > Toolbar "Drawing menu" (desktop) / "Drawing" (phone). Desktop
  `ui/src/DrawingMenu.tsx` floats above / below `storage.drawing.activeDom` like TableMenu, or
  under the zero-height slot of note properties "Drawing menu at the top" (prefs `drawingMenu`);
  right mouse button erases. Tool choices per device: `serializeDrawingTools` /
  `restoreDrawingTools` (desktop localStorage `noted_drawing_tools` via NoteEditor
  `drawingTools`; phone page posts `{type:'drawingTools'}`, RN SecureStore, sent back in
  `editorPrefs`).
  Option C (2026-10-18): `DrawingStarter` (drawing.ts, no schema) - a pen stroke on an empty
  top-level line turns it into a drawing, under the note starts one at the end (+ an empty line
  below), under a drawing (only empty lines between) writes on in it; the stroke is handed over
  without lifting the pen (`storage.drawing.views` -> node view `begin`, pointer capture); taps,
  text and the mouse are left alone unless desktop "Draw with the mouse" (top toolbar item
  `drawMode`, `setMouseDraws`, session only). Erasing the last stroke removes the block (same
  transaction). Desktop NoteEditor: while nothing has the focus, undo / redo go to the note
  worked in last (`lastUsedEditor`; portalled menus carry `data-editor-menu`). Yjs undo in
  happy-dom tests also reverts older changes: check undo in the app.
  Stage A (2026-10-18): the pen / mouse held still `HOLD_MS` at a stroke's end -> a cut when the
  stroke runs from one visible side to the other (`spansSides`, screen px of its first / last
  point, any shape: `belowCut` = outside the polygon cut + drawing top; the lower part becomes a
  drawing below, moved up and to the left), else `recognizeShape` (drawing-shapes.ts: line with
  45° snapping and a movable end, arrow, triangle, rectangle / square, ellipse / circle;
  polygon only when it fits clearly better than the ellipse). Grid paper = device tool state
  (`paper`, `gridSize` 20-160) shown only in the active drawing (SVG pattern, stripped from
  published copies); toolbar item `drawPaper` opens on / off + size. A tap on a drawing that is
  not active only wakes it (no dot). Phone plugin also takes the edges at the pen's height out
  of the system back gesture while the S Pen is near (`systemGestureExclusionRects`, 200 dp);
  re-running prebuild replaces its MainActivity block.
  Stage B (2026-10-18): lasso (`mode: 'lasso'`, toolbar item `drawLasso`; geometry in
  drawing-lasso.ts): a loop selects strokes mostly inside; the selection (stroke keys, node view
  state) shows a dashed box + corner handle (drag inside = move, handle = uniform scale incl.
  widths, one transaction each) and `.drawing-actions` (copy, cut, duplicate below, colour,
  delete, paste, clear) inside the figure; module-level `strokeClipboard` pastes into any drawing
  of the window (in place, or under the strokes when taken); desktop keys Ctrl+C / X / V / D,
  Delete, Esc. A pen stroke in an empty place always starts a drawing and switches back to the
  pen. CSS: the canvas rule is `.drawing-scroll > svg` (icons in the figure are svgs too).
  Finger drawing (2026-10-18): `mouseDraws` ("Draw with the mouse or finger", item `drawMode`, now
  also on the phone toolbar) makes a primary touch draw like the pen (node view and DrawingStarter);
  the phone drawing bar's ✕ turns it off. DrawingStarter treats the editor element itself (its
  min-height under the last block) as the page under the note.
  Stage C (2026-10-18): eraser ring under a hovering S Pen (eraser mode or side button held)
  and under the mouse in eraser mode; the page gets no hover, so `with-stylus.js` sends it
  (`window.__notedPenHover(x, y, sideButton)`, CSS px, ~60 Hz) -> `showPenHover` (drawing.ts).
- `/goto` and `/linkto` (`appendNoteLink` in sync/json-to-y.ts, never twice, not into locked notes).
- HEIC: desktop `src/heic.ts` (libheif-js), phone RN `{type:'convertHeic'}`.
- Files pasted from a file manager on desktop: WebKitGTK gives no data, so Rust
  `clipboard_file_paths` + `read_local_file` -> `insertFiles`.

## Desktop app (details in `docs/features.md`)

- Shell `App.tsx`: `NavPanel`, `NoteList`, `TabBar`, `StatusBar`, `SplitPane.tsx` (split /
  floating second `NoteEditor secondary`). Logic in `note-list.ts`, `link-tree.ts`,
  `note-groups.ts` (shared with the phone; link trees inside notebook / tag groups),
  `note-place.ts`; all tested. Device prefs in localStorage (`prefs.ts`).
- Shortcuts: `packages/ui/src/shortcuts.ts` registry, overrides `noted_shortcuts`.
- Pinch = note magnifier (`magnifier.ts`; lib.rs `redirect_pinch_zoom` -> `noted:pinch`).
- **All floating menus inside NoteEditor are portalled into `<body>` (`floating()`)** (CSS zoom
  scaled fixed coordinates); the page's mousedown handler ignores portal events.
- Note history (`history.ts`, table `note_history`, this device only). Restore carries `noteId`
  and is applied once (a sticky restore once overwrote every opened note).
- Dialogs only via `AppDialog.tsx` (`showDialog` / `confirmDialog` / `messageDialog`); never
  `window.confirm` or plugin-dialog `ask` / `message`. Own `Select` (native one paints white).
- Middle click does not paste (main.tsx swallows it). Window never scrolls.
- Tray, autostart (`--autostart`), single instance in release.

## Mobile app (details in `docs/features.md`)

- Editor = WebView page `apps/mobile/editor/`, RN <-> page messages `{type:...}` (requests with
  `requestId` / `reply`). Pages are not a secure context: no `crypto.randomUUID` (getRandomValues
  / `src/uuid.ts`). The page seals images / files itself and hands sealed bytes to RN (`storeBlob`).
- The editor is an overlay over the always-mounted list; Back hides it at once, the hidden
  EditorScreen flushes and saves first. Back goes through `{type:'back'}` / `backResult`.
- Keyboard: `react-native-keyboard-controller`; modals call `keyboardGone()`. ProseMirror's own
  scrolling is off; `centerCaret` only keeps the caret visible.
- Dialogs: `src/Dialog.tsx` `appAlert`, never `Alert.alert`.
- Text selection (2026-10-18): double taps go to Chromium (a selection set by code gets no
  handles); `selectionScroll` in toolbar.ts scrolls gently above the bar before Chromium's own
  fast edge scrolling; WebView haptics are off (`with-stylus.js`, handle ticks buzzed). The
  transparent `::selection` on list / quote containers in content.css is desktop only
  (`html.webkitgtk`): Chromium passes it on to the text.
- Keyboard corrections (2026-10-21, `editor/autocorrect.ts`): a word the keyboard changed within the
  key that committed it (compositionupdate data at keydown != compositionend data) is remembered
  with its position (mapped per transaction, this session only); a caret in it shows the bar
  "↶ typed instead of corrected" above the keyboard. The undo types through `execCommand('insertText')`
  (a ProseMirror-made change dropped the keyboard's underlines on every corrected word); the swapped-back
  word is offered again only until the caret leaves it. While focused, single taps (until Chromium's
  long press / `contextmenu`) move the caret by code: Chromium's tap opened Android's spelling popup.
- Theme (`src/ui.tsx`): palette (`material-you` | `noted` | preset id, SecureStore
  `noted_theme_palette`) + brightness (auto / light / dark, `noted_theme_mode`). No reload:
  `T` is changed in place by `refreshTheme()`, every module style sheet is
  `themed(() => StyleSheet.create(...))` (made again per theme version), `Root` re-renders via
  `useThemeVersion()`, lists pass it as `extraData`, EditorScreen re-sends `{type:'theme'}`.
  Never keep theme colours in module constants or `useMemo` / `useRef`.
- Battery (`src/battery.ts`, expo-battery): background sync needs Noted off battery
  optimization; asked once when reminders exist, Settings > Sync "Background sync" row.
- Home screen widget "Reminders" (`react-native-android-widget`, app.json plugin):
  `src/reminder-widget.tsx` (groups = `reminderGroups` in ui/src/reminder-list.ts),
  task `src/reminder-widget-task.tsx` (headless; circle = `runNoticeAction(.., 'done')`),
  taps open `noted://note/<id>`, `noted://reminders`, `noted://reminders/new` (NotesScreen
  Linking). Redrawn when the list / theme changes, after background sync and actions, every 30 min.
  It shows reminder text on the home screen even with the app lock on.

## Claude Code integration (`apps/mcp`, 2026-10-18)

- One more device of the vault: `noted-mcp setup` (passphrase once -> data key + auth epoch in
  `~/.config/noted-mcp/key.json`, 0600), own sealed copy `~/.local/share/noted-mcp/notes.db`
  (node:sqlite, loaded via `createRequire`: vitest does not know it) through `mergingNoteStore`,
  sync before calls (5 s throttle) and pushed right after every change. `scripts/install.sh` builds,
  links `~/.local/bin/noted-mcp`, `claude mcp add --scope user noted`. Tests: `pnpm -C apps/mcp exec vitest run`,
  typecheck `pnpm -C apps/mcp exec tsc --noEmit`.
- Hidden from Claude (`notes.ts`): catalog, deleted, locked notes and notes in the notebook
  "Protected" (`NOTED_MCP_PROTECTED`, comma list); checked on the doc itself, writes that would
  move a note out of reach are refused, links to hidden notes show "protected note". No deletes.
- Markdown (`markdown.ts`): images / drawings / files = tokens `⟦image 1⟧` on their own line,
  reminders / note links inline `⟦reminder 1: …⟧` `⟦link 1: Title⟧`; `rewrite_note` keeps the
  original node for every unchanged block (marked.lexer raw == rendered block) and for tokens,
  refuses missing tokens unless `remove`; kept blocks stay in place in the Y.Doc (longest
  increasing run, `edits.ts applyRewrite`). Small edits work in the Y.Doc (`replaceText` keeps
  the formatting, `insertBlocks` joins a following list, `setTaskDone`). `$…$`, `$$…$$`, `==…==`,
  `> [!NOTE]` are converted before the editor's HTML parser (happy-dom globals in `dom.ts`).
- Images: `read_note images: true` decrypts images (blob cache `~/.local/share/noted-mcp/blobs`)
  and draws drawings as PNG (resvg-wasm). Reminders: list / add (own in the catalog, or a chip in
  a note line) / update (done = `completeReminder`, snooze). `undo_last_change`: snapshot of
  title / body / notebooks / tags / flags before each change (table `history`); a created note goes to the trash.

## Publishing, backups, import, theme (details in `docs/features.md`)

- Publishing: `sync/publish.ts` + `ui/src/publish-html.ts`; server `apps/api/src/publish.ts`
  (separate public Hono server: `/`, `/viewer.js`, `/p/:id`, `/p/:id/data`); viewer
  `apps/api/viewer/viewer.ts` (sandboxed srcdoc iframe). Deleting a note for good unpublishes it.
- **Live publishing** (2026-10-18, desktop confirmed): Publish dialog switches "Live" + "Allow editing",
  same link `/p/:id#key`. NotePublish `live` / `editable`, note meta `live`. Keys `deriveLiveKeys`
  (crypto; from the link key or `publishPasswordKey`): `content` seals the Yjs snapshot + updates, server
  keeps SHA-256 of `read` (needed for ANY download: no offline password guessing) and `write`.
  Server `apps/api/src/live.ts`: tables `live_shares` / `live_updates` (global seq), private `/live/:id`
  (PUT snapshot + settings, `snapshotSeq` compacts the queue; the snapshot covering more wins), owner
  devices send `liveUpdate` / `liveAwareness` on the private WS and get `live` / `liveAwareness`;
  public `/p/:id/live` (header X-Live-Read), `/p/:id/live/info` (password?), `/p/:id/blob/:blob` (only
  blobs the owner listed), WS `/p/:id/ws` (join; 4403 bad token, 4404 gone, 4409 settings changed,
  4410 reload; limits: 1 MB update, 20 MB queue, 20 guests / note, token buckets). Owner logic
  `sync/live-owner.ts` (`createLiveOwner`: merge queue, `acceptGuestUpdates` in `sync/live.ts` refuses
  any guest update touching settings / tags / notebooks - and, Yjs being ordered, all later ones of that
  guest; compaction snapshot on connect and 60 s after guest edits, and 1.5 s after own edits that
  add a file (the snapshot's `blobs` list is what guests may download: an image added by the
  owner stayed "not uploaded yet" for guests until the next snapshot); the guest page asks again
  on 404 (8 x 2 s); seq per device in localStorage `noted_live_seq`). Desktop App: `liveOwner`, `watchDoc` on the active note, cursors via
  `y-protocols` Awareness + CollaborationCaret (`NoteEditor extraExtensions`, editor key `:live`,
  owner label "Owner"). Guest page `apps/web/src/LiveApp.tsx` + `live-client.ts` (name in localStorage,
  no note links / notebooks / tags / reminders / note font / images from URLs; a local change of protected
  types stops sending). NoteEditor props `slashItems`, `noteLinks`, `extraExtensions` exist for it.
  Guests of an editable note add images / files (2026-10-25): the page compresses + seals each with its own
  key and uploads it first (`PUT /p/:id/blob/:blob`, read + write token headers; `liveGuestUpload` in
  live.ts: 30 MB a file, 100 MB of guest files a note, 20 a minute, write-once ids, never an id the share's
  `blobs` lists), table `live_guest_blobs` (outlives the share) lets guests download them before a
  snapshot lists them; the owner's apps load them like any blob. After a sync (hourly) desktop and phone
  run `cleanUpGuestFilesHourly` (sync/guest-files.ts): private `GET /live/guest-files` (`settled` = no
  guest update after the upload waits outside a snapshot), delete those no note uses
  (`POST /live/guest-files/delete`, guest files only) once older than 1 h; with an unreadable locked
  note (vault closed) only files of notes still live and readable.
  Removing a live link or replacing it with a static copy first merges the guest edits the server still
  queues (`afterLiveCatchUp` + `liveOwner.catchUp` in live-owner.ts; desktop `publishActive`, phone
  `publish` / `unpublish`): `PUT` / `DELETE /publish/:id?after=<merged seq>` answers 409
  (`GuestEditsWaiting`) while newer guest edits wait, the app merges again, 3 tries. The page goes read only
  when the note holds nodes / attributes / marks its schema lacks (`unknownSchemaParts`,
  editor/schema-check.ts: an older server page once stripped collapsible headings from a note); guests
  export (Markdown / zip, text, HTML, PDF) in the browser; Ctrl+F hangs under `.live-top`.
  Desktop keeps an Awareness + caret for every open note (a key change on going live remounted the
  editor and closed the Publish dialog). Phone (confirmed 2026-10-18): `src/live.ts` (owner made in
  NotesScreen's WS effect, seq in SecureStore, `applyToNote` = updateNoteRecord + `onLiveNoteChanged`
  -> EditorScreen pushState at once), page `save` updates go out via `sendUpdate`, NoteMenu switches,
  `updateShare` right after publishing (the note list learns `live` only after a sync), page
  `setPublish` must keep `live` / `editable` / `passwordKey`, page saves every 400 ms while typing
  in a live note, cursors in the page (RN relays raw awareness). `NotePublish.passwordKey` = derived
  password key (no PBKDF2 in Hermes; the page derives it, `livePasswordKey`). Token hashes via
  `sha256Hex` (Hermes has no Web Crypto). Static copies strip `.collaboration-carets__*`.
- Backups `sync/backup.ts` (sealed notes + blobs + vault data; merge / replace / rollback,
  `compareBackup`); export all `sync/export-all.ts`; importer `ui/src/importers.ts` (ids per
  FILE, `importNoteDocs` merges duplicates and isolates per-note errors).
- Theme: `@noted/theme` CSS variables; desktop polls `$APPCONFIG/theme.json` (written e.g. by matugen).

## Status

Feature-complete for daily use (desktop Linux, Android, self-hosted server, MCP). In progress:
distribution to friends (releases, Windows, updates). Project status, decisions and open ideas:
`CLAUDE.local.md` (not in git).

## Incidents and gotchas

- All-zero key: a hot reload reset the key and a note was sealed with zeros. Guard: verifier
  check before sync; restart windows after entry-file changes.
- Lost text on slow connections (sync engine overwriting newer saves) -> `mergingNoteStore`.
- **Lost phone saves** (2026-10-17): Noted swiped away from the recent apps keeps its process
  (background sync, widget); opened again, the app re-runs in the same JS runtime and the shared
  expo-sqlite handle is dead (`prepareAsync` -> NullPointerException) -> every save failed
  silently. Fix: `openHealingDatabase` in `src/store.ts` (reopens with `useNewConnection` and
  repeats the call once) + EditorScreen keeps unsaved page updates (`unsavedRef`, merged with
  `Y.mergeUpdates`, retried every 2 s, alert after 3 failures). Release builds log console
  output to logcat (`adb logcat -s ReactNativeJS`).
- Lost edits after opening the already open note again (desktop note list / Reminders list,
  2026-10-17): `selectNote` made a new Y.Doc while the editor (created once) stayed on the old
  one and saves read the new one; edits vanished on restart. `selectNote` now keeps the live doc
  of the active note. Never swap `activeNote.ydoc` for the same note id.
- Notebooks missing after an import: `loadNotes` read the catalog before its pending 500 ms save;
  it now keeps notes with a pending save from memory.
- Import with duplicate file names -> "UNIQUE constraint failed: notes.id" -> ids per file.
- Stale phone JS (2026-10-18): Gradle took the old JS bundle as up to date after changes only
  in `packages/*` (outside apps/mobile), so `build-apk.sh` installed old code; the script now
  deletes the generated bundle first. Check a fix is in the APK: `grep -a -c <string>
  apps/mobile/android/app/build/generated/assets/react/release/index.android.bundle`.
  Strings of the editor page (non-Latin text inside) are UTF-16 in the Hermes bundle: grep them as
  `grep -a -c -P "h\x00e\x00a\x00d"`.
- `apps/mobile/android/` keeps the versionCode / versionName of the last prebuild: after
  `set-version.mjs` a local build installed as 0.1.0 (INSTALL_FAILED_VERSION_DOWNGRADE); re-run prebuild
  or fix `android/app/build.gradle`. CI generates it fresh.
- Phone page rewrite once cut `askReactNative` / `uuid`; check the bundle for helpers you removed.
- `build-editor.mjs` once shipped a page without content.css / KaTeX fonts (marker check added).
- Task item labels rewritten by Tiptap restarted Android IMEs (random capitals) -> `QuietTaskItem`.
- Task list CSS must use `> li`, not descendant `li` (nested lists lost their markers).
- Image drop must never land "between list items" (climbed out of the list).
- After a server wipe, phones must clear their app data (`adb shell pm clear`) or they re-upload.
- Metro + pnpm: explicit deps and metro config; warnings about `@noble/hashes/crypto.js` and
  `isomorphic-webcrypto` are harmless. Hermes lacks `crypto.randomUUID` and Web Crypto
  (`react-native-get-random-values` loaded first via `src/polyfill.ts`).
- react-native-webview types clash with React 19: `@ts-expect-error` on `<WebView>` is intentional.
- Node 25+ has a global `localStorage` without `getItem`; guard with
  `typeof localStorage.getItem === 'function'`.
