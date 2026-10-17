// @vitest-environment happy-dom
import { it, expect } from 'vitest';
import { Editor, generateJSON } from '@tiptap/core';
import * as Y from 'yjs';
import { createSchemaExtensions } from '@noted/editor';
import { setNoteBodyJson } from '@noted/sync';

it('the editor shows a body written without it exactly like the parsed HTML', async () => {
  const html = '<h2>Plan</h2><p>a <strong>b</strong> <a href="https://x.y">c</a></p><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>done</p></li></ul><blockquote><p>q</p></blockquote>';
  const json = generateJSON(html, createSchemaExtensions({ ydoc: new Y.Doc(), placeholder: '' }));
  const doc = new Y.Doc();
  setNoteBodyJson(doc, json);
  const editor = new Editor({ element: document.createElement('div'), extensions: createSchemaExtensions({ ydoc: doc, placeholder: '' }) });
  await new Promise((r) => setTimeout(r, 30));
  // The editor adds an empty paragraph after a closing block (trailing node); the rest is equal.
  const shown = editor.getJSON();
  const last = shown.content?.[shown.content.length - 1];
  if (last?.type === 'paragraph' && !last.content) shown.content!.pop();
  expect(shown).toEqual(json);
  editor.destroy();
});
