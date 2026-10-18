import { randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from './db.js';

// Whoever creates the vault on a fresh server owns it. A server reachable by others (a public
// address, a shared network) must not let a stranger be first, so creating the vault needs a
// setup code: NOTED_SETUP_CODE, or one made at the first start without a vault, kept in
// data/setup-code and printed to the log (`docker logs`). Gone once the vault exists.

const FILE = path.join(dataDir, 'setup-code');
const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';

// Codes are compared without case, spaces or dashes ("abcd efgh" = "ABCD-EFGH").
export const normalizeSetupCode = (code: string): string => code.toUpperCase().replace(/[\s-]/g, '');

const makeCode = (): string => {
  const bytes = randomBytes(12);
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
  return chars.match(/.{4}/g)!.join('-');
};

let code: string | null = null;

// Called at start while there is no vault.
export const prepareSetupCode = (): void => {
  const fromEnv = process.env.NOTED_SETUP_CODE?.trim();
  if (fromEnv) {
    code = fromEnv;
    console.log('vault: no vault yet, creating one needs the setup code from NOTED_SETUP_CODE');
    return;
  }
  try {
    code = fs.readFileSync(FILE, 'utf8').trim() || null;
  } catch {
    code = null;
  }
  if (!code) {
    code = makeCode();
    fs.writeFileSync(FILE, code, { mode: 0o600 });
  }
  console.log(`vault: no vault yet. Setup code for the first device: ${code}`);
};

export const setupCodeMatches = (given: string | undefined): boolean => {
  if (!code) return true;
  const a = Buffer.from(normalizeSetupCode(given ?? ''));
  const b = Buffer.from(normalizeSetupCode(code));
  return a.length === b.length && timingSafeEqual(a, b);
};

export const setupCodeRequired = (): boolean => code !== null;

// The vault exists: the code has done its job.
export const dropSetupCode = (): void => {
  code = null;
  fs.rmSync(FILE, { force: true });
};
