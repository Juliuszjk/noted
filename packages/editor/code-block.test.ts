// @vitest-environment happy-dom
import { it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import * as Y from 'yjs';
import { createSchemaExtensions } from './extensions';
import { detectCodeLanguage, lowlight } from './code-block';
import { CODE_LANGUAGES } from './code-themes';
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

it('has a grammar for every language in the list and colours XAML and MATLAB', () => {
  for (const [id] of CODE_LANGUAGES) expect(lowlight.registered(id), id).toBe(true);
  const editor = new Editor({ extensions: createSchemaExtensions({ ydoc: new Y.Doc(), placeholder: '' }).filter((e) => e.name !== 'collaboration') });
  editor.commands.setContent('<pre><code class="language-xaml">&lt;Grid x:Name="root"&gt;&lt;/Grid&gt;</code></pre>');
  expect(editor.view.dom.querySelector('.hljs-name')?.textContent).toBe('Grid');
  expect(editor.view.dom.querySelector('.code-block-lang')?.textContent).toBe('XAML');
  editor.commands.setContent('<pre><code class="language-matlab">function y = f(x)\n  y = x + 1;\nend</code></pre>');
  expect(editor.view.dom.querySelector('.hljs-keyword')?.textContent).toBe('function');
  editor.destroy();
});

it('only detects the common languages', () => {
  const code = 'function y = f(x)\n  % square\n  y = x.^2;\nend\n';
  expect(lowlight.highlightAuto(code).data?.language).not.toBe('matlab');
});

it('keeps the code theme in the editor settings', () => {
  const prefs = parseEditorPrefs(JSON.stringify({ codeTheme: 'dracula', codeThemeByLanguage: { python: 'monokai', rust: 'nope' } }));
  expect(prefs.codeTheme).toBe('dracula');
  expect(prefs.codeThemeByLanguage).toEqual({ python: 'monokai' });
  expect(editorPrefsCssVars(prefs)['--code-bg']).toBe('#282a36');
  expect(editorPrefsCssVars(parseEditorPrefs(null))['--code-bg']).toBe('');
});
