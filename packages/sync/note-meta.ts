import * as Y from 'yjs';
import { formatTitleTemplate } from '@noted/editor/title-template';
import { isReminderRepeat } from '@noted/editor/reminder-time';
import type { ReminderRepeat } from '@noted/editor/reminder-time';

// Every note is one Y.Doc: the ProseMirror document lives in the XmlFragment 'default'
// (y-prosemirror's default), the title in the Y.Text 'title'.
export const TITLE_KEY = 'title';
const BODY_KEY = 'default';
const EXCERPT_CHARS = 160;
const META_VERSION = 1;

// What the note list and the link index need, without decrypting the whole Y.Doc. Stored
// sealed in the note's `content` column (server: encrypted_html).
export interface NoteMeta {
  title: string;
  // Start of the body as plain text.
  excerpt: string;
  // Ids of notes this note links to (noteLink nodes), without duplicates.
  links: string[];
  // Shown in the "Pinned" section of the note list.
  pinned: boolean;
  // When the note was created (ms); null for notes created before this was recorded.
  created: number | null;
  favorite: boolean;
  archived: boolean;
  // In the trash since (ms), or null.
  trashedAt: number | null;
  // Deleted for good: a tombstone, never listed.
  deleted: boolean;
  // Notebooks (categories) and tags: catalog ids, a note can be in several of each.
  notebooks: string[];
  tags: string[];
  // The body is sealed with the vault key of locked notes (locked.ts): no excerpt, no links.
  locked: boolean;
  // Published to the web (settings `published`, publish.ts); the "Published" view lists these.
  published: boolean;
  // Reminder chips in the body, with the text of their line (the Reminders view). Absent in
  // meta saved before reminders were indexed (refreshStaleNoteMeta rebuilds those).
  reminders?: NoteReminder[];
}

export interface NoteReminder {
  id: string;
  at: number;
  repeat: ReminderRepeat | null;
  done: boolean;
  // The line the chip stands in, without the chip.
  text: string;
}

const REMINDER_TEXT_CHARS = 200;

export const getTitleText = (doc: Y.Doc): Y.Text => doc.getText(TITLE_KEY);

// Replaces the title with `value` by editing only the changed middle part, so concurrent
// edits on other devices still merge character by character.
export function setTitle(doc: Y.Doc, value: string, origin?: unknown): void {
  const text = getTitleText(doc);
  const current = text.toString();
  if (current === value) return;
  let start = 0;
  while (start < current.length && start < value.length && current[start] === value[start]) start++;
  let endCurrent = current.length;
  let endValue = value.length;
  while (endCurrent > start && endValue > start && current[endCurrent - 1] === value[endValue - 1]) {
    endCurrent--;
    endValue--;
  }
  doc.transact(() => {
    if (endCurrent > start) text.delete(start, endCurrent - start);
    if (endValue > start) text.insert(start, value.slice(start, endValue));
  }, origin);
}

// Per-note settings live in the Y.Map 'settings' of the same doc, so they sync and merge too.
const SETTINGS_KEY = 'settings';
export type NoteFont = 'serif' | 'mono';

export const getNoteSettings = (doc: Y.Doc): Y.Map<unknown> => doc.getMap(SETTINGS_KEY);

// Font of the whole note; null = the default (sans).
export const getNoteFont = (doc: Y.Doc): NoteFont | null => {
  const value = getNoteSettings(doc).get('font');
  return value === 'serif' || value === 'mono' ? value : null;
};

export const setNoteFont = (doc: Y.Doc, font: NoteFont | null, origin?: unknown): void => {
  doc.transact(() => {
    if (font) getNoteSettings(doc).set('font', font);
    else getNoteSettings(doc).delete('font');
  }, origin);
};

// On/off properties of a note. Absent = off, so old notes need no migration.
//  pinned: "Pinned" section; favorite: "Favorites"; archived: only in "Archive";
//  readOnly: the editor does not accept changes; noSpellcheck: browser spell check off.
export type NoteFlag = 'pinned' | 'favorite' | 'archived' | 'readOnly' | 'noSpellcheck';

export const getNoteFlag = (doc: Y.Doc, flag: NoteFlag): boolean => getNoteSettings(doc).get(flag) === true;

