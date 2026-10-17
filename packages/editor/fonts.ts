import { Extension } from '@tiptap/core';

// Three font families, as CSS variable references (defined in content.css) so they follow
// themes like the colour palette does. Used for the whole note (note setting, see
// @noted/sync note-font) and for selected text (the `fontFamily` attribute of textStyle).
export const EDITOR_FONTS = [
  { name: 'sans', label: 'Sans', css: 'var(--font-sans)' },
  { name: 'serif', label: 'Serif', css: 'var(--font-serif)' },
  { name: 'mono', label: 'Mono', css: 'var(--font-mono)' },
] as const;

export type EditorFontName = (typeof EDITOR_FONTS)[number]['name'];

const KNOWN = new Set<string>(EDITOR_FONTS.map((f) => f.css));

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    textFont: {
      setTextFont: (font: EditorFontName) => ReturnType;
      unsetTextFont: () => ReturnType;
    };
  }
}

// Font of selected text. Only the three variables above are kept: fonts pasted from web
// pages (arbitrary families) are dropped, like raw colours would break theming.
export const TextFont = Extension.create({
  name: 'textFont',

  addGlobalAttributes() {
    return [
      {
        types: ['textStyle'],
        attributes: {
          fontFamily: {
            default: null,
            parseHTML: (el: HTMLElement) => {
              const value = el.style.fontFamily?.replace(/\s+/g, '') ?? '';
              return KNOWN.has(value) ? value : null;
            },
            renderHTML: (attrs: Record<string, any>) => (attrs.fontFamily ? { style: `font-family: ${attrs.fontFamily}` } : {}),
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setTextFont: (font) => ({ chain }) => {
        const css = EDITOR_FONTS.find((f) => f.name === font)?.css;
        return css ? chain().setMark('textStyle', { fontFamily: css }).run() : false;
      },
      unsetTextFont: () => ({ chain }) => chain().setMark('textStyle', { fontFamily: null }).removeEmptyTextStyle().run(),
    };
  },
});
