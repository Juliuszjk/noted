# Release matrix

What a release has to get right, and what checks it. `pnpm verify:release` runs every row marked
**auto**; rows marked **manual** need a person and a device, right before a release. Commands and
safety notes: CLAUDE.md, "Release check".

Engines in the browser tests:

- **Chromium**: the desktop harness (the shared `NoteEditor`) and, emulated as a phone, the real
  phone pages from `apps/mobile/src/*.generated.ts`. Stands in for WebView2 and Android WebView.
- **WebKitGTK**: the system's webkit2gtk-4.1, the engine of the Linux app, headless in Weston; PDFs
  go through the same calls as `print_pdf`. It has no real mouse: layout, PDF and DOM-event checks only.
- **Firefox**: for the guests of live pages; the editor, exports and SVG run there too.

Tests live in `apps/release-check/tests/`. Fix commit in brackets: reverting that fix made the test
fail when it was written, except the two rows marked "guard", which pass without their fix because
something else also holds the behaviour.

## Editor interactions

| Check | How | Test |
| --- | --- | --- |
| Typing, shortcuts, undo | auto: Chromium, Firefox | `editor.spec` |
| Slash menu inserts blocks | auto: Chromium, Firefox | `editor.spec` |
| Task box ticks without moving the cursor | auto: Chromium, Firefox | `editor.spec` |
| Code block Tab, Ctrl+A in steps | auto: Chromium, Firefox | `editor.spec` |
| Note survives a render and parse round trip | auto: Chromium, Firefox | `editor.spec` |
| Schema, slash nav, tables, drawing logic, shapes | auto: unit | `packages/editor/*.test.ts` |
| Mouse selection feel in WebKitGTK (drag over bullets, beside the column) | manual: Linux app | |
| Image drag, resize, drawing with the S Pen | manual: phone, Linux app | |

## Heading folding

| Check | How | Test |
| --- | --- | --- |
| A press and tiny drag on an arrow keeps the cursor or selection [1b1ac9a] | auto: Chromium, Firefox, WebKitGTK (DOM events) | `fold.spec`, `engines.spec` |
| Double click on an arrow, drags across and into the arrow margin | auto: Chromium, Firefox | `fold.spec` |
| The toggled heading stays put on the screen [0dfd9ec] | auto: Chromium, Firefox; guard, the browser's scroll anchoring also holds it there | `fold.spec` |
| Folding far from the caret leaves the phone page still [0dfd9ec] | auto: phone pages; guard, as above | `phone.spec` |
| Fold range, cursor moved out of folded text, Enter on a folded heading | auto: Chromium, Firefox | `fold.spec` |
| Taps in a note ending in a folded section [0dfd9ec] | auto: phone pages | `phone.spec` |
| Fold arrow tap target [4e70a31] | auto: phone pages (area and real taps) | `phone.spec` |
| Folding with a real finger, mouse selection around arrows in WebKitGTK | manual: phone, Linux app | |

## Lists and paste

| Check | How | Test |
| --- | --- | --- |
| Enter continues and leaves a list | auto: Chromium, Firefox | `lists-paste.spec` |
| Tab and Shift+Tab: whole list, single item, by real keys [afdb3f4] | auto: Chromium, Firefox | `lists-paste.spec` |
| Indented lines becoming lists, joining list kinds | auto: Chromium, Firefox | `lists-paste.spec` |
| Markdown, LaTeX, plain text, web HTML, code block pastes; no remote image loaded | auto: Chromium | `lists-paste.spec` |
| Copy and paste inside a note keeps formulas [d3b1720] | auto: Chromium (real clipboard) | `lists-paste.spec` |
| Paste from other apps into the real windows, files from a file manager | manual: Linux app, phone | |

## SVG

| Check | How | Test |
| --- | --- | --- |
| Drawn large before compression, proportions, no viewBox [2e610cb] | auto: Chromium, Firefox | `svg.spec` |
| Shown at its own size | auto: Chromium, Firefox | `svg.spec` |
| Scripts do not run, linked files are not fetched, a broken file does no harm | auto: Chromium, Firefox | `svg.spec` |
| Size parsing | auto: unit | `packages/editor/svg-size.test.ts` |
| SVG from the phone's file picker | manual: phone | |

## Publishing, static and live

All of it against the real API on loopback with a throwaway database.

| Check | How | Test |
| --- | --- | --- |
| Link opens in the real viewer; the server holds only sealed bytes; the key is never sent | auto: Chromium | `publish.spec` |
| Password, self destruct, unpublish, wrong key | auto: Chromium | `publish.spec` |
| Viewer frame runs no scripts; fits a phone | auto: Chromium | `publish.spec` |
| Live page: read only, two guests editing, reload keeps edits, password | auto: Chromium | `publish.spec` |
| Live page layout at phone, tablet, desktop width | auto: Chromium, screenshots | `publish.spec` |
| Guest HTML export | auto: Chromium | `publish.spec` |
| Keys, guest update rules, owner merge queue | auto: unit | `packages/sync/*.test.ts` |
| Publishing from the real apps to the real server, owner merges guest edits | manual: Linux app, phone, server | |
| Funnel address reachable from outside the tailnet | manual | |

