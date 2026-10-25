// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { Editor, getSchema } from '@tiptap/core';
import * as Y from 'yjs';
import { createSchemaExtensions } from './extensions';
import { unknownSchemaParts } from './schema-check';

describe('unknownSchemaParts', () => {
  const schema = getSchema(createSchemaExtensions({ ydoc: new Y.Doc(), placeholder: '' }));

  const body = (fill: (fragment: Y.XmlFragment) => void) => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment('default');
    doc.transact(() => fill(fragment));
    return fragment;
  };

  it('finds nothing in a note of known parts', () => {
    const fragment = body((f) => {
      const heading = new Y.XmlElement('heading');
      heading.setAttribute('level', 2 as never);
      heading.setAttribute('foldable', true as never);
      const text = new Y.XmlText();
      text.insert(0, 'Title', { bold: {}, 'textStyle--abc': { color: 'red', fontSize: '18px' } });
      heading.insert(0, [text]);
      f.insert(0, [heading, new Y.XmlElement('paragraph')]);
    });
    expect(unknownSchemaParts(fragment, schema)).toEqual([]);
  });

  it('names unknown nodes, attributes and marks, also deep inside', () => {
    const fragment = body((f) => {
      const list = new Y.XmlElement('bulletList');
      const item = new Y.XmlElement('listItem');
      const para = new Y.XmlElement('paragraph');
      para.setAttribute('glow', true as never);
      const text = new Y.XmlText();
      text.insert(0, 'x', { sparkle: {}, link: { href: 'https://a', shiny: true } });
      para.insert(0, [text]);
      item.insert(0, [para, new Y.XmlElement('futureBlock')]);
      list.insert(0, [item]);
      f.insert(0, [list]);
    });
    expect(unknownSchemaParts(fragment, schema).sort()).toEqual(['futureBlock', 'link.shiny', 'paragraph.glow', 'sparkle']);
  });

  it('finds nothing in a body the editor wrote', () => {
    const ydoc = new Y.Doc();
    const editor = new Editor({ element: document.createElement('div'), extensions: createSchemaExtensions({ ydoc, placeholder: '' }) });
    editor.commands.setContent('<h2 data-foldable="true" data-collapsed="true">Fold</h2><p style="text-align: center">a <mark>b</mark> '
      + '<span style="color: red; font-size: 20px">c</span> <a href="https://a.b">d</a> <s>e</s> <code>f</code></p>'
      + '<ul data-outline="true"><li><p>g</p><ul><li><p>h</p></li></ul></li></ul><table><tr><td><p>1</p></td></tr></table>'
      + '<blockquote><p>q</p></blockquote><pre><code>let x = 1</code></pre>');
    expect(ydoc.getXmlFragment('default').length).toBeGreaterThan(3);
    expect(unknownSchemaParts(ydoc.getXmlFragment('default'), schema)).toEqual([]);
    editor.destroy();
  });
});
