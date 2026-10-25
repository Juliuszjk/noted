import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { NoteEditor } from '@noted/ui/src/NoteEditor';
import { slashItems } from '@noted/editor/slash-items';
import { TOOLBAR_PRESETS } from '@noted/editor/toolbar-items';
import type { ToolbarConfig } from '@noted/editor/toolbar-items';
import type { BlobHandlers, BlobRef } from '@noted/editor/blob-image';
import { unsealBytes, base64ToBytes } from '@noted/crypto';
import { liveKeys } from '@noted/sync/live';
import type { LiveKeys } from '@noted/sync/live';
import { getTitleText } from '@noted/sync/note-meta';
import { exportAttachmentsWith, zipNoteWithFiles } from '@noted/sync/export-files';
import { exportNote } from '@noted/editor/export';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import { fetchInitial, fetchNeedsPassword, openLiveSession } from './live-client';
import type { LiveSession, LiveStatus } from './live-client';

// The page a live published note's link opens (served by the public server as /live.js):
// the note in the shared editor, read only or editable as the owner chose, with everyone's
// cursors. The key is the link's #fragment; nothing here is sent anywhere but sealed.

const NAME_KEY = 'noted_live_name';
const COLORS = ['#e8590c', '#2f9e44', '#1971c2', '#9c36b5', '#c2255c', '#0c8599', '#f08c00', '#5f3dc4'];

// What a guest cannot do here: files (nothing is uploaded), the owner's other notes,
// notebooks and tags, reminders (they would ring on the owner's phone), publish. Export
// downloads the note in the browser.
const GUEST_HIDDEN = new Set(['Image', 'File', 'Reminder', 'Link to note', 'Link from another note', 'Go to note', 'Notebook', 'Tag', 'Publish']);
const GUEST_SLASH = slashItems.filter((item) => !GUEST_HIDDEN.has(item.title));
const GUEST_TOOLBAR: ToolbarConfig = {
  preset: 'custom',
  groups: TOOLBAR_PRESETS.desktop.default
    // The note's font is a setting of the note, which guests may not change (live.ts).
    .map((group) => group.filter((item) => item !== 'noteLink' && item !== 'font'))
    .filter((group) => group.length),
};

const fromBase64Url = (text: string): Uint8Array => {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
};

const readName = (): string => {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
};
const saveName = (name: string) => {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // private window: asked again next time
  }
};

const MISSING_BLOB_RETRIES = 8;
const MISSING_BLOB_WAIT_MS = 2_000;

const downloadFile = (data: BlobPart, name: string) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data]));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
};

const blobHandlers = (id: string, keys: LiveKeys): BlobHandlers & { bytes: (ref: BlobRef, retries?: number) => Promise<Uint8Array | null> } => {
  const urls = new Map<string, { url: string; count: number }>();
  // A file the owner just added is listed (and uploaded) a few seconds after it shows up in
  // the note: asked again a few times before the editor shows it as missing.
  const bytes = async (ref: BlobRef, retries = MISSING_BLOB_RETRIES): Promise<Uint8Array | null> => {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`/p/${id}/blob/${ref.id}`, { headers: { 'X-Live-Read': keys.read } });
      if (res.ok) return unsealBytes(base64ToBytes(ref.key), new Uint8Array(await res.arrayBuffer()));
      if (res.status !== 404 || attempt >= retries) return null;
      await new Promise((r) => setTimeout(r, MISSING_BLOB_WAIT_MS));
    }
  };
  const objectUrl = async (ref: BlobRef): Promise<string | null> => {
    const known = urls.get(ref.id);
    if (known) {
      known.count++;
      return known.url;
    }
    const data = await bytes(ref);
    if (!data) return null;
    const entry = { url: URL.createObjectURL(new Blob([data as BlobPart])), count: 1 };
    urls.set(ref.id, entry);
    return entry.url;
  };
  // Files open as downloads (a page cannot open them in another program).
  const download = async (ref: BlobRef, name: string) => {
    const data = await bytes(ref);
    if (!data) throw new Error('The file is not on the server');
    downloadFile(data as BlobPart, name);
  };
  return {
    bytes,
    resolve: objectUrl,
    release: (ref) => {
      const entry = urls.get(ref.id);
      if (entry && --entry.count <= 0) {
        URL.revokeObjectURL(entry.url);
        urls.delete(ref.id);
      }
    },
    saveFile: download,
    openFile: download,
    notify: (message) => alert(message),
  };
};

type Phase =
  | { kind: 'loading' }
  | { kind: 'message'; text: string }
  | { kind: 'password'; error: string }
  | { kind: 'name'; keys: LiveKeys; initial: Awaited<ReturnType<typeof fetchInitial>> & { ok: true } }
  | { kind: 'ready'; keys: LiveKeys; session: LiveSession };

