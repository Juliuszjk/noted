import { Node, mergeAttributes } from '@tiptap/core';
import { parseBlobRef } from './blob-image';

// A file stored as an encrypted blob, shown as a card (icon, name, size). Attributes: `blob`
// ("<id>:<key>", see blob-image.ts), `name`, `size` (bytes) and `mime`. Opening and saving
// are platform handlers (BlobHandlers.openFile / saveFile); without them the card is static.

type AttachmentView = { render: () => void };

interface AttachmentStorage {
  views: Set<AttachmentView>;
}

declare module '@tiptap/core' {
  interface Storage {
    attachment: AttachmentStorage;
  }
}

export const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
};

export const fileIcon = (mime: string | null, name: string): string => {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (mime?.startsWith('image/')) return '🖼';
  if (mime?.startsWith('audio/')) return '🎵';
  if (mime?.startsWith('video/')) return '🎬';
  if (mime === 'application/pdf' || ext === 'pdf') return '📕';
  if (['zip', 'rar', '7z', 'tar', 'gz', 'xz', 'zst'].includes(ext)) return '📦';
  if (['xls', 'xlsx', 'ods', 'csv'].includes(ext)) return '📊';
  if (['doc', 'docx', 'odt', 'rtf', 'txt', 'md'].includes(ext) || mime?.startsWith('text/')) return '📄';
  return '📎';
};

export const Attachment = Node.create<Record<string, never>, AttachmentStorage>({
  name: 'attachment',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addStorage() {
    return { views: new Set() };
  },

  addAttributes() {
    const data = (name: string, parse: (v: string | null) => unknown = (v) => v) => ({
      default: null,
      parseHTML: (el: HTMLElement) => parse(el.getAttribute(`data-${name}`)),
      renderHTML: (attrs: Record<string, any>) => (attrs[name] != null ? { [`data-${name}`]: String(attrs[name]) } : {}),
    });
    return {
      blob: data('blob'),
      name: data('name'),
      size: data('size', (v) => (v == null ? null : Number(v))),
      mime: data('mime'),
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-attachment]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-attachment': '' }, HTMLAttributes), node.attrs.name ?? 'file'];
  },

  renderText({ node }) {
    return `[${node.attrs.name ?? 'file'}]`;
  },

  addNodeView() {
    return ({ node: initial }) => {
      let node = initial;
      const dom = document.createElement('div');
      dom.className = 'attachment-card';
      dom.setAttribute('data-attachment', '');
      dom.contentEditable = 'false';

      const icon = document.createElement('span');
      icon.className = 'attachment-icon';
      const text = document.createElement('span');
      text.className = 'attachment-text';
      const name = document.createElement('span');
      name.className = 'attachment-name';
      const meta = document.createElement('span');
      meta.className = 'attachment-meta';
      text.append(name, meta);
      const actions = document.createElement('span');
      actions.className = 'attachment-actions';
      dom.append(icon, text, actions);

      const handlers = () => this.editor.storage.image?.handlers ?? null;
      const run = (kind: 'open' | 'save') => {
        const h = handlers();
        const ref = parseBlobRef(node.attrs.blob);
        const fn = kind === 'open' ? h?.openFile : h?.saveFile;
        if (!ref || !fn) return;
        dom.classList.add('attachment-busy');
        fn(ref, node.attrs.name ?? 'file')
          .catch((err) => {
            console.error(`Attachment ${kind} failed:`, err);
            h?.notify?.(`${node.attrs.name ?? 'file'}: ${err instanceof Error ? err.message : String(err)}`);
          })
          .finally(() => dom.classList.remove('attachment-busy'));
      };
      const button = (label: string, title: string, kind: 'open' | 'save') => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.title = title;
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          run(kind);
        });
        return b;
      };

      const view: AttachmentView = {
        render: () => {
          const fileName = (node.attrs.name as string | null) ?? 'file';
          icon.textContent = fileIcon(node.attrs.mime, fileName);
          name.textContent = fileName;
          meta.textContent = formatBytes(Number(node.attrs.size));
          const h = handlers();
          actions.replaceChildren(
            ...(h?.openFile ? [button('Open', 'Open with the default app', 'open')] : []),
            ...(h?.saveFile ? [button('Save', 'Save a decrypted copy', 'save')] : []),
          );
          dom.title = h?.openFile ? `Double-click to open ${fileName}` : fileName;
        },
      };
      dom.addEventListener('dblclick', (e) => {
        e.preventDefault();
        run('open');
      });

      view.render();
      this.storage.views.add(view);
      return {
        dom,
        update: (updated) => {
          if (updated.type !== node.type) return false;
          node = updated;
          view.render();
          return true;
        },
        destroy: () => {
          this.storage.views.delete(view);
        },
      };
    };
  },
});
