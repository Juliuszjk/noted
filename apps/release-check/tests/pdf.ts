import { execFileSync, spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { artifact } from './helpers';

export const pdfText = (file: string, page?: number) =>
  execFileSync('pdftotext', [...(page ? ['-f', String(page), '-l', String(page)] : []), '-layout', file, '-'], { encoding: 'utf8' });

export const pdfInfo = (file: string) => {
  const text = execFileSync('pdfinfo', [file], { encoding: 'utf8' });
  const size = /Page size:\s+([\d.]+) x ([\d.]+) pts/.exec(text);
  return { pages: Number(/Pages:\s+(\d+)/.exec(text)?.[1]), width: Number(size?.[1]), height: Number(size?.[2]) };
};

export const pdfFonts = (file: string) => execFileSync('pdffonts', [file], { encoding: 'utf8' });

// A4 in points, with a point of slack (each engine rounds it differently).
export const isA4 = ({ width, height }: { width: number; height: number }) => Math.abs(width - 595) <= 1.5 && Math.abs(height - 842) <= 1.5;

// What Save PDF does in Chromium: the print sheets of the note in the harness, printed.
export const chromiumPdf = async (page: Page, name: string) => {
  await page.evaluate(() => (window as any).__h.mountPrint());
  const file = artifact('pdf', `${name}.pdf`);
  await page.pdf({ path: file, preferCSSPageSize: true, printBackground: true });
  await page.evaluate(() => document.getElementById('noted-print')?.remove());
  return file;
};

// Each page as a PNG, for comparisons and for people to look at.
export const pdfPngs = (file: string, prefix: string, dpi = 60): string[] => {
  const out = artifact('pdf', prefix);
  execFileSync('pdftoppm', ['-r', String(dpi), '-png', file, out]);
  const pages = pdfInfo(file).pages;
  const pad = String(pages).length;
  return Array.from({ length: pages }, (_, i) => `${out}-${String(i + 1).padStart(pad, '0')}.png`);
};

// How far two pictures are apart: 0 = the same, 1 = opposite (ImageMagick's normalised RMSE).
// Blurred first, so the engines' different glyph rendering does not count, only the layout: a
// shifted block, a missing background or a blank page do.
export const pictureDifference = (a: string, b: string): number => {
  const blurred = [a, b].map((file) => {
    const out = file.replace(/\.png$/, '-blurred.png');
    execFileSync('magick', [file, '-blur', '0x3', out]);
    return out;
  });
  try {
    // compare exits 0 for identical pictures and 1 when they differ; 2 is a real error.
    const result = spawnSync('compare', ['-metric', 'RMSE', ...blurred, 'null:'], { encoding: 'utf8' });
    if (result.status === 2 || result.status === null) throw new Error(`compare failed: ${result.stderr}`);
    return parseRmse(`${result.stdout}${result.stderr}`);
  } finally {
    blurred.forEach((file) => rmSync(file, { force: true }));
  }
};
const parseRmse = (text: string) => {
  const match = /\(([\d.e+-]+)\)/.exec(text);
  if (!match) throw new Error(`No RMSE in "${text}"`);
  return Number(match[1]);
};
