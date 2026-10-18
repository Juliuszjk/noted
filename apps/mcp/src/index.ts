import './dom';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { base64ToBytes, bytesToBase64, deriveMasterKey } from '@noted/crypto';
import { fetchVault, openWithPassphraseKey, setAuthEpoch } from '@noted/sync';
import { createNotes } from './notes';
import { blobCache, openStore, readKey, writeKey } from './store';
import { INSTRUCTIONS, registerTools } from './tools';

// Noted for Claude Code: an MCP server on stdio that is one more device of the vault.
//   noted-mcp setup   asks for the passphrase once and keeps the data key (0600 file)
//   noted-mcp         the server (Claude Code starts it)

// stdout carries the protocol: everything shared code logs goes to stderr.
console.log = console.info = (...args: unknown[]) => console.error(...args);

const askHidden = (prompt: string): Promise<string> => new Promise((resolve) => {
  process.stderr.write(prompt);
  const stdin = process.stdin;
  stdin.setRawMode?.(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  let value = '';
  const onData = (chunk: string) => {
    for (const c of chunk) {
      if (c === '\r' || c === '\n') {
        stdin.setRawMode?.(false);
        stdin.pause();
        stdin.off('data', onData);
        process.stderr.write('\n');
        resolve(value);
        return;
      }
      if (c === '\u0003') process.exit(130);
      if (c === '\u007f' || c === '\b') value = value.slice(0, -1);
      else value += c;
    }
  };
  stdin.on('data', onData);
});

const setup = async () => {
  const info = await fetchVault();
  if (!info) throw new Error('The server has no vault yet: set Noted up in the app first.');
  const passphrase = await askHidden('Noted passphrase: ');
  process.stderr.write('Unlocking...\n');
  const dataKey = openWithPassphraseKey(info, deriveMasterKey(passphrase, base64ToBytes(info.salt)));
  if (!dataKey) throw new Error('Wrong passphrase.');
  const file = writeKey({ key: bytesToBase64(dataKey), epoch: info.authEpoch });
  setAuthEpoch(info.authEpoch);
  const notes = createNotes(dataKey, openStore());
  const warning = await notes.sync(true);
  const count = (await notes.list()).length;
  process.stderr.write(`Key saved in ${file} (only you can read it). ${count} notes available to Claude.${warning ? `\nSync: ${warning}` : ''}\n`);
};

const serve = async () => {
  const stored = readKey();
  if (!stored) throw new Error('No key yet: run "noted-mcp setup" in a terminal first.');
  setAuthEpoch(stored.epoch);
  const key = base64ToBytes(stored.key);
  const notes = createNotes(key, openStore());
  const server = new McpServer({ name: 'noted', version: '1.0.0' }, { instructions: INSTRUCTIONS });
  registerTools(server, notes, key, blobCache());
  await server.connect(new StdioServerTransport());
  // The first sync (the whole vault on a new copy) starts right away.
  notes.sync(true).catch(() => {});
};

(process.argv[2] === 'setup' ? setup().then(() => process.exit(0)) : serve()).catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
