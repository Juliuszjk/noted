# Noted — project memory for Claude Code

Local-first, end-to-end encrypted, zero-knowledge notes app (Notion-like editor, Notesnook-like
encryption and UI). Personal tool of one user (personal details in `CLAUDE.local.md`, not in git).

**More detail lives in `docs/`** (read the relevant part before changing a feature):
- `docs/features.md`: full notes on Editor, Desktop, Mobile, Publishing, Settings/backups/import, Theme.
- `docs/private/claude-md-history-2026-10-12.md` (not in git): history of all rounds (1-25), rejected ideas, old TODO detail.
- `docs/private/claude-md-full-2026-10-15.md` (not in git): the complete CLAUDE.md before it was trimmed.

## Working rules (from the user, always apply)

- Talk to the user in **Polish**. Write all code and code comments in **English**.
- **Git / GitHub** (private repo, see CLAUDE.local.md): commit and push **only after the user has
  tested a finished feature and confirmed it works as wanted**; then commit (message, splitting,
  branches as you see fit) and push without asking. Before every commit grep the staged files for
  personal data (addresses, names, e-mail). Never force-push or rewrite history unasked.
- The user's shell is **fish** (Mercury's too). Commands you hand to the user must work in fish,
  or be wrapped with `bash -c '...'`. Heredocs and `$(...)` do not work in fish; use `; and`.
- After any change to an app entry file (e.g. `apps/desktop/src/App.tsx`) **restart the app
  windows**, do not rely on Vite hot reload (a hot reload once reset the master key to zeros).
- Small, verifiable steps: change, then tests + typecheck, then **rebuild and install the
  affected apps without asking** (desktop install script, phone APK; see "Running"), then ask
  the user to test. Make a backup copy of files you rewrite heavily.
- Never weaken the encryption or the zero-knowledge server to "make something work".
- Ideas in "TODO / ideas" are not decided: ask before building them.

## Stack and layout

