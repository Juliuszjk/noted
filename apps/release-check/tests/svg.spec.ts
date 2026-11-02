import { test, expect, openNote } from './helpers';
import type { Page } from '@playwright/test';

const svg = (attrs: string, body = '<circle cx="12" cy="12" r="10" fill="#c33"/>') => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;
const compress = (page: Page, text: string, name = 'pic.svg', type = 'image/svg+xml') =>
  page.evaluate(([t, n, ty]) => (window as any).__h.compress(n, ty, t), [text, name, type]);
const insert = (page: Page, text: string, name = 'pic.svg') => page.evaluate(([t, n]) => {
  const editor = (window as any).__h.editor();
  editor.commands.focus('end');
  return (window as any).__h.insertFile(n, 'image/svg+xml', t);
}, [text, name]);
const imageNode = (page: Page) => page.evaluate(() => {
  let found: any = null;
  (window as any).__h.editor().state.doc.descendants((node: any) => { if (node.type.name === 'image') found = node.attrs; });
  return found;
});

test.describe('SVG images', () => {
  // 2e610cb: small SVGs ended up tiny or blurry.
  test('are drawn large before compression, whatever size they ask for', async ({ page }) => {
    await openNote(page, '<p>x</p>');
    const icon = await compress(page, svg('width="24" height="24" viewBox="0 0 24 24"'));
    expect(icon.width).toBe(1920);
    expect(icon.height).toBe(1920);
    expect(icon.type).toBe('image/webp');
    expect(icon.bytes).toBeLessThan(1_100_000);
  });

  test('keep their proportions; a missing viewBox still scales', async ({ page }) => {
    await openNote(page, '<p>x</p>');
    const wide = await compress(page, svg('width="300" height="100"'));
    expect([wide.width, wide.height]).toEqual([1920, 640]);
    const boxOnly = await compress(page, svg('viewBox="0 0 400 200"'));
    expect([boxOnly.width, boxOnly.height]).toEqual([1920, 960]);
    const nothing = await compress(page, svg(''));
    expect([nothing.width, nothing.height]).toEqual([1920, 960]);
  });

  test('show at their own size in the note', async ({ page }) => {
    await openNote(page, '<p>x</p>');
    expect(await insert(page, svg('width="48" height="24" viewBox="0 0 48 24"'))).toBe('image/webp');
    const attrs = await page.waitForFunction(() => {
      let found: any = null;
      (window as any).__h.editor().state.doc.descendants((node: any) => { if (node.type.name === 'image') found = node.attrs; });
      return found;
    }).then((h) => h.jsonValue());
    expect(attrs.blob).toContain(':');
    expect(Number(attrs.width)).toBe(48);
    const img = page.locator('.ProseMirror img').first();
    await expect(img).toBeVisible();
    await expect.poll(async () => Math.round((await img.boundingBox())?.width ?? 0)).toBe(48);
  });

  test('never run scripts or fetch what they link to', async ({ page, outside }) => {
    await openNote(page, '<p>x</p>');
    const hostile = svg('width="24" height="24" viewBox="0 0 24 24" onload="window.__pwned = 1"',
      '<script>window.__pwned = 2</script><image href="https://example.com/tracker.png" width="24" height="24"/><foreignObject width="10" height="10"><img xmlns="http://www.w3.org/1999/xhtml" src="https://example.com/t2.png"/></foreignObject>');
    await compress(page, hostile).catch(() => null);
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => (window as any).__pwned)).toBeUndefined();
    expect(outside).toEqual([]);
  });

  test('a broken SVG is refused or stays out of the note, without breaking the editor', async ({ page }) => {
    await openNote(page, '<p>Still here</p>');
    await page.evaluate(() => (window as any).__h.compress('bad.svg', 'image/svg+xml', 'this is not svg').catch(() => null));
    await page.keyboard.type('');
    await expect(page.getByText('Still here')).toBeVisible();
    expect(await imageNode(page)).toBeNull();
  });
});
