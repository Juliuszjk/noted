import { TableCell } from '@tiptap/extension-table-cell';
import { TableRow } from '@tiptap/extension-table-row';
import { TableHeader } from '@tiptap/extension-table-header';

// Table cells with an optional background colour (attribute `background`): a palette
// variable like var(--hl-red) or a hex colour, nothing else (it ends up in a style attribute).
const SAFE_COLOR = /^(var\(--(hl|c)-[a-z]+\)|#[0-9a-f]{3,8})$/i;
export const safeCellColor = (value: unknown): string | null => (typeof value === 'string' && SAFE_COLOR.test(value) ? value : null);

const background = {
  background: {
    default: null,
    parseHTML: (el: HTMLElement) => safeCellColor(el.getAttribute('data-background')),
    renderHTML: (attrs: Record<string, unknown>) => {
      const color = safeCellColor(attrs.background);
      return color ? { 'data-background': color, style: `background-color: ${color}` } : {};
    },
  },
};

export const ColoredTableCell = TableCell.extend({ addAttributes() { return { ...this.parent?.(), ...background }; } });
export const ColoredTableHeader = TableHeader.extend({ addAttributes() { return { ...this.parent?.(), ...background }; } });

// Rows with an optional height in px (attribute `height`, set by dragging the line under a row
// or by "Equal row heights"). Content taller than it still makes the row grow.
export const SizedTableRow = TableRow.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      height: {
        default: null,
        parseHTML: (el: HTMLElement) => {
          const px = parseFloat(el.style.height || el.getAttribute('data-height') || '');
          return Number.isFinite(px) && px > 0 ? Math.round(px) : null;
        },
        renderHTML: (attrs: Record<string, unknown>) => {
          const px = Number(attrs.height);
          return Number.isFinite(px) && px > 0 ? { 'data-height': String(Math.round(px)), style: `height: ${Math.round(px)}px` } : {};
        },
      },
    };
  },
});
