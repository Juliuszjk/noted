// @vitest-environment happy-dom
import { it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import * as Y from 'yjs';
import { createSchemaExtensions } from './extensions';
import { looksLikeMarkdown, markdownToHtml } from './markdown-paste';

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
