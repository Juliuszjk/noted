// @vitest-environment happy-dom
import { it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import * as Y from 'yjs';
import { createSchemaExtensions } from './extensions';
import { hasMarkdownMath, looksLikeMarkdown, markdownToHtml, pastedMathHtml } from './markdown-paste';

const SAMPLE = '# 📝 Plan\n\n**Data:** today  \n**Tagi:** `#a`\n\n---\n\n## ✅ Lista\n- [x] done\n- [ ] todo\n\n1. one\n2. [doc](https://x.org/)\n\n```python\ndef f():\n    return 1\n';

it('tells Markdown from plain text', () => {
  expect(looksLikeMarkdown(SAMPLE)).toBe(true);
  expect(looksLikeMarkdown('Just a sentence.\nAnd another one - with a dash.')).toBe(false);
  expect(looksLikeMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |')).toBe(true);
  expect(looksLikeMarkdown('- milk\n- bread')).toBe(false);
});

it('turns Markdown into headings, task lists, lists, links and an unclosed code block', () => {
  const editor = new Editor({ extensions: createSchemaExtensions({ ydoc: new Y.Doc(), placeholder: '' }).filter((e) => e.name !== 'collaboration') });
  editor.commands.setContent(markdownToHtml(SAMPLE));
  const types = editor.getJSON().content!.map((n) => n.type);
  expect(types.slice(0, 7)).toEqual(['heading', 'paragraph', 'horizontalRule', 'heading', 'taskList', 'orderedList', 'codeBlock']);
  const json = JSON.stringify(editor.getJSON());
  expect(json).toContain('"checked":true');
  expect(json).toContain('"href":"https://x.org/"');
  expect(json).toContain('return 1');
  editor.destroy();
});

// Copied from an AI chat (the "TODO noted" example): LaTeX backslashes must survive Markdown.
const MATH = [
  '# Myhill–Nerode: słowa kończące się na `bbb`',
  '',
  '**Zadanie:** $L = \\{w \\in \\{a,b\\}^* : w \\text{ kończy się na } bbb\\}$. Wykazać.',
  '',
  '**Lemat:** $u \\, R_L \\, v \\iff (\\forall z)\\,(uz \\in L \\iff vz \\in L)$.',
  '',
  '- $[\\varepsilon]$ – 0 `b` na końcu, cena $5',
  '',
  '$$',
  'x^2 + \\frac{1}{2}',
  '$$',
  '',
  'Inline \\(a_1 + a_2\\) and `$not math$`.',
  '',
  '> [!TIP]',
  '> Quote with $q_1$',
].join('\n');

it('keeps formulas from pasted Markdown', () => {
  expect(looksLikeMarkdown('Policz $x^2$ oraz\n**to** teraz')).toBe(true);
  const editor = new Editor({ extensions: createSchemaExtensions({ ydoc: new Y.Doc(), placeholder: '' }).filter((e) => e.name !== 'collaboration') });
  editor.commands.setContent(markdownToHtml(MATH));
  const latex: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'inlineMath' || node.type.name === 'blockMath') latex.push(`${node.type.name}:${node.attrs.latex}`);
  });
  expect(latex).toEqual([
    'inlineMath:L = \\{w \\in \\{a,b\\}^* : w \\text{ kończy się na } bbb\\}',
    'inlineMath:u \\, R_L \\, v \\iff (\\forall z)\\,(uz \\in L \\iff vz \\in L)',
    'inlineMath:[\\varepsilon]',
    'blockMath:x^2 + \\frac{1}{2}',
    'inlineMath:a_1 + a_2',
    'inlineMath:q_1',
  ]);
  expect(editor.state.doc.textContent).toContain('cena $5');
  expect(editor.state.doc.textContent).toContain('$not math$');
  expect(editor.getJSON().content!.map((n) => n.type)).toContain('callout');
  editor.destroy();
});

it('finds Markdown formulas', () => {
  expect(hasMarkdownMath('Let $x^2$ be')).toBe(true);
  expect(hasMarkdownMath('Price $5 and $10')).toBe(false);
  expect(hasMarkdownMath('Code `$x$` only')).toBe(false);
  expect(hasMarkdownMath('$$\nx\n$$')).toBe(true);
  expect(hasMarkdownMath('Inline \\(a\\)')).toBe(true);
});

it('turns pasted KaTeX into math nodes', () => {
  const katex = (tex: string, display: boolean) => {
    const inner = `<span class="katex"><span class="katex-mathml"><math><semantics><mi>x</mi><annotation encoding="application/x-tex">${tex}</annotation></semantics></math></span><span class="katex-html">x</span></span>`;
    return display ? `<span class="katex-display">${inner}</span>` : inner;
  };
  const html = pastedMathHtml(`<p>Let ${katex('L = \\{w\\}', false)} be</p>${katex('\\frac{1}{2}', true)}`);
  const editor = new Editor({ extensions: createSchemaExtensions({ ydoc: new Y.Doc(), placeholder: '' }).filter((e) => e.name !== 'collaboration') });
  editor.commands.setContent(html);
  const latex: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'inlineMath' || node.type.name === 'blockMath') latex.push(`${node.type.name}:${node.attrs.latex}`);
  });
  expect(latex).toEqual(['inlineMath:L = \\{w\\}', 'blockMath:\\frac{1}{2}']);
  expect(editor.state.doc.textContent).toBe('Let  be');
  editor.destroy();
});
