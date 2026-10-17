import { Extension, Node, mergeAttributes } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion from '@tiptap/suggestion';
import type { SuggestionOptions } from '@tiptap/suggestion';

// Link to another note. The document stores only the target's id; the label is always the
// target's current title, looked up in a title map the app keeps up to date with
// setNoteTitles. A target missing from the map is shown as a struck-through "Missing note".

type NoteLinkView = { render: () => void };

interface NoteLinkStorage {
  titles: Map<string, string>;
  // Live node views, re-rendered when titles change.
  views: Set<NoteLinkView>;
}

declare module '@tiptap/core' {
  interface Storage {
    noteLink: NoteLinkStorage;
  }
  interface Commands<ReturnType> {
    noteLink: {
      insertNoteLink: (noteId: string) => ReturnType;
    };
  }
}

const MISSING_LABEL = 'Missing note';

export const NoteLink = Node.create<Record<string, never>, NoteLinkStorage>({
  name: 'noteLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addStorage() {
    return { titles: new Map(), views: new Set() };
  },

  addAttributes() {
    return {
      noteId: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-note-id'),
        renderHTML: (attrs: Record<string, any>) => ({ 'data-note-id': attrs.noteId }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-note-link]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const title = this.storage.titles.get(node.attrs.noteId);
    return ['span', mergeAttributes({ 'data-note-link': '', class: 'note-link' }, HTMLAttributes), title ?? MISSING_LABEL];
  },

  renderText({ node }) {
    return `[[${this.storage.titles.get(node.attrs.noteId) ?? MISSING_LABEL}]]`;
  },

  addNodeView() {
    return ({ node: initial }) => {
      let node = initial;
      const dom = document.createElement('span');
      dom.className = 'note-link';
      dom.setAttribute('data-note-link', '');
      dom.contentEditable = 'false';
      const view: NoteLinkView = {
        render: () => {
          const id = node.attrs.noteId as string | null;
          const title = id ? this.storage.titles.get(id) : undefined;
          dom.setAttribute('data-note-id', id ?? '');
          dom.textContent = title ?? MISSING_LABEL;
          dom.classList.toggle('note-link--missing', title === undefined);
        },
      };
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

  addCommands() {
    return {
      insertNoteLink: (noteId) => ({ commands }) =>
        commands.insertContent([{ type: this.name, attrs: { noteId } }, { type: 'text', text: ' ' }]),
    };
  },
});

// Gives the editor the current title of every note (id -> title) and refreshes the links.
export const setNoteTitles = (editor: Editor, titles: Map<string, string> | Record<string, string>): void => {
  const storage = editor.storage.noteLink;
  if (!storage) return;
  storage.titles = titles instanceof Map ? titles : new Map(Object.entries(titles));
  storage.views.forEach((view) => view.render());
};

// "[[" opens a note picker. Like SlashCommands, the UI is supplied through `suggestion.render`.
export const NoteLinkSuggestion = Extension.create({
  name: 'noteLinkSuggestion',

  addOptions() {
    return {
      suggestion: {
        char: '[[',
        // Titles contain spaces, and "word[[" should work too.
        allowSpaces: true,
        allowedPrefixes: null,
        pluginKey: new PluginKey('noteLinkSuggestion'),
      } as Partial<SuggestionOptions>,
    };
  },

  addProseMirrorPlugins() {
    return [Suggestion({ editor: this.editor, ...this.options.suggestion })];
  },
});
