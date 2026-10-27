# Noted — detailed feature reference

Implementation notes moved out of CLAUDE.md (2026-10-15, more on 2026-10-27, verbatim).
CLAUDE.md keeps only the file names and invariants; read the matching section here before
changing a feature. Full pre-trim copies: `docs/private/claude-md-full-*.md` (not in git).

## Editor (shared by desktop and the phone WebView)

- **`packages/editor/extensions.ts` -> `createSchemaExtensions` is the only place where nodes
  and marks are defined.** An editor that does not know a node can drop it and the loss syncs
  everywhere. `schema.test.ts` locks the names; change it only on purpose; rebuild the mobile
  bundle after changes.
- Schema: StarterKit (headings 1-6, quote, lists, hr, underline, link; its codeBlock off),
  TextStyle + Color + FontSize (px) + TextFont (`fontFamily`, only `var(--font-*)`), Highlight
  (multicolor), Sub/Superscript, TextAlign, TaskList / TaskItem (`QuietTaskItem`), ListStyles
  (bulletStyle / numberStyle / outline + collapsed), Collaboration, Placeholder, Image
  (`blob-image.ts`), Attachment, Table (+ `SizedTableRow` height, cell `background`), Callout,
  Math (`inlineMath` / `blockMath`, KaTeX), `noteLink`, `NotedCodeBlock`.
- Colours are CSS variable references from `palette.ts` (`var(--c-red)`, `var(--hl-red)`);
  custom colours raw hex. HSV helpers in `palette.ts`. `content.css` is shared (desktop import,
  inlined in the phone page); font stacks `--font-sans/serif/mono`, `--editor-font(-size)`.
- Slash menu: `slash-items.ts` tree + `slash-nav.ts` (search: titles first, keywords fallback;
  single match opens its choices). Opens upwards when needed; key presses set `keyboardMode` so a
  resting mouse does not steal the highlight.
- Links: `normalizeLinkUrl` validation; `onOpenLink` (desktop `openUrl` from plugin-opener,
  Ctrl+click or "Open"); right-click `LinkContextMenu`.
- Note links (`note-link.ts`): inline atom `noteLink` {noteId}; label = current title from
  `setNoteTitles(editor, map)` (unknown = struck "Missing note"); `[[` suggestion
  (`NoteLinkSuggestion`, ranking `note-search.ts`); always offers "Create note" (`canCreateNote`);
  new notes get the linking note's notebooks. Backlinks from meta.links.
- "/goto" (Go to note, opens it in a new tab) and "/linkto" (Link from another note: a link to
  THIS note goes at the end of the picked note, `appendNoteLink` in sync/json-to-y.ts, never
  twice, not into locked notes) are NoteActions kinds `goto` / `linkto`. Desktop: `NotePicker.tsx`
  (also Ctrl+P); phone: the note link sheet in mode goto / linkto, RN `{type:'linkFrom'}`.
- Images (`blob-image.ts`): node `image`, attr `blob` = "<id>:<base64 key>" (ONE attribute),
  `src` only for legacy base64, `width` / `height`, `align` (null / center / right / `inline`,
  `inline-center`, `inline-right` = side by side; `ImageRowLayout`, `imageRowAt`,
  `matchImageRowHeights`), `x` (0..1 = free horizontal place in the column after dragging,
  CSS `left: x*100%` + `translateX(-x*100%)`; the align buttons clear it; `imageX`). Text wrap
  around images was built and REMOVED again (no float). Moving: `image-drag.ts`
  (`ImageDragging` extension, both platforms; the browser's image drag and drop is off, it made
  copies): mouse press + move / touch hold 400 ms then drag; a see-through copy follows the
  pointer; it lands right AFTER the last line block (paragraph / heading / code / picture)
  whose top is above the copy's top edge, inside that block's container (under a list item's
  text = into that item), never "between list items" (that climbed out of the list and looked
  like nothing happened). `blockDropTarget(view, x, y, skip)`, `moveBlockTo`; a line under that
  block shows it. The let-go left edge sets `x` (snaps to left / centre / right within 6 px);
  touch locks the note's scrolling (overflow hidden) and auto-scrolls near the edges. One corner
  grip `.image-grip-br` (dotted square) resizes; mouse edges resize too. External http(s) src is NEVER loaded: `importImages` downloads it into
  a blob. Tools in `image-tools.ts`, full-screen `image-viewer.ts`. Compression WebP 1920 px
  ~1 MB (GIF kept). Paste / drop: `insertFiles`. Handlers via `configureBlobs(editor, ...)`.
  Files copied in a file manager (yazi `c y` = `wl-copy -t text/uri-list`): WebKitGTK lists the
  type `text/uri-list` but gives the page NO data and no files (it would paste the paths as
  text; checked with a probe program). `BlobHandlers.clipboardPaths` -> Rust
  `clipboard_file_paths` (GTK clipboard `request_uris` on the main thread) ->
  `BlobHandlers.readPaths` (Rust `read_local_file`, regular files <= 30 MB) -> `insertFiles`.
