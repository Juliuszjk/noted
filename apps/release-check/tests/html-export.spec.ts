import { writeFileSync } from 'node:fs';
import { test, expect, openHarness, openNote, artifact } from './helpers';
import type { Page } from '@playwright/test';

const save = async (page: Page, name: string) => {
  const html: string = await page.evaluate(() => (window as any).__h.htmlFile());
  const file = artifact('html', `${name}.html`);
  writeFileSync(file, html);
  return { html, url: `file://${file}` };
};

test.describe('HTML export', () => {
  test('is one self-contained file', async ({ page, browserName }) => {
    await openHarness(page, 'kitchen');
    const { html, url } = await save(page, `kitchen-${browserName}`);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/<script[^>]+src=/i);
    // CSS may name the attribute; the note itself must not carry it.
    expect(html.slice(html.indexOf('<body'))).not.toMatch(/contenteditable/i);
    expect(html).not.toMatch(/url\(["']?(?!data:)[^)"']*\.(woff2?|ttf)/i);
    const requests: string[] = [];
    page.on('request', (r) => { if (!r.url().startsWith('file:') && !r.url().startsWith('data:')) requests.push(r.url()); });
    await page.goto(url);
    await expect(page.locator('.export-title')).toHaveText('Kitchen sink');
    for (const word of ['Bullet one', 'Nested bullet', 'Done task', 'A quoted line', 'const answer = 42', 'Cell B', 'Callout text']) {
      await expect(page.locator('p, pre, td, th').filter({ hasText: word }).first()).toBeVisible();
    }
    await expect(page.locator('.katex').first()).toBeVisible();
    expect(requests).toEqual([]);
  });

  test('a ticked task stays ticked', async ({ page, browserName }) => {
    await openHarness(page, 'kitchen');
    const { url } = await save(page, `tasks-${browserName}`);
    await page.goto(url);
    const boxes = page.locator('ul[data-type="taskList"] input[type=checkbox]');
    await expect(boxes.nth(0)).toBeChecked();
    await expect(boxes.nth(1)).not.toBeChecked();
  });

  test('folded sections stay folded and open with their arrow', async ({ page, browserName }) => {
    await openHarness(page, 'collapsed');
    const { url } = await save(page, `collapsed-${browserName}`);
    await page.goto(url);
    await expect(page.getByText('HIDDENPARAGRAPH')).toBeHidden();
    await expect(page.getByText('HIDDENOUTLINE')).toBeHidden();
    await page.locator('.heading-toggle').first().click();
    await expect(page.getByText('HIDDENPARAGRAPH')).toBeVisible();
    await expect(page.getByText('HIDDENNESTED')).toBeVisible();
    await page.locator('.heading-toggle').first().click();
    await expect(page.getByText('HIDDENPARAGRAPH')).toBeHidden();
    await page.locator('.outline-toggle').first().click();
    await expect(page.getByText('HIDDENOUTLINE')).toBeVisible();
  });

  test('printed, the file does not leave folded text out', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'page.pdf is Chromium only');
    await openHarness(page, 'collapsed');
    const { url } = await save(page, 'collapsed-print');
    await page.goto(url);
    await page.emulateMedia({ media: 'print' });
    // A reader's choice: what they folded stays folded when they print. Recorded, not judged.
    expect(await page.getByText('HIDDENPARAGRAPH').isVisible()).toBe(false);
  });

  test('the code Copy button copies the code', async ({ page, browserName, context }) => {
    test.skip(browserName !== 'chromium', 'needs the real clipboard');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openHarness(page, 'kitchen');
    await page.route('http://127.0.0.1:47321/export.html', async (route) => route.fulfill({ contentType: 'text/html', body: await routeBody }));
    let resolve!: (text: string) => void;
    const routeBody = new Promise<string>((r) => { resolve = r; });
    resolve(await page.evaluate(() => (window as any).__h.htmlFile()));
    await page.goto('/export.html');
    await page.locator('.code-block-copy').first().click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('const answer = 42;');
    await expect(page.locator('.code-block-copy').first()).toHaveText('Copied');
  });

  test('follows a dark system', async ({ page }) => {
    await openHarness(page, 'kitchen');
    const { url } = await save(page, 'dark');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(url);
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(20, 18, 24)');
    await page.screenshot({ path: artifact('html', 'dark.png') });
  });

  test('a title with markup stays text', async ({ page }) => {
    await openNote(page, '<p>Body</p>', 'A <b>bold</b> & "quoted" title');
    const { html, url } = await save(page, 'title');
    expect(html).toContain('<title>A &lt;b&gt;bold&lt;/b&gt; &amp; &quot;quoted&quot; title</title>');
    await page.goto(url);
    await expect(page.locator('.export-title')).toHaveText('A <b>bold</b> & "quoted" title');
  });

  test('fits a phone without sideways scrolling', async ({ page }) => {
    await openHarness(page, 'wide');
    const { url } = await save(page, 'wide');
    await page.setViewportSize({ width: 412, height: 915 });
    await page.goto(url);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: artifact('html', 'wide-phone.png') });
  });
});
