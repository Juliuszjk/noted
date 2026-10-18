import * as Y from 'yjs';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { JSONContent } from '@tiptap/core';
import {
  ensureCatalogEntry, getNoteFlag, getNoteNotebooks, getNoteTags, getSharedEditorPrefs, listCatalog,
  listOwnReminders, markNoteCreated, noteBodyJson, noteBodyText, setNoteBodyJson, setNoteFlag, setNoteNotebook, setNoteTag,
  setOwnReminder, setTitle, updateReminderInDoc,
} from '@noted/sync';
import type { LocalBlobStore, NoteMeta, OwnReminder } from '@noted/sync';
import { completeReminder, isReminderRepeat, repeatLabel, reminderDue, reminderStatus } from '@noted/editor/reminder-time';
import type { ReminderRepeat, ReminderState } from '@noted/editor/reminder-time';
import { reminderEntries } from '@noted/ui/src/reminder-list';
import type { ReminderEntry } from '@noted/ui/src/reminder-list';
import { newBlocks, parseRewrite, renderBody } from './markdown';
import { applyRewrite, findBlock, insertBlocks, plainText, replaceText, setTaskDone } from './edits';
import { jsonToY } from '@noted/sync/json-to-y';
import { HiddenNoteError, isProtectedName } from './notes';
import type { Notes, NoteInfo } from './notes';
import { drawingPicture, imagePicture } from './render';

// The tools Claude gets. Every call first syncs (at most every few seconds), changes are
// pushed at once. Calls run one at a time.

type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };
type Result = { content: Content[]; isError?: boolean };

const text = (value: string, isError = false): Result => ({ content: [{ type: 'text', text: value }], ...(isError ? { isError } : {}) });

export const INSTRUCTIONS = `Noted is the user's notes app (end-to-end encrypted; this server is one of their devices).
Notes are shown as Markdown. Things Markdown cannot hold appear as tokens:
- ⟦image N⟧, ⟦drawing N⟧, ⟦file N⟧ on a line of their own: an image, a hand drawing (can hold handwriting or code) or an attached file. read_note with images: true shows images and drawings to you.
- ⟦reminder N: …⟧ inline: a reminder chip (date shown after the colon). ⟦link N: Title⟧ inline: a link to another note.
When you rewrite a note, keep every token where it should go (move them freely); a token you drop is refused unless you list it in "remove". [[Exact note title]] creates a link to a note.
Prefer the small edits (replace_text, append_to_note, set_task_done) over rewrite_note when only a part changes; blocks you leave unchanged in rewrite_note keep their exact formatting (colours, highlights), changed blocks get plain Markdown formatting.
When you complete half-written sentences or fill gaps in the user's notes, mark what you added as *[…]* (italic in square brackets) so they can tell it from their own words, unless they ask otherwise.
Markdown extras: $…$ inline math, $$…$$ block math, ==highlight==, - [ ] tasks, > [!NOTE] / [!TIP] / [!WARNING] / [!CAUTION] callouts.
Times are the user's local time (${Intl.DateTimeFormat().resolvedOptions().timeZone}); write them as YYYY-MM-DD HH:MM.
Some notes are hidden from you on purpose (a protected notebook, locked notes); never try to reach them.
undo_last_change reverts your last change if something went wrong.`;

const formatTime = (ms: number) => {
  const d = new Date(ms);
  const date = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  return `${date} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
};
const formatNow = () => `Now: ${formatTime(Date.now())}.`;

// "2026-10-20 18:00", "2026-10-20T18:00", ISO with an offset, or a date alone (the morning time).
const parseTime = (value: string, morning: string): number | null => {
  const v = value.trim();
  const full = /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T${morning}` : v.replace(/^(\d{4}-\d{2}-\d{2}) (\d)/, '$1T$2');
  const ms = new Date(full).getTime();
  return Number.isFinite(ms) ? ms : null;
};

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ł/g, 'l');