## HTML export

| Check | How | Test |
| --- | --- | --- |
| One self-contained file: no links, no remote fonts, no requests | auto: Chromium, Firefox | `html-export.spec` |
| Folded parts stay folded, arrows work; a ticked task stays ticked | auto: Chromium, Firefox | `html-export.spec` |
| Code Copy button | auto: Chromium | `html-export.spec` |
| Dark system, markup in a title, phone width | auto: Chromium, Firefox | `html-export.spec` |
| The saved file from the real save dialogs | manual: Linux app, phone | |

## PDF, automatic export

| Check | How | Test |
| --- | --- | --- |
| Folded headings and outline items reach paper, the note stays folded [4e70a31] | auto: Chromium, phone pages, WebKitGTK | `pdf.spec`, `phone.spec`, `engines.spec` |
| A4, bundled fonts, no editor furniture, page breaks, no line lost or doubled | auto: Chromium | `pdf.spec` |
| Headings wrap alike: desktop, phone PDF page, WebKitGTK; Firefox line counts [7a6e88f] | auto | `engines.spec` |
| WebKitGTK and Chromium PDFs: same pages, same text, same picture (blurred) | auto: 4 notes, through `print_pdf`'s GTK calls | `engines.spec` |
| Phone PDF has the desktop's pages and text; ticked tasks stay ticked | auto: phone pages | `engines.spec`, `phone.spec` |
| Preview rebuilds after edits, Save PDF prints those sheets | auto: Chromium (live page), phone pages | `publish.spec`, `phone.spec` |
| `print_pdf` itself: save dialog, file written, toast | manual: Linux app | |
| expo-print on the phone (its own page width, system font size) | manual: phone, with a large system font | |
| Windows print dialog path | manual: Windows | |

## Linux desktop

| Check | How | Test |
| --- | --- | --- |
| TypeScript, front end build, `cargo check --offline --locked` | auto | `verify.mjs` |
| The engine: see the WebKitGTK rows | auto | `engines.spec` |
| AppImage and deb from CI, install, start, tray, autostart | manual | |
| Updater from the previous version | manual | |
| Sync between two instances (CLAUDE.md, second desktop instance) | manual | |
| Pinch magnifier, split view, tabs, spell check, reminders | manual | |

The pipeline never starts the app (dev and installed builds share one SQLite file) and never runs
`install-linux.sh`.

## Android

| Check | How | Test |
| --- | --- | --- |
| RN <-> page messages all handled, bundles build | auto | `build:editor` in `verify.mjs` |
| TypeScript: app and WebView pages | auto | `verify.mjs` |
| Tap targets: fold and outline arrows, toolbar | auto: phone pages, 412 px, touch | `phone.spec` |
| No sideways scrolling at 360 and 412 px | auto: phone pages | `phone.spec` |
| Typing reaches React Native as a save | auto: phone pages | `phone.spec` |
| APK build, install over the previous version, updates | manual: `apps/mobile/scripts/build-apk.sh` installs on the phone, so it stays out of the pipeline | |
| Real keyboard: corrections bar, IME, S Pen, back gesture | manual: phone | |
| Background sync, reminders, widget, biometrics | manual: phone | |

Emulated Chromium is close to Android WebView but has no keyboard, system font scale or native
shell around it.

## Known app issues

Each has a test marked `test.fail`: the run stays green and lists it, and the test turns red once
the issue is gone, so this list cannot go stale.

- **Task box tap target**: about 17 x 26 CSS px on the phone (WCAG 2.2 minimum 24 x 24; the fold
  arrows have about 28 x 46). A design decision: `phone.spec`.
- **Double space at a line's end in PDFs**: with `white-space: break-spaces`, a word that fits the
  line while the double space after it does not stays there in WebKitGTK and Firefox and moves
  down in Chromium (phone, Windows). The line count can differ, rarely, and so can the pages. Fixture
  `wrapEdge`: `engines.spec`.

## Before a release, by hand

1. Linux: CI AppImage or deb, start, open a real note, fold, select around arrows, Save PDF, open
   the PDF.
2. Phone: install the APK over the old one, fold with a finger, tick tasks, export a PDF with a
   large system font.
3. Publish a note live from the app, open it on another device, edit, unpublish.
4. Updater: previous version on desktop and phone finds the new one.
5. Windows: start, print dialog PDF.
