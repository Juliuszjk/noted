import { unsealBytes, publishPasswordKey } from '@noted/crypto';

// Viewer of a published note (served by the public server, bundled into viewer.generated.ts).
// The key is the link's #fragment, which browsers never send to the server. The decrypted
// note is shown in a sandboxed srcdoc frame: no scripts run there, links open in a new tab.

interface Published {
  v: 1;
  title: string;
  html: string;
  css: string;
  font?: string | null;
  publishedAt: number;
}

const status = document.getElementById('status')!;
const frame = document.getElementById('note') as HTMLIFrameElement;

const fromBase64Url = (text: string): Uint8Array => {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4);
  const binary = atob(b64);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
};

const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

// Colours for the note's CSS variables: light, or dark when the reader's system is dark.
const THEME = `
  :root { color-scheme: light dark; --text-main: #1b1b1f; --text-muted: #5f5f66; --bg-base: #ffffff; --bg-surface: #f3f3f5;
    --bg-surface-low: #f7f7f9; --bg-surface-high: #ececef; --bg-surface-highest: #e4e4e8; --border: #cfcfd6; --border-focus: #9a9aa3;
    --primary: #6750a4; --primary-fg: #ffffff; --secondary-container: #e8def8; --on-secondary-container: #1d192b; --error: #b3261e; }
  @media (prefers-color-scheme: dark) {
    :root { --text-main: #e6e0e9; --text-muted: #a6a0aa; --bg-base: #141218; --bg-surface: #211f26; --bg-surface-low: #1d1b20;
      --bg-surface-high: #2b2930; --bg-surface-highest: #36343b; --border: #49454f; --border-focus: #79747e; --primary: #d0bcff;
      --primary-fg: #381e72; --secondary-container: #4a4458; --on-secondary-container: #e8def8; --error: #f2b8b5; }
  }
  html, body { margin: 0; background: var(--bg-base); color: var(--text-main); }
  body { font-family: var(--font-sans, system-ui, sans-serif); }
  article { max-width: 760px; margin: 0 auto; padding: 32px 20px 64px; }
  .published-title { font-size: 2em; font-weight: 700; margin: 0 0 6px; line-height: 1.25; }
  .published-date { color: var(--text-muted); font-size: 13px; margin-bottom: 24px; }
  .published-footer { margin-top: 48px; color: var(--text-muted); font-size: 12px; text-align: center; }
  .ProseMirror { outline: none; }
  .ProseMirror img { max-width: 100%; height: auto; }
  .ProseMirror input[type=checkbox] { pointer-events: none; }
`;

// Defence in depth (the frame runs no scripts anyway): no script-like elements or handlers,
// links open outside.
const clean = (html: string): string => {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.firstElementChild!;
  root.querySelectorAll('script, iframe, object, embed, form, meta, link, base').forEach((el) => el.remove());
  root.querySelectorAll('*').forEach((el) => {
    for (const attr of [...el.attributes]) {
      if (/^on/i.test(attr.name) || (/^(href|src|xlink:href)$/i.test(attr.name) && /^\s*javascript:/i.test(attr.value))) el.removeAttribute(attr.name);
    }
    if (el.tagName === 'A') {
      el.setAttribute('target', '_blank');
      el.setAttribute('rel', 'noopener noreferrer');
    }
  });
  return root.innerHTML;
};

let destroyed = false;

const show = (note: Published) => {
  document.title = note.title || 'Untitled';
  const date = new Date(note.publishedAt).toLocaleString();
  frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">`
    + `<style>${note.css.replace(/<\/style/gi, '')}</style><style>${THEME}</style></head>`
    + `<body${note.font ? ` data-note-font="${escapeHtml(note.font)}"` : ''}><article>`
    + `<div class="published-title note-title">${escapeHtml(note.title || 'Untitled')}</div>`
    + `<div class="published-date">Published ${escapeHtml(date)}</div>`
    + `${clean(note.html)}<div class="published-footer">Published with Noted · end-to-end encrypted`
    + `${destroyed ? '<br>This note was deleted from the server when you opened it: this was the only view.' : ''}</div></article></body></html>`;
  status.style.display = 'none';
  frame.style.display = 'block';
};

const fail = (text: string) => { status.textContent = text; };

// Browsers may load a page ahead (prerendering a pasted address, link previews): the data
// is fetched only once the page is really shown, or a self-destructing note would be used up
// by a load nobody saw.
const whenShown = () => new Promise<void>((resolve) => {
  const ready = () => !(document as any).prerendering && document.visibilityState === 'visible';
  if (ready()) return resolve();
  const check = () => {
    if (!ready()) return;
    document.removeEventListener('visibilitychange', check);
    document.removeEventListener('prerenderingchange', check);
    resolve();
  };
  document.addEventListener('visibilitychange', check);
  document.addEventListener('prerenderingchange', check);
});

(async () => {
  await whenShown();
  const id = location.pathname.split('/')[2] ?? '';
  const keyText = location.hash.slice(1);
  if (!keyText) return fail('This link is missing its key (the part after #).');
  let key: Uint8Array;
  try {
    key = fromBase64Url(keyText);
    if (key.length !== 32) throw new Error('bad key');
  } catch {
    return fail('This link is damaged.');
  }
  const res = await fetch(`/p/${encodeURIComponent(id)}/data`, { cache: 'no-store' }).catch(() => null);
  if (!res) return fail('Could not load the note. Check your connection.');
  if (res.status === 404) return fail('This note is not published any more.');
  if (!res.ok) return fail('Could not load the note.');
  destroyed = res.headers.get('X-Self-Destructed') === '1';
  const data = new Uint8Array(await res.arrayBuffer());
  // "N", format 1, flags (bit 0 = password), then the sealed note.
  if (data[0] !== 0x4e || data[1] !== 1) return fail('This note was published by a newer version of Noted.');
  const sealed = data.slice(3);
  const open = (k: Uint8Array): boolean => {
    try {
      show(JSON.parse(new TextDecoder().decode(unsealBytes(k, sealed))) as Published);
      return true;
    } catch {
      return false;
    }
  };
  if (!(data[2] & 1)) {
    if (!open(key)) fail('This link does not open this note (wrong key).');
    return;
  }
  // Password protected. The bytes stay here, so a typo costs nothing (even after a one-time
  // view deleted the copy from the server).
  status.style.display = 'none';
  const form = document.getElementById('unlock') as HTMLFormElement;
  const input = document.getElementById('password') as HTMLInputElement;
  const error = document.getElementById('unlock-error')!;
  form.style.display = 'block';
  input.focus();
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    error.textContent = 'Checking…';
    setTimeout(() => {
      if (open(publishPasswordKey(key, input.value))) form.style.display = 'none';
      else error.textContent = 'Wrong password.';
    }, 20);
  });
})();
