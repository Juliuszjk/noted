import Image from '@tiptap/extension-image';
import type { Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { isSvgFile, parseSvg, svgSize } from '@noted/media/svg-size';

// Images stored as encrypted blobs. The image node keeps its name and attributes; a new `blob`
// attribute holds "<blobId>:<base64 key>" in ONE attribute, so concurrent edits on two devices
// can never pair the id of one blob with the key of another. `src` stays for old base64
// images and for images pasted from the web; both are moved into blobs by importImages.
// External (http) images are never loaded directly: that would tell the third-party site
// that the note is being read. Turning a reference into something <img> can show is
// platform work: the app registers handlers with configureBlobs.

export interface BlobRef {
  id: string;
  key: string;
}

export const formatBlobRef = (ref: BlobRef): string => `${ref.id}:${ref.key}`;

export const parseBlobRef = (value: unknown): BlobRef | null => {
  if (typeof value !== 'string') return null;
  const at = value.indexOf(':');
  if (at <= 0 || at === value.length - 1) return null;
  return { id: value.slice(0, at), key: value.slice(at + 1) };
};

export interface BlobHandlers {
  // URL for <img> (e.g. an object URL of the decrypted bytes); null if the blob is not
  // available yet (the device that added it has not uploaded it).
  resolve: (ref: BlobRef) => Promise<string | null>;
  // Gives back a URL from resolve once the image no longer shows it (the app may then free
  // the decrypted picture). Every non-null resolve is released exactly once.
  release?: (ref: BlobRef) => void;
  // Stores a picked/pasted/dropped image and returns its reference. Absent = read only.
  upload?: (file: File) => Promise<BlobRef>;
  // Stores already prepared image bytes (used to migrate old base64 images).
  storeBytes?: (bytes: Uint8Array) => Promise<BlobRef>;
  // Downloads an image from the web and stores it (image from URL, pasted web images).
  storeUrl?: (url: string) => Promise<BlobRef>;
  // Stores any file as is (attachments).
  uploadFile?: (file: File) => Promise<BlobRef>;
  // Reads local files by path (files copied in a file manager are pasted as file:// URIs).
  readPaths?: (paths: string[]) => Promise<File[]>;
  // Paths of the files on the clipboard, for engines that announce text/uri-list to the page
  // without giving it (WebKitGTK).
  clipboardPaths?: () => Promise<string[]>;
  // Opens / saves a decrypted attachment.
  openFile?: (ref: BlobRef, name: string) => Promise<void>;
  saveFile?: (ref: BlobRef, name: string) => Promise<void>;
  // Shows an error to the user (failed upload, file too large, ...).
  notify?: (message: string) => void;
}

type ImageView = { render: () => void };

interface BlobImageStorage {
  handlers: BlobHandlers | null;
  views: Set<ImageView>;
  // Set by the UI: asks the user for an image URL to insert at `pos` (slash "Image from URL").
  requestUrl: ((pos: number) => void) | null;
}

declare module '@tiptap/core' {
  interface Storage {
    image: BlobImageStorage;
  }
}

const MISSING_RETRY_MS = 15_000;
const MIN_IMAGE_PX = 40;

export const imagePx = (value: unknown): number | null => {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  return Number.isFinite(n) && n >= 1 ? Math.round(n) : null;
};
// 'inline*' = side by side: images next to each other that are all 'inline*' share a row (as many
// as fit), e.g. a few small pictures; 'inline-center' / 'inline-right' place the row like the
// alignment of a single image (ImageRowLayout).
export type ImageAlign = 'center' | 'right' | 'inline' | 'inline-center' | 'inline-right';
const ALIGNS = new Set(['center', 'right', 'inline', 'inline-center', 'inline-right']);
export const imageAlign = (value: unknown): ImageAlign | null => (ALIGNS.has(value as string) ? value as ImageAlign : null);
export const isSideBySide = (align: unknown): boolean => typeof align === 'string' && align.startsWith('inline');
// Free horizontal place of an image dragged sideways (image-drag.ts): 0 = left edge of the
// column, 1 = right edge; null = by `align`.
export const imageX = (value: unknown): number | null => {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : null;
};
// Left / center / right, side by side or not.
export const imageBaseAlign = (align: unknown): 'left' | 'center' | 'right' => {
  const a = imageAlign(align);
  return a === 'center' || a === 'inline-center' ? 'center' : a === 'right' || a === 'inline-right' ? 'right' : 'left';
};
export const composeImageAlign = (base: 'left' | 'center' | 'right', sideBySide: boolean): ImageAlign | null =>
  sideBySide ? (base === 'left' ? 'inline' : `inline-${base}`) : (base === 'left' ? null : base);

// Rows of side-by-side images are inline blocks in the note's own line boxes, which only align
// left. A centred / right row gets its free space as the left margin of the first image on
// each visual line, measured after every change and on resize.
const layoutImageRows = (root: HTMLElement) => {
  const style = getComputedStyle(root);
  const inner = root.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const runs: HTMLElement[][] = [];
  let run: HTMLElement[] = [];
  const walk = (parent: Element) => {
    for (const child of Array.from(parent.children) as HTMLElement[]) {
      if (child.classList.contains('image-node') && isSideBySide(child.getAttribute('data-align'))) {
        run.push(child);
        continue;
      }
      if (run.length) runs.push(run);
      run = [];
      // Images inside list items, quotes, callouts, cells.
      if (!child.classList.contains('image-node') && child.querySelector('.image-node[data-align^="inline"]')) walk(child);
    }
    if (run.length) runs.push(run);
    run = [];
  };
  walk(root);
  for (const images of runs) {
    for (const el of images) el.style.marginLeft = '';
    const base = imageBaseAlign(images[0].getAttribute('data-align'));
    if (base === 'left') continue;
    const parent = images[0].parentElement!;
    const ps = getComputedStyle(parent);
    const width = parent === root ? inner : parent.clientWidth - parseFloat(ps.paddingLeft) - parseFloat(ps.paddingRight);
    // Visual lines: images with the same top.
    const lines: HTMLElement[][] = [];
    for (const el of images) {
      const line = lines[lines.length - 1];
      if (line && Math.abs(line[0].offsetTop - el.offsetTop) < 2) line.push(el);
      else lines.push([el]);
    }
    for (const line of lines) {
      const used = line.reduce((sum, el) => sum + el.offsetWidth + parseFloat(getComputedStyle(el).marginRight || '0'), 0);
      // The last image's right margin is only a gap between pictures.
      const last = line[line.length - 1];
      const free = width - used + parseFloat(getComputedStyle(last).marginRight || '0');
      if (free > 1) line[0].style.marginLeft = `${Math.floor(base === 'center' ? free / 2 : free)}px`;
    }
  }
};

const imageRowsKey = new PluginKey('imageRows');
const ImageRowLayout = new Plugin({
  key: imageRowsKey,
  view: (view) => {
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => layoutImageRows(view.dom as HTMLElement));
    };
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
    observer?.observe(view.dom);
    // Pictures change size when they finish loading.
    view.dom.addEventListener('load', schedule, true);
    schedule();
    return {
      update: (_view, prev) => { if (!prev.doc.eq(view.state.doc)) schedule(); },
      destroy: () => {
        cancelAnimationFrame(frame);
        observer?.disconnect();
        view.dom.removeEventListener('load', schedule, true);
      },
    };
  },
});