const center = { maxWidth: 360, margin: '18vh auto 0', padding: '0 20px', textAlign: 'center' } as const;
const input = {
  width: '100%', boxSizing: 'border-box', padding: '10px 12px', fontSize: 16, borderRadius: 10,
  border: '1px solid var(--border)', background: 'transparent', color: 'inherit',
} as const;
const primary = {
  marginTop: 10, width: '100%', padding: 10, fontSize: 15, fontWeight: 600, border: 0, borderRadius: 10,
  background: 'var(--primary)', color: 'var(--primary-fg)', cursor: 'pointer',
} as const;

export function LiveApp() {
  const id = location.pathname.split('/')[2] ?? '';
  const keyText = location.hash.slice(1);
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [password, setPassword] = useState('');
  const [name, setName] = useState(readName);

  const open = async (pw: string | null) => {
    let link: Uint8Array;
    try {
      link = fromBase64Url(keyText);
      if (link.length !== 32) throw new Error('bad key');
    } catch {
      return setPhase({ kind: 'message', text: keyText ? 'This link is damaged.' : 'This link is missing its key (the part after #).' });
    }
    const keys = liveKeys(link, pw);
    const result = await fetchInitial(id, keys).catch(() => null);
    if (!result) return setPhase({ kind: 'message', text: 'Could not load the note. Check your connection.' });
    if (!result.ok) {
      if (result.status === 404) return setPhase({ kind: 'message', text: 'This note is not published any more.' });
      if (result.status === 429) return setPhase(pw ? { kind: 'password', error: 'Too many tries. Wait a minute.' } : { kind: 'message', text: 'Too many tries. Wait a minute and reload.' });
      if (pw) return setPhase({ kind: 'password', error: 'Wrong password.' });
      return setPhase({ kind: 'message', text: 'This link does not open this note (wrong key).' });
    }
    if (result.initial.editable && !readName()) return setPhase({ kind: 'name', keys, initial: result });
    start(keys, result.initial, readName());
  };

  const start = (keys: LiveKeys, initial: (Phase & { kind: 'name' })['initial']['initial'], who: string) => {
    const session = openLiveSession(id, keys, initial, true);
    const color = COLORS[Math.abs([...who].reduce((h, c) => h * 31 + c.charCodeAt(0), 7)) % COLORS.length];
    session.awareness.setLocalStateField('user', { name: who || 'Guest', color });
    setPhase({ kind: 'ready', keys, session });
  };

  useEffect(() => {
    fetchNeedsPassword(id).then((needs) => {
      if (needs === null) setPhase({ kind: 'message', text: 'This note is not published any more.' });
      else if (needs) setPhase({ kind: 'password', error: '' });
      else open(null);
    }).catch(() => setPhase({ kind: 'message', text: 'Could not load the note. Check your connection.' }));
  }, []);

  if (phase.kind === 'loading') return <div className="live-status">Opening…</div>;
  if (phase.kind === 'message') return <div className="live-status">{phase.text}</div>;
  if (phase.kind === 'password') {
    return (
      <form style={center} onSubmit={(e) => { e.preventDefault(); setPhase({ kind: 'password', error: 'Checking…' }); setTimeout(() => open(password), 20); }}>
        <h1 style={{ fontSize: 20, margin: '0 0 8px' }}>Password protected</h1>
        <p style={{ opacity: 0.7, fontSize: 14, margin: '0 0 16px' }}>This note needs a password to open.</p>
        <input style={input} type="password" autoFocus autoComplete="off" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <button style={primary} type="submit">Open</button>
        <div style={{ color: 'var(--error)', fontSize: 13, minHeight: 18, marginTop: 8 }}>{phase.error}</div>
      </form>
    );
  }
  if (phase.kind === 'name') {
    return (
      <form style={center} onSubmit={(e) => { e.preventDefault(); const who = name.trim().slice(0, 40); if (!who) return; saveName(who); start(phase.keys, phase.initial.initial, who); }}>
        <h1 style={{ fontSize: 20, margin: '0 0 8px' }}>Your name</h1>
        <p style={{ opacity: 0.7, fontSize: 14, margin: '0 0 16px' }}>Others editing this note see it next to your cursor.</p>
        <input style={input} autoFocus maxLength={40} placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <button style={primary} type="submit">Continue</button>
      </form>
    );
  }
  return <LiveEditor id={id} keys={phase.keys} session={phase.session} />;
}

const STATUS_TEXT: Record<LiveStatus, string> = {
  online: '', connecting: 'Connecting…', offline: 'Offline: your changes are kept and sent when the connection is back',
  gone: 'This note is not published any more.', denied: 'The link changed (new password?): reload the page.',
  full: 'Waiting for the owner\'s app to take your changes…',
};

