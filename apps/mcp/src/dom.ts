import { Window } from 'happy-dom';

// The editor's HTML parser (Markdown -> nodes) needs a DOM; Node has none. Imported first:
// the window and its classes (HTMLElement, HTMLUListElement, DOMParser, ...) become globals,
// what Node has already (fetch, URL, navigator, ...) stays Node's.
const window = new Window({ url: 'https://noted.invalid/' });
// Standards mode (KaTeX warns in quirks mode).
window.document.write('<!DOCTYPE html><html><head></head><body></body></html>');
const g = globalThis as Record<string, unknown>;
const w = window as unknown as Record<string, unknown>;
g.window = window;
g.document = window.document;
for (const name of Object.getOwnPropertyNames(window)) {
  if (name in g || !/^[A-Z]/.test(name)) continue;
  try {
    g[name] = w[name];
  } catch {
    // a getter that needs a real browser
  }
}
g.getComputedStyle = window.getComputedStyle.bind(window);
