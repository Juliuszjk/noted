# Noted — detailed feature reference

Full implementation notes moved out of CLAUDE.md on 2026-10-15 (verbatim as of that day).
CLAUDE.md keeps only the file names and invariants; read the matching section here before
changing a feature. Full pre-trim CLAUDE.md: `docs/claude-md-full-2026-10-15.md`.

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
  around images was built and REMOVED on the user's wish (no float). Moving: `image-drag.ts`
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
- Indent (`indent.ts`): list = sink / lift, code = 2 spaces, other text = `\t`.
- Find / replace: `NoteSearch` (`search.ts`, decorations). Select all (`select-all.ts`): code
  block first, then the note; paints AllSelection itself. Copy (`clipboard-text.ts`): text/plain
  one line per block with list markers. Markdown paste (`markdown-paste.ts`, `marked`) for
  plain-text pastes that `looksLikeMarkdown`. `SymbolLigatures` (-> → etc.).
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
  `~/.config/autostart/Noted.desktop` with `--autostart`; the user's Hyprland session does not run
  XDG autostart, so `~/.config/hypr/autostart.lua` runs `noted --autostart` while that file
  exists), window `visible: false` and shown unless `--autostart`, single instance in release.
  Rust commands: `open_folder` (terminal file manager in a terminal), `notify` (notify-send with
  the user's quickshell icons), spell-check languages + Enchant word lists.
- Memory: WebKit cache model DocumentViewer, inspector off in release, `M_ARENA_MAX` 2.
  Measured ~720 MB PSS after 36 min (Notesnook ~400 MB).
- Window never scrolls (overflow hidden + scroll reset in main.tsx).
- The user's Quickshell bar shows workspace / notification glyphs from
  `~/.config/quickshell/utils/Icons.qml` and `services/NotificationService.qml` iconMaps (by
  window class / app name); "noted" was added there (backups `*.bak-noted-2026-10-13`).

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
- Theme: Material You (`@pchmn/expo-material3-theme`) or presets; changes reload the app
  (`reloadAppAsync`, also when `themeSignature()` changed). Styles are built at start.

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
- Desktop polls `$APPCONFIG/theme.json` (~/.config/com.apollo.desktop) every 3 s; matugen writes
  it (template `~/.config/matugen/templates/noted-theme.json`). **Do NOT run `matugen` to test**
  (other templates have post hooks); `matugen image <wall> --dry-run -j hex --prefer <x>` is safe.
- Icons: Material Design Icons (`@mdi/js`).

