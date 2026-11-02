// `pnpm verify:release`: the whole release check, one command. Builds the bundles, runs unit
// tests and typechecks, builds the desktop front end, checks the Rust side, and drives the real
// editor, PDF, export and publishing code in browsers (see docs/release-matrix.md).
//
// Safe to run at any time: it only writes generated files, build output and artifacts inside
// this checkout. It does not push, tag, publish, deploy, install or touch the owner's apps or
// server. Browser tests stop every request past 127.0.0.1, the API it starts has a throwaway
// database, binds loopback only and dies with the run.
//
// Flags: --quick skips cargo check, --only=<step[,step]> runs some steps, --list lists them.
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const checkDir = path.resolve(here, '..');
const repo = path.resolve(checkDir, '../..');
const args = process.argv.slice(2);
const quick = args.includes('--quick');
const only = args.find((a) => a.startsWith('--only='))?.slice(7).split(',');

const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
// Everything generated stays under dist/: ignored by git and left out of the server deploy's rsync.
const runs = path.join(checkDir, 'dist/runs');
const artifacts = path.join(runs, stamp);
mkdirSync(artifacts, { recursive: true });
const logs = path.join(artifacts, 'logs');
mkdirSync(logs);

// Tests never see the owner's home: the MCP tests and anything else keyed to it get an empty one.
const home = mkdtempSync(path.join(tmpdir(), 'noted-release-home-'));
const browsers = path.join(checkDir, 'dist/browsers');
const baseEnv = {
  ...process.env,
  CI: '1',
  DO_NOT_TRACK: '1',
  TURBO_TELEMETRY_DISABLED: '1',
  EXPO_NO_TELEMETRY: '1',
  PLAYWRIGHT_BROWSERS_PATH: browsers,
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
  RELEASE_ARTIFACTS: artifacts,
};
const sandboxedHome = { HOME: home, XDG_CONFIG_HOME: path.join(home, 'config'), XDG_DATA_HOME: path.join(home, 'data'), XDG_CACHE_HOME: path.join(home, 'cache') };