pnpm workspaces + Turborepo (pnpm's default isolated layout, no .npmrc).

```
apps/desktop   Tauri v2 + React + TS. Package "desktop", Cargo package "noted". SQLite via tauri-plugin-sql.
apps/mobile    Expo, Android. Release APK on the phone. Editor = WebView page (apps/mobile/editor). SQLite via expo-sqlite.
apps/api       Hono + better-sqlite3 + ws, Docker on the server "Mercury".
apps/web       placeholder (future guest editor / viewer)
packages/crypto   XChaCha20-Poly1305 (@noble/ciphers), Argon2id + HKDF (@noble/hashes 1.8)
packages/sync     Yjs merge, API client, sync engine, editor bridge, backups, import/export helpers
packages/editor   Tiptap schema (single source of truth), slash menu, toolbar model, content.css
packages/ui       Desktop React components (NoteEditor, menus, dialogs, settings, importers) + shared list logic
packages/config   API_URL, timeouts, storage keys
packages/types    NoteRecord, RemoteNote, VaultMode
packages/media    image compression (WebP)
packages/theme    Material 3 colour roles -> CSS variables, presets
packages/db, crdt   empty
```

## Running, building, testing

- Desktop dev: `pnpm --filter desktop run tauri dev`
- Desktop production (installed): `apps/desktop/scripts/install-linux.sh` builds
  (`tauri build --no-bundle`, ~4 min) and installs `~/.local/bin/noted`, icons and
  `~/.local/share/applications/noted.desktop`. `--no-build` only installs. Identifier stays
  `com.apollo.desktop` (same SQLite file as dev, own localStorage). Do not run dev and the
  installed app at the same time (one database). Icons: `pnpm tauri icon src-tauri/icons/icon-source-1024.png`.
- Second desktop instance (sync testing; debug builds skip single-instance):
  `mkdir -p /tmp/noted-b && env XDG_DATA_HOME=/tmp/noted-b/data XDG_CONFIG_HOME=/tmp/noted-b/config XDG_CACHE_HOME=/tmp/noted-b/cache apps/desktop/src-tauri/target/debug/noted`
- Mobile dev (Expo Go over Tailscale):
  `REACT_NATIVE_PACKAGER_HOSTNAME=$(tailscale ip -4) pnpm --filter mobile exec expo start -c`
- **Mobile APK** (package `com.apollo.noted`): `apps/mobile/scripts/build-apk.sh` = Gradle
  `assembleRelease` (arm64-v8a) with JDK 21 from mise (Java 25 breaks CMake), then
  `adb install -r`. `android/` is generated (`npx expo prebuild --platform android`, CNG;
  app.json + plugins are the source: icons, `allowBackup: false`, cleartext HTTP to the
  Tailscale API, `plugins/with-release-signing.js`). Release key:
  `~/.config/noted-android/noted-release.keystore` + `signing.properties` (outside the repo).
  The user's phone (see CLAUDE.local.md); adb works for testing (screencap, input, screenrecord + ffmpeg).
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
- Viewer bundle: `pnpm --filter api run build:viewer` -> `src/viewer.generated.ts`.

## Server

Docker (`infra/docker`: `Dockerfile.api`, `docker-compose.yml`), one container `noted_api` with the
private API (port 3000) and the public publish server (port 3001). Host, addresses, deploy
commands, backups and Tailscale rules: **`CLAUDE.local.md`** (not in git, read it before deploying).
Server addresses for the apps: `packages/config/server.ts` (not in git; template `server.example.ts`);
compose bind IP: `infra/docker/.env` (`NOTED_BIND_IP`, not in git).

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
  passphrase still derives the data key (no rotation, no OS keyring: the user's choice).
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
  `list-convert.ts` (skips `y-sync$` transactions); `indent.ts`; `search.ts`; `select-all.ts`;
  `clipboard-text.ts`; `markdown-paste.ts`; `export.ts`; `slash-items.ts` / `slash-nav.ts`;
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
  (expo-background-task, ~15 min) syncs with the app closed). No Firebase / push: the user
  rejected it (2026-10-17), reminders set elsewhere reach a closed phone within ~15 min. Colours `palette.ts` (CSS variable refs, custom = raw hex);
  shared `content.css`.
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
- Tray, autostart (`--autostart`; Hyprland runs it from `~/.config/hypr/autostart.lua`),
  single instance in release. Quickshell icon maps include "noted".

## Mobile app (details in `docs/features.md`)

- Editor = WebView page `apps/mobile/editor/`, RN <-> page messages `{type:...}` (requests with
  `requestId` / `reply`). Pages are not a secure context: no `crypto.randomUUID` (getRandomValues
  / `src/uuid.ts`). The page seals images / files itself and hands sealed bytes to RN (`storeBlob`).
- The editor is an overlay over the always-mounted list; Back hides it at once, the hidden
  EditorScreen flushes and saves first. Back goes through `{type:'back'}` / `backResult`.
- Keyboard: `react-native-keyboard-controller`; modals call `keyboardGone()`. ProseMirror's own
  scrolling is off; `centerCaret` only keeps the caret visible.
- Dialogs: `src/Dialog.tsx` `appAlert`, never `Alert.alert`.
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

## Publishing, backups, import, theme (details in `docs/features.md`)

- Publishing: `sync/publish.ts` + `ui/src/publish-html.ts`; server `apps/api/src/publish.ts`
  (separate public Hono server: `/`, `/viewer.js`, `/p/:id`, `/p/:id/data`); viewer
  `apps/api/viewer/viewer.ts` (sandboxed srcdoc iframe). Deleting a note for good unpublishes it.
- Backups `sync/backup.ts` (sealed notes + blobs + vault data; merge / replace / rollback,
  `compareBackup`); export all `sync/export-all.ts`; importer `ui/src/importers.ts` (ids per
  FILE, `importNoteDocs` merges duplicates and isolates per-note errors).
- Theme: `@noted/theme` CSS variables; desktop polls `$APPCONFIG/theme.json` (matugen).
  **Do NOT run `matugen` to test** (post hooks); `matugen image <wall> --dry-run -j hex` is safe.

## Status (2026-10-17)

Rounds up to 28 confirmed (history in docs; round 26/27 detail: `notePlaces` in
`ui/src/note-place.ts`, archived notes out of pickers, phone file paste / drop, Markdown zip with
attachments, phone "Clean up storage"; round 28: "[[" / "Link to note" picker shows the most
recently edited notes first like "/goto" (`searchNotes` keeps the caller's order for an empty
query; desktop `summaries` and phone `titles` sorted by `updated_at` desc), server moved to
Mercury `~/docker/noted/` and added to `mercury-update`). **Caveat** (round 27): each device's
clean-up only knows ITS OWN history, so it can delete a server file only another device's old
version uses.
The user imported all Notesnook notes (2026-10-16) and uses Noted daily: real data now, be careful.

**Reminders done (2026-10-17)**: stages 1-3 (chips, Reminders view, notifications) plus the
battery prompt, theme without reload (Material You as the first palette card) and the home
screen widget, all confirmed and pushed. The phone's background sync needs Noted's battery
"Unrestricted": with Samsung Power saving on, Android blocks the job
(`readyNotRestrictedInBg: false` in `adb shell dumpsys jobscheduler`). Decided: no Firebase /
push; notification icon = the app's icon; buttons Done / In 1 hour / Tomorrow (English UI).

Git: private GitHub repo (details in CLAUDE.local.md). Personal data stays out of git: server
addresses (`packages/config/server.ts`, `infra/docker/.env`), `CLAUDE.local.md`, `docs/private/`,
`apps/api/data`. Generated files (`*.generated.ts`, `apps/mobile/android/`) are not committed:
after a fresh clone run `build:editor` and `build:viewer` first. Before going public: grep the
tracked files for addresses / names again.

## TODO / ideas (not decided yet, ask before doing)

- **Shared editing by link**: guests edit one note live with a limited editor; share key in the
  fragment, server relays sealed Yjs updates per share id (public WebSocket on the Funnel port,
  rate limits), owner's app merges. Guest page in apps/web must use `createSchemaExtensions` as is.
- **S Pen** (plan 2026-10-13, waiting for the user's choices): block atom `drawing` {id, height, paper} in the shared schema;
  strokes in the note's Y.Doc (`Y.Map 'drawings'` id -> Y.Array of compact strokes: logical
  x/y, pressure, tool, palette colour name) so devices merge; SVG via `perfect-freehand`;
  drawing on a canvas (pen only, palm rejection, side button = eraser, coalesced / predicted
  events); later lasso, highlighter, paper, SVG export, ML Kit Digital Ink. Phase 0 = probe S Pen
  pointer events in the WebView over adb.
- Attachments > 30 MB: chunked sealed blobs + encrypted manifest, server storing files.
- Claude integration (postponed): local MCP server as one more device; a public key-holding
  server was advised against.
- Low priority: download subfolders by notebook / type; embeds (the user called them a gimmick).
- **Final stage: distribution to friends** (2026-10-16; no iPhone). Blockers first: the server is
  single-user (one `vault` row) and `API_URL` is the hard-coded Tailscale IP. The user's choice:
  NO multi-user accounts on Mercury; friends either run their own server (Docker image + server
  address chosen at first start) or use the apps without any server (local-only mode on the
  desktop / phone; details still to be worked out together). Then:
  GitHub repo (clean personal data first, see "Open") + GitHub Releases built by Actions:
  Windows `.msi` / `.exe` (Tauri, Windows runner; unsigned = SmartScreen warning), Android APK
  (own release key, CI secrets), Linux AppImage; Tauri updater maybe. Arch: AUR `PKGBUILD`
  (`-bin` from the release, or from source); check whether the name "noted" is taken.

## Incidents and gotchas

- All-zero key: a hot reload reset the key and a note was sealed with zeros. Guard: verifier
  check before sync; restart windows after entry-file changes.
- Lost text on slow connections (sync engine overwriting newer saves) -> `mergingNoteStore`.
- Lost edits after opening the already open note again (desktop note list / Reminders list,
  2026-10-17): `selectNote` made a new Y.Doc while the editor (created once) stayed on the old
  one and saves read the new one; edits vanished on restart. `selectNote` now keeps the live doc
  of the active note. Never swap `activeNote.ydoc` for the same note id.
- Notebooks missing after an import: `loadNotes` read the catalog before its pending 500 ms save;
  it now keeps notes with a pending save from memory.
- Import with duplicate file names -> "UNIQUE constraint failed: notes.id" -> ids per file.
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
- Old diagnostic script `/tmp/noted-diag.mts` sends no auth token. Old profiles: `~/noted-backup`.
