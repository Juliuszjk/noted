// Decrypted images as object URLs, kept only while they are shown. Every image on screen
// holds its URL (acquire); when the last one lets go (release) the URL stays a while for
// coming back to the note, then the newest few unused ones are kept and the rest revoked, so
// the decrypted pictures do not pile up in memory for the whole session.

export interface BlobUrlCache {
  // The URL for blob `id` (loading it when needed); null when it cannot be had now. Every
  // non-null result must be given back with release(id).
  acquire: (id: string) => Promise<string | null>;
  release: (id: string) => void;
  // Puts a blob that was just created (no decrypting needed later); not held by anyone yet.
  put: (id: string, blob: Blob) => void;
  // Number of URLs alive (tests, diagnostics).
  size: () => number;
}

interface Entry {
  url: string;
  holders: number;
  lastUsed: number;
}

export const createBlobUrlCache = (
  load: (id: string) => Promise<Blob | null>,
  { keepUnused = 12, delayMs = 20_000, now = () => Date.now(), schedule = (run: () => void, ms: number) => { setTimeout(run, ms); } } = {},
): BlobUrlCache => {
  const entries = new Map<string, Entry>();
  const loading = new Map<string, Promise<string | null>>();
  let sweepPlanned = false;

  const sweep = () => {
    sweepPlanned = false;
    const unused = [...entries.entries()].filter(([, e]) => e.holders === 0).sort((a, b) => b[1].lastUsed - a[1].lastUsed);
    for (const [id, e] of unused.slice(keepUnused)) {
      URL.revokeObjectURL(e.url);
      entries.delete(id);
    }
  };
  const planSweep = () => {
    if (sweepPlanned) return;
    sweepPlanned = true;
    schedule(sweep, delayMs);
  };
  const hold = (id: string): string | null => {
    const e = entries.get(id);
    if (!e) return null;
    e.holders++;
    e.lastUsed = now();
    return e.url;
  };

  return {
    acquire: async (id) => {
      const ready = hold(id);
      if (ready) return ready;
      let pending = loading.get(id);
      if (!pending) {
        pending = load(id).then((blob) => {
          if (!blob) return null;
          if (!entries.has(id)) entries.set(id, { url: URL.createObjectURL(blob), holders: 0, lastUsed: now() });
          return entries.get(id)!.url;
        }).finally(() => loading.delete(id));
        loading.set(id, pending);
      }
      const url = await pending;
      return url ? hold(id) : null;
    },
    release: (id) => {
      const e = entries.get(id);
      if (!e || e.holders === 0) return;
      e.holders--;
      e.lastUsed = now();
      if (e.holders === 0) planSweep();
    },
    put: (id, blob) => {
      if (entries.has(id)) return;
      entries.set(id, { url: URL.createObjectURL(blob), holders: 0, lastUsed: now() });
      planSweep();
    },
    size: () => entries.size,
  };
};