export const BlobImage = Image.extend<any, BlobImageStorage>({
  addStorage() {
    return { handlers: null, views: new Set(), requestUrl: null };
  },

  addAttributes() {
    return {
      ...this.parent?.(),
      blob: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-blob'),
        renderHTML: (attrs: Record<string, any>) => (attrs.blob ? { 'data-blob': attrs.blob } : {}),
      },
      // Size in px set by the image menu or the corner handle (the height follows the width);
      // null = natural size, never wider than the note.
      width: {
        default: null,
        parseHTML: (el: HTMLElement) => imagePx(el.getAttribute('width') ?? el.style.width),
        renderHTML: (attrs: Record<string, any>) => (imagePx(attrs.width) ? { width: String(imagePx(attrs.width)) } : {}),
      },
      height: {
        default: null,
        parseHTML: (el: HTMLElement) => imagePx(el.getAttribute('height') ?? el.style.height),
        renderHTML: (attrs: Record<string, any>) => (imagePx(attrs.height) ? { height: String(imagePx(attrs.height)) } : {}),
      },
      x: {
        default: null,
        parseHTML: (el: HTMLElement) => imageX(el.getAttribute('data-x')),
        renderHTML: (attrs: Record<string, any>) => (imageX(attrs.x) === null ? {} : { 'data-x': String(imageX(attrs.x)) }),
      },
      // 'center' | 'right'; null = left.
      align: {
        default: null,
        parseHTML: (el: HTMLElement) => imageAlign(el.getAttribute('data-align')),
        renderHTML: (attrs: Record<string, any>) => (imageAlign(attrs.align) ? { 'data-align': attrs.align } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'img[data-blob]' }, ...(this.parent?.() ?? [])];
  },

  addProseMirrorPlugins() {
    return [...(this.parent?.() ?? []), ImageRowLayout];
  },

  addNodeView() {
    return ({ node: initial, getPos, editor }) => {
      let node = initial;
      // Wrapper: alignment / free place, and the corner grips that resize the image. Moving is
      // image-drag.ts (not the browser's drag and drop, which made copies).
      const dom = document.createElement('div');
      dom.className = 'image-node';
      dom.draggable = false;
      const img = document.createElement('img');
      // Pictures far below the visible part are decoded only when scrolled near (memory).
      img.loading = 'lazy';
      img.decoding = 'async';
      dom.appendChild(img);
      img.draggable = false;
      // Grip in the bottom right corner (a dotted square, shown on hover / when selected);
      // dragging it resizes the picture.
      const grip = document.createElement('span');
      grip.className = 'image-grip image-grip-br';
      grip.title = 'Drag to resize';
      dom.appendChild(grip);
      const layout = () => {
        const width = imagePx(node.attrs.width);
        img.style.width = width ? `${width}px` : '';
        dom.setAttribute('data-align', imageAlign(node.attrs.align) ?? 'left');
        const x = isSideBySide(node.attrs.align) ? null : imageX(node.attrs.x);
        if (x === null) {
          dom.removeAttribute('data-x');
          dom.style.removeProperty('--x');
        } else {
          dom.setAttribute('data-x', String(x));
          dom.style.setProperty('--x', String(x));
        }
      };
      // Resizing: the picture follows at once, the note gets one edit at the end. `dir` = 1
      // when dragging the right side (wider to the right), -1 for the left side.
      const startResize = (e: PointerEvent, target: HTMLElement, dir: 1 | -1) => {
        e.preventDefault();
        e.stopPropagation();
        target.setPointerCapture(e.pointerId);
        const scale = img.getBoundingClientRect().width / (img.offsetWidth || 1) || 1;
        const startX = e.clientX;
        const startWidth = img.offsetWidth;
        const ratio = img.naturalWidth ? img.naturalHeight / img.naturalWidth : img.offsetHeight / (img.offsetWidth || 1);
        const maxWidth = Math.max(MIN_IMAGE_PX, dom.parentElement?.clientWidth ?? startWidth);
        let width = startWidth;
        dom.classList.add('resizing');
        const move = (ev: PointerEvent) => {
          width = Math.round(Math.min(maxWidth, Math.max(MIN_IMAGE_PX, startWidth + (dir * (ev.clientX - startX)) / scale)));
          img.style.width = `${width}px`;
        };
        const up = () => {
          target.removeEventListener('pointermove', move);
          target.removeEventListener('pointerup', up);
          target.removeEventListener('pointercancel', up);
          dom.classList.remove('resizing');
          const pos = typeof getPos === 'function' ? getPos() : undefined;
          if (typeof pos !== 'number' || width === startWidth) return layout();
          editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, width, height: Math.round(width * ratio) || null }));
        };
        target.addEventListener('pointermove', move);
        target.addEventListener('pointerup', up);
        target.addEventListener('pointercancel', up);
      };
      grip.addEventListener('pointerdown', (e) => {
        if (!editor.isEditable || e.button > 0) return;
        startResize(e, grip, 1);
      });
      // Mouse: near an edge or a corner of the image the pointer becomes a resize arrow, and
      // pressing there resizes (like Notesnook).
      const EDGE = 8;
      const edgeAt = (e: PointerEvent): { dir: 1 | -1; cursor: string } | null => {
        if (e.pointerType !== 'mouse' || !editor.isEditable) return null;
        const r = img.getBoundingClientRect();
        if (e.clientY < r.top || e.clientY > r.bottom) return null;
        const nearTop = e.clientY - r.top < EDGE;
        const nearBottom = r.bottom - e.clientY < EDGE;
        if (r.right - e.clientX < EDGE && e.clientX <= r.right + 2) return { dir: 1, cursor: nearBottom ? 'nwse-resize' : nearTop ? 'nesw-resize' : 'ew-resize' };
        if (e.clientX - r.left < EDGE && e.clientX >= r.left - 2) return { dir: -1, cursor: nearBottom ? 'nesw-resize' : nearTop ? 'nwse-resize' : 'ew-resize' };
        return null;
      };
      dom.addEventListener('pointermove', (e) => {
        if (dom.classList.contains('resizing')) return;
        const edge = edgeAt(e);
        img.style.cursor = edge?.cursor ?? '';
      });
      dom.addEventListener('pointerleave', () => { img.style.cursor = ''; });
      dom.addEventListener('pointerdown', (e) => {
        const edge = e.button === 0 ? edgeAt(e) : null;
        if (edge) startResize(e, dom, edge.dir);
      });
      let retry: ReturnType<typeof setTimeout> | null = null;
      // Ignores results of an older render after the node changed.
      let generation = 0;
      // The blob whose URL this image holds (given back when it changes or goes away).
      let held: BlobRef | null = null;
      const letGo = () => {
        if (held) this.storage.handlers?.release?.(held);
        held = null;
      };

      const setState = (state: 'ready' | 'loading' | 'missing' | 'error') => img.setAttribute('data-blob-state', state);

      const view: ImageView = {
        render: () => {
          generation++;
          if (retry) clearTimeout(retry);
          retry = null;
          const { alt, title, src } = node.attrs;
          if (alt) img.alt = alt; else img.removeAttribute('alt');
          if (title) img.title = title; else img.removeAttribute('title');
          layout();
          const ref = parseBlobRef(node.attrs.blob);
          // Already showing this blob: nothing to load again.
          if (ref && held?.id === ref.id && img.getAttribute('src')) return;
          if (!ref) {
            letGo();
            if (typeof src === 'string' && /^https?:/i.test(src)) {
              // Imported into a blob by importImages; never fetched from the third party here.
              img.removeAttribute('src');
              img.alt = 'External image (not imported yet)';
              setState('missing');
              return;
            }
            if (src) img.src = src;
            setState('ready');
            return;
          }
          const handlers = this.storage.handlers;
          img.removeAttribute('src');
          setState('loading');
          if (!handlers) return; // rendered again once the app registers handlers
          const mine = generation;
          handlers.resolve(ref).then(
            (url) => {
              if (mine !== generation) {
                if (url) handlers.release?.(ref);
                return;
              }
              if (url) {
                letGo();
                held = ref;
                img.src = url;
                setState('ready');
              } else {
                setState('missing');
                img.alt = 'Image not uploaded yet';
                retry = setTimeout(view.render, MISSING_RETRY_MS);
              }
            },
            (err) => {
              if (mine !== generation) return;
              console.error('Image blob failed:', err);
              setState('error');
              img.alt = 'Image could not be loaded';
              retry = setTimeout(view.render, MISSING_RETRY_MS);
            },
          );
        },
      };

      view.render();
      this.storage.views.add(view);
      return {
        dom,
        update: (updated) => {
          if (updated.type !== node.type) return false;
          const changed = updated.attrs.blob !== node.attrs.blob || updated.attrs.src !== node.attrs.src
            || updated.attrs.alt !== node.attrs.alt || updated.attrs.title !== node.attrs.title;
          node = updated;
          if (changed) view.render();
          else layout();
          return true;
        },
        destroy: () => {
          if (retry) clearTimeout(retry);
          generation++;
          letGo();
          this.storage.views.delete(view);
        },
      };
    };
  },
});