export const registerTools = (server: McpServer, notes: Notes, key: Uint8Array, blobs: LocalBlobStore) => {
  let queue: Promise<unknown> = Promise.resolve();
  // One call at a time; a failure becomes an error result (hidden notes: their own message).
  const run = (work: () => Promise<Result>, writes = false): Promise<Result> => {
    const next = queue.then(async () => {
      try {
        const warning = await notes.sync();
        const result = await work();
        const said = result.content.some((c) => c.type === 'text' && c.text.includes(warning ?? '\0'));
        if (warning && !said) result.content.push({ type: 'text', text: `(Sync: ${warning})` });
        return result;
      } catch (e) {
        if (e instanceof HiddenNoteError) return text(e.message, true);
        return text(`${writes ? 'Not changed: ' : ''}${e instanceof Error ? e.message : String(e)}`, true);
      }
    });
    queue = next.catch(() => {});
    return next;
  };

  const names = async () => {
    const cat = await notes.catalog();
    const prot = notes.protectedIds(cat);
    const notebooks = listCatalog(cat, 'notebooks').filter((e) => !prot.has(e.id));
    const tags = listCatalog(cat, 'tags');
    return { cat, notebooks, tags, notebookName: new Map(notebooks.map((e) => [e.id, e.name])), tagName: new Map(tags.map((e) => [e.id, e.name])) };
  };

  // Title lookups over the notes Claude may see.
  const titleLookups = (visible: NoteInfo[]) => {
    const byId = new Map(visible.map((n) => [n.id, n.meta.title || 'Untitled']));
    const resolveTitle = (title: string) => {
      const hits = visible.filter((n) => !n.meta.trashedAt && fold(n.meta.title.trim()) === fold(title.trim()));
      return hits.length ? hits[0].id : null;
    };
    return { linkTitle: (id: string) => byId.get(id) ?? null, resolveTitle };
  };

  type Names = Awaited<ReturnType<typeof names>>;
  const describe = (n: NoteInfo, names: Names) => {
    const parts = [`id: ${n.id}`, `edited ${formatTime(n.updatedAt)}`];
    const nb = n.meta.notebooks.map((id) => names.notebookName.get(id)).filter(Boolean);
    const tg = n.meta.tags.map((id) => names.tagName.get(id)).filter(Boolean);
    if (nb.length) parts.push(`notebooks: ${nb.join(', ')}`);
    if (tg.length) parts.push(`tags: ${tg.map((t) => `#${t}`).join(' ')}`);
    for (const flag of ['pinned', 'favorite', 'archived', 'published'] as const) if (n.meta[flag]) parts.push(flag);
    if (n.meta.trashedAt) parts.push('in trash');
    return parts.join(' · ');
  };

  // A note that may be changed (not in the trash, not read-only).
  const editable = async (id: string) => {
    const note = await notes.open(id);
    if (note.meta.trashedAt) throw new Error('The note is in the trash; restore it in the app first.');
    if (getNoteFlag(note.doc, 'readOnly')) throw new Error('The note is read-only (note properties in the app).');
    return { ...note, before: notes.snapshot(note.doc) };
  };

  const saved = async (id: string, doc: Y.Doc, action: string, before: ReturnType<Notes['snapshot']> | null, what: string) => {
    const warning = await notes.write(id, doc, action, before);
    return text(`${what}${warning ? `\n(Saved locally; sync: ${warning})` : ''}`);
  };

  // ---- reading ----

  server.registerTool('list_notes', {
    title: 'List / search notes',
    description: 'Lists notes, newest edit first. `query` searches titles and text (accents and case ignored); notebook / tag filter by name.',
    inputSchema: {
      query: z.string().optional(),
      notebook: z.string().optional(),
      tag: z.string().optional(),
      include_archived: z.boolean().optional(),
      include_trash: z.boolean().optional(),
      limit: z.number().int().min(1).max(200).optional(),
    },
  }, (args) => run(async () => {
    const n = await names();
    let list = await notes.list();
    if (!args.include_trash) list = list.filter((x) => !x.meta.trashedAt);
    if (!args.include_archived) list = list.filter((x) => !x.meta.archived);
    if (args.notebook) {
      const nb = n.notebooks.find((e) => fold(e.name) === fold(args.notebook!));
      if (!nb) return text(`No notebook "${args.notebook}". Notebooks: ${n.notebooks.map((e) => e.name).join(', ') || 'none'}.`, true);
      list = list.filter((x) => x.meta.notebooks.includes(nb.id));
    }
    if (args.tag) {
      const tg = n.tags.find((e) => fold(e.name) === fold(args.tag!.replace(/^#/, '')));
      if (!tg) return text(`No tag "${args.tag}".`, true);
      list = list.filter((x) => x.meta.tags.includes(tg.id));
    }
    const snippets = new Map<string, string>();
    if (args.query?.trim()) {
      const q = fold(args.query.trim());
      const inTitle: NoteInfo[] = [];
      const inText: NoteInfo[] = [];
      for (const x of list) {
        if (fold(x.meta.title).includes(q)) {
          inTitle.push(x);
          continue;
        }
        const body = noteBodyText(noteBodyJson((await notes.open(x.id)).doc));
        const at = fold(body).indexOf(q);
        if (at >= 0) {
          inText.push(x);
          snippets.set(x.id, body.slice(Math.max(0, at - 60), at + q.length + 60).replace(/\s+/g, ' ').trim());
        }
      }
      list = [...inTitle, ...inText];
    }
    const limit = args.limit ?? 30;
    if (!list.length) return text('No notes found.');
    const lines = list.slice(0, limit).map((x) => {
      const excerpt = snippets.get(x.id) ?? x.meta.excerpt.slice(0, 120);
      return `- ${x.meta.title || 'Untitled'} (${describe(x, n)})${excerpt ? `\n  ${snippets.has(x.id) ? '…' : ''}${excerpt}${snippets.has(x.id) ? '…' : ''}` : ''}`;
    });
    return text(`${list.length} note(s)${list.length > limit ? `, first ${limit}` : ''}:\n${lines.join('\n')}`);
  }));

  server.registerTool('read_note', {
    title: 'Read a note',
    description: 'A note as Markdown with its properties. images: true also shows its images and drawings (as pictures, after the text).',
    inputSchema: { id: z.string(), images: z.boolean().optional() },
  }, (args) => run(async () => {
    const n = await names();
    const visible = await notes.list();
    const { doc, meta, updatedAt } = await notes.open(args.id);
    const view = renderBody(noteBodyJson(doc), titleLookups(visible).linkTitle);
    const head = [`# ${meta.title || 'Untitled'}`, `(${describe({ id: args.id, meta, updatedAt }, n)}${getNoteFlag(doc, 'readOnly') ? ' · read-only' : ''})`].join('\n');
    const result: Result = { content: [{ type: 'text', text: `${head}\n\n${view.markdown || '(empty)'}` }] };
    if (args.images) {
      for (const [name, node] of view.nodes) {
        if (!name.startsWith('image') && !name.startsWith('drawing')) continue;
        const picture = name.startsWith('image') ? await imagePicture(key, blobs, node) : await drawingPicture(node);
        result.content.push({ type: 'text', text: `⟦${name}⟧${typeof picture === 'string' ? `: ${picture}` : ''}` });
        if (typeof picture !== 'string') result.content.push({ type: 'image', ...picture });
      }
    }
    return result;
  }));

  server.registerTool('list_notebooks_tags', {
    title: 'Notebooks and tags',
    description: 'The notebooks and tags with how many notes each has.',
    inputSchema: {},
  }, () => run(async () => {
    const n = await names();
    const list = (await notes.list()).filter((x) => !x.meta.trashedAt);
    const count = (pick: (m: NoteMeta) => string[], id: string) => list.filter((x) => pick(x.meta).includes(id)).length;
    const nb = n.notebooks.map((e) => `- ${e.name} (${count((m) => m.notebooks, e.id)})`);
    const tg = n.tags.map((e) => `- #${e.name} (${count((m) => m.tags, e.id)})`);
    return text(`Notebooks:\n${nb.join('\n') || '(none)'}\n\nTags:\n${tg.join('\n') || '(none)'}`);
  }));

  // ---- writing ----

  // Catalog ids for names (created when missing; protected names refused).
  const catalogIds = async (kind: 'notebooks' | 'tags', wanted: string[]): Promise<string[]> => {
    if (!wanted.length) return [];
    if (kind === 'notebooks' && wanted.some(isProtectedName)) throw new Error('That notebook is not available to Claude.');
    const ids: string[] = [];
    let changed = false;
    await notes.writeCatalog((cat) => {
      for (const name of wanted) {
        const before = listCatalog(cat, kind).length;
        ids.push(ensureCatalogEntry(cat, kind, name.replace(/^#/, ''), () => crypto.randomUUID()).id);
        if (listCatalog(cat, kind).length !== before) changed = true;
      }
    });
    if (changed) await notes.sync(true);
    return ids;
  };

  server.registerTool('create_note', {
    title: 'Create a note',
    description: 'Creates a note from Markdown. Notebooks / tags by name (created when missing).',
    inputSchema: { title: z.string(), markdown: z.string(), notebooks: z.array(z.string()).optional(), tags: z.array(z.string()).optional() },
  }, (args) => run(async () => {
    const { resolveTitle } = titleLookups(await notes.list());
    const blocks = newBlocks(args.markdown, resolveTitle);
    if ('error' in blocks) return text(blocks.error, true);
    const doc = new Y.Doc();
    markNoteCreated(doc);
    setTitle(doc, args.title.trim());
    setNoteBodyJson(doc, { type: 'doc', content: blocks.blocks.length ? blocks.blocks : [{ type: 'paragraph' }] });
    for (const id of await catalogIds('notebooks', args.notebooks ?? [])) setNoteNotebook(doc, id, true);
    for (const id of await catalogIds('tags', args.tags ?? [])) setNoteTag(doc, id, true);
    const id = crypto.randomUUID();
    return saved(id, doc, 'create_note', null, `Created "${args.title.trim()}" (id: ${id}).`);
  }, true));

  server.registerTool('append_to_note', {
    title: 'Add to a note',
    description: 'Adds Markdown to a note: at the end, at the start, or after the block (paragraph, list, ...) containing after_text. Tasks added right after a task list join it.',
    inputSchema: { id: z.string(), markdown: z.string(), after_text: z.string().optional(), at_start: z.boolean().optional() },
  }, (args) => run(async () => {
    const { doc, before } = await editable(args.id);
    const blocks = newBlocks(args.markdown, titleLookups(await notes.list()).resolveTitle);
    if ('error' in blocks) return text(blocks.error, true);
    const fragment = doc.getXmlFragment('default');
    let index = args.at_start ? 0 : fragment.length;
    if (args.after_text) {
      const found = findBlock(doc, args.after_text);
      if ('error' in found) return text(found.error, true);
      index = found.index + 1;
    } else if (!args.at_start && fragment.length) {
      // An empty last line is filled instead of left above the new text.
      const last = fragment.get(fragment.length - 1);
      if (last instanceof Y.XmlElement && last.nodeName === 'paragraph' && !plainText(last) && !last.length) {
        doc.transact(() => fragment.delete(fragment.length - 1, 1));
        index--;
      }
    }
    insertBlocks(doc, index, blocks.blocks);
    return saved(args.id, doc, 'append_to_note', before, 'Added.');
  }, true));

  server.registerTool('replace_text', {
    title: 'Replace text in a note',
    description: 'Replaces text inside one line of a note, keeping its formatting. `find` must occur once unless all: true.',
    inputSchema: { id: z.string(), find: z.string(), replace: z.string(), all: z.boolean().optional() },
  }, (args) => run(async () => {
    const { doc, before } = await editable(args.id);
    const result = replaceText(doc, args.find, args.replace, args.all);
    if ('error' in result) return text(result.error, true);
    return saved(args.id, doc, 'replace_text', before, `Replaced ${result.count}×.`);
  }, true));

  server.registerTool('set_task_done', {
    title: 'Tick a task',
    description: 'Ticks (or unticks, done: false) the task whose text contains `task`.',
    inputSchema: { id: z.string(), task: z.string(), done: z.boolean().optional() },
  }, (args) => run(async () => {
    const { doc, before } = await editable(args.id);
    const result = setTaskDone(doc, args.task, args.done ?? true);
    if ('error' in result) return text(result.error, true);
    return saved(args.id, doc, 'set_task_done', before, args.done === false ? 'Unticked.' : 'Ticked.');
  }, true));

  server.registerTool('rewrite_note', {
    title: 'Rewrite a note',
    description: 'Replaces the whole body with Markdown (use the Markdown and tokens from read_note). Every ⟦image/drawing/file/reminder⟧ token must stay unless listed in `remove` (e.g. ["drawing 1"]). Unchanged blocks keep their exact formatting.',
    inputSchema: { id: z.string(), markdown: z.string(), remove: z.array(z.string()).optional() },
  }, (args) => run(async () => {
    const { doc, before } = await editable(args.id);
    const lookups = titleLookups(await notes.list());
    const view = renderBody(noteBodyJson(doc), lookups.linkTitle);
    const remove = (args.remove ?? []).map((r) => r.replace(/[⟦⟧]/g, '').split(':')[0].trim());
    const parsed = parseRewrite(view, args.markdown.replace(/^# .*\n+/, (line) => (line.slice(2).trim() === (before.title || 'Untitled') ? '' : line)), lookups.resolveTitle, remove);
    if ('error' in parsed) return text(parsed.error, true);
    applyRewrite(doc, parsed.items, view.blocks.map((b) => b.json));
    const kept = parsed.items.filter((i) => 'keep' in i).length;
    return saved(args.id, doc, 'rewrite_note', before, `Rewritten (${kept} of ${parsed.items.length} blocks unchanged).`);
  }, true));

  server.registerTool('update_note_properties', {
    title: 'Change note properties',
    description: 'Title, notebooks / tags (by name, created when missing), pinned, favorite, archived.',
    inputSchema: {
      id: z.string(),
      title: z.string().optional(),
      add_notebooks: z.array(z.string()).optional(),
      remove_notebooks: z.array(z.string()).optional(),
      add_tags: z.array(z.string()).optional(),
      remove_tags: z.array(z.string()).optional(),
      pinned: z.boolean().optional(),
      favorite: z.boolean().optional(),
      archived: z.boolean().optional(),
    },
  }, (args) => run(async () => {
    const { doc, before } = await editable(args.id);
    const n = await names();
    if (args.title !== undefined) setTitle(doc, args.title.trim());
    for (const id of await catalogIds('notebooks', args.add_notebooks ?? [])) setNoteNotebook(doc, id, true);
    for (const id of await catalogIds('tags', args.add_tags ?? [])) setNoteTag(doc, id, true);
    for (const name of args.remove_notebooks ?? []) {
      const e = n.notebooks.find((x) => fold(x.name) === fold(name));
      if (e && getNoteNotebooks(doc).includes(e.id)) setNoteNotebook(doc, e.id, false);
    }
    for (const name of args.remove_tags ?? []) {
      const e = n.tags.find((x) => fold(x.name) === fold(name.replace(/^#/, '')));
      if (e && getNoteTags(doc).includes(e.id)) setNoteTag(doc, e.id, false);
    }
    for (const flag of ['pinned', 'favorite', 'archived'] as const) if (args[flag] !== undefined) setNoteFlag(doc, flag, args[flag]!);
    return saved(args.id, doc, 'update_note_properties', before, 'Updated.');
  }, true));

  server.registerTool('undo_last_change', {
    title: 'Undo Claude\'s last change',
    description: 'Puts back a note as it was before your last change (of the given note, or of any). A note you created goes to the trash.',
    inputSchema: { id: z.string().optional() },
  }, (args) => run(async () => {
    const done = await notes.undo(args.id);
    if (!done) return text('Nothing to undo.', true);
    return text(`Undone: ${done.action} of note ${done.id} (${formatTime(done.at)}).`);
  }, true));

  // ---- reminders ----

  const reminderList = async (): Promise<{ entries: ReminderEntry[]; cat: Y.Doc }> => {
    const cat = await notes.catalog();
    const visible = (await notes.list()).filter((x) => !x.meta.trashedAt);
    const entries = reminderEntries(visible.map((x) => ({ id: x.id, title: x.meta.title || 'Untitled', reminders: x.meta.reminders, trashedAt: x.meta.trashedAt })), listOwnReminders(cat));
    return { entries, cat };
  };
  const morning = (cat: Y.Doc) => getSharedEditorPrefs(cat).reminderMorning || '07:00';

  server.registerTool('list_reminders', {
    title: 'List reminders',
    description: 'Reminders (in notes and on their own): overdue, today and upcoming, optionally only the next `days` days, and done ones with include_done. Each has a key for update_reminder.',
    inputSchema: { days: z.number().int().min(1).max(366).optional(), include_done: z.boolean().optional() },
  }, (args) => run(async () => {
    const { entries } = await reminderList();
    const now = new Date();
    const until = args.days ? Date.now() + args.days * 86_400_000 : Infinity;
    const shown = entries
      .filter((e) => (args.include_done || !e.done) && (e.done || reminderDue(e) <= until))
      .sort((a, b) => reminderDue(a) - reminderDue(b));
    if (!shown.length) return text(`No reminders. ${formatNow()}`);
    const lines = shown.map((e) => {
      const status = reminderStatus(e, now);
      const due = reminderDue(e);
      return `- [${status}] ${formatTime(due)}${e.snooze ? ` (snoozed; set for ${formatTime(e.at)})` : ''}${e.repeat ? `, repeats ${repeatLabel(e.repeat).toLowerCase()}` : ''}: ${e.text || '(no text)'}${e.noteTitle ? ` (in note "${e.noteTitle}", id ${e.noteId})` : ''}  key: ${e.key}`;
    });
    return text(`${formatNow()}\n${lines.join('\n')}`);
  }));

  const repeatSchema = z.enum(['daily', 'weekly', 'monthly', 'yearly']).nullable().optional();

  server.registerTool('add_reminder', {
    title: 'Add a reminder',
    description: 'A reminder on its own (text), or a reminder chip in a note: note_id with after_text puts it at the end of the line containing after_text, otherwise a new line "text ⟦reminder⟧" goes at the end of the note. at: "YYYY-MM-DD HH:MM" local time (a date alone = the morning time).',
    inputSchema: { at: z.string(), text: z.string().optional(), repeat: repeatSchema, note_id: z.string().optional(), after_text: z.string().optional() },
  }, (args) => run(async () => {
    const cat = await notes.catalog();
    const at = parseTime(args.at, morning(cat));
    if (at === null) return text(`Cannot read the time "${args.at}"; use YYYY-MM-DD HH:MM.`, true);
    const repeat: ReminderRepeat | null = args.repeat ?? null;
    const id = crypto.randomUUID();
    const when = `${formatTime(at)}${repeat ? `, repeats ${repeatLabel(repeat).toLowerCase()}` : ''}`;
    if (!args.note_id) {
      if (!args.text?.trim()) return text('A reminder on its own needs a text.', true);
      await notes.writeCatalog((doc) => setOwnReminder(doc, { id, text: args.text!.trim(), at, repeat, done: false, created: Date.now() }));
      await notes.sync(true);
      return text(`Reminder set for ${when} (key: own/${id}).`);
    }
    const { doc, before } = await editable(args.note_id);
    const chip: JSONContent = { type: 'reminder', attrs: { id, at, repeat, done: false } };
    if (args.after_text) {
      const lines: Y.XmlElement[] = [];
      const walk = (node: Y.XmlFragment | Y.XmlElement) => node.toArray().forEach((child) => {
        if (!(child instanceof Y.XmlElement)) return;
        if (['paragraph', 'heading'].includes(child.nodeName) && plainText(child).includes(args.after_text!)) lines.push(child);
        walk(child);
      });
      walk(doc.getXmlFragment('default'));
      if (lines.length !== 1) return text(lines.length ? `"${args.after_text}" is in ${lines.length} lines: give more text.` : `No line contains "${args.after_text}".`, true);
      doc.transact(() => {
        const line = lines[0];
        const last = line.length ? line.get(line.length - 1) : null;
        const pad = last instanceof Y.XmlText && !/\s$/.test(last.toString());
        line.insert(line.length, jsonToY([...(pad ? [{ type: 'text', text: ' ' }] : []), chip]));
      });
    } else {
      insertBlocks(doc, doc.getXmlFragment('default').length, [{ type: 'paragraph', content: [...(args.text?.trim() ? [{ type: 'text', text: `${args.text.trim()} ` }] : []), chip] }]);
    }
    return saved(args.note_id, doc, 'add_reminder', before, `Reminder set for ${when} (key: ${args.note_id}/${id}).`);
  }, true));

  server.registerTool('update_reminder', {
    title: 'Change a reminder',
    description: 'By key (from list_reminders): done: true = done (a repeating one moves to its next time), done: false = open again; new at / repeat; snooze_until = due then without moving the series; text (own reminders only).',
    inputSchema: {
      key: z.string(), done: z.boolean().optional(), at: z.string().optional(), repeat: repeatSchema, snooze_until: z.string().optional(), text: z.string().optional(),
    },
  }, (args) => run(async () => {
    const { entries, cat } = await reminderList();
    const entry = entries.find((e) => e.key === args.key);
    if (!entry) return text(`No reminder with key ${args.key} (see list_reminders).`, true);
    let state: ReminderState = { at: entry.at, repeat: entry.repeat, done: entry.done, snooze: entry.snooze ?? null };
    if (args.at) {
      const at = parseTime(args.at, morning(cat));
      if (at === null) return text(`Cannot read the time "${args.at}".`, true);
      state = { ...state, at, snooze: null, done: false };
    }
    if (args.repeat !== undefined) state = { ...state, repeat: isReminderRepeat(args.repeat) ? args.repeat : null };
    if (args.snooze_until) {
      const until = parseTime(args.snooze_until, morning(cat));
      if (until === null) return text(`Cannot read the time "${args.snooze_until}".`, true);
      state = { ...state, snooze: until, done: false };
    }
    if (args.done === true) state = completeReminder(state, Date.now());
    if (args.done === false) state = { ...state, done: false };
    const summary = state.done ? 'Done.' : `Due ${formatTime(reminderDue(state))}${state.repeat ? `, repeats ${repeatLabel(state.repeat).toLowerCase()}` : ''}.`;
    if (!entry.noteId) {
      const own = listOwnReminders(cat).find((r) => r.id === entry.id) as OwnReminder;
      await notes.writeCatalog((doc) => setOwnReminder(doc, { ...own, ...state, text: args.text?.trim() || own.text }));
      await notes.sync(true);
      return text(summary);
    }
    if (args.text) return text('The text of a reminder in a note is its line: change it with replace_text.', true);
    const { doc, before } = await editable(entry.noteId);
    if (!updateReminderInDoc(doc, entry.id, state)) return text('The reminder is not in the note any more.', true);
    return saved(entry.noteId, doc, 'update_reminder', before, summary);
  }, true));

};
