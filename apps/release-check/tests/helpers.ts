import { test as base, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export const ARTIFACTS = process.env.RELEASE_ARTIFACTS!;
export const API = 'http://127.0.0.1:47322';
export const PUBLIC = 'http://127.0.0.1:47323';
export const SETUP_CODE = 'RELEASE-CHECK';

export const artifact = (...parts: string[]) => {
  const file = path.join(ARTIFACTS, ...parts);
  mkdirSync(path.dirname(file), { recursive: true });
  return file;
};

const LOOPBACK = /^(https?|wss?):\/\/(127\.0\.0\.1|localhost)(:\d+)?\//;

// Every test runs behind this guard: a page that reaches past loopback fails the test, and
// the request never leaves the machine.
export const test = base.extend<{ outside: string[] }>({
  outside: [async ({ context }, use, info) => {
    const seen: string[] = [];
    await context.route(/^https?:\/\//, (route) => {
      const url = route.request().url();
      if (LOOPBACK.test(url)) return route.fallback();
      seen.push(url);
      return route.abort();
    });
    await use(seen);
    expect(seen, `requests past loopback in "${info.title}"`).toEqual([]);
  }, { auto: true }],
});

export { expect };

// The harness with a note open.
export const openHarness = async (page: Page, fixture?: string) => {
  await page.goto('/index.html');
  await page.waitForFunction(() => !!(window as any).__h);
  if (fixture) await page.evaluate((name) => (window as any).__h.openFixture(name), fixture);
  await page.waitForSelector('.ProseMirror');
};

export const openNote = async (page: Page, html: string, title = 'Release check') => {
  await page.goto('/index.html');
  await page.waitForFunction(() => !!(window as any).__h);
  await page.evaluate(([h, t]) => (window as any).__h.open(h, t), [html, title]);
  await page.waitForSelector('.ProseMirror');
};

// The selected text, as the editor sees it.
export const selectedText = (page: Page) => page.evaluate(() => {
  const { state } = (window as any).__h.editor();
  return state.doc.textBetween(state.selection.from, state.selection.to, '\n');
});

export const selection = (page: Page) => page.evaluate(() => {
  const { from, to } = (window as any).__h.editor().state.selection;
  return { from, to };
});

// A cursor in the text `needle`, offset characters in. Tiptap focuses on the next frame: this
// returns once keys reach the editor.
export const placeCursor = async (page: Page, needle: string, offset = 0) => {
  await page.evaluate(([n, o]) => {
    const editor = (window as any).__h.editor();
    let at = -1;
    editor.state.doc.descendants((node: any, pos: number) => {
      if (at < 0 && node.isText && node.text.includes(n)) at = pos + node.text.indexOf(n) + (o as number);
    });
    if (at < 0) throw new Error(`No text "${n}"`);
    editor.commands.focus();
    editor.commands.setTextSelection(at);
  }, [needle, offset] as const);
  await page.waitForFunction(() => (window as any).__h.editor().isFocused);
};
