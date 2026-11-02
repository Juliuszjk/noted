import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { firefox } from '@playwright/test';
import { test, expect, openHarness, ARTIFACTS } from './helpers';
import { chromiumPdf, isA4, pdfInfo, pdfPngs, pdfText, pictureDifference } from './pdf';
import { noteState, phonePdf } from './phone';

const WEBKIT_DIR = path.join(ARTIFACTS, 'webkitgtk');
const HOST = path.resolve('webkitgtk/run.mjs');
type Sheet = { headings: string[][]; text: number };
let webkit: { userAgent: string; notes: Record<string, { sheets: Sheet[] }>; foldPress: any } | null = null;
let webkitProblem = '';

const headings = (sheets: Sheet[]) => sheets.map((sheet) => sheet.headings);
// List numbers are painted, not text, in WebKitGTK's PDF (they show, pdftotext does not see them).
const words = (text: string) => text.replace(/(^|\s)\d+\.(?=\s)/g, ' ').replace(/\s+/g, ' ').trim();
// The same characters: an engine may emit a superscript or an emoji's variation selector in
// another order. The order of the text shows in the page pictures.
const characters = (text: string) => [...words(text).replace(/[\s\uFE0F]/g, '')].sort().join('');

test.skip(({ browserName }) => browserName !== 'chromium', 'runs once, in the Chromium project');

test.beforeAll(() => {
  // Runs the real WebKitGTK of the Linux app against the harness.
  const run = spawnSync(process.execPath, [HOST, 'http://127.0.0.1:47321', WEBKIT_DIR], { encoding: 'utf8', timeout: 120_000 });
  if (run.status === 0 && existsSync(path.join(WEBKIT_DIR, 'result.json'))) webkit = JSON.parse(readFileSync(path.join(WEBKIT_DIR, 'result.json'), 'utf8'));
  else webkitProblem = `${run.status === 3 ? 'missing tools' : 'failed'}: ${(run.stderr || run.stdout || '').trim().slice(-400)}`;
});

test('the real WebKitGTK engine is available', () => {
  if (webkitProblem.startsWith('missing tools')) test.skip(true, webkitProblem);
  expect(webkitProblem).toBe('');
  expect(webkit!.userAgent).toMatch(/AppleWebKit/);
  expect(webkit!.userAgent).not.toMatch(/Chrome/);
});

test.describe('headings wrap the same on every engine', () => {
  // 7a6e88f: the phone's PDF page lacked the editor's text styles, a double space collapsed
  // there and a heading fitted one line instead of two, so the pages broke elsewhere too.
  test('Chromium, the phone PDF page, Firefox and WebKitGTK', async ({ page, browser }) => {
    await openHarness(page, 'wrap');
    const chromium: Sheet[] = await page.evaluate(() => (window as any).__h.sheets());
    const lines = headings(chromium);
    // The fixture does what it is for: the double spaces make these headings wrap.
    expect(lines[0].some((heading) => heading.length > 1)).toBe(true);
    expect(lines[0].find((heading) => heading[0].startsWith('The'))).toHaveLength(2);

    const phone = await phonePdf(browser, await noteState(page, 'wrap'), 'Heading wrap');
    expect(headings(phone.sheets), 'phone PDF page').toEqual(lines);
    await phone.context.close();

    const gecko = await firefox.launch();
    const firefoxPage = await gecko.newPage({ baseURL: 'http://127.0.0.1:47321', viewport: { width: 1280, height: 820 } });
    await openHarness(firefoxPage, 'wrap');
    const inFirefox: Sheet[] = await firefoxPage.evaluate(() => (window as any).__h.sheets());
    await gecko.close();
    // Guests only, and Firefox breaks `break-spaces` a word later at a line end (double spaces
    // hang differently): same headings and pages, the same line count, not the same cut.
    expect(inFirefox.length, 'Firefox pages').toBe(chromium.length);
    expect(inFirefox.map((sheet) => sheet.headings.map((h) => h.length)), 'Firefox line counts').toEqual(lines.map((sheet) => sheet.map((h) => h.length)));

    if (webkit) expect(headings(webkit.notes.wrap.sheets), 'WebKitGTK').toEqual(lines);
  });

  // Known app issue (docs/release-matrix.md): with `white-space: break-spaces`, a word that fits
  // the line while the double space after it does not stays there in WebKitGTK and Firefox, and
  // moves down in Chromium (the phone, Windows). Rare, but a page count could differ.
  test('a word followed by a double space at the very end of a line', async ({ page }) => {
    test.info().annotations.push({ type: 'known-app-issue', description: 'PDF: a word that fits a line while the double space after it does not wraps differently in Chromium (phone, Windows) and WebKitGTK (Linux)' });
    test.skip(!webkit, 'WebKitGTK did not run');
    test.fail();
    await openHarness(page, 'wrapEdge');
    const chromium: Sheet[] = await page.evaluate(() => (window as any).__h.sheets());
    expect(headings(webkit!.notes.wrapEdge.sheets)).toEqual(headings(chromium));
  });

  test('a page without Tiptap\'s styles still keeps double spaces (the phone PDF page)', async ({ page, browser }) => {
    const state = await noteState(page, 'wrap');
    const phone = await phonePdf(browser, state, 'Heading wrap');
    const styles = await phone.pdf.evaluate(() => {
      const el = document.querySelector('.pdf-flow .ProseMirror')!;
      const style = getComputedStyle(el);
      return { whiteSpace: style.whiteSpace, ligatures: style.fontVariantLigatures };
    });
    expect(styles.whiteSpace).toBe('break-spaces');
    expect(styles.ligatures).toBe('none');
    await phone.context.close();
  });
});

