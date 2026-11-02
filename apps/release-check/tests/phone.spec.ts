import { test, expect, artifact } from './helpers';
import type { Page } from '@playwright/test';
import { messages, noteState, openPhoneEditor, phonePdf, send, waitForMessage } from './phone';
import { pdfInfo, pdfText, isA4 } from './pdf';

// What a finger can hit around an element: the size of the area where the element (or its
// pseudo-element) is the top element, scanned every 2 px.
const hitArea = (page: Page, selector: string, index = 0) => page.evaluate(([s, i]) => {
  const el = document.querySelectorAll(s as string)[i as number] as HTMLElement;
  el.scrollIntoView({ block: 'center' });
  const box = el.getBoundingClientRect();
  const hits = (x: number, y: number) => {
    const top = document.elementFromPoint(x, y);
    return !!top && (top === el || el.contains(top));
  };
  let left = Infinity, right = -Infinity, up = Infinity, down = -Infinity;
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  for (let x = cx - 80; x <= cx + 80; x += 2) if (x >= 0 && hits(x, cy)) { left = Math.min(left, x); right = Math.max(right, x); }
  for (let y = cy - 80; y <= cy + 80; y += 2) if (hits(cx, y)) { up = Math.min(up, y); down = Math.max(down, y); }
  return { width: right - left + 2, height: down - up + 2, left, right, up, down, cx, cy };
}, [selector, index] as const);

const collapsed = (page: Page, selector: string) => page.locator(selector).first().getAttribute('data-collapsed');

test.describe('tap targets', () => {
  // 4e70a31: the arrows were hard to hit with a finger.
  test('the heading fold arrow takes the margin and some of the heading', async ({ page }) => {
    await openPhoneEditor(page, await noteState(page, 'fold'));
    const area = await hitArea(page, '.heading-toggle');
    console.log(`fold arrow hit area: ${area.width} x ${area.height}`);
    expect(area.left, 'reaches the screen edge side').toBeLessThanOrEqual(2);
    expect(area.width).toBeGreaterThanOrEqual(28);
    expect(area.height).toBeGreaterThanOrEqual(44);
  });

  test('a real tap on either end of that area folds', async ({ page }) => {
    await openPhoneEditor(page, await noteState(page, 'fold'));
    const area = await hitArea(page, '.heading-toggle');
    await page.touchscreen.tap(area.left + 2, area.cy);
    await expect(page.locator('h2').first()).toHaveAttribute('data-collapsed', 'true');
    await page.waitForTimeout(350);
    await page.touchscreen.tap(area.right - 2, area.up + 4);
    await expect.poll(() => collapsed(page, 'h2')).toBeNull();
  });

  test('the outline arrow is big enough for a finger', async ({ page }) => {
    await openPhoneEditor(page, await noteState(page, 'collapsed'));
    const area = await hitArea(page, '.outline-toggle');
    console.log(`outline arrow hit area: ${area.width} x ${area.height}`);
    expect(area.width).toBeGreaterThanOrEqual(24);
    expect(area.height).toBeGreaterThanOrEqual(30);
    await page.touchscreen.tap(area.cx, area.cy);
    await expect(page.getByText('HIDDENOUTLINE')).toBeVisible();
  });

  test('the toolbar above the keyboard has finger-sized buttons', async ({ page }) => {
    await openPhoneEditor(page, await noteState(page, 'kitchen'));
    await page.locator('.ProseMirror p').first().tap();
    await page.waitForFunction(() => document.activeElement?.classList.contains('ProseMirror'));
    await send(page, { type: 'keyboard', inset: 320, shown: true });
    await page.waitForSelector('.tb.visible .tb-btn', { state: 'attached' });
    const all = await page.locator('.tb-main .tb-btn').evaluateAll((buttons) => buttons.map((b) => ({ w: b.getBoundingClientRect().width, h: b.getBoundingClientRect().height, name: b.className })));
    // Buttons of other modes are in the bar without a box.
    const sizes = all.filter((size) => size.w > 0);
    expect(sizes.length).toBeGreaterThan(5);
    for (const size of sizes) {
      expect(size.h, size.name).toBeGreaterThanOrEqual(40);
      expect(size.w, size.name).toBeGreaterThanOrEqual(26);
    }
    await page.screenshot({ path: artifact('phone', 'toolbar.png') });
  });

  // Known app issue (docs/release-matrix.md, "Known app issues"): the box is 17 x 26 CSS px, below
  // the 24 px minimum of WCAG 2.2, and far below the fold arrows. A UI decision for the owner;
  // `test.fail` turns this test red the day the target grows, so the note can go.
  test('task boxes are big enough for a finger', async ({ page }) => {
    test.info().annotations.push({ type: 'known-app-issue', description: 'Task box tap target: about 17 x 26 CSS px on the phone (WCAG 2.2 minimum 24 x 24)' });
    test.fail();
    await openPhoneEditor(page, await noteState(page, 'kitchen'));
    const area = await hitArea(page, 'ul[data-type="taskList"] label');
    console.log(`task box hit area: ${area.width} x ${area.height}`);
    expect(area.width).toBeGreaterThanOrEqual(24);
    expect(area.height).toBeGreaterThanOrEqual(24);
  });
});

