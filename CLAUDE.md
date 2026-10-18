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
apps/web       guest page of live published notes (React + NoteEditor, esbuild -> apps/api/src/live.generated.ts)
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
- Viewer bundle: `pnpm --filter api run build:viewer` -> `src/viewer.generated.ts`. Live note page:
  `pnpm --filter web run build:live` -> `apps/api/src/live.generated.ts` (after changes in apps/web or the
  shared packages it bundles; the build swaps `packages/config/server.ts` for a stub and fails if a server
  address ends up in the page).

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
- Text selection (2026-10-18): double taps go to Chromium (a selection set by code gets no
  handles); `selectionScroll` in toolbar.ts scrolls gently above the bar before Chromium's own
  fast edge scrolling; WebView haptics are off (`with-stylus.js`, handle ticks buzzed). The
  transparent `::selection` on list / quote containers in content.css is desktop only
  (`html.webkitgtk`): Chromium passes it on to the text.
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
  no uploads / note links / notebooks / tags / reminders / note font; a local change of protected types
  stops sending). NoteEditor props `slashItems`, `noteLinks`, `extraExtensions` exist for it.
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
after a fresh clone run `build:editor`, `build:viewer` and `build:live` first. Before going public: grep the
tracked files for addresses / names again.

**Drawing steps 1-3 done (2026-10-17)**: block + rendering everywhere, phone drawing (480 Hz,
side button eraser, pen kinds, erasers, colours incl. custom, width slider), desktop drawing
menu (floating / at the top), configurable drawing bars, remembered tool choices; option C
(pen on empty lines / under the note starts drawings), mouse draw mode; confirmed. Further
drawing ideas (overlay, annotations, handwriting) are parked until the user knows drawing is
useful, see the TODO.

## TODO / ideas (not decided yet, ask before doing)

- **S Pen** (plan 2026-10-13, waiting for the user's choices): block atom `drawing` {id, height, paper} in the shared schema;
  strokes in the note's Y.Doc (`Y.Map 'drawings'` id -> Y.Array of compact strokes: logical
  x/y, pressure, tool, palette colour name) so devices merge; SVG via `perfect-freehand`;
  drawing on a canvas (pen only, palm rejection, side button = eraser, coalesced / predicted
  events); later lasso, highlighter, paper, SVG export, ML Kit Digital Ink. **The user's wish
  (2026-10-17)**: the whole note text + drawing (draw anywhere over / between text, like Samsung
  Notes; "stage B" overlay anchored to blocks); fallback if that proves hard: pulling the S Pen
  out inserts a drawing block under the cursor. Option C done; the overlay over text, annotations
  and handwriting are parked (2026-10-18): the user first wants to see whether drawing as it is
  proves useful in daily use. **Phase 0 done
  (2026-10-17)**, probe in Vivaldi and injected over CDP into the editor WebView: pen =
  `pointerType 'pen'`, palm / finger = `touch` (ignore it; pen strokes never cancelled by the
  palm); pressure fine-grained but tops out ~0.47-0.59 (needs scaling); tiltX/Y + altitude /
  azimuth yes, twist no; `desynchronized` canvas yes. The page gets NO hover and never sees the
  side button (a stroke with it held never arrives; a click in the air = Samsung Air Command).
  Phase 0b (native probe in MainActivity, removed again): the Activity DOES get
  `BUTTON_STYLUS_PRIMARY` (buttonState 32) on DOWN/MOVE/UP and `ACTION_HOVER_*`; re-dispatching
  a copy with the button bit cleared makes the WebView see a normal pen stroke -> plan: native
  code strips the bit and tells the page "eraser" (held button = eraser like Samsung Notes).
  WebView pointermove is ~60 Hz (7-8 historical points per event natively);
  `window.decorView.requestUnbufferedDispatch(e)` on stylus ACTION_DOWN gives ~476 Hz in the
  WebView (like Chrome). An https `baseUrl` makes the page a secure context (coalesced events,
  `crypto.randomUUID`) but was not needed for the rate. Native code needs an Expo config plugin
  (android/ is generated). The editor under an overlay grabbed focus (keyboard): drawing mode must blur it.
- **Drawing: annotations on text** (parked 2026-10-18 until drawing proves useful): circles / underlines / arrows at
  words, anchored to characters and stored IN the body (invisible inline anchor node holding
  the strokes; never a separate Y.Map: locked notes, undo, copy / paste). Multi-word circles that
  rewrap differently and arrows between words can never fit every width.
- **Drawing: handwriting recognition** (parked 2026-10-18, same reason): ML Kit Digital Ink on the
  phone, offline (weak for math). Exporting a drawing as an image: the user does not need it.
- **Live notes: guests pasting images / files** (parked 2026-10-18, "maybe some day"): public
  `PUT /p/:id/blob/:blobId` with the write token (editable only), per-file / per-note quotas +
  rate limits, guest page compresses + seals, owner accepts blob nodes and lists them. ~1 round.
- Claude integration (postponed): local MCP server as one more device; a public key-holding
  server was advised against.
- Low priority: embeds (the user called them a gimmick). Rejected (2026-10-18): attachments
  > 30 MB, download subfolders by notebook / type.
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