test.describe('the same PDF everywhere', () => {
  for (const fixture of ['wrap', 'collapsed', 'pages', 'kitchen']) {
    test(`${fixture}: WebKitGTK prints what Chromium prints`, async ({ page }) => {
      test.skip(!webkit, 'WebKitGTK did not run');
      await openHarness(page, fixture);
      const chromiumFile = await chromiumPdf(page, `${fixture}-chromium`);
      const webkitFile = path.join(ARTIFACTS, 'pdf', `${fixture}-webkitgtk.pdf`);
      copyFileSync(path.join(WEBKIT_DIR, `${fixture}.pdf`), webkitFile);
      const a = pdfInfo(chromiumFile);
      const b = pdfInfo(webkitFile);
      expect(isA4(b)).toBe(true);
      expect(b.pages).toBe(a.pages);
      expect(characters(pdfText(webkitFile))).toBe(characters(pdfText(chromiumFile)));
      const left = pdfPngs(chromiumFile, `${fixture}-chromium`);
      const right = pdfPngs(webkitFile, `${fixture}-webkitgtk`);
      left.forEach((png, i) => expect(pictureDifference(png, right[i]), `page ${i + 1}`).toBeLessThan(0.05));
    });
  }

  test('the phone PDF has the desktop\'s pages and text', async ({ page, browser }) => {
    await openHarness(page, 'wrap');
    const desktopFile = await chromiumPdf(page, 'wrap-desktop');
    const phone = await phonePdf(browser, await noteState(page, 'wrap'), 'Heading wrap');
    const printed = await phone.context.newPage();
    await printed.setContent(phone.document);
    await printed.evaluate(() => document.fonts.ready);
    const phoneFile = desktopFile.replace('desktop', 'phone');
    await printed.pdf({ path: phoneFile, preferCSSPageSize: true, printBackground: true });
    await phone.context.close();
    expect(pdfInfo(phoneFile).pages).toBe(pdfInfo(desktopFile).pages);
    expect(isA4(pdfInfo(phoneFile))).toBe(true);
    expect(words(pdfText(phoneFile))).toBe(words(pdfText(desktopFile)));
  });
});

test('WebKitGTK: a press on a fold arrow leaves the selection alone', () => {
  test.skip(!webkit, 'WebKitGTK did not run');
  const probe = webkit!.foldPress;
  expect(probe.collapsedHeading).toBe(true);
  expect(probe.from).toBe(probe.expected);
  expect(probe.to).toBe(probe.expected);
  expect(probe.nativeCollapsed).toBe(true);
});