const run = (name, command, argv, options = {}) => new Promise((resolve) => {
  const log = path.join(logs, `${name}.log`);
  const child = spawn(command, argv, { cwd: options.cwd ?? repo, env: { ...baseEnv, ...options.env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const keep = (chunk) => { output += chunk; };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  child.on('error', (e) => { output += String(e); });
  child.on('close', (code) => {
    writeFileSync(log, output);
    resolve({ code: code ?? 1, output, log });
  });
});

const pnpm = (name, ...argv) => run(name, 'pnpm', argv);
const vitest = (dir) => () => run(`vitest-${dir.replace('/', '-')}`, path.join(repo, dir, 'node_modules/.bin/vitest'), ['run'], { cwd: path.join(repo, dir), env: sandboxedHome });

const steps = [
  { id: 'preflight', title: 'Tools and browsers are here', action: async () => {
    const missing = ['pdftotext', 'pdfinfo', 'pdffonts', 'pdftoppm', 'compare'].filter((tool) => spawnSync('which', [tool]).status !== 0);
    const installed = existsSync(browsers) ? readdirSync(browsers) : [];
    for (const browser of ['chromium', 'firefox']) if (!installed.some((name) => name.startsWith(`${browser}-`))) missing.push(`${browser} (run: pnpm verify:release:setup)`);
    // Like CI: no built-in server address. An existing file stays untouched.
    const server = path.join(repo, 'packages/config/server.ts');
    if (!existsSync(server)) copyFileSync(path.join(repo, 'packages/config/server.example.ts'), server);
    return missing.length ? { code: 1, output: `Missing: ${missing.join(', ')}` } : { code: 0, output: '' };
  } },
  { id: 'bundles', title: 'Bundles: phone pages (with the message check), viewer, live page', action: async () => {
    for (const [name, ...argv] of [['editor', '--filter', 'mobile', 'run', 'build:editor'], ['viewer', '--filter', 'api', 'run', 'build:viewer'], ['live', '--filter', 'web', 'run', 'build:live'], ['harness', '--filter', 'release-check', 'run', 'build:harness']]) {
      const result = await pnpm(`bundle-${name}`, ...argv);
      if (result.code) return result;
    }
    return { code: 0, output: '' };
  } },
  { id: 'unit', title: 'Unit tests (crypto, sync, editor, theme, ui, mcp)', action: async () => {
    const results = await Promise.all(['packages/crypto', 'packages/sync', 'packages/editor', 'packages/theme', 'packages/ui', 'apps/mcp'].map((dir) => vitest(dir)()));
    const totals = results.map((r) => /Tests\s+.*?(\d+) passed/.exec(r.output.replace(/\x1b\[[0-9;]*m/g, ''))?.[1] ?? '0').map(Number);
    const failed = results.filter((r) => r.code);
    return { code: failed.length ? 1 : 0, output: failed.map((r) => r.output.slice(-1500)).join('\n'), detail: `${totals.reduce((a, b) => a + b, 0)} tests passed`, log: failed[0]?.log };
  } },
  { id: 'typecheck', title: 'Typecheck (desktop, mobile, phone pages, api, mcp)', action: async () => {
    const results = await Promise.all([
      pnpm('tsc-desktop', '--filter', 'desktop', 'exec', 'tsc', '--noEmit'),
      pnpm('tsc-mobile', '--filter', 'mobile', 'exec', 'tsc', '--noEmit'),
      pnpm('tsc-pages', '--filter', 'mobile', 'exec', 'tsc', '-p', 'editor/tsconfig.json'),
      pnpm('tsc-api', '--filter', 'api', 'exec', 'tsc', '--noEmit'),
      pnpm('tsc-mcp', '-C', 'apps/mcp', 'exec', 'tsc', '--noEmit'),
    ]);
    const failed = results.filter((r) => r.code);
    return { code: failed.length ? 1 : 0, output: failed.map((r) => r.output.slice(-1500)).join('\n'), log: failed[0]?.log };
  } },
  { id: 'desktop', title: 'Desktop front end builds', action: () => pnpm('desktop-build', '--filter', 'desktop', 'exec', 'vite', 'build') },
  { id: 'rust', title: 'Rust side: cargo check --offline --locked', skip: quick && '--quick', action: async () => {
    if (spawnSync('which', ['cargo']).status !== 0) return { code: 3, output: 'cargo is not installed' };
    return run('cargo-check', 'cargo', ['check', '--offline', '--locked'], { cwd: path.join(repo, 'apps/desktop/src-tauri') });
  } },
  { id: 'browser', title: 'Browser tests (Chromium, Firefox, phone pages, real WebKitGTK, local API)', action: () => run('playwright', path.join(checkDir, 'node_modules/.bin/playwright'), ['test'], { cwd: checkDir, env: sandboxedHome }) },
];

if (args.includes('--list')) {
  for (const step of steps) console.log(`${step.id.padEnd(10)} ${step.title}`);
  process.exit(0);
}

const cleanLines = (text) => (text ?? '').replace(/\x1b\[[0-9;]*m/g, '').split('\n').map((line) => line.trim()).filter(Boolean);
const firstLine = (text) => cleanLines(text)[0] ?? '';
const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`;

const outcomes = [];
for (const step of steps) {
  if (only && !only.includes(step.id) && step.id !== 'preflight') { outcomes.push({ ...step, status: 'not run', reason: '--only' }); continue; }
  if (step.skip) { outcomes.push({ ...step, status: 'skipped', reason: step.skip }); continue; }
  process.stdout.write(`${step.title} ... `);
  const started = Date.now();
  const result = await step.action();
  const status = result.code === 0 ? 'passed' : result.code === 3 ? 'skipped' : 'FAILED';
  const elapsed = Date.now() - started;
  console.log(`${status} (${seconds(elapsed)})`);
  outcomes.push({ ...step, status, elapsed, output: result.output, detail: result.detail, log: result.log, reason: result.code === 3 ? firstLine(result.output) : undefined });
  // Later steps need these two.
  if (status === 'FAILED' && (step.id === 'preflight' || step.id === 'bundles')) break;
}

// The Playwright results, for the report.
const browserFacts = () => {
  const file = path.join(artifacts, 'playwright.json');
  if (!existsSync(file)) return null;
  const json = JSON.parse(readFileSync(file, 'utf8'));
  const facts = { passed: 0, failed: [], skipped: [], known: [], flaky: json.stats?.flaky ?? 0, attachments: [] };
  const visit = (suite, trail) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const name = `[${test.projectName}] ${path.basename(spec.file ?? suite.file ?? '')}: ${[...trail, spec.title].join(' > ')}`;
        const last = test.results.at(-1);
        const notes = (test.annotations ?? []).filter((a) => a.type === 'known-app-issue');
        if (test.status === 'skipped') facts.skipped.push(`${name}${test.annotations?.find((a) => a.type === 'skip')?.description ? ` (${test.annotations.find((a) => a.type === 'skip').description})` : ''}`);
        else if (test.status === 'expected' && notes.length) facts.known.push(...notes.map((n) => n.description));
        else if (test.status === 'expected') facts.passed++;
        else {
          facts.failed.push({ name, error: cleanLines(last?.errors?.[0]?.message ?? last?.error?.message ?? '').slice(0, 4).join(' / ').slice(0, 300), shots: (last?.attachments ?? []).filter((a) => a.path).map((a) => path.relative(artifacts, a.path)) });
        }
      }
    }
    for (const child of suite.suites ?? []) visit(child, child.title && !child.title.endsWith('.ts') ? [...trail, child.title] : trail);
  };
  for (const suite of json.suites ?? []) visit(suite, []);
  return facts;
};

const listFiles = (dir, base = dir) => (existsSync(dir) ? readdirSync(dir).flatMap((name) => {
  const file = path.join(dir, name);
  return statSync(file).isDirectory() ? listFiles(file, base) : [path.relative(base, file)];
}) : []);

const facts = browserFacts();
const failedSteps = outcomes.filter((o) => o.status === 'FAILED');
const verdict = failedSteps.length ? 'FAILED' : only ? 'PASSED (partial run, --only)' : outcomes.some((o) => o.status === 'skipped') ? 'PASSED, with steps skipped' : 'PASSED';
const lines = [
  `# Release check ${stamp}`,
  '',
  `**Result: ${verdict}**`,
  '',
  `Commit: ${spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout.trim()} on ${spawnSync('git', ['branch', '--show-current'], { cwd: repo, encoding: 'utf8' }).stdout.trim()}${spawnSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).stdout.trim() ? ' (with local changes)' : ''}`,
  '',
  '| Step | Status | Time |',
  '| --- | --- | --- |',
  ...outcomes.map((o) => `| ${o.title}${o.detail ? ` (${o.detail})` : ''} | ${o.status}${o.reason ? `: ${o.reason}` : ''} | ${o.elapsed ? seconds(o.elapsed) : ''} |`),
  '',
];
if (facts) {
  lines.push(`Browser tests: ${facts.passed} passed, ${facts.failed.length} failed, ${facts.known.length} known app issue(s), ${facts.skipped.length} skipped.`, '');
  if (facts.failed.length) {
    lines.push('## Failed browser tests', '');
    for (const f of facts.failed) lines.push(`- ${f.name}`, `  - ${f.error}`, ...f.shots.map((s) => `  - ${s}`));
    lines.push('');
  }
  if (facts.known.length) lines.push('## Known app issues (expected to fail, see docs/release-matrix.md)', '', ...facts.known.map((k) => `- ${k}`), '');
  if (facts.skipped.length) lines.push('## Skipped browser tests', '', ...facts.skipped.map((s) => `- ${s}`), '');
}
for (const o of failedSteps.filter((step) => step.id !== 'browser' || !facts)) {
  lines.push(`## ${o.title}`, '', '```', (o.output ?? '').replace(/\x1b\[[0-9;]*m/g, '').trim().slice(-1200), '```', '', `Full log: ${path.relative(artifacts, o.log ?? path.join(logs, `${o.id}.log`))}`, '');
}
const files = listFiles(artifacts).filter((f) => /\.(pdf|png|html)$/.test(f) && !f.startsWith('test-output'));
const group = (dir) => files.filter((f) => f.startsWith(`${dir}/`));
lines.push('## Artifacts', '', `Folder: ${path.relative(repo, artifacts)}/`, '', ...['pdf', 'html', 'publish', 'phone', 'webkitgtk'].filter((d) => group(d).length).map((d) => `- ${d}/: ${group(d).length} files`), '- logs/: one log per step', '- playwright.json: every browser test', '');
lines.push('Manual checks that remain: docs/release-matrix.md, rows marked manual.', '');
const report = path.join(artifacts, 'report.md');
writeFileSync(report, lines.join('\n'));
const latest = path.join(runs, 'latest');
rmSync(latest, { force: true });
symlinkSync(stamp, latest);
rmSync(home, { recursive: true, force: true });

console.log(`\n${verdict}\nReport: ${path.relative(repo, report)}`);
process.exit(failedSteps.length ? 1 : 0);
