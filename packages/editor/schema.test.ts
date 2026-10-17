import { describe, it, expect } from 'vitest';
import { getSchema } from '@tiptap/core';
import * as Y from 'yjs';
import { createSchemaExtensions } from './extensions';

// Stored notes and every client depend on these names. Removing or renaming one is a
// breaking change for existing documents, so update this list only on purpose.
describe('note document schema', () => {
  const schema = getSchema(createSchemaExtensions({ ydoc: new Y.Doc(), placeholder: '' }));

  it('keeps all node types', () => {
    expect(Object.keys(schema.nodes)).toEqual(
      expect.arrayContaining([
        'attachment', 'blockMath', 'blockquote', 'bulletList', 'callout', 'codeBlock', 'drawing', 'drawingStroke', 'heading', 'horizontalRule', 'image',
        'inlineMath', 'listItem', 'noteLink', 'orderedList', 'paragraph', 'reminder', 'table', 'tableCell', 'tableHeader', 'tableRow',
        'taskItem', 'taskList',
      ]),
    );
  });

  it('keeps all mark types', () => {
    expect(Object.keys(schema.marks)).toEqual(
      expect.arrayContaining([
        'bold', 'code', 'highlight', 'italic', 'link', 'strike', 'subscript', 'superscript', 'textStyle', 'underline',
      ]),
    );
  });

  it('keeps the callout and math attributes', () => {
    expect(Object.keys(schema.nodes.callout.spec.attrs ?? {})).toEqual(expect.arrayContaining(['variant', 'icon', 'color']));
    expect(Object.keys(schema.nodes.inlineMath.spec.attrs ?? {})).toContain('latex');
    expect(Object.keys(schema.nodes.blockMath.spec.attrs ?? {})).toContain('latex');
    expect(Object.keys(schema.nodes.noteLink.spec.attrs ?? {})).toEqual(['noteId']);
    expect(Object.keys(schema.nodes.image.spec.attrs ?? {})).toEqual(expect.arrayContaining(['src', 'alt', 'title', 'blob']));
    expect(Object.keys(schema.nodes.attachment.spec.attrs ?? {})).toEqual(['blob', 'name', 'size', 'mime']);
    expect(Object.keys(schema.nodes.reminder.spec.attrs ?? {})).toEqual(['id', 'at', 'repeat', 'done', 'snooze']);
    expect(Object.keys(schema.nodes.drawing.spec.attrs ?? {})).toEqual(['height']);
    expect(Object.keys(schema.nodes.drawingStroke.spec.attrs ?? {})).toEqual(['points', 'color', 'size', 'tool']);
  });

  it('keeps the textStyle attributes', () => {
    expect(Object.keys(schema.marks.textStyle.spec.attrs ?? {})).toEqual(expect.arrayContaining(['color', 'fontSize', 'fontFamily']));
  });
});
