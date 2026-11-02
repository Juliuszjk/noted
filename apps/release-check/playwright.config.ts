import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

// Keeps the artifacts of one run together; scripts/verify.mjs names the folder.
const artifacts = process.env.RELEASE_ARTIFACTS ?? path.resolve('dist/runs/manual');
process.env.RELEASE_ARTIFACTS = artifacts;
process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.resolve('dist/browsers');

const PHONE = {
  ...devices['Pixel 7'],
  // A large Android phone's width in CSS px.
  viewport: { width: 412, height: 915 },
  defaultBrowserType: 'chromium' as const,
};

export default defineConfig({
  testDir: 'tests',
  outputDir: path.join(artifacts, 'test-output'),
  timeout: 45_000,
  expect: { timeout: 7_000 },
  // A flaky test is a failed test here: nothing retries it.
  retries: 0,
  fullyParallel: false,
  workers: 2,
  reporter: [['line'], ['json', { outputFile: path.join(artifacts, 'playwright.json') }]],
  use: {
    baseURL: 'http://127.0.0.1:47321',
    screenshot: 'only-on-failure',
    trace: 'off',
    timezoneId: 'Europe/Warsaw',
    locale: 'en-GB',
    colorScheme: 'light',
  },
  webServer: [
    { command: 'node scripts/static-server.mjs', url: 'http://127.0.0.1:47321/index.html', reuseExistingServer: false, stdout: 'ignore' },
    // Asked to stop, not killed: it deletes its temporary database.
    { command: 'node scripts/local-api.mjs', url: 'http://127.0.0.1:47322/', reuseExistingServer: false, stdout: 'ignore', gracefulShutdown: { signal: 'SIGTERM', timeout: 2000 } },
  ],
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 820 } }, testIgnore: /phone\.spec/ },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: { width: 1280, height: 820 } }, testMatch: /(editor|fold|lists-paste|svg|html-export)\.spec/ },
    { name: 'phone', use: PHONE, testMatch: /phone\.spec/ },
  ],
});
