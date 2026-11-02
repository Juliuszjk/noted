import { test, expect, openNote, placeCursor } from './helpers';
import type { Page } from '@playwright/test';

// The editor keeps an empty line after a closing list or code block (its trailing node).
const html = async (page: Page): Promise<string> => (await page.evaluate(() => (window as any).__h.html() as string)).replace(/<p><\/p>$/, '');
const json = (page: Page) => page.evaluate(() => {
  const doc = (window as any).__h.json();
  const last = doc.content.at(-1);
  if (doc.content.length > 1 && last.type === 'paragraph' && !last.content) doc.content.pop();
  return doc;
});
const types = async (page: Page) => (await json(page)).content.map((n: any) => n.type);

// A paste as the browser delivers it (the real clipboard differs per engine and needs a
// permission; the editor only reads the event's data).
const paste = (page: Page, data: Record<string, string>) => page.evaluate((items) => {
  const clipboardData = new DataTransfer();
  for (const [type, value] of Object.entries(items)) clipboardData.setData(type, value);
  const dom = (window as any).__h.editor().view.dom;
  dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
}, data);

test.describe('lists', () => {
  test('Enter continues a list, Enter on an empty item leaves it', async ({ page }) => {
    await openNote(page, '<ul><li><p>One</p></li></ul>');
    await placeCursor(page, 'One', 3);
    await page.keyboard.press('Enter');
    await page.keyboard.type('Two');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Out');
    expect(await html(page)).toBe('<ul><li><p>One</p></li><li><p>Two</p></li></ul><p>Out</p>');
  });

  // afdb3f4: Tab on the first item moves the whole list.
  test('Tab on the first item indents the whole list, Shift+Tab brings it back', async ({ page }) => {
    await openNote(page, '<ul><li><p>One</p></li><li><p>Two</p></li></ul>');
    await placeCursor(page, 'One', 0);
    const left = () => page.getByText('Two', { exact: true }).evaluate((el) => el.getBoundingClientRect().left);
    const before = await left();
    await page.keyboard.press('Tab');
    expect(await left()).toBeGreaterThan(before + 10);
    expect((await json(page)).content).toHaveLength(1);
    await page.keyboard.press('Shift+Tab');
    expect(await left()).toBeCloseTo(before, 0);
  });

  test('Tab on a later item nests only that item', async ({ page }) => {
    await openNote(page, '<ul><li><p>One</p></li><li><p>Two</p></li></ul>');
    await placeCursor(page, 'Two', 0);
    await page.keyboard.press('Tab');
    expect(await html(page)).toBe('<ul><li><p>One</p><ul><li><p>Two</p></li></ul></li></ul>');
  });

  test('a list started in an indented line keeps the indent', async ({ page }) => {
    await openNote(page, '<p data-indent="2">Line</p>');
    await placeCursor(page, 'Line', 0);
    const left = await page.getByText('Line').evaluate((el) => el.getBoundingClientRect().left);
    await page.keyboard.press('Control+Shift+8');
    const list = (await json(page)).content[0];
    expect(list.type).toBe('bulletList');
    expect(await page.getByText('Line').evaluate((el) => el.getBoundingClientRect().left)).toBeGreaterThanOrEqual(left);
  });

  test('switching a list kind joins it with its neighbours', async ({ page }) => {
    await openNote(page, '<ul><li><p>One</p></li></ul><ol><li><p>Two</p></li></ol>');
    await placeCursor(page, 'Two', 0);
    await page.keyboard.press('Control+Shift+8');
    expect(await html(page)).toBe('<ul><li><p>One</p></li><li><p>Two</p></li></ul>');
  });
});

