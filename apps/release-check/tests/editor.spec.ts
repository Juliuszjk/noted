import { test, expect, openHarness, openNote, placeCursor, selectedText } from './helpers';

const html = (page: any): Promise<string> => page.evaluate(() => (window as any).__h.html());

test.describe('editing', () => {
  test('typing, a shortcut and undo', async ({ page }) => {
    await openNote(page, '<p>Start</p>');
    await placeCursor(page, 'Start', 5);
    await page.keyboard.type(' typed');
    await page.keyboard.press('Control+b');
    await page.keyboard.type(' bold');
    expect(await html(page)).toContain('Start typed<strong> bold</strong>');
    await page.keyboard.press('Control+z');
    expect(await html(page)).not.toContain('bold');
  });

  test('the slash menu inserts a collapsible heading', async ({ page }) => {
    await openNote(page, '<p>Start</p><p></p>');
    await page.evaluate(() => {
      const editor = (window as any).__h.editor();
      editor.commands.focus('end');
    });
    await page.waitForFunction(() => (window as any).__h.editor().isFocused);
    await page.keyboard.type('/collapsible');
    await page.waitForTimeout(150);
    await page.keyboard.press('Enter');
    await page.keyboard.type('Made by slash');
    expect(await html(page)).toContain('<h1 data-foldable="true">Made by slash</h1>');
    await expect(page.locator('.heading-toggle')).toHaveCount(1);
  });

  test('a task box ticks without moving the cursor', async ({ page }) => {
    await openHarness(page, 'kitchen');
    await placeCursor(page, 'Bullet one', 2);
    await page.locator('ul[data-type="taskList"] input[type=checkbox]').nth(1).click();
    expect(await html(page)).toMatch(/data-checked="true"[^]*Open task/);
    await page.keyboard.type('x');
    expect(await html(page)).toContain('Buxllet one');
  });

  test('Tab in a code block indents, and Ctrl+A takes the block first, then the note', async ({ page }) => {
    await openHarness(page, 'kitchen');
    await placeCursor(page, 'console.log', 0);
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => (window as any).__h.text())).toContain('  console.log(answer);');
    await page.keyboard.press('Control+a');
    expect((await selectedText(page)).startsWith('const answer')).toBe(true);
    await page.keyboard.press('Control+a');
    expect(await page.evaluate(() => (window as any).__h.editor().state.selection.toJSON().type)).toBe('all');
  });

  test('a page rebuilt from the same document keeps every node (schema round trip)', async ({ page }) => {
    await openHarness(page, 'kitchen');
    const first = await html(page);
    await page.evaluate((h) => (window as any).__h.open(h, 'Again'), first);
    expect(await html(page)).toBe(first);
  });
});