// Registers the platform's blob handlers and renders images that were waiting for them.
export const configureBlobs = (editor: Editor, handlers: BlobHandlers | null): void => {
  const storage = editor.storage.image;
  if (!storage) return;
  storage.handlers = handlers;
  storage.views.forEach((view) => view.render());
  editor.storage.attachment?.views.forEach((view) => view.render());
};

// Local paths in a paste: text/uri-list (or plain text) made only of file:// URIs, as file
// managers put copied files on the clipboard. Null when it is anything else.
export const pastedFilePaths = (uriList: string, plain: string): string[] | null => {
  const lines = (uriList || plain).split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  if (lines.length === 0 || !lines.every((l) => /^file:\/\//i.test(l))) return null;
  try {
    return lines.map((l) => decodeURIComponent(new URL(l).pathname));
  } catch {
    return null;
  }
};

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

// HEIC / HEIF photos (phone cameras): no browser engine here decodes them, the platform's
// upload handler converts them first. Their type is often empty, so the name counts too.
export const isHeicFile = (file: File): boolean =>
  /^image\/hei[cf]/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);

const isImageFile = (file: File): boolean => file.type.startsWith('image/') || isHeicFile(file);

// An SVG is stored drawn large (sharp, @noted/media) but shown at the size it asks for.
const svgDisplaySize = async (file: File): Promise<{ width: number; height: number } | null> => {
  if (!isSvgFile(file)) return null;
  const svg = parseSvg(await file.text());
  if (!svg) return null;
  const { width, height } = svgSize(svg);
  return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
};

// Stores files and inserts them at `pos` (or the cursor): images as compressed image blobs,
// everything else as attachments. Errors are reported through handlers.notify.
export const insertFiles = async (editor: Editor, files: File[], pos?: number): Promise<boolean> => {
  const handlers = editor.storage.image?.handlers;
  if (!handlers || files.length === 0) return false;
  const nodes = [];
  for (const file of files) {
    try {
      if (isImageFile(file) && handlers.upload) {
        const size = await svgDisplaySize(file);
        nodes.push({ type: 'image', attrs: { blob: formatBlobRef(await handlers.upload(file)), alt: file.name || null, ...size } });
      } else if (handlers.uploadFile) {
        const ref = await handlers.uploadFile(file);
        nodes.push({ type: 'attachment', attrs: { blob: formatBlobRef(ref), name: file.name || 'file', size: file.size, mime: file.type || null } });
      }
    } catch (err) {
      console.error('File upload failed:', err);
      handlers.notify?.(`${file.name}: ${errorMessage(err)}`);
    }
  }
  if (nodes.length === 0 || editor.isDestroyed) return false;
  const at = pos ?? editor.state.selection.from;
  return editor.chain().focus().insertContentAt(Math.min(at, editor.state.doc.content.size), nodes).run();
};

// Inserts only the image files (slash "Image").
export const insertImageFiles = (editor: Editor, files: File[], pos?: number) =>
  insertFiles(editor, files.filter(isImageFile), pos);

const pickFiles = (accept: string, onPicked: (files: File[]) => Promise<unknown>) => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  input.multiple = true;
  input.style.display = 'none';
  const cleanup = () => input.remove();
  input.addEventListener('cancel', cleanup);
  input.addEventListener('change', async () => {
    try {
      await onPicked(Array.from(input.files ?? []));
    } finally {
      cleanup();
    }
  });
  document.body.appendChild(input);
  input.click();
};

