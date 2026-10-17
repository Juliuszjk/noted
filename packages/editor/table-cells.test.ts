// @vitest-environment happy-dom
import { it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import * as Y from 'yjs';
import { createSchemaExtensions } from './extensions';
import { safeCellColor } from './table-cells';

it('keeps palette / hex cell colours and drops anything else', () => {
  expect(safeCellColor('var(--hl-red)')).toBe('var(--hl-red)');
  expect(safeCellColor('#a0b0c0')).toBe('#a0b0c0');
  expect(safeCellColor('red; background-image: url(x)')).toBeNull();
  const editor = new Editor({ extensions: createSchemaExtensions({ ydoc: new Y.Doc(), placeholder: '' }).filter((e) => e.name !== 'collaboration') });
  editor.commands.setContent('<table><tr><td data-background="var(--hl-green)"><p>a</p></td><td data-background="url(x)"><p>b</p></td></tr></table>');
  const html = editor.getHTML();
  expect(html).toContain('background-color: var(--hl-green)');
  expect(html).not.toContain('url(x)');
  editor.destroy();
});
