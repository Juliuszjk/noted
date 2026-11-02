import { test, expect, openHarness } from './helpers';
import { chromiumPdf, isA4, pdfFonts, pdfInfo, pdfPngs, pdfText } from './pdf';

const count = (text: string, needle: string) => text.split(needle).length - 1;

test.describe('PDF export', () => {
  // 4e70a31: a folded section was missing from the paper.
  test('folded headings and outline items open on paper, the note stays folded', async ({ page }) => {
    await openHarness(page, 'collapsed');
    await expect(page.getByText('HIDDENPARAGRAPH')).toBeHidden();
    await expect(page.getByText('HIDDENOUTLINE')).toBeHidden();
    const file = await chromiumPdf(page, 'collapsed');
    const text = pdfText(file);
    for (const word of ['Visible opening line', 'Folded heading', 'HIDDENPARAGRAPH', 'Hidden subheading', 'HIDDENNESTED', 'Open heading', 'Visible closing line', 'Outline parent', 'HIDDENOUTLINE']) {
      expect(text, word).toContain(word);
      expect(count(text, word), `${word} once`).toBe(1);
    }
    // Printing changes a copy only.
    await expect(page.getByText('HIDDENPARAGRAPH')).toBeHidden();
    await expect(page.getByText('HIDDENOUTLINE')).toBeHidden();
    expect(await page.evaluate(() => (window as any).__h.html())).toContain('data-collapsed="true"');
  });

  test('is A4 with the bundled fonts and no editor furniture', async ({ page }) => {
    await openHarness(page, 'kitchen');
    const file = await chromiumPdf(page, 'kitchen');
    expect(isA4(pdfInfo(file))).toBe(true);
    const fonts = pdfFonts(file);
    expect(fonts).toMatch(/Inter/);
    expect(fonts).toMatch(/JetBrains/i);
    const text = pdfText(file);
    for (const word of ['Kitchen sink', 'Bullet one', 'Nested bullet', 'Number two', 'Done task', 'A quoted line', 'const answer = 42', 'Cell B', 'Callout text', 'Text inside the folded part']) {
      expect(text, word).toContain(word);
    }
    expect(text).not.toMatch(/[▾▸]/);
    expect(text).not.toContain('Copy');
    expect(text).not.toContain('JavaScript');
    pdfPngs(file, 'kitchen');
  });

  test('a page break starts a new page and is not printed; no line is lost or doubled', async ({ page }) => {
    await openHarness(page, 'pages');
    const sheets = await page.evaluate(() => (window as any).__h.sheets());
    const file = await chromiumPdf(page, 'pages');
    const info = pdfInfo(file);
    expect(info.pages).toBe(sheets.length);
    expect(info.pages).toBeGreaterThanOrEqual(3);
    expect(pdfText(file, 1)).toContain('First page');
    expect(pdfText(file, 1)).not.toContain('Second page');
    expect(pdfText(file, 2)).toContain('Second page');
    const all = pdfText(file);
    expect(all).not.toContain('Page break');
    for (let i = 1; i <= 30; i++) expect(count(all, `Flow paragraph ${i}:`), `paragraph ${i}`).toBe(1);
  });

  test('a selection in the note does not reach the paper', async ({ page }) => {
    await openHarness(page, 'kitchen');
    await page.keyboard.press('Control+a');
    const file = await chromiumPdf(page, 'selected');
    expect(pdfText(file)).toContain('Kitchen sink');
    expect(await page.evaluate(() => (window as any).__h.sheets())).toHaveLength(pdfInfo(file).pages);
  });
});
