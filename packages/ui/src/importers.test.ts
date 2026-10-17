// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { importMarkdown, parseImport, importHtml, importText } from './importers';
import type { ImportFile } from './importers';

const file = (path: string, content: string | Uint8Array): ImportFile => ({
  path,
  text: async () => (typeof content === 'string' ? content : new TextDecoder().decode(content)),
  bytes: async () => (typeof content === 'string' ? new TextEncoder().encode(content) : content),
});
const storeImage = async (_bytes: Uint8Array, name: string) => `blob-${name}:key`;
const types = (json: any): string[] => [json.type, ...(json.content ?? []).flatMap(types)];

describe('importers', () => {
  it('reads an Obsidian vault: folders, front matter, #tags, [[links]], images, checklists', async () => {
    const notes = await importMarkdown([
      file('Semestr 5/Plan.md', '---\ntags: [studia, plan]\n---\n# Plan\n\nSee [[Lab 1]] and [[Missing|other]].\n\n- [ ] todo\n- [x] done\n\n![[pic.png]] #obsidian\n'),
      file('Semestr 5/Lab 1.md', 'Just text'),
      file('Semestr 5/pic.png', new Uint8Array([1, 2, 3])),
    ], storeImage);
    const plan = notes.find((n) => n.title === 'Plan')!;
    const lab = notes.find((n) => n.title === 'Lab 1')!;
    expect(plan.notebook).toBe('Semestr 5');
    expect(plan.tags.sort()).toEqual(['obsidian', 'plan', 'studia']);
    const all = JSON.stringify(plan.json);
    expect(all).toContain(`"noteId":"${lab.id}"`);
    expect(all).toContain('other');
    expect(all).toContain('"blob":"blob-pic.png:key"');
    expect(types(plan.json)).toContain('taskItem');
    expect(all).not.toContain('"text":"Plan"');
  });

  it('reads a Notesnook export zip (Markdown with front matter and HTML)', async () => {
    const zip = zipSync({
      'Work/Plan.md': strToU8('---\ntitle: "Plan Q4"\ntags: [work]\npinned: true\ncreated_at: 2024-05-01T10:00:00.000Z\n---\n\nSome *text*\n'),
      'Ideas.html': strToU8('<html><head><title>Ideas</title></head><body><p>one</p></body></html>'),
      '__MACOSX/._Ideas.html': strToU8('junk'),
    });
    const notes = await parseImport('notesnook', [file('notesnook-export.zip', zip)], storeImage);
    expect(notes.map((n) => n.title).sort()).toEqual(['Ideas', 'Plan Q4']);
    const plan = notes.find((n) => n.title === 'Plan Q4')!;
    expect(plan).toMatchObject({ notebook: 'Work', tags: ['work'], pinned: true, created: Date.parse('2024-05-01T10:00:00.000Z') });
  });
  it('keeps checklists of Notesnook HTML, text indentation, and one title from front matter', async () => {
    const [html] = await importHtml([file('List.html', '<html><head><title>List</title></head><body><ul class="checklist"><li class="checklist--item checked">done</li><li class="checklist--item">todo</li></ul></body></html>')], storeImage);
    const items = (html.json.content?.[0].content ?? []);
    expect(html.json.content?.[0].type).toBe('taskList');
    expect(items.map((i) => i.attrs?.checked)).toEqual([true, false]);
    const [text] = await importText([file('Plan.txt', 'Plan\n\nfirst\n    indented\n\tagain\n')]);
    expect(text.json.content?.map((p) => p.content?.[0].text ?? '')).toEqual(['first', '\tindented', '\tagain']);
    const [md] = await importMarkdown([file('Note.md', '---\ntitle: "Note"\n---\n\n# Note\n\nbody\n')], storeImage);
    expect(md.title).toBe('Note');
    expect(JSON.stringify(md.json)).not.toContain('"heading"');
  });
  it('turns checkbox and list lines of text files into nested lists', async () => {
    const [note] = await importText([file('T.txt', 'intro\n[ ] buy milk\n[x] call mum\n    [ ] nested\n- one\n- two\n1. first\n')]);
    const c = note.json.content!;
    expect(c.map((n) => n.type)).toEqual(['paragraph', 'taskList', 'bulletList', 'orderedList']);
    expect(c[1].content!.map((i) => i.attrs?.checked)).toEqual([false, true]);
    expect(c[1].content![1].content![1].type).toBe('taskList');
    const [links] = await importText([file('L.txt', 'see https://example.com/a, ok\n')]);
    expect(links.json.content![0].content).toEqual([
      { type: 'text', text: 'see ' },
      { type: 'text', text: 'https://example.com/a', marks: [{ type: 'link', attrs: { href: 'https://example.com/a' } }] },
      { type: 'text', text: ', ok' },
    ]);
  });
});

