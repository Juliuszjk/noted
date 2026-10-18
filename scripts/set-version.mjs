// Sets the app version everywhere it is kept: node scripts/set-version.mjs 0.2.0
// (desktop package.json, tauri.conf.json, Cargo.toml, the phone's app.json with its versionCode).
// Then commit and tag: git tag v0.2.0 && git push --tags starts the release build.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const version = process.argv[2];
const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version ?? '');
if (!match) {
  console.error('Usage: node scripts/set-version.mjs <major.minor.patch>');
  process.exit(1);
}
const [major, minor, patch] = match.slice(1).map(Number);
if (minor > 999 || patch > 999) throw new Error('minor and patch must stay below 1000 (versionCode)');
// Android only installs a higher versionCode over an older one.
const versionCode = major * 1_000_000 + minor * 1000 + patch;

const root = fileURLToPath(new URL('..', import.meta.url));
const editJson = (file, edit) => {
  const path = root + file;
  const data = JSON.parse(readFileSync(path, 'utf8'));
  edit(data);
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
};

editJson('apps/desktop/package.json', (d) => { d.version = version; });
editJson('apps/desktop/src-tauri/tauri.conf.json', (d) => { d.version = version; });
editJson('apps/mobile/app.json', (d) => { d.expo.version = version; d.expo.android.versionCode = versionCode; });
const cargo = root + 'apps/desktop/src-tauri/Cargo.toml';
writeFileSync(cargo, readFileSync(cargo, 'utf8').replace(/^version = ".*"$/m, `version = "${version}"`));
console.log(`Version ${version} (Android versionCode ${versionCode})`);
