import { readFileSync } from 'node:fs';
import { test, expect, openHarness, API, PUBLIC, SETUP_CODE, artifact } from './helpers';
import type { Page } from '@playwright/test';

// The real API (apps/api) with a throwaway database on loopback, the real viewer and live
// page, and the apps' own publishing code in the harness. Nothing leaves the machine.

test.skip(({ browserName }) => browserName !== 'chromium', 'runs once, in the Chromium project');

const owner = async (page: Page, fixture: string) => {
  await openHarness(page, fixture);
  await page.evaluate(([a, p, c]) => (window as any).__h.owner.connect(a, p, c), [API, PUBLIC, SETUP_CODE]);
};
const publishStatic = (page: Page, options = {}) => page.evaluate((o) => (window as any).__h.owner.publishStatic(o), options);
const publishLive = (page: Page, editable: boolean, password: string | null = null) =>
  page.evaluate(([e, p]) => (window as any).__h.owner.publishLive(e, p), [editable, password] as const);
const noteFrame = (page: Page) => page.frameLocator('#note');

test.describe('static publishing', () => {
  test('the link shows the note, the server holds only sealed bytes', async ({ page, context, request }) => {
    await owner(page, 'kitchen');
    const { url, id } = await publishStatic(page);
    expect(url.startsWith(`${PUBLIC}/p/`)).toBe(true);
    const stored = await request.get(`${PUBLIC}/p/${id}/data`);
    expect(stored.status()).toBe(200);
    const bytes = (await stored.body()).toString('latin1');
    for (const word of ['Kitchen sink', 'Bullet one', 'answer']) expect(bytes).not.toContain(word);

    const reader = await context.newPage();
    const urls: string[] = [];
    reader.on('request', (r) => urls.push(r.url()));
    await reader.goto(url);
    await expect(noteFrame(reader).getByText('Bullet one')).toBeVisible();
    await expect(noteFrame(reader).locator('.katex').first()).toBeVisible();
    await expect(noteFrame(reader).locator('ul[data-type="taskList"] input').first()).toBeChecked();
    // The key is the #fragment: it never goes to the server.
    expect(urls.filter((u) => u.includes('#')).length + urls.filter((u) => u.includes(url.split('#')[1])).length).toBe(0);
    await reader.screenshot({ path: artifact('publish', 'static.png') });
  });

  test('the viewer frame runs no scripts and folded parts stay hidden', async ({ page, context }) => {
    await owner(page, 'collapsed');
    const { url } = await publishStatic(page);
    const reader = await context.newPage();
    await reader.goto(url);
    await expect(noteFrame(reader).getByText('Visible opening line.')).toBeVisible();
    await expect(noteFrame(reader).getByText('HIDDENPARAGRAPH')).toBeHidden();
    expect(await reader.locator('#note').getAttribute('sandbox')).not.toContain('allow-scripts');
  });

  test('a wrong key says so', async ({ page, context }) => {
    await owner(page, 'fold');
    const { url } = await publishStatic(page);
    const reader = await context.newPage();
    await reader.goto(`${url.split('#')[0]}#${'A'.repeat(43)}`);
    await expect(reader.locator('#status')).toBeVisible();
    await expect(noteFrame(reader).getByText('Alpha text under one.')).toHaveCount(0);
  });

  test('a password protects the copy', async ({ page, context }) => {
    await owner(page, 'fold');
    const { url } = await publishStatic(page, { password: 'correct horse' });
    const reader = await context.newPage();
    await reader.goto(url);
    const input = reader.locator('#unlock input');
    await input.fill('wrong');
    await input.press('Enter');
    await expect(reader.locator('#unlock')).toBeVisible();
    await input.fill('correct horse');
    await input.press('Enter');
    await expect(noteFrame(reader).getByText('Alpha text under one.')).toBeVisible();
  });

  test('self destruct: readable once, then gone', async ({ page, context }) => {
    await owner(page, 'fold');
    const { url } = await publishStatic(page, { selfDestruct: true });
    const first = await context.newPage();
    await first.goto(url);
    await expect(noteFrame(first).getByText('Alpha text under one.')).toBeVisible();
    const second = await context.newPage();
    await second.goto(url);
    await expect(second.getByText('This note is not published.')).toBeVisible();
  });

  test('unpublishing removes it', async ({ page, context }) => {
    await owner(page, 'fold');
    const { url } = await publishStatic(page);
    await page.evaluate(() => (window as any).__h.owner.unpublishStatic());
    const reader = await context.newPage();
    await reader.goto(url);
    await expect(reader.getByText('This note is not published.')).toBeVisible();
  });

  test('fits a phone', async ({ page, browser }) => {
    await owner(page, 'wide');
    const { url } = await publishStatic(page);
    const phone = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
    const reader = await phone.newPage();
    await reader.goto(url);
    await expect(noteFrame(reader).locator('h1')).toBeVisible();
    expect(await reader.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    await reader.screenshot({ path: artifact('publish', 'static-phone.png') });
    await phone.close();
  });
});

test.describe('live publishing', () => {
  const guest = async (context: any, url: string, name?: string) => {
    const page: Page = await context.newPage();
    await page.goto(url);
    if (name) {
      await page.getByRole('textbox').fill(name);
      await page.keyboard.press('Enter');
    }
    await page.waitForSelector('.ProseMirror');
    return page;
  };

  test('a read only guest reads, folds and cannot type', async ({ page, browser }) => {
    await owner(page, 'fold');
    const { url } = await publishLive(page, false);
    const context = await browser.newContext({ viewport: { width: 1280, height: 820 } });
    const reader = await guest(context, url);
    await expect(reader.getByText('Live · read only')).toBeVisible();
    await expect(reader.getByText('Alpha text under one.')).toBeVisible();
    await expect(reader.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'false');
    await reader.screenshot({ path: artifact('publish', 'live-read-only.png') });
    await context.close();
  });

  test('two guests of an editable note see each other\'s typing', async ({ page, browser }) => {
    await owner(page, 'fold');
    const { url } = await publishLive(page, true);
    const one = await browser.newContext({ viewport: { width: 1280, height: 820 } });
    const two = await browser.newContext({ viewport: { width: 1280, height: 820 } });
    const a = await guest(one, url, 'Ann');
    const b = await guest(two, url, 'Ben');
    await expect(a.getByText('Live · editing')).toBeVisible();
    await a.getByText('Epsilon text at the end.').click();
    await a.keyboard.press('End');
    await a.keyboard.type(' Typed by Ann');
    await expect(b.getByText('Epsilon text at the end. Typed by Ann')).toBeVisible();
    await a.reload();
    await a.waitForSelector('.ProseMirror');
    await expect(a.getByText('Epsilon text at the end. Typed by Ann')).toBeVisible();
    await one.close();
    await two.close();
  });

  test('a password guards the live note', async ({ page, browser }) => {
    await owner(page, 'fold');
    const { url } = await publishLive(page, false, 'correct horse');
    const context = await browser.newContext();
    const reader = await context.newPage();
    await reader.goto(url);
    await reader.getByRole('textbox').fill('wrong');
    await reader.keyboard.press('Enter');
    await expect(reader.getByText('Wrong password.')).toBeVisible();
    await reader.getByRole('textbox').fill('correct horse');
    await reader.keyboard.press('Enter');
    await expect(reader.getByText('Alpha text under one.')).toBeVisible();
    await context.close();
  });

  test('a guest can export HTML; the download keeps a folded section whole', async ({ page, browser }) => {
    await owner(page, 'collapsed');
    const { url } = await publishLive(page, false);
    const context = await browser.newContext({ acceptDownloads: true });
    const reader = await guest(context, url);
    await reader.getByRole('button', { name: 'Export' }).click();
    const download = reader.waitForEvent('download');
    await reader.getByRole('button', { name: /HTML/ }).click();
    const file = artifact('publish', 'live-export.html');
    await (await download).saveAs(file);
    const text = readFileSync(file, 'utf8');
    expect(text).toContain('HIDDENPARAGRAPH');
    await context.close();
  });

  // The shared PdfPreview (the desktop's /pdf) in a page that really runs it.
  test('the PDF preview follows the note and Save PDF prints those sheets', async ({ page, browser }) => {
    await owner(page, 'kitchen');
    const { url } = await publishLive(page, true);
    const context = await browser.newContext({ viewport: { width: 1280, height: 820 } });
    const editor = await guest(context, url, 'Ann');
    await editor.getByText('Text in the open part.').click();
    await editor.keyboard.press('End');
    await editor.keyboard.press('Enter');
    await editor.keyboard.type('/pdf');
    await editor.waitForTimeout(200);
    await editor.keyboard.press('Enter');
    await expect(editor.getByText(/PDF preview · \d+ pages?/)).toBeVisible();
    const preview = editor.locator('.live-pdf .pdf-sheet');
    await expect(preview.first()).toContainText('Text inside the folded part');
    await editor.locator('.live-note .ProseMirror').press('Control+End');
    await editor.keyboard.type('Added after the preview opened');
    await expect(preview.last()).toContainText('Added after the preview opened', { timeout: 4000 });
    await editor.screenshot({ path: artifact('publish', 'live-pdf-preview.png') });
    await editor.evaluate(() => { (window as any).__printed = 0; window.print = () => { (window as any).__printed++; (window as any).__sheets = document.querySelectorAll('#noted-print .pdf-sheet').length; }; });
    await editor.getByRole('button', { name: 'Save PDF' }).click();
    await editor.waitForFunction(() => (window as any).__printed === 1);
    expect(await editor.evaluate(() => (window as any).__sheets)).toBe(await preview.count());
    await context.close();
  });

  for (const [name, width, height] of [['phone', 412, 915], ['tablet', 800, 1100], ['desktop', 1280, 820]] as const) {
    test(`the live page fits a ${name}`, async ({ page, browser }) => {
      await owner(page, 'wide');
      const { url } = await publishLive(page, true);
      const mobile = width < 500;
      const context = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile });
      const editor = await guest(context, url, 'Ann');
      await expect(editor.getByText('Live · editing')).toBeVisible();
      expect(await editor.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
      await editor.screenshot({ path: artifact('publish', `live-${name}.png`) });
      await context.close();
    });
  }
});
