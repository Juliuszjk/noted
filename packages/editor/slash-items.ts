import type { SlashItem } from './slash';
import { importCsvInto } from './table-actions';
import { CALLOUT_VARIANTS } from './callout';
import { requestMathEdit } from './math';
import { pickImagesInto, pickAttachmentsInto, requestImageUrl } from './blob-image';
import type { MathKind } from './math';
import { requestNoteAction } from './note-actions';
import { requestReminderEdit } from './reminder';
import { mdiBellOutline } from '@mdi/js';

// Slash menu content, shared by every platform that offers a "/" menu. The menu is a tree:
// rows with a `submenu` open a second (or third) panel, rows with a `command` run it.

const headingItems: SlashItem[] = ([1, 2, 3, 4, 5, 6] as const).map((level) => ({
  title: `Heading ${level}`,
  keywords: [`h${level}`],
  preview: { kind: 'heading', level },
  command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode('heading', { level }).run(),
}));

const numberedTile = (title: string, style: string, markers: string[], keywords: string[]): SlashItem => ({
  title,
  keywords,
  preview: { kind: 'markers', markers },
  command: ({ editor, range }) => {
    const chain = editor.chain().focus().deleteRange(range);
    if (!editor.isActive('orderedList')) chain.toggleOrderedList();
    chain.updateAttributes('orderedList', { numberStyle: style === 'decimal' ? null : style }).run();
  },
});

const bulletTile = (title: string, style: string, marker: string, keywords: string[]): SlashItem => ({
  title,
  keywords,
  preview: { kind: 'markers', markers: [marker, marker, marker] },
  command: ({ editor, range }) => {
    const chain = editor.chain().focus().deleteRange(range);
    if (!editor.isActive('bulletList')) chain.toggleBulletList();
    chain.updateAttributes('bulletList', { bulletStyle: style === 'disc' ? null : style }).run();
  },
});

const numberedList: SlashItem = {
  title: 'Numbered list',
  keywords: ['ordered', 'ol', 'roman', 'alpha', 'greek', 'letters'],
  submenu: {
    kind: 'tiles',
    columns: 3,
    items: [
      numberedTile('1, 2, 3', 'decimal', ['1.', '2.', '3.'], ['numbers', 'decimal']),
      numberedTile('A, B, C', 'upper-alpha', ['A.', 'B.', 'C.'], ['letters', 'uppercase']),
      numberedTile('a, b, c', 'lower-alpha', ['a.', 'b.', 'c.'], ['letters', 'lowercase']),
      numberedTile('I, II, III', 'upper-roman', ['I.', 'II.', 'III.'], ['roman', 'uppercase']),
      numberedTile('i, ii, iii', 'lower-roman', ['i.', 'ii.', 'iii.'], ['roman', 'lowercase']),
      numberedTile('α, β, γ', 'lower-greek', ['α.', 'β.', 'γ.'], ['greek']),
    ],
  },
};

const bulletList: SlashItem = {
  title: 'Bullet list',
  keywords: ['unordered', 'ul', 'dots'],
  submenu: {
    kind: 'tiles',
    columns: 4,
    items: [
      bulletTile('Disc', 'disc', '•', ['dot', 'default']),
      bulletTile('Circle', 'circle', '◦', ['open']),
      bulletTile('Square', 'square', '▪', ['filled']),
      bulletTile('Open square', 'square-open', '▫', ['hollow', 'empty']),
    ],
  },
};

const taskList: SlashItem = {
  title: 'Task list',
  keywords: ['todo', 'checklist', 'checkbox'],
  command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleTaskList().run(),
};

const outlineList: SlashItem = {
  title: 'Outline list',
  keywords: ['collapsible', 'fold', 'toggle', 'tree'],
  command: ({ editor, range }) => {
    const chain = editor.chain().focus().deleteRange(range);
    if (!editor.isActive('bulletList')) chain.toggleBulletList();
    chain.updateAttributes('bulletList', { outline: true }).run();
  },
};

const tableItem: SlashItem = {
  title: 'Table',
  keywords: ['grid', 'csv'],
  submenu: { kind: 'table' },
  searchChildren: [
    {
      title: 'Import CSV',
      keywords: ['csv', 'import', 'spreadsheet'],
      command: ({ editor, range }) => importCsvInto(editor, range),
    },
  ],
};

const calloutItem: SlashItem = {
  title: 'Callout',
  keywords: ['admonition', 'alert', 'box', 'highlight block'],
  submenu: {
    kind: 'list',
    items: CALLOUT_VARIANTS.map((variant) => ({
      title: `${variant.label} callout`,
      keywords: [...variant.keywords],
      preview: { kind: 'icon', icon: variant.icon },
      command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setCallout({ variant: variant.name }).run(),
    })),
  },
};

const mathItem = (title: string, kind: MathKind, keywords: string[]): SlashItem => ({
  title,
  keywords,
  preview: { kind: 'icon', icon: kind === 'inline' ? 'x²' : '∑' },
  command: ({ editor, range }) => {
    editor.chain().focus().deleteRange(range).run();
    requestMathEdit(editor, { mode: 'insert', kind, pos: range.from });
  },
});

