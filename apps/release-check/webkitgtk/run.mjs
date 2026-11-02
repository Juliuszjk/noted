// Runs driver.py (the real WebKitGTK) inside a headless Weston of its own: nothing shows on
// the desktop and the app's data folders are never touched. Exit code 3 = this machine lacks
// what it needs (the pipeline reports that as skipped, not passed).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const [base, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });

const has = (command, ...args) => spawnSync(command, args, { stdio: 'ignore' }).status === 0;
if (!has('weston', '--version')) { console.error('weston is not installed'); process.exit(3); }
if (!has('python3', '-c', 'import gi; gi.require_version("WebKit2", "4.1"); from gi.repository import WebKit2')) {
  console.error('python-gobject with WebKit2 4.1 is not available');
  process.exit(3);
}

const socket = `noted-verify-${process.pid}`;
const runtime = process.env.XDG_RUNTIME_DIR ?? tmpdir();
const home = mkdtempSync(path.join(tmpdir(), 'noted-release-webkit-'));
const clean = { ...process.env };
delete clean.DISPLAY;
delete clean.WAYLAND_DISPLAY;
const weston = spawn('weston', ['--backend=headless', `--socket=${socket}`, '--no-config', '--idle-time=0', '--width=1400', '--height=900'], { env: clean, stdio: 'ignore' });
const stop = () => { weston.kill('SIGTERM'); rmSync(home, { recursive: true, force: true }); };

for (let i = 0; i < 100 && !existsSync(path.join(runtime, socket)); i++) await new Promise((r) => setTimeout(r, 50));
const driver = spawn('python3', ['-I', path.join(here, 'driver.py'), base, out], {
  stdio: ['ignore', 'inherit', 'pipe'],
  env: {
    ...clean,
    WAYLAND_DISPLAY: socket,
    GDK_BACKEND: 'wayland',
    NO_AT_BRIDGE: '1',
    GTK_USE_PORTAL: '0',
    LIBGL_ALWAYS_SOFTWARE: '1',
    WEBKIT_DISABLE_COMPOSITING_MODE: '1',
    XDG_CACHE_HOME: path.join(home, 'cache'),
    XDG_DATA_HOME: path.join(home, 'data'),
    XDG_CONFIG_HOME: path.join(home, 'config'),
  },
});
let errors = '';
driver.stderr.on('data', (chunk) => { errors += chunk; });
const code = await new Promise((resolve) => driver.on('exit', resolve));
stop();
if (code !== 0) console.error(errors.split('\n').filter((line) => !/CRITICAL|MESA|^$/.test(line)).slice(-15).join('\n'));
process.exit(code ?? 1);