// Slash menu "File": any files, inserted as attachments (images too, in original quality).
export const pickAttachmentsInto = (editor: Editor, range: { from: number; to: number }): void => {
  editor.chain().focus().deleteRange(range).run();
  const handlers = editor.storage.image?.handlers;
  if (!handlers?.uploadFile) return;
  pickFiles('', async (files) => {
    const nodes = [];
    for (const file of files) {
      try {
        const ref = await handlers.uploadFile!(file);
        nodes.push({ type: 'attachment', attrs: { blob: formatBlobRef(ref), name: file.name || 'file', size: file.size, mime: file.type || null } });
      } catch (err) {
        console.error('File upload failed:', err);
        handlers.notify?.(`${file.name}: ${errorMessage(err)}`);
      }
    }
    if (nodes.length && !editor.isDestroyed) editor.chain().focus().insertContent(nodes).run();
  });
};

// Slash menu "Image from URL": the UI asks for the address (see storage.requestUrl).
export const requestImageUrl = (editor: Editor, range: { from: number; to: number }): void => {
  editor.chain().focus().deleteRange(range).run();
  editor.storage.image?.requestUrl?.(range.from);
};

// Downloads an image into a blob and inserts it; used by the URL prompt.
export const insertImageFromUrl = async (editor: Editor, url: string, pos: number): Promise<void> => {
  const handlers = editor.storage.image?.handlers;
  if (!handlers?.storeUrl) return;
  try {
    const ref = await handlers.storeUrl(url);
    if (editor.isDestroyed) return;
    editor.chain().focus().insertContentAt(Math.min(pos, editor.state.doc.content.size), { type: 'image', attrs: { blob: formatBlobRef(ref) } }).run();
  } catch (err) {
    console.error('Image download failed:', err);
    handlers.notify?.(`Image from URL: ${errorMessage(err)}`);
  }
};

