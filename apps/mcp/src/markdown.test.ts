// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import type { JSONContent } from '@tiptap/core';
import { noteBodyJson } from '@noted/sync/doc-json';
import { setNoteBodyJson } from '@noted/sync/json-to-y';
import { renderBody, parseRewrite, newBlocks, markdownBlocks } from './markdown';
import { applyRewrite, insertBlocks, replaceText, setTaskDone } from './edits';

const text = (t: string, marks?: JSONContent['marks']): JSONContent => ({ type: 'text', text: t, ...(marks ? { marks } : {}) });
const para = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content });
const image: JSONContent = { type: 'image', attrs: { blob: 'img1:a2V5', alt: 'board', align: 'center' } };
const drawing: JSONContent = { type: 'drawing', attrs: { height: 300 }, content: [{ type: 'drawingStroke', attrs: { points: '1:AAAA', color: 'red', size: 4, tool: 'pen' } }] };
const reminder: JSONContent = { type: 'reminder', attrs: { id: 'r1', at: Date.UTC(2026, 9, 20, 16), done: false } };

const lecture = (): Y.Doc => {
  const doc = new Y.Doc();
  setNoteBodyJson(doc, {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [text('Lecture 3')] },
      para(text('Red '), text('words', [{ type: 'textStyle', attrs: { color: '#ff0000' } }]), text(' stay')),
      image,
      para(text('Homework '), reminder, text(' see '), { type: 'noteLink', attrs: { noteId: 'n2' } }),
      { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [para(text('read chapter 2'))] }] },
      drawing,
      para(text('half a sent')),
    ],
  });
  return doc;
};
const titles = (id: string) => (id === 'n2' ? 'Syllabus' : null);
const noTitles = () => null;
const body = (doc: Y.Doc) => noteBodyJson(doc).content ?? [];

