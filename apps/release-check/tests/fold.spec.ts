import { test, expect, openHarness, placeCursor, selectedText, selection } from './helpers';
import type { Page } from '@playwright/test';

const arrow = (page: Page, index = 0) => page.locator('.ProseMirror .heading-toggle').nth(index);
const middle = async (page: Page, index = 0) => {
  const box = (await arrow(page, index).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};
const collapsedHeadings = (page: Page) => page.evaluate(() => {
  const out: string[] = [];
  (window as any).__h.editor().state.doc.descendants((node: any) => {
    if (node.type.name === 'heading' && node.attrs.collapsed) out.push(node.textContent);
  });
  return out;
});

test.describe('fold arrows and the selection', () => {
  // 1b1ac9a: the press started a selection drag, the next tiny movement extended the old
  // selection to the line beside the arrow.
  test('a press with a tiny movement on an arrow keeps the cursor where it was', async ({ page }) => {
    await openHarness(page, 'fold');
    await placeCursor(page, 'Gamma text', 3);
    const before = await selection(page);
    const { x, y } = await middle(page);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 1, y + 1);
    await page.mouse.move(x + 2, y + 2);
    await page.mouse.up();
    expect(await collapsedHeadings(page)).toEqual(['Section one']);
    expect(await selectedText(page)).toBe('');
    expect(await selection(page)).toEqual(before);
    expect(await page.evaluate(() => document.getSelection()?.isCollapsed)).toBe(true);
  });

  test('a press on an arrow keeps a selection elsewhere intact', async ({ page }) => {
    await openHarness(page, 'fold');
    await page.evaluate(() => {
      const editor = (window as any).__h.editor();
      let at = 0;
      editor.state.doc.descendants((node: any, pos: number) => { if (node.isText && node.text.startsWith('Epsilon')) at = pos; });
      editor.commands.focus();
      editor.commands.setTextSelection({ from: at, to: at + 7 });
    });
    const { x, y } = await middle(page);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 3);
    await page.mouse.up();
    expect(await selectedText(page)).toBe('Epsilon');
  });

  test('a double click on an arrow folds and opens, and selects nothing', async ({ page }) => {
    await openHarness(page, 'fold');
    await placeCursor(page, 'Epsilon', 2);
    const { x, y } = await middle(page);
    await page.mouse.dblclick(x, y);
    expect(await collapsedHeadings(page)).toEqual([]);
    expect(await selectedText(page)).toBe('');
  });

  test('a drag over a heading with an arrow selects from text to text', async ({ page }) => {
    await openHarness(page, 'fold');
    const start = (await page.getByText('Beta text under one.').boundingBox())!;
    const end = (await page.getByText('Gamma text under two.').boundingBox())!;
    await page.mouse.move(start.x + 2, start.y + start.height / 2);
    await page.mouse.down();
    await page.mouse.move(end.x + 40, end.y + end.height / 2, { steps: 8 });
    await page.mouse.up();
    const text = await selectedText(page);
    expect(text).toContain('Section two');
    expect(text.startsWith('Beta')).toBe(true);
    expect(await collapsedHeadings(page)).toEqual([]);
  });

  test('a drag from a heading into the arrow margin ends at the start of that line', async ({ page }) => {
    await openHarness(page, 'fold');
    const heading = (await page.getByRole('heading', { name: 'Section two' }).boundingBox())!;
    const y = heading.y + heading.height / 2;
    const { x } = await middle(page, 1);
    await page.mouse.move(heading.x + 110, y);
    await page.mouse.down();
    await page.mouse.move(x, y, { steps: 10 });
    await page.mouse.up();
    const text = await selectedText(page);
    expect(text.length).toBeGreaterThan(3);
    expect('Section two'.startsWith(text)).toBe(true);
    expect(await collapsedHeadings(page)).toEqual([]);
  });
});

test.describe('folding', () => {
  // 0dfd9ec: folding moved the page. The section is mid-note: at the very end the page gets
  // shorter than the scroll position and no code can keep it.
  test('the toggled heading stays where it was on the screen', async ({ page }) => {
    await openHarness(page, 'foldLong');
    const heading = page.getByRole('heading', { name: 'Middle section' });
    await page.evaluate(() => {
      const scroller = document.getElementById('root')!;
      scroller.scrollTop += [...document.querySelectorAll('h2')].find((h) => h.textContent === 'Middle section')!.getBoundingClientRect().top - 300;
    });
    const top = (await heading.boundingBox())!.y;
    const { x, y } = await middle(page);
    await page.mouse.click(x, y);
    await expect(page.getByText('Inside paragraph 1:')).toBeHidden();
    await page.waitForTimeout(100);
    expect(Math.abs((await heading.boundingBox())!.y - top)).toBeLessThan(2);
    await page.mouse.click(x, y);
    await expect(page.getByText('Inside paragraph 1:')).toBeVisible();
    await page.waitForTimeout(100);
    expect(Math.abs((await heading.boundingBox())!.y - top)).toBeLessThan(2);
  });

  test('folding hides up to the next heading of the same level and keeps the text', async ({ page }) => {
    await openHarness(page, 'fold');
    const { x, y } = await middle(page, 1);
    await page.mouse.click(x, y);
    await expect(page.getByText('Gamma text under two.')).toBeHidden();
    await expect(page.getByText('Delta text under three.')).toBeHidden();
    await expect(page.getByText('Epsilon text at the end.')).toBeVisible();
    expect(await page.evaluate(() => (window as any).__h.text())).toContain('Delta text under three.');
  });

  test('folding the text the cursor is in moves the cursor to the heading', async ({ page }) => {
    await openHarness(page, 'fold');
    await placeCursor(page, 'Alpha text', 3);
    const { x, y } = await middle(page);
    await page.mouse.click(x, y);
    await page.keyboard.type('!');
    expect(await page.evaluate(() => (window as any).__h.html())).toContain('Section one!</h2>');
    await expect(page.getByText('Alpha text under one.')).toBeHidden();
  });

  test('Enter at the end of a folded heading opens it and starts a line under it', async ({ page }) => {
    await openHarness(page, 'fold');
    const { x, y } = await middle(page);
    await page.mouse.click(x, y);
    await placeCursor(page, 'Section one', 'Section one'.length);
    await page.keyboard.press('Enter');
    await page.keyboard.type('New line');
    await expect(page.getByText('Alpha text under one.')).toBeVisible();
    expect(await page.evaluate(() => (window as any).__h.html())).toMatch(/Section one<\/h2><p>New line<\/p>/);
  });

  test('a fold survives an undo of the typing after it', async ({ page }) => {
    await openHarness(page, 'fold');
    const { x, y } = await middle(page);
    await page.mouse.click(x, y);
    await placeCursor(page, 'Epsilon', 0);
    await page.keyboard.type('x');
    await page.keyboard.press('Control+z');
    await expect(page.getByText('Epsilon text at the end.')).toBeVisible();
    expect(await page.evaluate(() => (window as any).__h.text())).not.toContain('xEpsilon');
  });
});
