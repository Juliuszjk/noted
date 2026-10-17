// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import * as Y from 'yjs';
import { createSchemaExtensions } from './extensions';
import { decodePoints, encodePoints } from './drawing-codec';
import { exportNote } from './export';
import { restoreDrawingTools, serializeDrawingTools, setDrawingTool, setMouseDraws, setPenSettings } from './drawing';

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

  describe('pointer input', () => {
    const fire = (el: Element, type: string, x: number, y: number, extra: Record<string, unknown> = {}) => {
      const e = new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, pressure: 0.5, ...extra });
      el.dispatchEvent(e);
    };
    const drag = (el: Element, points: [number, number][], extra: Record<string, unknown> = {}) => {
      fire(el, 'pointerdown', ...points[0], extra);
      for (const p of points.slice(1)) fire(el, 'pointermove', ...p, extra);
      fire(el, 'pointerup', ...points[points.length - 1], { ...extra, buttons: 0 });
    };
    const setup = () => {
      const editor = makeEditor();
      editor.commands.setContent('<p>x</p>');
      editor.commands.insertContentAt(editor.state.doc.content.size, { type: 'drawing' });
      return { editor, svg: editor.view.dom.querySelector('[data-type="drawing"] svg')! };
    };

    it('draws a stroke with the mouse and marks the drawing active', () => {
      const { editor, svg } = setup();
      drag(svg, [[10, 10], [60, 10], [110, 10]]);
      expect(strokes(editor)).toHaveLength(1);
      expect(decodePoints(strokes(editor)[0].points).map((p) => p.x)).toEqual([10, 60, 110]);
      expect(editor.storage.drawing.active).toBe(true);
      // Back to the text (happy-dom sends no focus event for commands.focus()).
      editor.view.dom.dispatchEvent(new FocusEvent('focus'));
      expect(editor.storage.drawing.active).toBe(false);
    });

    // (Undo is not checked here: Yjs undo in happy-dom also reverts older changes.)
    it('removes the drawing when its last stroke is erased', () => {
      const { editor, svg } = setup();
      drag(svg, [[10, 50], [300, 50]]);
      drag(svg, [[10, 150], [300, 150]]);
      setDrawingTool(editor, { mode: 'eraser', eraser: 'part' });
      drag(svg, [[150, 0], [150, 100]]);
      expect(editor.getJSON().content!.map((n) => n.type)).toContain('drawing');
      setDrawingTool(editor, { mode: 'eraser', eraser: 'stroke' });
      drag(svg, [[20, 0], [20, 200], [290, 200], [290, 0]]);
      expect(editor.getJSON().content!.map((n) => n.type)).not.toContain('drawing');
    });

    it('erases whole strokes in one undoable step', () => {
      const { editor, svg } = setup();
      drag(svg, [[10, 10], [200, 10]]);
      drag(svg, [[10, 100], [200, 100]]);
      drag(svg, [[10, 200], [200, 200]]);
      setDrawingTool(editor, { mode: 'eraser', eraser: 'stroke' });
      drag(svg, [[100, 0], [100, 120]]);
      expect(strokes(editor)).toHaveLength(1);
      expect(decodePoints(strokes(editor)[0].points)[0].y).toBe(200);
    });

    it('cuts the touched part out with the part eraser', () => {
      const { editor, svg } = setup();
      drag(svg, [[10, 50], [300, 50]]);
      setDrawingTool(editor, { mode: 'eraser', eraser: 'part' });
      drag(svg, [[150, 0], [150, 100]]);
      const left = strokes(editor).map((s) => decodePoints(s.points));
      expect(left).toHaveLength(2);
      expect(Math.max(...left[0].map((p) => p.x))).toBeLessThan(140);
      expect(Math.min(...left[1].map((p) => p.x))).toBeGreaterThan(160);
    });

    it('erases with the pen eraser while the pen tool is chosen', () => {
      const { editor, svg } = setup();
      drag(svg, [[10, 50], [300, 50]], { pointerType: 'pen' });
      expect(strokes(editor)).toHaveLength(1);
      drag(svg, [[150, 0], [150, 100]], { pointerType: 'pen', buttons: 32, button: 5 });
      expect(strokes(editor)).toHaveLength(0);
    });

    it('erases with the right mouse button', () => {
      const { editor, svg } = setup();
      drag(svg, [[10, 50], [300, 50]]);
      drag(svg, [[150, 0], [150, 100]], { button: 2, buttons: 2 });
      expect(strokes(editor)).toHaveLength(0);
    });

    it('draws with the chosen pen kind, colour and width', () => {
      const { editor, svg } = setup();
      setDrawingTool(editor, { tool: 'highlighter' });
      drag(svg, [[10, 50], [300, 50]]);
      setDrawingTool(editor, { tool: 'fountain' });
      setPenSettings(editor, { color: '#123456', size: 12 });
      drag(svg, [[10, 150], [300, 150]]);
      expect(strokes(editor).map((s) => [s.tool, s.color, s.size])).toEqual([['highlighter', 'var(--c-yellow)', 24], ['fountain', '#123456', 12]]);
      expect(editor.storage.drawing.activeDom?.getAttribute('data-type')).toBe('drawing');
    });

    it('keeps the tool choices as text and reads them back safely', () => {
      const { editor } = setup();
      setDrawingTool(editor, { tool: 'pencil', eraser: 'part', paper: 'grid', gridSize: 85 });
      setPenSettings(editor, { color: 'var(--c-red)', size: 7 });
      const text = serializeDrawingTools(editor.storage.drawing.current);
      const other = makeEditor();
      restoreDrawingTools(other, text);
      expect(other.storage.drawing.current).toMatchObject({ tool: 'pencil', eraser: 'part', mode: 'pen', paper: 'grid' });
      expect(other.storage.drawing.current.pens.pencil).toEqual({ color: 'var(--c-red)', size: 7 });
      expect(other.storage.drawing.current.gridSize).toBe(85);
      restoreDrawingTools(other, '{"v":1,"gridSize":5000}');
      expect(other.storage.drawing.current.gridSize).toBe(160);
      restoreDrawingTools(other, '{"v":1,"tool":"laser","pens":{"pen":{"size":999,"color":5}}}');
      expect(other.storage.drawing.current.tool).toBe('pencil');
      expect(other.storage.drawing.current.pens.pen).toEqual({ color: null, size: 30 });
      restoreDrawingTools(other, 'garbage');
    });

    describe('holding the pen at the end of a stroke', () => {
      const hold = (svg: Element, points: [number, number][]) => {
        vi.useFakeTimers();
        try {
          fire(svg, 'pointerdown', ...points[0], { pointerType: 'pen' });
          for (const p of points.slice(1)) fire(svg, 'pointermove', ...p, { pointerType: 'pen' });
          vi.advanceTimersByTime(700);
          fire(svg, 'pointerup', ...points[points.length - 1], { pointerType: 'pen', buttons: 0 });
        } finally {
          vi.useRealTimers();
        }
      };

      it('straightens a wobbly stroke into a level line', () => {
        const { editor, svg } = setup();
        hold(svg, [[10, 50], [60, 58], [110, 44], [160, 55], [210, 52]]);
        const pts = decodePoints(strokes(editor)[0].points);
        expect(pts.length).toBeGreaterThan(10);
        expect(new Set(pts.map((p) => Math.round(p.y))).size).toBe(1);
      });

      it('keeps a stroke as drawn without the hold', () => {
        const { editor, svg } = setup();
        drag(svg, [[10, 50], [60, 58], [110, 44]], { pointerType: 'pen' });
        expect(decodePoints(strokes(editor)[0].points).map((p) => p.y)).toEqual([50, 58, 44]);
      });

      it('cuts the drawing in two along a stroke from side to side', () => {
        const { editor, svg } = setup();
        // The visible part of the drawing on screen (happy-dom has no layout).
        (svg.parentElement as HTMLElement).getBoundingClientRect = () => ({ left: 0, right: 1000, width: 1000, top: 0, bottom: 600, height: 600, x: 0, y: 0, toJSON: () => ({}) });
        drag(svg, [[100, 50], [300, 60]]);
        drag(svg, [[100, 400], [300, 420]]);
        hold(svg, [[5, 200], [300, 240], [600, 180], [995, 210]]);
        const drawings = editor.getJSON().content!.filter((n) => n.type === 'drawing');
        expect(drawings).toHaveLength(2);
        expect(drawings.map((d) => d.content?.length)).toEqual([1, 1]);
        // The lower part starts near its own top.
        expect(decodePoints(drawings[1].content![0].attrs!.points)[0].y).toBeLessThan(60);
        // ... and at the left edge.
        expect(decodePoints(drawings[1].content![0].attrs!.points)[0].x).toBeLessThan(60);
      });
    });

    it('a tap only wakes a drawing; once it is active a tap leaves a dot', () => {
      const { editor, svg } = setup();
      drag(svg, [[40, 40], [41, 40]], { pointerType: 'pen' });
      expect(strokes(editor)).toHaveLength(0);
      expect(editor.storage.drawing.active).toBe(true);
      drag(svg, [[40, 40], [41, 40]], { pointerType: 'pen' });
      expect(strokes(editor)).toHaveLength(1);
    });

    it('ignores fingers', () => {
      const { editor, svg } = setup();
      drag(svg, [[10, 50], [300, 50]], { pointerType: 'touch' });
      expect(strokes(editor)).toHaveLength(0);
    });
  });

  describe('pen strokes outside a drawing', () => {
    const pen = (el: Element, type: string, x: number, y: number) => el.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 7, pointerType: 'pen', button: type === 'pointermove' ? -1 : 0,
      buttons: type === 'pointerup' ? 0 : 1, pressure: 0.25,
    }));
    // Starts on `el`, goes on in the drawing it made (pointer capture), ends there.
    const stroke = (editor: Editor, el: Element, x = 20, y = 300) => {
      pen(el, 'pointerdown', x, y);
      pen(el, 'pointermove', x + 2, y);
      pen(el, 'pointermove', x + 30, y + 5);
      const svg = editor.storage.drawing.activeDom?.querySelector('svg');
      if (svg) {
        pen(svg, 'pointermove', x + 60, y + 10);
        pen(svg, 'pointerup', x + 60, y + 10);
      } else {
        pen(el, 'pointerup', x + 30, y + 5);
      }
    };
    const mounted = (html: string) => {
      const element = document.body.appendChild(document.createElement('div'));
      const editor = new Editor({ element, extensions: createSchemaExtensions({ ydoc: new Y.Doc(), placeholder: '' }) });
      editor.commands.setContent(html);
      return editor;
    };
    const types = (editor: Editor) => editor.getJSON().content!.map((n) => n.type);

    it('turns an empty line into a drawing and keeps the stroke', () => {
      const editor = mounted('<p>Lecture</p><p></p><p>More text</p>');
      stroke(editor, editor.view.dom.children[1]);
      expect(types(editor)).toEqual(['paragraph', 'drawing', 'paragraph']);
      expect(strokes(editor)).toHaveLength(1);
      expect(decodePoints(strokes(editor)[0].points).length).toBeGreaterThanOrEqual(3);
      expect(editor.storage.drawing.active).toBe(true);
      editor.destroy();
    });

    it('starts a drawing under the note with a line to type on below it', () => {
      const editor = mounted('<p>Lecture</p>');
      stroke(editor, document.body);
      expect(types(editor)).toEqual(['paragraph', 'drawing', 'paragraph']);
      expect(strokes(editor)).toHaveLength(1);
      editor.destroy();
    });

    it('writes on in the drawing above instead of making another one', () => {
      const editor = mounted('<p>Lecture</p>');
      stroke(editor, document.body);
      // The empty line under the drawing, then the page under the note.
      stroke(editor, editor.view.dom.children[2]);
      stroke(editor, document.body);
      expect(types(editor)).toEqual(['paragraph', 'drawing', 'paragraph']);
      expect(strokes(editor)).toHaveLength(3);
      editor.destroy();
    });

    it('lets the mouse start drawings while "Draw with the mouse" is on', () => {
      const editor = mounted('<p>Lecture</p>');
      setMouseDraws(editor, true);
      const mouse = (el: Element, type: string, x: number, y: number) => el.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', button: type === 'pointermove' ? -1 : 0, buttons: type === 'pointerup' ? 0 : 1, pressure: 0.5,
      }));
      mouse(document.body, 'pointerdown', 20, 300);
      mouse(document.body, 'pointermove', 60, 310);
      const svg = editor.storage.drawing.activeDom!.querySelector('svg')!;
      mouse(svg, 'pointermove', 90, 320);
      mouse(svg, 'pointerup', 90, 320);
      expect(types(editor)).toEqual(['paragraph', 'drawing', 'paragraph']);
      expect(strokes(editor)).toHaveLength(1);
      editor.destroy();
    });

    it('leaves taps, text lines and the mouse alone', () => {
      const editor = mounted('<p>Lecture</p><p></p>');
      const empty = editor.view.dom.children[1];
      pen(empty, 'pointerdown', 20, 300);
      pen(empty, 'pointerup', 20, 300);
      stroke(editor, editor.view.dom.children[0]);
      empty.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 20, clientY: 300, pointerId: 3, pointerType: 'mouse', buttons: 1 }));
      empty.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 80, clientY: 300, pointerId: 3, pointerType: 'mouse', buttons: 1 }));
      expect(types(editor)).toEqual(['paragraph', 'paragraph']);
      editor.destroy();
    });
  });
});