- **HEIC** (the phone camera's format; no engine here decodes it, `isHeicFile`): desktop
  `src/heic.ts` decodes with `libheif-js` (wasm, lazy chunk) to JPEG before compression; phone
  page asks RN `{type:'convertHeic'}` -> `src/heic.ts` (expo-image-manipulator, Android decoder,
  max 2560 px JPEG).
- Attachments (`attachment.ts`): block atom attrs blob / name / size / mime, card node view,
  Open (decrypted copy in a cache dir, wiped at start) and Save (download folder). Max 30 MB.
- Tables: `table-tools.ts` (move row / column -> 'moved' | 'edge' | 'merged', select parts,
  equal widths / heights), `TableResize` plugin (drag lines; mouse 4 px, touch 10 px after a
  250 ms hold; guide line; drops selection-only transactions while dragging),
  `FreshColumnsTableView`. Touch: hold in a cell then drag = cell selection.
- Code blocks (`code-block.ts`): CodeBlockLowlight (node `codeBlock`, attr `language`), bar with
  language picker ("Auto · X" via `detectCodeLanguage`) and Copy; colours `--code-*`; themes
  `code-themes.ts`, prefs `codeTheme` / `codeThemeByLanguage`. Tab = 2 spaces.
- Callout (`callout.ts`, variant / icon / color, drawn by CSS; inside a list wraps the outermost
  list). Math: `$$x$$` inline, `$$$x$$$` block; edit UI through `onEditMath` / `requestMathEdit`
  / `commitMathEdit`.
- Lists: `ListConvert` (`list-convert.ts`) rebuilds a list when switching kinds and joins
  adjacent lists of the same kind (skips `y-sync$` transactions).
- Indent (`indent.ts`): list = sink / lift, code = 2 spaces, paragraphs / headings = attribute
  `indent` (0-8 levels of 2em, `data-indent` + inline `margin-left`, the whole block moves). Tab
  inside a line (cursor not at its start, nothing selected) still types `\t`; Shift+Tab removes
  a tab before the cursor first, then a level, then an old leading tab. Backspace at the start
  of an indented block takes a level off (`IndentBackspace`, before the core keymap).
- Collapsible headings (`heading-fold.ts`): heading attrs `foldable` / `collapsed` (slash
  "Heading > Collapsible heading 1-3"); arrow `.heading-toggle` in the left margin folds the
  following siblings up to a heading of the same or higher level (node decorations
  `.heading-folded`, display none). Enter at the end of a folded heading opens it.
- Find / replace: `NoteSearch` (`search.ts`, decorations). Select all (`select-all.ts`): code
  block first, then the note; paints AllSelection itself. Copy (`clipboard-text.ts`): text/plain
  one line per block with list markers, formulas as `$…$` / `$$…$$` (painted selected:
  `.math-in-selection`, math.ts). Markdown paste (`markdown-paste.ts`, `marked`) for
  plain-text pastes that `looksLikeMarkdown`; `markdownMath` turns `$…$`, `$$…$$`, `\(…\)`, `\[…\]`
  and `==…==` into editor HTML before marked (it ate LaTeX backslashes), `> [!NOTE]` = callout
  (shared with the MCP server's `markdownBlocks`). `SymbolLigatures` (-> → etc.).
- Export (`export.ts`): Markdown / text; `exportAttachments` (sync/export-files.ts) writes
  `attachments/<16 chars of blob id>-<name>` linked from the Markdown (what the importer reads).
- Toolbar model (`toolbar-items.ts`, tested): `ToolbarConfig = {preset, groups}` (subgroups
  behind ⋮), platforms desktop / mobile / `desktopTable` / `mobileTable`; drag-to-edit helpers
  `toolbarMove`, `toolbarInsertAt`, `pruneToolbar`, drop position `ui/src/drop-index.ts`.

## Desktop app

- Note list (desktop `NoteList` and the phone's list share `packages/ui/src/note-groups.ts`,
  tested): rows = Pinned, Recent (edited < 7 days, max 10), then groups by **Notebook / Tag /
  A–Z / Date** (prefs `grouping`, old sort "notebook" / "tag" migrated). Inside a notebook or
  tag (also the single notebook / tag views) the notes are a TREE FROM NOTE LINKS (decided
  with the user, not sub-notebooks): a note linked from another note of the same group sits
  under it, children by title with numeric order, a note with two parents is under both,
  loops cut. Group headers start folded, Pinned / Recent / branches open; folds = keys flipped
  against the default (desktop prefs `listFolds`, phone `<documents>/list-folds.json`). Parents
  bolder, children indented with guide lines. A–Z / Date have no trees; Trash by date; search
  stays flat (Title / In the text). In a single notebook / tag view: grouping by the same
  kind = its tree; by the other kind / A–Z / Date = those groups inside it (no Pinned / Recent).
- Archiving / unarchiving a note (list menu, selection, note properties, phone note menu)
  offers "Only this" / "Archive all N" when notes sit under it in the link tree
  (`linkDescendants`: reachable through links AND deeper than it, depth = shortest distance
  from a note nothing links to, so back links up never take parents along).
- Shell (`App.tsx`): `NavPanel` (Notes / Favorites / Archive / Trash / Published, notebooks, tags,
  Links tree, gear), `NoteList` (grouped rows above, search with bold hits, multi-select with
  Ctrl / Shift, Delete key), `TabBar` (tabs, history, notebook / tag chips, ⋮ = `NoteProperties`),
  `StatusBar` (online dot from a 5 s `GET /` probe, sync, width, focus mode, zoom, word count,
  dates). Columns resize / hide / collapse to a rail (`Resizer`, widths in prefs).
  Logic in `note-list.ts`, `link-tree.ts` (tested). Device prefs in localStorage (`prefs.ts`).
- Keyboard shortcuts: registry `packages/ui/src/shortcuts.ts` (`SHORTCUT_ACTIONS` with
  defaults, combos like "Ctrl+Shift+[" from e.code, `matchesShortcut(e, id)`,
  `handleEditorShortcut` runs CHANGED formatting shortcuts and swallows their old defaults;
  unchanged ones stay with Tiptap's keymaps). Settings > Keyboard shortcuts
  (`ShortcutSettings.tsx`: record, remove, reset, clashes in red); overrides in localStorage
  `noted_shortcuts` (prefs.ts), set before render with `setShortcutOverrides`. App actions stop
  propagation when handled. Fixed: Ctrl+1..8 / Ctrl+9 tabs, Ctrl+wheel zoom.
- Touchpad pinch = MAGNIFIER of the note (like a browser's pinch: `magnifier.ts`, CSS transform
  on the note inside a sizer, no reflow, point under the pointer kept, scrolls both ways, back
  to 100 % ends it, reset on note change / zoom reset). WebKitGTK's own pinch magnifies the whole
  window and cannot be stopped from JS: lib.rs `redirect_pinch_zoom` disconnects WebKit's
  handlers on the GtkGestureZoom (object data "wk-view-zoom-gesture", GTK3) and emits
  `noted:pinch` {phase, scale}. App first dispatches a cancelable window event `PINCH_EVENT`
  (image-viewer.ts): an open picture viewer takes it and zooms the picture. The Ctrl+wheel /
  status bar zoom (CSS zoom, reflows) is separate.
- Formatting: `TopToolbar` (scrolls sideways, dropdowns portalled into `<body>`) or floating
  `FormatMenu`. "Font" = selection font when there is a selection, else the note font.
  `TableMenu` built from Settings > Toolbar > "Table menu" (floating above / below the table, or
  docked under the top toolbar).
- **Split view** (desktop, `SplitPane.tsx`): press a note in the list or a tab and drag it onto
  the note area (`beginNoteDrag`; tabs now select on click, not mousedown): outer quarter of a
  side = split there, middle = small floating window (`zoneAt`, `DropZones` preview). The second
  pane is a `NoteEditor secondary` (floating toolbar; ignores the app-wide export / publish /
  reveal events; Ctrl+F only while typing in it); its live doc gets stored states merged in
  (`splitAppliedRef`), closes when the note is trashed or becomes the main note. Bar: swap,
  turn, window / dock, close; divider ratio 20-80 %; the window moves by its bar and resizes
  (CSS resize). `focus-at` events only act in the pane whose area was clicked.
- Middle click outside text (closing tabs) no longer pastes the primary selection (main.tsx
  swallows the middle mousedown / mouseup and a paste right after it).
- **All floating menus inside NoteEditor are portalled into `<body>` (`floating()`)**: the note's
  CSS `zoom` scaled fixed coordinates. The page's mousedown handler ignores events from portals.
- Selection: NoteEditor takes over plain presses and drags that leave the text (`pointPos`);
  `noted:focus-at` puts the cursor at the nearest text when clicking the empty page.
- Note history (`history.ts`, table `note_history`, this device only): one row per editing
  session (10 min pause, newest 30), `HistoryPreview` with `diffHtml` (`html-diff.ts`), Restore /
  Save a copy. Restore carries `noteId` and is applied once (a sticky restore once overwrote
  every opened note).
- Dialogs: own `AppDialog.tsx` (`showDialog` / `confirmDialog` / `messageDialog`); never
  `window.confirm` or plugin-dialog `ask` / `message` (file pickers stay). Own `Select` (native
  <select> paints white in WebKitGTK).
- Integration: tray (Show / Quit, close / minimize to tray), autostart (plugin writes
  `~/.config/autostart/Noted.desktop` with `--autostart`; sessions without XDG autostart, e.g.
  Hyprland, can run `noted --autostart` themselves while that file exists), window `visible: false` and shown unless `--autostart`, single instance in release.
  Rust commands: `open_folder` (terminal file manager in a terminal), `notify` (notify-send with
  Quickshell notification icons when present), spell-check languages + Enchant word lists.
- Memory: WebKit cache model DocumentViewer, inspector off in release, `M_ARENA_MAX` 2.
  Measured ~720 MB PSS after 36 min (Notesnook ~400 MB).
- Window never scrolls (overflow hidden + scroll reset in main.tsx).

## Mobile app

- NotesScreen: list (same sections, search, sort sheet, multi-select by hold); no sync button in
  the header (sync runs on its own): the Drawer shows a dot (online primary / offline red) and
  the state under "Noted", a tap syncs now,
  `Drawer.tsx` (views, notebooks / tags with create, rename, delete), tabs (`TabsSheet.tsx`),
  split view (two editors, draggable divider, swap / turn). The editor is an overlay over the
  always-mounted list: Back hides it at once, the hidden EditorScreen flushes and saves first.
- The editor is a WebView page (`apps/mobile/editor/`), RN <-> page messages
  (`{type:...}`, requests with `requestId` / `reply`). Pages are not a secure context: no
  `crypto.randomUUID` (use getRandomValues / `src/uuid.ts`). The page seals images / files
  itself and hands sealed bytes to RN (`storeBlob`).
- Toolbar (`editor/toolbar.ts`, plain DOM): Notesnook layout, configured from Settings
  (normal + table toolbars), ⋮ card, sheets sliding up, table / cell rows, image row, "/" panel.
  Buttons cancel mousedown to keep the keyboard. The bar belongs to the keyboard (shown on
  keyboard show, hidden with `opacity: 0`).
- Keyboard: `react-native-keyboard-controller`; EditorScreen pads the WebView once by the
  keyboard's final height and sends `{type:'keyboard', shown}`; modals call `keyboardGone()`
  themselves (their window gets the events). `centerCaret` only keeps the caret visible
  (no typewriter scrolling). ProseMirror's own scrolling is off.
- Taps: while the editor is focused Chromium handles taps (spelling suggestions); unfocused taps
  are handled by the page (`focusAt`); double tap selects a word. Images and file cards are
  picked without a keyboard (`inputMode = 'none'`). Split view: a page without window focus posts
  `wantFocus` -> RN `requestFocus()`.
- Back: EditorScreen sends `{type:'back'}`; the page closes viewer / history / find / sheet first
  (`backResult`). NotesScreen Back closes the drawer.
- Note menu (`NoteMenu.tsx`, layout editable in Settings, `note-menu-layout.ts`): switches in
  pages, actions, attached files, history (`src/history.ts` + `editor/history-view.ts`), publish,
  export. Dialogs: `src/Dialog.tsx` `appAlert` (never `Alert.alert`).
- Files: Open = decrypted cache copy + VIEW intent; Save / export = download folder (SAF, asked
  once); share is a separate action.

## Publishing

- `sync/publish.ts`: a rendered copy (`PublishedNote` {title, html, css, font}, built by
  `ui/src/publish-html.ts`) sealed with a random key; link `PUBLIC_URL/p/<id>#<key base64url>`;
  settings `published` holds id, key, password, self destruct, expiry, `autoUpdate`.
- Upload `[0x4E, 1, flags]` + sealed (flag 1 = password; `publishPasswordKey` = PBKDF2 100k +
  HKDF). Headers `X-Self-Destruct: 1` (row deleted on the first data read), `X-Expires-At`.
- Server `apps/api/src/publish.ts`: private `PUT/GET/DELETE /publish/:id`; separate public Hono
  server with only `/`, `/viewer.js`, `/p/:id` (CSP, no-referrer, noindex), `/p/:id/data`.
  Viewer (`apps/api/viewer/viewer.ts`) decrypts in the browser, sandboxed srcdoc iframe, fetches
  only when visible and not prerendering.
- Auto update 15 s after the last edit and on close; apps poll self-destructing copies
  (`publishedExists`). Deleting a note for good unpublishes it.

## Settings, backups, import

- Desktop `SettingsDialog` (Ctrl+,) / mobile `SettingsScreen`: Account (vault, recovery key,
  passphrase, log out others), Sync, Appearance, Editor (title template `$date$ $time$`, font,
  size, ligatures, spell check, code themes, download folder), Toolbar (drag on the picture),
  Backup & export, Importer (desktop), Vault.
- Backups (`sync/backup.ts`): JSON of the sealed notes + sealed blobs (default on) + the vault
  data (`BackupVault`); only this vault opens them. Automatic daily / weekly (desktop
  `~/Documents/Noted backups`, phone a picked folder), due by the newest file, newest 10.
  Restore modes: merge (`mergeWithBackup`: CRDT merge + deleted blocks come back), replace,
  rollback; `compareBackup` per-note compare (desktop `BackupCompare.tsx`, phone history view in
  backup mode). Unlock screen on a server without a vault can set it up from a backup.
- Export all: md / txt / html zip (`sync/export-all.ts`, fflate, README.txt first).
- Importer (`ui/src/importers.ts`): Markdown / Obsidian, plain text, HTML, Notesnook export zip
  (files next to notes found by name, attachments, checklists, front matter). Ids per FILE;
  `importNoteDocs` merges duplicate copies (Notesnook exports a note once per notebook), skips
  notes already present, isolates per-note errors.

## Theme

- Material 3 roles from `@noted/theme` as CSS variables (`--bg-base`, `--bg-surface-*`,
  `--text-main/muted`, `--primary`, `--border`, ...). Presets `THEME_PRESETS` (Catppuccin, Nord,
  Gruvbox, Dracula, Tokyo Night, Rosé Pine, Solarized Light); `resolveTheme(mode, file, systemDark)`.
- Desktop polls `$APPCONFIG/theme.json` (the app config dir) every 3 s; matugen can write it
  (a template producing the theme.json format).
- Icons: Material Design Icons (`@mdi/js`).

## Server address, self-hosting, local-only mode

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

## Reminders

- Reminders: inline atom `reminder` {id, at (ms), repeat (null|daily|weekly|monthly|yearly), done} in `reminder.ts` (pasted copies get new ids), dates in `reminder-time.ts` (pure, local-time repeats, tested), picker `reminder-picker.ts` (plain DOM: desktop `ReminderEditor.tsx` popover, phone sheet with the toolbar row hidden, `hideBar`), shortcut `reminder` (Ctrl+Alt+R, `requestReminderAtSelection`), copied text "» <date>" (no emoji), published copy shows the full date (publish-html.ts), morning / evening = EditorPrefs `reminderMorning` / `reminderEvening`, shared via the catalog (`SHARED_EDITOR_PREFS` with `titleTemplate`). Reminders view (NoteView `reminders`): note meta `reminders` [{id, at, repeat, done, text of the line}] (absent = old meta; `refreshStaleNoteMeta` re-indexes locally at start, same timestamp, no upload), reminders of their own in the catalog Y.Map `reminders` (`sync/reminders.ts`, also `updateReminderInDoc` for chips outside the editor), list logic `ui/src/reminder-list.ts`, desktop `RemindersList.tsx` + `ReminderPopover.tsx`, phone `RemindersView.tsx` + RN `ReminderSheet.tsx` (same pure functions as the page picker). Notifications: attr / field `snooze` (ms, null = none; due = `reminderDue` = snooze || at, keeps a repeating series), buttons Done / In 1 hour / Tomorrow = `applyReminderAction` (ignores stale notices: due must match), notice list `ui/src/reminder-notify.ts` (id "<entry key>@<due>", missed ones within 12 h notify once). Desktop: Rust `src-tauri/src/reminders.rs` (timer thread + notify-rust D-Bus actions, `set_reminder_notices`, events `noted:reminder-shown` / `noted:reminder-action`, shown ids in localStorage `noted_reminders_shown`). Phone: `src/reminder-notifications.ts` (expo-notifications exact alarms, `USE_EXACT_ALARM`; buttons run the headless task `noted-reminder-action` defined via `index.ts`: opens the DB, changes the reminder, reschedules, syncs once; scheduled / shown ids in `<documents>/reminder-notices.json`; `noted-background-sync` (expo-background-task, ~15 min) syncs with the app closed). No Firebase / push: decided against (2026-10-17), reminders set elsewhere reach a closed phone within ~15 min.

## Drawing

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

## Mobile app (later additions)

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

## PDF (2026-10-27)

- Every PDF is A4 sheets laid out by the app, the same on every device: `editor/pdf-sheets.ts`
  copies the note (`noteFlow`: title + unfolded clone, `markPrintCopy` adds `print-copy`, the
  paper rules in content.css), measures it at the text width and `print-pages.ts paginate` finds
  where pages begin (headings stay with the next block, pictures / formulas / code up to a page
  move whole, paragraphs and long code split between lines, tables between rows with the header
  row repeated, `pageBreak` nodes); each sheet shows its slice (inline-block body, copy moved with
  `top`: a negative margin / plain block was paginated again by the print engine).
  Units: 1.25 CSS px per point (WebKitGTK's print scale; prints 1:1 there with GTK's 6.35 mm
  dialog margins, the sheet padding makes 16 mm). Chromium: `@page { margin: 0 }` + zoom 96/90;
  Android (expo-print): print media queries on the page width (desktop Chromium answers them with
  740 px). Fonts are bundled (`pdf-fonts.ts`: Inter + JetBrains Mono, OFL) and the type is 16 px
  whatever the editor settings: system fonts and font sizes made pages differ.
- Desktop: `/pdf` = `ui/src/PdfPreview.tsx` beside the note (per note / tab, width pref
  `pdfWidth`), rebuilt 500 ms after changes; Save PDF and Export > PDF: save dialog + Rust
  `print_pdf` (WebKitGTK PrintOperation to a file, A4, no dialog; elsewhere it answers
  "unsupported" and the print dialog opens). Live guest page: the same preview, browser print.
- Phone: the editor WebView follows the system font size (text zoom scales type and line height,
  not em spacing), so the PDF is made in its own WebView with `textZoom={100}`: `src/PdfPane.tsx`
  (page `editor/pdf.ts`, `pdfHtml.generated.ts`) under the note, open per note (`pdfOpenNotes`);
  the editor page sends the flow (`pdf-flow.ts`, `{type:'pdfFlow'}`, pictures once each as data
  URLs) after changes; Export > PDF goes the same way; expo-print with `textZoom: 100`.
- `/page break` (`/pg`): node `pageBreak` (page-break.ts), dashed line in editors only, left out
  of Markdown / text / HTML / published copies; MCP token `⟦page-break N⟧`.

## Live publishing

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

## Security, sync and data model (full notes; CLAUDE.md keeps the invariants)

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

Sync:

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

Data model:

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