test.describe('the phone editor page', () => {
  // 0dfd9ec: blocks under a folded heading have no box, so every tap counted as a tap below
  // the note and the cursor went to the end of the hidden text.
  test('taps work in a note that ends in a folded section', async ({ page }) => {
    await openPhoneEditor(page, await noteState(page, 'foldEnd'));
    const caretBlock = () => page.evaluate(() => document.getSelection()?.anchorNode?.parentElement?.closest('p,h2')?.textContent ?? document.getSelection()?.anchorNode?.textContent);
    await page.getByText('Second line of the note.').tap();
    await page.waitForTimeout(350);
    expect(await caretBlock()).toBe('Second line of the note.');
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.waitForTimeout(100);
    const heading = (await page.getByRole('heading', { name: 'Last section' }).boundingBox())!;
    await page.touchscreen.tap(200, heading.y + heading.height + 150);
    await page.waitForTimeout(350);
    expect(await caretBlock()).toBe('Last section');
  });

  test('a tap in a folded heading\'s neighbour keeps the cursor out of the hidden text', async ({ page }) => {
    await openPhoneEditor(page, await noteState(page, 'collapsed'));
    await page.getByText('Open heading').tap();
    await page.waitForTimeout(300);
    const inside = await page.evaluate(() => document.getSelection()?.anchorNode?.parentElement?.closest('p,h2,h3,li')?.textContent);
    expect(inside).toBe('Open heading');
  });

  // 0dfd9ec: folding on the phone brought the caret, often far away, back into view.
  test('folding far from the caret leaves the page where it is', async ({ page }) => {
    await openPhoneEditor(page, await noteState(page, 'foldLong'));
    await page.getByText('Before paragraph 1:').tap();
    await page.waitForFunction(() => document.activeElement?.classList.contains('ProseMirror'));
    await send(page, { type: 'keyboard', inset: 320, shown: true });
    await page.getByRole('heading', { name: 'Later section' }).scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const heading = page.getByRole('heading', { name: 'Middle section' });
    await heading.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const top = (await heading.boundingBox())!.y;
    await page.locator('.heading-toggle').first().tap();
    await expect(page.getByText('Inside paragraph 1:')).toBeHidden();
    await page.waitForTimeout(300);
    expect(Math.abs((await heading.boundingBox())!.y - top)).toBeLessThan(3);
  });

  for (const width of [360, 412]) {
    test(`no sideways scrolling at ${width} px with wide content`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await openPhoneEditor(page, await noteState(page, 'wide'));
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
      await page.screenshot({ path: artifact('phone', `wide-${width}.png`) });
    });
  }

  test('the kitchen sink note looks right', async ({ page }) => {
    await openPhoneEditor(page, await noteState(page, 'kitchen'));
    await page.screenshot({ path: artifact('phone', 'kitchen.png'), fullPage: true });
    await expect(page.locator('.ProseMirror h1')).toHaveText('Kitchen sink');
    expect(await messages(page, 'alert')).toEqual([]);
  });

  test('saves typed text as an update for React Native', async ({ page }) => {
    await openPhoneEditor(page, await noteState(page, 'fold'));
    await page.getByText('Epsilon text at the end.').tap();
    await page.keyboard.type('x');
    expect((await waitForMessage(page, 'save')).update.length).toBeGreaterThan(8);
  });
});

test.describe('the phone PDF', () => {
  test('the open preview gets the note again after a change', async ({ page }) => {
    await openPhoneEditor(page, await noteState(page, 'fold'));
    await send(page, { type: 'pdfPane', open: true, reset: true });
    await waitForMessage(page, 'pdfFlow');
    await page.getByText('Epsilon text at the end.').tap();
    await page.keyboard.type('Newwords');
    await page.waitForFunction(() => (window as any).__rn.some((m: any) => m.type === 'pdfFlow' && m.html.includes('Newwords')));
  });

  test('a ticked task stays ticked', async ({ page, browser }) => {
    const phone = await phonePdf(browser, await noteState(page, 'kitchen'), 'Kitchen sink');
    const printed = await phone.context.newPage();
    await printed.setContent(phone.document);
    await expect(printed.locator('ul[data-type="taskList"] input').nth(0)).toBeChecked();
    await expect(printed.locator('ul[data-type="taskList"] input').nth(1)).not.toBeChecked();
    await phone.context.close();
  });

  test('a folded note reaches paper whole, on A4', async ({ page, browser }) => {
    const phone = await phonePdf(browser, await noteState(page, 'collapsed'), 'Collapsed content');
    const printed = await phone.context.newPage();
    await printed.setContent(phone.document);
    const file = artifact('pdf', 'collapsed-phone.pdf');
    await printed.pdf({ path: file, preferCSSPageSize: true, printBackground: true });
    await phone.context.close();
    expect(isA4(pdfInfo(file))).toBe(true);
    const text = pdfText(file);
    for (const word of ['HIDDENPARAGRAPH', 'HIDDENNESTED', 'HIDDENOUTLINE', 'Visible closing line']) expect(text, word).toContain(word);
  });
});
