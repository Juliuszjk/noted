// @vitest-environment happy-dom
import { it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import * as Y from 'yjs';
import { createSchemaExtensions } from './extensions';
import { detectCodeLanguage } from './code-block';
import { parseEditorPrefs, editorPrefsCssVars } from './editor-prefs-lite';

it('detects languages and colours code without changing the stored node', () => {
  expect(detectCodeLanguage('def init(name):\n    """Doc."""\n    print(f"hi {name}")\n    return {"name": name, "ok": True}\n')).toBe('python');
  expect(detectCodeLanguage('x')).toBeNull();
  const editor = new Editor({ extensions: createSchemaExtensions({ ydoc: new Y.Doc(), placeholder: '' }).filter((e) => e.name !== 'collaboration') });
  editor.commands.setContent('<pre><code class="language-rust">fn main() { let x = 1; }</code></pre>');
  const block = editor.getJSON().content![0];
  expect(block).toMatchObject({ type: 'codeBlock', attrs: { language: 'rust' } });
  expect(editor.view.dom.querySelector('.hljs-keyword')?.textContent).toBe('fn');
  expect(editor.view.dom.querySelector('.code-block-lang')?.textContent).toBe('Rust');
  editor.destroy();
});

it('keeps the code theme in the editor settings', () => {
  const prefs = parseEditorPrefs(JSON.stringify({ codeTheme: 'dracula', codeThemeByLanguage: { python: 'monokai', rust: 'nope' } }));
  expect(prefs.codeTheme).toBe('dracula');
  expect(prefs.codeThemeByLanguage).toEqual({ python: 'monokai' });
  expect(editorPrefsCssVars(prefs)['--code-bg']).toBe('#282a36');
  expect(editorPrefsCssVars(parseEditorPrefs(null))['--code-bg']).toBe('');
});
