// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import * as Y from 'yjs';
import { createSchemaExtensions } from './extensions';
import { encodePoints } from './drawing-codec';
import { exportNote } from './export';

const makeEditor = (ydoc = new Y.Doc()) => new Editor({ extensions: createSchemaExtensions({ ydoc, placeholder: '' }) });

const drawingPos = (editor: Editor) => {
  let pos = -1;
  editor.state.doc.descendants((node, p) => {
    if (node.type.name === 'drawing' && pos < 0) pos = p;
  });
  return pos;
};

// Appends a stroke the way the node view does.
const addStroke = (editor: Editor, x: number, color: string | null = null) => {
  const pos = drawingPos(editor);
  const node = editor.state.doc.nodeAt(pos)!;
  const stroke = editor.schema.nodes.drawingStroke.create({
    points: encodePoints([{ x, y: 10, p: 0.5 }, { x: x + 20, y: 30, p: 0.7 }]), color, size: 6, tool: 'pen',
  });
  editor.view.dispatch(editor.state.tr.insert(pos + 1 + node.content.size, stroke));
};

const strokes = (editor: Editor) => {
  const found: Record<string, unknown>[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'drawingStroke') found.push(node.attrs);
  });
  return found;
};

describe('drawing block', () => {
  it('inserts an empty drawing and keeps strokes as child nodes', () => {
    const editor = makeEditor();
    editor.commands.setContent('<p>Lecture</p>');
    editor.commands.insertContentAt(editor.state.doc.content.size, { type: 'drawing' });
    expect(drawingPos(editor)).toBeGreaterThan(0);
    addStroke(editor, 100, 'var(--c-red)');
    addStroke(editor, 300);
    expect(strokes(editor)).toHaveLength(2);
    expect(strokes(editor)[0]).toMatchObject({ color: 'var(--c-red)', size: 6, tool: 'pen' });
    const svg = editor.view.dom.querySelector('[data-type="drawing"] svg')!;
    expect(svg.querySelectorAll('g path')).toHaveLength(2);
    expect(svg.getAttribute('viewBox')).toBe('0 0 1000 300');
  });

  it('round-trips through HTML (copy / paste between notes)', () => {
    const editor = makeEditor();
    editor.commands.setContent('<p>A</p>');
    editor.commands.insertContentAt(editor.state.doc.content.size, { type: 'drawing', attrs: { height: 420 } });
    addStroke(editor, 100, 'var(--c-blue)');
    addStroke(editor, 500);
    const html = editor.getHTML();
    expect(html).toContain('<figure');
    expect(html).toContain('data-points="1:');
    const other = makeEditor();
    other.commands.setContent(html);
    expect(strokes(other)).toEqual(strokes(editor));
    expect(other.state.doc.nodeAt(drawingPos(other))!.attrs.height).toBe(420);
  });

  it('merges strokes drawn at the same time on two devices', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const a = makeEditor(docA);
    a.commands.setContent('<p>Notes</p>');
    a.commands.insertContentAt(a.state.doc.content.size, { type: 'drawing' });
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    const b = makeEditor(docB);
    expect(drawingPos(b)).toBeGreaterThan(0);
    addStroke(a, 100);
    addStroke(b, 600);
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));
    const xs = (e: Editor) => strokes(e).map((s) => s.points).sort();
    expect(xs(a)).toHaveLength(2);
    expect(xs(a)).toEqual(xs(b));
  });

  it('exports as an inline SVG in Markdown and a placeholder in text', () => {
    const editor = makeEditor();
    editor.commands.setContent('<p>Formula</p>');
    editor.commands.insertContentAt(editor.state.doc.content.size, { type: 'drawing' });
    addStroke(editor, 100, 'var(--c-green)');
    const json = editor.getJSON();
    const md = exportNote('T', json, 'markdown');
    expect(md).toMatch(/<svg xmlns="http:\/\/www.w3.org\/2000\/svg"[^>]*><path d="M[^"]+" fill="#7fd88a"\/><\/svg>/);
    expect(exportNote('T', json, 'text')).toContain('[drawing]');
  });
});