export const setNoteFlag = (doc: Y.Doc, flag: NoteFlag, on: boolean, origin?: unknown): void => {
  doc.transact(() => {
    if (on) getNoteSettings(doc).set(flag, true);
    else getNoteSettings(doc).delete(flag);
  }, origin);
};

export const isNotePinned = (doc: Y.Doc): boolean => getNoteFlag(doc, 'pinned');
export const setNotePinned = (doc: Y.Doc, pinned: boolean, origin?: unknown): void => setNoteFlag(doc, 'pinned', pinned, origin);

// Trash: a trashed note keeps its content and can be restored. Deleting it for good empties the
// doc (CRDT deletes, so the content is gone on every device after the merge) and leaves a
// small tombstone that sync keeps, so no device uploads the note again.
export const getNoteTrashedAt = (doc: Y.Doc): number | null => {
  const value = getNoteSettings(doc).get('trashedAt');
  return typeof value === 'number' ? value : null;
};

export const setNoteTrashed = (doc: Y.Doc, trashed: boolean, at: number = Date.now(), origin?: unknown): void => {
  doc.transact(() => {
    if (trashed) getNoteSettings(doc).set('trashedAt', at);
    else getNoteSettings(doc).delete('trashedAt');
  }, origin);
};

export const isNoteDeleted = (doc: Y.Doc): boolean => getNoteSettings(doc).get('deleted') === true;

export const deleteNoteForever = (doc: Y.Doc, origin?: unknown): void => {
  doc.transact(() => {
    const body = doc.getXmlFragment(BODY_KEY);
    if (body.length) body.delete(0, body.length);
    const title = getTitleText(doc);
    if (title.length) title.delete(0, title.length);
    const tags = getNoteTagMap(doc);
    for (const key of [...tags.keys()]) tags.delete(key);
    const notebooks = getNoteNotebookMap(doc);
    for (const key of [...notebooks.keys()]) notebooks.delete(key);
    const settings = getNoteSettings(doc);
    for (const key of [...settings.keys()]) if (key !== 'createdAt') settings.delete(key);
    settings.set('deleted', true);
  }, origin);
};

// Notebooks (categories) and tags refer to entries of the catalog (catalog.ts) by id, so
// renaming a notebook or tag needs no change in the notes. Both are keys of their own Y.Map,
// so adding a note to notebooks / tags on two devices at once merges. Notes from before
// several notebooks were allowed keep their one notebook in settings.notebook; it is moved
// into the map on the next change.
export const getNoteNotebookMap = (doc: Y.Doc): Y.Map<boolean> => doc.getMap('notebooks');

export const getNoteNotebooks = (doc: Y.Doc): string[] => {
  const ids = new Set(getNoteNotebookMap(doc).keys());
  const legacy = getNoteSettings(doc).get('notebook');
  if (typeof legacy === 'string' && legacy) ids.add(legacy);
  return [...ids].sort();
};

export const setNoteNotebook = (doc: Y.Doc, notebookId: string, on: boolean, origin?: unknown): void => {
  doc.transact(() => {
    const map = getNoteNotebookMap(doc);
    const settings = getNoteSettings(doc);
    const legacy = settings.get('notebook');
    if (typeof legacy === 'string') {
      settings.delete('notebook');
      if (legacy && legacy !== notebookId) map.set(legacy, true);
    }
    if (on) map.set(notebookId, true);
    else map.delete(notebookId);
  }, origin);
};

// Tags are keys of their own Y.Map, so tagging on two devices at once merges.
export const getNoteTagMap = (doc: Y.Doc): Y.Map<boolean> => doc.getMap('tags');
export const getNoteTags = (doc: Y.Doc): string[] => [...getNoteTagMap(doc).keys()].sort();

export const setNoteTag = (doc: Y.Doc, tagId: string, on: boolean, origin?: unknown): void => {
  doc.transact(() => {
    if (on) getNoteTagMap(doc).set(tagId, true);
    else getNoteTagMap(doc).delete(tagId);
  }, origin);
};