describe('note as Markdown', () => {
  it('shows images, drawings, reminders and links as tokens', () => {
    const view = renderBody(noteBodyJson(lecture()), titles);
    expect(view.markdown).toContain('## Lecture 3');
    expect(view.markdown).toContain('⟦image 1: board⟧');
    expect(view.markdown).toContain('⟦drawing 1⟧');
    expect(view.markdown).toMatch(/Homework ⟦reminder 1: » [^⟧]+⟧ see ⟦link 1: Syllabus⟧/);
    expect(view.markdown).toContain('- [ ] read chapter 2');
  });

  it('keeps everything when the Markdown comes back unchanged', () => {
    const doc = lecture();
    const before = body(doc);
    const view = renderBody(noteBodyJson(doc), titles);
    const parsed = parseRewrite(view, view.markdown, noTitles);
    if ('error' in parsed) throw new Error(parsed.error);
    expect(parsed.items.every((i) => 'keep' in i)).toBe(true);
    const sv = Y.encodeStateVector(doc);
    applyRewrite(doc, parsed.items, view.blocks.map((b) => b.json));
    expect(Y.encodeStateAsUpdate(doc, sv).length).toBeLessThan(10);
    expect(body(doc)).toEqual(before);
  });

  it('reformats around the originals: moved image and drawing stay byte for byte, untouched blocks keep colours', () => {
    const doc = lecture();
    const view = renderBody(noteBodyJson(doc), titles);
    const md = [
      '# Lecture 3: graphs',
      view.blocks[1].md,
      '⟦drawing 1⟧',
      '```js\nconst g = new Graph();\n```',
      'Homework ⟦reminder 1: whatever⟧ see ⟦link 1: Syllabus⟧ and [[Syllabus]]',
      '⟦image 1⟧',
      '- [ ] read chapter 2',
      'Half a sentence *(completed)*.',
    ].join('\n\n');
    const parsed = parseRewrite(view, md, (t) => (t === 'Syllabus' ? 'n2' : null));
    if ('error' in parsed) throw new Error(parsed.error);
    applyRewrite(doc, parsed.items, view.blocks.map((b) => b.json));
    const after = body(doc);
    expect(after[0]).toMatchObject({ type: 'heading', attrs: { level: 1 } });
    expect(after[1]).toEqual(noteBodyJson(lecture()).content![1]);
    expect(after[2]).toEqual(drawing);
    expect(after[3]).toMatchObject({ type: 'codeBlock', attrs: { language: 'js' } });
    expect(after[4].content?.filter((n) => n.type === 'reminder')).toEqual([reminder]);
    expect(after[4].content?.filter((n) => n.type === 'noteLink')).toHaveLength(2);
    expect(after[5]).toEqual(image);
    expect(after).toHaveLength(8);
  });

  it('refuses to lose an image, drawing or reminder unless asked', () => {
    const view = renderBody(noteBodyJson(lecture()), titles);
    const md = view.markdown.replace(/⟦image 1[^⟧]*⟧/, '').replace(/⟦reminder 1[^⟧]*⟧/, '');
    const parsed = parseRewrite(view, md, noTitles);
    expect('error' in parsed && parsed.error).toMatch(/Missing: ⟦image 1⟧, ⟦reminder 1⟧/);
    expect('items' in parseRewrite(view, md, noTitles, ['image 1', 'reminder 1'])).toBe(true);
    expect('error' in parseRewrite(view, `${view.markdown}\n\n⟦image 7⟧`, noTitles)).toBe(true);
  });

  it('splits a paragraph around a block token on a line of its own', () => {
    const view = renderBody(noteBodyJson(lecture()), titles);
    const md = view.markdown.replace(/\n\n⟦image 1: board⟧\n\n/, '\n\nbefore\n⟦image 1⟧\nafter\n\n');
    const parsed = parseRewrite(view, md, noTitles);
    if ('error' in parsed) throw new Error(parsed.error);
    const doc = lecture();
    applyRewrite(doc, parsed.items, view.blocks.map((b) => b.json));
    const i = body(doc).findIndex((b) => b.type === 'image');
    expect(body(doc)[i - 1].content?.at(-1)?.text).toBe('before');
    expect(body(doc)[i + 1].content?.[0].text).toBe('after');
  });

  it('reads math, highlights, callouts and tasks from Markdown', () => {
    const blocks = markdownBlocks('Euler: $e^{i\\pi}+1=0$ is ==neat==, costs $5\n\n$$\n\\int x\n$$\n\n> [!WARNING]\n> Exam on Friday\n\n- [x] done\n- [ ] todo');
    expect(blocks[0].content?.find((n) => n.type === 'inlineMath')?.attrs?.latex).toBe('e^{i\\pi}+1=0');
    expect(blocks[0].content?.find((n) => n.marks?.some((m) => m.type === 'highlight'))?.text).toBe('neat');
    expect(blocks[0].content?.at(-1)?.text).toContain('$5');
    expect(blocks[1]).toMatchObject({ type: 'blockMath', attrs: { latex: '\\int x' } });
    expect(blocks[2]).toMatchObject({ type: 'callout', attrs: { variant: 'warning' } });
    expect(blocks[2].content?.[0].content?.[0].text).toBe('Exam on Friday');
    expect(blocks[3]).toMatchObject({ type: 'taskList' });
    expect(blocks[3].content?.map((i) => i.attrs?.checked)).toEqual([true, false]);
  });

  it('does not take tokens in new content', () => {
    expect('error' in newBlocks('⟦image 1⟧', noTitles)).toBe(true);
  });
});

describe('edits in place', () => {
  it('replaces text inside a line and keeps its formatting', () => {
    const doc = lecture();
    expect(replaceText(doc, 'words', 'letters')).toEqual({ count: 1 });
    expect(body(doc)[1].content?.[1]).toEqual(text('letters', [{ type: 'textStyle', attrs: { color: '#ff0000' } }]));
    expect('error' in replaceText(doc, 'e', 'x')).toBe(true);
    expect('error' in replaceText(doc, 'missing', 'x')).toBe(true);
  });

  it('ticks a task and adds tasks to the list it follows', () => {
    const doc = lecture();
    expect(setTaskDone(doc, 'chapter 2', true)).toEqual({ ok: true });
    const blocks = newBlocks('- [ ] solve problem 4', noTitles);
    if ('error' in blocks) throw new Error(blocks.error);
    insertBlocks(doc, 5, blocks.blocks);
    const list = body(doc)[4];
    expect(list.content?.map((i) => i.attrs?.checked)).toEqual([true, false]);
    expect(body(doc)).toHaveLength(7);
  });
});
