import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { DialogHost } from "@noted/ui";
import { resolveTheme } from "@noted/theme";
import { applyTheme, getThemeMode, watchSystemTheme } from "./theme";
import { routeFileDropsToEditors } from "./file-drop";
import { watchForUpdates } from "./updates";

// Colours before the first paint, then the system (matugen) theme as soon as it is read.
applyTheme(resolveTheme(getThemeMode(), null, window.matchMedia('(prefers-color-scheme: dark)').matches));
watchSystemTheme();
routeFileDropsToEditors();
watchForUpdates();

// Focus moving to an element outside the window (scrollIntoView) can still scroll the
// overflow-hidden document; put it back at once.
const resetWindowScroll = () => {
  const el = document.scrollingElement;
  if (el && (el.scrollTop || el.scrollLeft)) el.scrollTo(0, 0);
  for (const box of [document.body, document.getElementById("root")]) {
    if (box && (box.scrollTop || box.scrollLeft)) box.scrollTo(0, 0);
  }
};
window.addEventListener("scroll", resetWindowScroll);
document.getElementById("root")?.addEventListener("scroll", resetWindowScroll);

// Linux pastes the primary selection on a middle click. A middle click outside the text (closing
// a tab, opening a note in a new tab) must not paste into the note that ends up under the
// pointer or has the focus: such clicks are swallowed, and a paste right after one is dropped.
let middleOutsideAt = 0;
const inText = (target: EventTarget | null) =>
  !!(target as HTMLElement | null)?.closest?.('[contenteditable="true"], input, textarea');
window.addEventListener("mousedown", (e) => {
  if (e.button !== 1 || inText(e.target)) return;
  middleOutsideAt = Date.now();
  e.preventDefault();
}, true);
window.addEventListener("mouseup", (e) => {
  if (e.button === 1 && Date.now() - middleOutsideAt < 5000) e.preventDefault();
}, true);
window.addEventListener("paste", (e) => {
  if (Date.now() - middleOutsideAt > 800) return;
  middleOutsideAt = 0;
  e.preventDefault();
  e.stopImmediatePropagation();
}, true);
window.addEventListener("keydown", () => { middleOutsideAt = 0; }, true);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
    <DialogHost />
  </React.StrictMode>,
);
