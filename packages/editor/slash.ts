import { Extension } from '@tiptap/core';
import Suggestion, { SuggestionOptions } from '@tiptap/suggestion';

export interface SlashCommandParams {
  editor: any;
  range: { from: number; to: number };
}

// What a menu row shows besides its title.
export type SlashPreview =
  | { kind: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6 }
  | { kind: 'markers'; markers: string[] }
  // `path`: an MDI icon drawn instead of the `icon` character.
  | { kind: 'icon'; icon: string; path?: string };

// What opens when a row is activated.
export type SlashSubmenu =
  | { kind: 'list'; items: SlashItem[] }
  | { kind: 'tiles'; items: SlashItem[]; columns: number }
  | { kind: 'table' };

export interface SlashItem {
  title: string;
  // Extra search terms matched by the slash menu filter.
  keywords?: string[];
  preview?: SlashPreview;
  // MDI icon path shown in front of the title (every platform's menu).
  icon?: string;
  // Leaf action. Rows with a submenu have none.
  command?: (params: SlashCommandParams) => void;
  submenu?: SlashSubmenu;
  // Children that exist only for search (e.g. the table picker's "Import CSV").
  searchChildren?: SlashItem[];
}

export const SlashCommands = Extension.create({
  name: 'slashCommands',

  addOptions() {
    return {
      suggestion: {
        char: '/',
        command: ({ editor, range, props }: any) => {
          props.command({ editor, range });
        },
      } as Partial<SuggestionOptions>,
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ];
  },
});
