import { apiUrl, hasServer, publicUrl, serverAddress, setServerAddress } from '@noted/config';

// GET /info of a Noted server (no auth): proves an address is one, and gives the public
// address of its published notes ('' = none configured, `NOTED_PUBLIC_URL`).
export interface ServerInfo {
  publicUrl: string;
}

export const fetchServerInfo = async (base: string, timeoutMs = 8000): Promise<ServerInfo> => {
  let res: Response;
  try {
    res = await fetch(`${base}/info`, { signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new Error(`Cannot reach ${base}.`);
  }
  const body = res.ok ? await res.json().catch(() => null) : null;
  if (body?.app !== 'noted') throw new Error(`${base} is not a Noted server (or an older version).`);
  return { publicUrl: typeof body.publicUrl === 'string' ? body.publicUrl.replace(/\/+$/, '') : '' };
};

// Chooses the server of this device (before unlocking: the vault lives on it).
export const connectServer = async (base: string): Promise<void> => {
  const info = await fetchServerInfo(base);
  setServerAddress({ api: base, public: info.publicUrl });
};

// At start: takes over a public address the server reports (it may have moved). Quiet when
// offline or when the server reports none (a build default stays).
export const refreshServerInfo = async (): Promise<void> => {
  if (!hasServer()) return;
  try {
    const info = await fetchServerInfo(apiUrl());
    if (info.publicUrl && info.publicUrl !== publicUrl()) setServerAddress({ ...serverAddress(), public: info.publicUrl });
  } catch {
    // Offline or an older server.
  }
};