test.describe('paste', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Firefox ignores clipboardData on a made-up paste event');

  test('Markdown text becomes headings, tasks, lists, code', async ({ page }) => {
    await openNote(page, '<p></p>');
    await page.evaluate(() => (window as any).__h.editor().commands.focus('end'));
    await page.waitForFunction(() => (window as any).__h.editor().isFocused);
    await paste(page, { 'text/plain': '# Title here\n\n- [x] done\n- [ ] todo\n\n1. one\n2. two\n\n```python\nprint(1)\n```\n' });
    await expect(page.locator('.ProseMirror h1')).toHaveText('Title here');
    expect(await types(page)).toEqual(expect.arrayContaining(['heading', 'taskList', 'orderedList', 'codeBlock']));
  });

  test('LaTeX in Markdown survives as formulas', async ({ page }) => {
    await openNote(page, '<p></p>');
    await page.evaluate(() => (window as any).__h.editor().commands.focus('end'));
    await page.waitForFunction(() => (window as any).__h.editor().isFocused);
    await paste(page, { 'text/plain': '# Math\n\nLet $x_1 \\in \\{a,b\\}$ hold.\n\n$$\n\\frac{1}{2}\n$$\n' });
    const text = JSON.stringify(await json(page));
    expect(text).toContain('inlineMath');
    expect(text).toContain('blockMath');
    expect(text).toContain('\\\\frac{1}{2}');
  });

  test('plain lines stay plain lines', async ({ page }) => {
    await openNote(page, '<p>Hello</p>');
    await placeCursor(page, 'Hello', 5);
    await paste(page, { 'text/plain': ' one sentence - with a dash' });
    expect(await html(page)).toBe('<p>Hello one sentence - with a dash</p>');
  });

  test('HTML from a web page keeps the list and drops scripts and styles', async ({ page }) => {
    await openNote(page, '<p></p>');
    await page.evaluate(() => (window as any).__h.editor().commands.focus('end'));
    await page.waitForFunction(() => (window as any).__h.editor().isFocused);
    await paste(page, { 'text/html': '<ul><li>Web one</li><li onclick="alert(1)">Web two</li></ul><script>window.__pwned = 1</script>', 'text/plain': 'Web one\nWeb two' });
    expect(await html(page)).toContain('<ul><li><p>Web one</p></li><li><p>Web two</p></li></ul>');
    expect(await page.evaluate(() => (window as any).__pwned)).toBeUndefined();
  });

  test('an image from a web address is not loaded on paste', async ({ page, outside }) => {
    await openNote(page, '<p></p>');
    await page.evaluate(() => (window as any).__h.editor().commands.focus('end'));
    await page.waitForFunction(() => (window as any).__h.editor().isFocused);
    await paste(page, { 'text/html': '<p>Picture <img src="https://example.com/never.png"></p>', 'text/plain': 'Picture' });
    await page.waitForTimeout(200);
    expect(outside).toEqual([]);
    expect(await page.locator('.ProseMirror img[src*="never.png"]').count()).toBe(0);
  });

  test('text pasted into a code block stays raw', async ({ page }) => {
    await openNote(page, '<pre><code>x</code></pre>');
    await placeCursor(page, 'x', 1);
    await paste(page, { 'text/plain': '\n# not a heading\n- not a list' });
    const body = await json(page);
    expect(body.content).toHaveLength(1);
    expect(body.content[0].type).toBe('codeBlock');
    expect(body.content[0].content[0].text).toBe('x\n# not a heading\n- not a list');
  });
});

// d3b1720: the text of a copy holding formulas has "$...$" and quotes, so it was read as Markdown
// and the pasted copy lost its headings and quotes.
test('copy and paste inside a note keeps formulas, headings and quotes', async ({ page, browserName, context }) => {
  test.skip(browserName !== 'chromium', 'needs the real clipboard');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const formula = (latex: string) => `<span data-type="inline-math" data-latex="${latex}"></span>`;
  await openNote(page, `<h1>Task one</h1><p>Signal ${formula('f_{max}')} and ${formula('f_p')}</p><blockquote><p>Example ${formula('f_p')} here</p></blockquote><p>Target:</p>`);
  await page.evaluate(() => {
    const editor = (window as any).__h.editor();
    let end = 0;
    editor.state.doc.descendants((node: any, pos: number) => { if (node.type.name === 'blockquote') end = pos + node.nodeSize - 2; });
    editor.commands.focus();
    editor.commands.setTextSelection({ from: 1, to: end });
  });
  await page.waitForFunction(() => (window as any).__h.editor().isFocused);
  await page.keyboard.press('Control+c');
  await placeCursor(page, 'Target:', 7);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+v');
  const text = await html(page);
  expect(text.split('<h1>')).toHaveLength(3);
  expect(text.split('<blockquote>')).toHaveLength(3);
  expect(text.split('data-latex="f_p"')).toHaveLength(5);
});
