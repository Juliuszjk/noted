import type { Editor } from '@tiptap/core';
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight';
import { createLowlight, common } from 'lowlight';
import { CODE_LANGUAGES, codeLanguageLabel, codeThemeVars } from './code-themes';

// Code blocks with syntax colours (highlight.js grammars through lowlight, painted as
// decorations: nothing is stored but the `language` attribute). A block without a language
// is detected from its text. Under the code a bar shows the language (pick another or "Auto"
// from a searchable list) and a Copy button. The node and its `language` attribute are
// unchanged from StarterKit's code block, so older notes and devices read it as before.

export const lowlight = createLowlight(common);

// Detection needs a few lines to be sure; short snippets stay "plain text".
const MIN_RELEVANCE = 5;
export const detectCodeLanguage = (code: string): string | null => {
  if (code.trim().length < 12) return null;
  const result = lowlight.highlightAuto(code);
  const language = result.data?.language;
  return language && (result.data?.relevance ?? 0) >= MIN_RELEVANCE ? language : null;
};

type CodeView = { render: () => void };
interface CodeBlockStorage {
  // Settings > Editor: another colour theme for some languages.
  themeByLanguage: Record<string, string>;
  views: Set<CodeView>;
}

declare module '@tiptap/core' {
  interface Storage {
    codeBlock: CodeBlockStorage;
  }
}

export const setCodeThemeByLanguage = (editor: Editor, map: Record<string, string>): void => {
  const storage = editor.storage.codeBlock;
  if (!storage) return;
  storage.themeByLanguage = map;
  storage.views.forEach((v) => v.render());
};

const copyText = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Pages that are not a secure context (the phone's editor page) have no clipboard API.
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
};

export const NotedCodeBlock = CodeBlockLowlight.extend<any, CodeBlockStorage>({
  addStorage() {
    return { themeByLanguage: {}, views: new Set() };
  },

  addNodeView() {
    return ({ node: initial, editor, getPos }) => {
      let node = initial;
      const dom = document.createElement('div');
      dom.className = 'code-block';
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      pre.append(code);
      const bar = document.createElement('div');
      bar.className = 'code-block-bar';
      bar.contentEditable = 'false';
      const langButton = document.createElement('button');
      langButton.type = 'button';
      langButton.className = 'code-block-lang';
      langButton.title = 'Language (detected when Auto)';
      const copyButton = document.createElement('button');
      copyButton.type = 'button';
      copyButton.className = 'code-block-copy';
      copyButton.textContent = 'Copy';
      bar.append(langButton, copyButton);
      dom.append(pre, bar);

      let detected: string | null = null;
      let detectTimer: ReturnType<typeof setTimeout> | undefined;
      let detectedFor = '';
      const language = () => (node.attrs.language as string | null) || null;

      const view: CodeView = {
        render: () => {
          const lang = language() ?? detected;
          code.className = lang ? `language-${lang}` : '';
          langButton.textContent = language() ? codeLanguageLabel(language()) : detected ? `Auto · ${codeLanguageLabel(detected)}` : 'Auto · Plain text';
          // A theme of its own for this language (Settings > Editor), else the global one.
          const vars = lang ? codeThemeVars(this.storage.themeByLanguage[lang]) : null;
          for (const name of Object.keys(codeThemeVars('github-dark') ?? {})) {
            if (vars?.[name]) dom.style.setProperty(name, vars[name]);
            else dom.style.removeProperty(name);
          }
        },
      };
      const detect = () => {
        clearTimeout(detectTimer);
        if (language()) return view.render();
        const text = node.textContent;
        if (text === detectedFor) return view.render();
        detectTimer = setTimeout(() => {
          detectedFor = text;
          detected = detectCodeLanguage(text);
          view.render();
        }, detectedFor ? 400 : 0);
        view.render();
      };

      // The language list: a search field and the languages, "Auto" first.
      let menu: HTMLDivElement | null = null;
      const closeMenu = () => {
        menu?.remove();
        menu = null;
        document.removeEventListener('mousedown', outside, true);
      };
      const outside = (e: Event) => { if (menu && !menu.contains(e.target as Node) && e.target !== langButton) closeMenu(); };
      const setLanguage = (value: string | null) => {
        closeMenu();
        const pos = typeof getPos === 'function' ? getPos() : undefined;
        if (typeof pos !== 'number' || !editor.isEditable) return;
        editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, language: value }));
      };
      langButton.addEventListener('mousedown', (e) => e.preventDefault());
      langButton.addEventListener('click', (e) => {
        e.preventDefault();
        if (menu) return closeMenu();
        if (!editor.isEditable) return;
        menu = document.createElement('div');
        menu.className = 'code-block-menu';
        const search = document.createElement('input');
        search.placeholder = 'Search languages';
        const list = document.createElement('div');
        list.className = 'code-block-menu-list';
        const fill = () => {
          const q = search.value.trim().toLowerCase();
          const items: [string | null, string][] = [[null, detected ? `Auto (${codeLanguageLabel(detected)})` : 'Auto-detect'], ...CODE_LANGUAGES];
          list.replaceChildren(...items.filter(([id, label]) => !q || label.toLowerCase().includes(q) || (id ?? '').includes(q)).map(([id, label]) => {
            const item = document.createElement('button');
            item.type = 'button';
            item.textContent = label;
            if ((id ?? null) === language()) item.className = 'active';
            item.addEventListener('mousedown', (ev) => ev.preventDefault());
            item.addEventListener('click', (ev) => { ev.preventDefault(); setLanguage(id); });
            return item;
          }));
        };
        search.addEventListener('input', fill);
        search.addEventListener('keydown', (ev) => {
          if (ev.key === 'Escape') { closeMenu(); editor.commands.focus(); }
          if (ev.key === 'Enter') { ev.preventDefault(); (list.firstElementChild as HTMLButtonElement | null)?.click(); }
        });
        fill();
        menu.append(search, list);
        bar.append(menu);
        document.addEventListener('mousedown', outside, true);
        // Phones: no keyboard just for opening the list.
        if (window.matchMedia?.('(pointer: fine)').matches) search.focus();
      });
      copyButton.addEventListener('mousedown', (e) => e.preventDefault());
      copyButton.addEventListener('click', async (e) => {
        e.preventDefault();
        const ok = await copyText(node.textContent);
        copyButton.textContent = ok ? 'Copied' : 'Copy failed';
        setTimeout(() => { copyButton.textContent = 'Copy'; }, 1500);
      });

      this.storage.views.add(view);
      detect();
      return {
        dom,
        contentDOM: code,
        update: (updated) => {
          if (updated.type !== node.type) return false;
          node = updated;
          detect();
          return true;
        },
        // The bar and the class on <code> are ours, not the document's.
        ignoreMutation: (m) => m.type !== 'selection' && (m.type === 'attributes' || !code.contains(m.target)),
        stopEvent: (e) => bar.contains(e.target as Node),
        destroy: () => {
          clearTimeout(detectTimer);
          closeMenu();
          this.storage.views.delete(view);
        },
      };
    };
  },
}).configure({ lowlight, defaultLanguage: null });