export const getNoteCreated = (doc: Y.Doc): number | null => {
  const value = getNoteSettings(doc).get('createdAt');
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

// Records the creation time once; later calls (other devices, merges) keep the first one.
export const markNoteCreated = (doc: Y.Doc, at: number = Date.now(), origin?: unknown): void => {
  if (getNoteCreated(doc) !== null) return;
  doc.transact(() => getNoteSettings(doc).set('createdAt', at), origin);
};

type Walk = { text: string; links: Set<string>; reminders: NoteReminder[] };

// Plain text of a text block (paragraph, heading): its own text, not that of nested blocks.
const blockText = (block: Y.XmlElement): string => {
  let text = '';
  for (const child of block.toArray()) {
    if (!(child instanceof Y.XmlText)) continue;
    for (const op of child.toDelta() as { insert: unknown }[]) if (typeof op.insert === 'string') text += op.insert;
  }
  return text.replace(/\s+/g, ' ').trim().slice(0, REMINDER_TEXT_CHARS);
};

const readReminder = (element: Y.XmlElement, parent: Y.XmlElement | Y.XmlFragment): NoteReminder | null => {
  const id = element.getAttribute('id');
  const at = Number(element.getAttribute('at'));
  if (typeof id !== 'string' || !id || !Number.isFinite(at)) return null;
  const repeat = element.getAttribute('repeat');
  return {
    id,
    at,
    repeat: isReminderRepeat(repeat) ? repeat : null,
    done: (element.getAttribute('done') as unknown) === true,
    text: parent instanceof Y.XmlElement ? blockText(parent) : '',
  };
};

const walk = (node: Y.XmlElement | Y.XmlFragment | Y.XmlText, acc: Walk) => {
  if (node instanceof Y.XmlText) {
    if (acc.text.length < EXCERPT_CHARS) {
      for (const op of node.toDelta() as { insert: unknown }[]) {
        if (typeof op.insert === 'string') acc.text += op.insert;
      }
    }
    return;
  }
  if (node instanceof Y.XmlElement && node.nodeName === 'noteLink') {
    const id = node.getAttribute('noteId');
    if (typeof id === 'string' && id) acc.links.add(id);
  }
  for (const child of node.toArray()) {
    if (child instanceof Y.XmlElement && child.nodeName === 'reminder') {
      const reminder = readReminder(child, node as Y.XmlElement | Y.XmlFragment);
      if (reminder) acc.reminders.push(reminder);
      continue;
    }
    walk(child as Y.XmlElement | Y.XmlText, acc);
  }
  // Blocks are separated by a space in the excerpt.
  if (node instanceof Y.XmlElement && acc.text && !acc.text.endsWith(' ')) acc.text += ' ';
};

export function buildNoteMeta(doc: Y.Doc): NoteMeta {
  const acc: Walk = { text: '', links: new Set(), reminders: [] };
  const locked = typeof getNoteSettings(doc).get('locked') === 'string';
  if (!locked) walk(doc.getXmlFragment(BODY_KEY), acc);
  return {
    title: getTitleText(doc).toString().trim(),
    excerpt: acc.text.replace(/\s+/g, ' ').trim().slice(0, EXCERPT_CHARS),
    links: [...acc.links],
    pinned: isNotePinned(doc),
    created: getNoteCreated(doc),
    favorite: getNoteFlag(doc, 'favorite'),
    archived: getNoteFlag(doc, 'archived'),
    trashedAt: getNoteTrashedAt(doc),
    deleted: isNoteDeleted(doc),
    notebooks: getNoteNotebooks(doc),
    tags: getNoteTags(doc),
    locked,
    published: getNotePublish(doc) !== null,
    reminders: acc.reminders,
  };
}

const parseNoteReminder = (r: unknown): NoteReminder | null => {
  if (!r || typeof r !== 'object') return null;
  const data = r as Record<string, unknown>;
  if (typeof data.id !== 'string' || typeof data.at !== 'number') return null;
  return {
    id: data.id,
    at: data.at,
    repeat: isReminderRepeat(data.repeat) ? data.repeat : null,
    done: data.done === true,
    text: typeof data.text === 'string' ? data.text : '',
  };
};

const EMPTY_FLAGS = {
  pinned: false, created: null, favorite: false, archived: false, trashedAt: null, deleted: false, notebooks: [] as string[], tags: [] as string[],
  locked: false, published: false,
};

export const encodeNoteMeta = (meta: NoteMeta): string => JSON.stringify({ v: META_VERSION, ...meta });

// Reads a decrypted `content` value. Notes saved before titles existed hold an HTML (or Yjs
// XML) preview instead of JSON; those get its text as excerpt and no title.
export function decodeNoteMeta(plain: string | null | undefined): NoteMeta {
  if (plain && plain.startsWith('{')) {
    try {
      const data = JSON.parse(plain);
      if (data && data.v === META_VERSION) {
        return {
          title: typeof data.title === 'string' ? data.title : '',
          excerpt: typeof data.excerpt === 'string' ? data.excerpt : '',
          links: Array.isArray(data.links) ? data.links.filter((l: unknown) => typeof l === 'string') : [],
          pinned: data.pinned === true,
          created: typeof data.created === 'number' ? data.created : null,
          favorite: data.favorite === true,
          archived: data.archived === true,
          trashedAt: typeof data.trashedAt === 'number' ? data.trashedAt : null,
          deleted: data.deleted === true,
          // Meta written before several notebooks were allowed has one `notebook`.
          notebooks: Array.isArray(data.notebooks) ? data.notebooks.filter((n: unknown) => typeof n === 'string')
            : typeof data.notebook === 'string' && data.notebook ? [data.notebook] : [],
          tags: Array.isArray(data.tags) ? data.tags.filter((t: unknown) => typeof t === 'string') : [],
          locked: data.locked === true,
          published: data.published === true,
          ...(Array.isArray(data.reminders) ? { reminders: data.reminders.map(parseNoteReminder).filter(Boolean) as NoteReminder[] } : {}),
        };
      }
    } catch {
      // not JSON after all: treat as legacy text below
    }
  }
  const excerpt = (plain ?? '').replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').trim().slice(0, EXCERPT_CHARS);
  return { ...EMPTY_FLAGS, title: '', excerpt, links: [] };
}

// Name shown for a note in lists and links.
export const displayTitle = (meta: NoteMeta): string => meta.title || meta.excerpt.slice(0, 40) || 'Untitled';

// Published copy of the note (publish.ts): its public id, the key of the link (base64url,
// only ever in the link's #fragment and inside this encrypted note) and when it was last
// uploaded. One value, so a concurrent publish on two devices never mixes id and key.
export interface NotePublish {
  id: string;
  key: string;
  at: number;
  // Readers also need this password (kept here so Update keeps it; the note is encrypted).
  password?: string | null;
  // The server deletes the copy after it was opened once.
  selfDestruct?: boolean;
  // Edits are published by themselves (a little while after typing stops).
  autoUpdate?: boolean;
  // The link stops working at this time (ms); null = never.
  expiresAt?: number | null;
}

export const getNotePublish = (doc: Y.Doc): NotePublish | null => {
  const value = getNoteSettings(doc).get('published') as Partial<NotePublish> | undefined;
  return value && typeof value.id === 'string' && typeof value.key === 'string' && typeof value.at === 'number'
    ? {
      id: value.id, key: value.key, at: value.at,
      password: typeof value.password === 'string' && value.password ? value.password : null,
      selfDestruct: value.selfDestruct === true,
      autoUpdate: value.autoUpdate === true,
      expiresAt: typeof value.expiresAt === 'number' ? value.expiresAt : null,
    } : null;
};

export const setNotePublish = (doc: Y.Doc, info: NotePublish | null, origin?: unknown): void => {
  doc.transact(() => {
    if (info) getNoteSettings(doc).set('published', { ...info });
    else getNoteSettings(doc).delete('published');
  }, origin);
};

// Settings > Editor "Default title": a note that got text but no title is titled from the
// template (with its creation time), once; a title deleted afterwards stays deleted.
export const applyDefaultTitle = (doc: Y.Doc, template: string, now = Date.now(), origin?: unknown): boolean => {
  if (!template.trim()) return false;
  const settings = getNoteSettings(doc);
  if (settings.get('autoTitled') || getTitleText(doc).toString().trim()) return false;
  const hasText = doc.getXmlFragment('default').toArray().some((node) => {
    const text = node instanceof Y.XmlText ? node.toString() : (node as Y.XmlElement).toString().replace(/<[^>]*>/g, '');
    return text.trim().length > 0;
  });
  if (!hasText) return false;
  const created = getNoteCreated(doc) ?? now;
  doc.transact(() => {
    setTitle(doc, formatTitleTemplate(template, new Date(created)));
    settings.set('autoTitled', true);
  }, origin);
  return true;
};