function LiveEditor({ id, keys, session }: { id: string; keys: LiveKeys; session: LiveSession }) {
  const version = useSyncExternalStore(session.onChange, () => `${session.status()}|${session.editable()}|${session.unsaved()}|${session.broken()}|${session.outdated()}|${session.awareness.getStates().size}`);
  const [toolbarSlot, setToolbarSlot] = useState<HTMLDivElement | null>(null);
  const [findSlot, setFindSlot] = useState<HTMLDivElement | null>(null);
  const blobs = useMemo(() => blobHandlers(id, keys), [id, keys]);
  const user = session.awareness.getLocalState()?.user ?? { name: 'Guest', color: COLORS[0] };
  const caret = useMemo(() => [CollaborationCaret.configure({ provider: { awareness: session.awareness }, user })], [session]);
  const status = session.status();
  const editable = session.editable();
  const people = [...session.awareness.getStates().entries()]
    .filter(([client, state]) => client !== session.doc.clientID && state?.user?.name)
    .map(([client, state]) => ({ client, name: String(state.user.name).slice(0, 40), color: String(state.user.color ?? COLORS[0]) }));

  useEffect(() => {
    const update = () => { document.title = getTitleText(session.doc).toString().trim() || 'Untitled'; };
    update();
    getTitleText(session.doc).observe(update);
    return () => getTitleText(session.doc).unobserve(update);
  }, [session]);

  // Edits not stored yet: the browser asks before the page closes.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (session.unsaved()) e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [session]);

  // Export (the header button or "/export"): Markdown / text / HTML downloaded by the browser; a
  // Markdown note with images or files as a zip with an attachments folder, like the app's.
  const saveExport = async (name: string, text: string, source?: { title: string; json: object; format: 'markdown' | 'text'; titles: Record<string, string> }) => {
    try {
      if (source?.format === 'markdown') {
        const { links, files } = await exportAttachmentsWith(source.json as Parameters<typeof exportAttachmentsWith>[0], (blob, key) => blobs.bytes({ id: blob, key }, 0));
        if (files.length) {
          return downloadFile(zipNoteWithFiles(name, exportNote(source.title, source.json, 'markdown', source.titles, links), files) as BlobPart, name.replace(/\.md$/, '.zip'));
        }
      }
      downloadFile(text, name);
    } catch (e) {
      alert(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  void version;
  return (
    <div className="live-page">
      <div className="live-top">
        <header className="live-header">
          <span className="live-brand">Noted</span>
          <span className="live-mode">{editable ? 'Live · editing' : 'Live · read only'}</span>
          <span className={`live-dot live-dot-${status === 'online' ? (session.unsaved() ? 'saving' : 'online') : 'offline'}`} title={status === 'online' ? (session.unsaved() ? 'Saving…' : 'Saved') : STATUS_TEXT[status]} />
          <span style={{ flex: 1 }} />
          <span className="live-people">
            {people.map((p) => (
              <span key={p.client} className="live-person" style={{ background: p.color }} title={p.name}>{p.name.slice(0, 1).toUpperCase()}</span>
            ))}
          </span>
          <button type="button" className="live-button" title="Export this note (Markdown, text, HTML or PDF)" onClick={() => window.dispatchEvent(new Event('noted:export'))}>Export</button>
        </header>
        {editable && <div className="live-toolbar" ref={setToolbarSlot} />}
        {/* The find bar (Ctrl+F) hangs under the header and the toolbar. */}
        <div className="live-find" ref={setFindSlot} />
      </div>
      {status !== 'online' && status !== 'connecting' && <div className="live-banner">{STATUS_TEXT[status]}</div>}
      {session.broken() && <div className="live-banner">Something here could not be saved. Reload the page to go on editing.</div>}
      {session.outdated() && <div className="live-banner">This note uses things this page does not know yet (the server runs an older Noted), so editing is off: nothing in the note gets lost.</div>}
      <main className="live-note">
        <NoteEditor
          noteId={id}
          ydoc={session.doc}
          onUpdate={() => {}}
          readOnly={!editable || status === 'gone' || status === 'denied'}
          blobs={blobs}
          toolbarMode="top"
          toolbarSlot={toolbarSlot}
          toolbarConfig={GUEST_TOOLBAR}
          findSlot={findSlot}
          onSaveExport={saveExport}
          slashItems={GUEST_SLASH}
          noteLinks={false}
          extraExtensions={caret}
          onOpenLink={(href) => window.open(href, '_blank', 'noopener,noreferrer')}
        />
      </main>
      <footer className="live-footer">Noted · end-to-end encrypted: the server never sees this note</footer>
    </div>
  );
}