const mathMenu: SlashItem = {
  title: 'Math',
  keywords: ['latex', 'katex', 'equation', 'formula', 'tex'],
  submenu: {
    kind: 'list',
    items: [
      mathItem('Inline math', 'inline', ['latex', 'equation', 'formula', 'inline']),
      mathItem('Math block', 'block', ['latex', 'equation', 'formula', 'display', 'block']),
    ],
  },
};

// A reminder chip at the cursor; the date picker is platform UI (reminder-picker.ts).
const reminderItem: SlashItem = {
  title: 'Reminder',
  keywords: ['remind', 'alarm', 'due', 'date', 'deadline', 'notification', 'przypomnienie'],
  preview: { kind: 'icon', icon: '', path: mdiBellOutline },
  command: ({ editor, range }) => {
    editor.chain().focus().deleteRange(range).run();
    requestReminderEdit(editor, { mode: 'insert', pos: range.from });
  },
};

// Types "[[" so the note picker (NoteLinkSuggestion) opens.
const noteLinkItem: SlashItem = {
  title: 'Link to note',
  keywords: ['note link', 'wiki', 'reference', 'page', 'backlink', '[['],
  preview: { kind: 'icon', icon: '↗' },
  command: ({ editor, range }) => editor.chain().focus().deleteRange(range).insertContent('[[').run(),
};

const imageItem: SlashItem = {
  title: 'Image',
  keywords: ['picture', 'photo', 'img', 'screenshot'],
  submenu: {
    kind: 'list',
    items: [
      {
        title: 'Upload image',
        keywords: ['picture', 'photo', 'upload', 'disk', 'screenshot'],
        command: ({ editor, range }) => pickImagesInto(editor, range),
      },
      {
        title: 'Image from URL',
        keywords: ['picture', 'link', 'web', 'download', 'url'],
        command: ({ editor, range }) => requestImageUrl(editor, range),
      },
    ],
  },
};

const fileItem: SlashItem = {
  title: 'File',
  keywords: ['attachment', 'attach', 'upload', 'pdf', 'document'],
  command: ({ editor, range }) => pickAttachmentsInto(editor, range),
};

// Put the note into a notebook (category) or tag it; the picker is app UI (NoteActions).
const notebookItem: SlashItem = {
  title: 'Notebook',
  keywords: ['category', 'kategoria', 'folder', 'move', 'notebook'],
  command: ({ editor, range }) => {
    editor.chain().focus().deleteRange(range).run();
    requestNoteAction(editor, { kind: 'notebook', pos: range.from });
  },
};

const tagItem: SlashItem = {
  title: 'Tag',
  keywords: ['tags', 'label', 'hashtag', '#'],
  command: ({ editor, range }) => {
    editor.chain().focus().deleteRange(range).run();
    requestNoteAction(editor, { kind: 'tag', pos: range.from });
  },
};

// Export the note (Markdown, plain text, PDF); the format picker is app UI (NoteActions).
const exportItem: SlashItem = {
  title: 'Export',
  keywords: ['markdown', 'pdf', 'text', 'download', 'save as', 'eksport'],
  command: ({ editor, range }) => {
    editor.chain().focus().deleteRange(range).run();
    requestNoteAction(editor, { kind: 'export', pos: range.from });
  },
};

// Publish the note as a public, read-only page (the dialog is app UI).
const publishItem: SlashItem = {
  title: 'Publish',
  keywords: ['share', 'public', 'link', 'web', 'monograph', 'opublikuj'],
  command: ({ editor, range }) => {
    editor.chain().focus().deleteRange(range).run();
    requestNoteAction(editor, { kind: 'publish', pos: range.from });
  },
};

// Jump to another note (opens it in a new tab); the note picker is app UI.
const gotoItem: SlashItem = {
  title: 'Go to note',
  keywords: ['goto', 'open', 'jump', 'switch', 'find note', 'przejdz'],
  preview: { kind: 'icon', icon: '→' },
  command: ({ editor, range }) => {
    editor.chain().focus().deleteRange(range).run();
    requestNoteAction(editor, { kind: 'goto', pos: range.from });
  },
};

// The reverse of "Link to note": puts a link to THIS note at the end of a picked note.
const linkToItem: SlashItem = {
  title: 'Link from another note',
  keywords: ['linkto', 'link to', 'backlink', 'add to note', 'parent'],
  preview: { kind: 'icon', icon: '↙' },
  command: ({ editor, range }) => {
    editor.chain().focus().deleteRange(range).run();
    requestNoteAction(editor, { kind: 'linkto', pos: range.from });
  },
};

export const slashItems: SlashItem[] = [
  { title: 'Heading', keywords: ['title', 'header'], submenu: { kind: 'list', items: headingItems } },
  {
    title: 'Quote',
    keywords: ['blockquote', 'citation'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
  {
    title: 'List',
    keywords: ['bullet', 'numbered', 'todo', 'task', 'checklist', 'outline'],
    submenu: { kind: 'list', items: [bulletList, numberedList, taskList, outlineList] },
  },
  {
    title: 'Divider',
    keywords: ['horizontal rule', 'hr', 'line', 'separator'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
  {
    title: 'Code block',
    keywords: ['code', 'snippet', 'pre'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setCodeBlock().run(),
  },
  tableItem,
  imageItem,
  fileItem,
  calloutItem,
  mathMenu,
  reminderItem,
  noteLinkItem,
  linkToItem,
  gotoItem,
  notebookItem,
  tagItem,
  exportItem,
  publishItem,
];