// Opens a file picker and inserts the chosen images (slash menu "Image").
export const pickImagesInto = (editor: Editor, range: { from: number; to: number }): void => {
  editor.chain().focus().deleteRange(range).run();
  pickFiles('image/*,.heic,.heif', (files) => insertImageFiles(editor, files));
};

const dataUrlToBytes = (dataUrl: string): Uint8Array | null => {
  const match = /^data:[^;,]*;base64,(.*)$/s.exec(dataUrl);
  if (!match) return null;
  const binary = atob(match[1]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

// Moves images that are not blobs yet into blobs: old embedded base64 images and images
// pasted from the web (downloaded once, then never fetched from that site again). Positions
// are looked up again after the async work, so typing meanwhile is safe. Returns how many
// images were converted; failures stay as they are and are retried next time.
export const importImages = async (editor: Editor): Promise<number> => {
  const handlers = editor.storage.image?.handlers;
  if (!handlers?.storeBytes) return 0;
  const sources = new Set<string>();
  editor.state.doc.descendants((node) => {
    const src = node.attrs.src;
    if (node.type.name === 'image' && !node.attrs.blob && typeof src === 'string' && /^(data:|https?:)/i.test(src)) {
      sources.add(src);
    }
  });
  if (sources.size === 0) return 0;

  const refs = new Map<string, string>();
  for (const src of sources) {
    try {
      if (src.startsWith('data:')) {
        const bytes = dataUrlToBytes(src);
        if (bytes) refs.set(src, formatBlobRef(await handlers.storeBytes(bytes)));
      } else if (handlers.storeUrl) {
        refs.set(src, formatBlobRef(await handlers.storeUrl(src)));
      }
    } catch (err) {
      console.error('Image import failed:', src.slice(0, 80), err);
    }
  }
  if (editor.isDestroyed || refs.size === 0) return 0;

  const { tr } = editor.state;
  let converted = 0;
  tr.doc.descendants((node, pos) => {
    const ref = node.type.name === 'image' && !node.attrs.blob ? refs.get(node.attrs.src) : undefined;
    if (ref) {
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: null, blob: ref });
      converted++;
    }
  });
  if (converted) editor.view.dispatch(tr.setMeta('addToHistory', false));
  return converted;
};