describe('Notesnook exports with files', () => {
  const storeFile = async (_bytes: Uint8Array, name: string) => `file-${name}:key`;
  const assets = [
    file('attachments/9f86349a57ef5b38-shot.png', new Uint8Array([1])),
    file('attachments/dffd277b4c744b13-clip.mp4', new Uint8Array([1, 2, 3])),
  ];
  it('Markdown: images, attachments, links and empty lines', async () => {
    const md = '# TODO\n\n- [ ] noted\n\n\n\n\n\n\n\n[clip.mp4](<./attachments/dffd277b4c744b13-clip.mp4> "clip.mp4")\n\n[yt](<youtube.com> "yt")\n\n![shot.png](<./attachments/9f86349a57ef5b38-shot.png>)\n';
    const [note] = await importMarkdown([file('TODO.md', md), ...assets], storeImage, storeFile);
    const c = note.json.content!;
    expect(c.map((n) => n.type)).toEqual(['taskList', 'paragraph', 'paragraph', 'paragraph', 'attachment', 'paragraph', 'image']);
    expect(c[4].attrs).toMatchObject({ blob: 'file-clip.mp4:key', name: 'clip.mp4', size: 3, mime: 'video/mp4' });
    expect(c[6].attrs?.blob).toBe('blob-shot.png:key');
    expect(JSON.stringify(c[5])).toContain('"href":"youtube.com"');
  });
  it('HTML: image in a span with its size, attachment links', async () => {
    const html = '<html><head><title>TODO</title></head><body><h1>TODO</h1><p><a href="./attachments/dffd277b4c744b13-clip.mp4">clip.mp4</a></p><span class="image-container"><img src="./attachments/9f86349a57ef5b38-shot.png" alt="shot.png" width="250" height="252"></span></body></html>';
    const [note] = await importHtml([file('TODO.html', html), ...assets], storeImage, storeFile);
    const c = note.json.content!;
    expect(c.map((n) => n.type)).toEqual(['attachment', 'image']);
    expect(c[1].attrs).toMatchObject({ blob: 'blob-shot.png:key', width: 250, height: 252 });
  });
  it('text: "word [address]" becomes a link', async () => {
    const [note] = await importText([file('T.txt', 'see yt [youtube.com] now')]);
    expect(JSON.stringify(note.json)).toContain('"text":"yt","marks":[{"type":"link","attrs":{"href":"https://youtube.com"');
  });
});

it('text spacing like Notesnook, empty <p><br></p>, and files that were not picked', async () => {
  const [t] = await importText([file('T.txt', 'a\n\nb\n\n\n\n\nc\n')]);
  expect(t.json.content!.map((n) => n.content?.[0]?.text ?? '')).toEqual(['a', 'b', '', '', 'c']);
  const [h] = await importHtml([file('H.html', '<body><p>a</p><p><br></p><p>b</p></body>')], storeImage);
  expect(h.json.content!.map((n) => n.content?.length ?? 0)).toEqual([1, 0, 1]);
  const report = { missing: [] as string[] };
  await parseImport('markdown', [file('N.md', '![x](<./attachments/a.png>)\n')], storeImage, undefined, report);
  expect(report.missing).toEqual(['./attachments/a.png']);
});

it('gives notes with the same name in different folders their own ids', async () => {
  const notes = await importMarkdown([file('Studia/Zakupy.md', '# Zakupy\n\n- [ ] Miód\n'), file('Random/Zakupy.md', '# Zakupy\n\n- [ ] Miód\n'), file('Plan.md', 'See [[Zakupy]]\n')], storeImage);
  const [a, b, plan] = notes;
  expect(a.id).not.toBe(b.id);
  expect([a.notebook, b.notebook]).toEqual(['Studia', 'Random']);
  expect(JSON.stringify(plan.json)).toContain(a.id);
});
