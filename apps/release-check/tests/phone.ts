import type { Browser, BrowserContext, Page } from '@playwright/test';

// The phone's real WebView pages (apps/mobile/src/*.generated.ts) with a stand-in for React
// Native: messages the page posts are collected in window.__rn.

export const PHONE_USE = {
  viewport: { width: 412, height: 915 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (Linux; Android 15; SM-S948B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36 wv',
};

export const stubReactNative = (context: BrowserContext | Page) => context.addInitScript(() => {
  (window as any).__rn = [];
  (window as any).ReactNativeWebView = { postMessage: (text: string) => (window as any).__rn.push(JSON.parse(text)) };
});

export const send = (page: Page, message: Record<string, unknown>) =>
  page.evaluate((text) => (window as any).__noted.receive(text), JSON.stringify(message));

export const messages = (page: Page, type: string) =>
  page.evaluate((t) => (window as any).__rn.filter((m: any) => m.type === t), type);

export const waitForMessage = async (page: Page, type: string) => {
  await page.waitForFunction((t) => (window as any).__rn.some((m: any) => m.type === t), type);
  return (await messages(page, type)).at(-1);
};

// The state of a fixture note, as React Native would hand it over (made by the shared code).
export const noteState = async (page: Page, fixture: string): Promise<string> => {
  await page.goto('/index.html');
  await page.waitForFunction(() => !!(window as any).__h);
  return page.evaluate((name) => (window as any).__h.fixtureState(name), fixture);
};

export const openPhoneEditor = async (page: Page, state: string) => {
  await stubReactNative(page);
  await page.goto('/phone-editor.html');
  await page.waitForFunction(() => !!(window as any).__noted);
  await send(page, { type: 'init', state });
  await page.waitForSelector('.ProseMirror');
  await page.waitForTimeout(200);
};

// Export > PDF on the phone: the editor page's flow goes to the PDF page, which makes the
// document React Native prints. Returns that document and the PDF page.
export const phonePdf = async (browser: Browser, state: string, title: string) => {
  const context = await browser.newContext({ ...PHONE_USE, baseURL: 'http://127.0.0.1:47321' });
  const editor = await context.newPage();
  await openPhoneEditor(editor, state);
  await send(editor, { type: 'export', format: 'pdf', share: false });
  const flow = await waitForMessage(editor, 'pdfFlow');
  const pdf = await context.newPage();
  await stubReactNative(pdf);
  await pdf.goto('/phone-pdf.html');
  await pdf.waitForFunction(() => !!(window as any).__noted);
  await send(pdf, { type: 'flow', html: flow.html, pictures: flow.pictures, title, save: true });
  const made = await waitForMessage(pdf, 'pdf');
  await pdf.addScriptTag({ url: '/measure.js' });
  const sheets = await pdf.evaluate(() => (window as any).__measure.sheetSummary([...document.querySelectorAll('.pdf-sheet')]));
  await editor.close();
  return { context, pdf, document: made.html as string, sheets };
};
