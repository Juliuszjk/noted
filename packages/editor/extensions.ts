import type { Extensions } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Collaboration from '@tiptap/extension-collaboration';
import { Table } from '@tiptap/extension-table';
import { ColoredTableCell, ColoredTableHeader, SizedTableRow } from './table-cells';
import { TableResize, FreshColumnsTableView } from './table-tools';
import { SelectAllKeys } from './select-all';
import { MarkdownPaste } from './markdown-paste';
import { ClipboardText } from './clipboard-text';
import { ListConvert } from './list-convert';
import { NotedCodeBlock } from './code-block';
import { TaskList } from '@tiptap/extension-list';
import { QuietTaskItem } from './task-item';
import { TextStyle, Color, FontSize } from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import TextAlign from '@tiptap/extension-text-align';
import type * as Y from 'yjs';
import { ListStyles } from './list-extensions';
import { CodeBlockIndent } from './code-extensions';
import { Callout } from './callout';
import { NoteLink } from './note-link';
import { BlobImage } from './blob-image';
import { ImageDragging } from './image-drag';
import { Attachment } from './attachment';
import { TextFont } from './fonts';
import { TextIndent } from './indent';
import { NoteSearch } from './search';
import { SymbolLigatures } from './editor-prefs';
import { createMathExtensions } from './math';
import type { MathEditHandler } from './math';
import { Reminder } from './reminder';
import { Drawing, DrawingStroke, DrawingStarter } from './drawing';
import type { ReminderEditHandler } from './reminder';

export interface SchemaExtensionOptions {
  ydoc: Y.Doc;
  placeholder: string;
  // Opens the platform's LaTeX editor (clicked formula or new one from the slash menu).
  // Without it math still renders and the $$...$$ shortcuts still work.
  onEditMath?: MathEditHandler;
  // Opens the platform's reminder picker (clicked chip or "/reminder"). Without it reminder
  // chips still render.
  onEditReminder?: ReminderEditHandler;
}

// The single list of extensions that define the note document schema. Desktop and the
// mobile WebView bundle both build their editor from this function. An editor that does
// not know a node type present in a document can drop that node, and the loss then syncs
// to every device, so never add a node or mark anywhere else.
export const createSchemaExtensions = ({ ydoc, placeholder, onEditMath, onEditReminder }: SchemaExtensionOptions): Extensions => [
  // Yjs provides its own undo/redo. StarterKit also brings headings 1-6, quote, lists,
  // code block, horizontal rule, underline and link.
  // The code block is ours (code-block.ts: colours, language, Copy), same node and attributes.
  StarterKit.configure({ undoRedo: false, link: { openOnClick: false }, codeBlock: false }),
  NotedCodeBlock,
  TextStyle,
  Color,
  // Stored as a px value on the textStyle mark (attribute, not a new mark), e.g. "18px".
  FontSize,
  // Font of selected text: one of three CSS variables (fonts.ts), stored on textStyle.
  TextFont,
  // Colours are stored as CSS variable references from the named palette (see palette.ts).
  Highlight.configure({ multicolor: true }),
  Subscript,
  Superscript,
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  TaskList,
  QuietTaskItem.configure({ nested: true }),
  ListStyles,
  CodeBlockIndent,
  TextIndent,
  Collaboration.configure({ document: ydoc }),
  Placeholder.configure({ placeholder }),
  // Encrypted blob images; base64 `src` is still read for images added before blobs.
  BlobImage.configure({ inline: false, allowBase64: true }),
  ImageDragging,
  Table.configure({ resizable: false, View: FreshColumnsTableView }),
  SizedTableRow,
  ColoredTableHeader,
  ColoredTableCell,
  Callout,
  NoteLink,
  // Reminder chips in the text (reminder.ts).
  Reminder.configure({ onEdit: onEditReminder ?? null }),
  Attachment,
  // Hand drawing block; its strokes are child nodes (drawing.ts).
  Drawing,
  DrawingStroke,
  // A pen stroke on an empty line or under the note starts a drawing there (no schema).
  DrawingStarter,
  ...createMathExtensions(onEditMath),
  // Dragging the lines between columns and rows (mouse and touch; no schema).
  TableResize,
  // Ctrl+A (code block first, then the whole note).
  SelectAllKeys,
  // Text written in Markdown pastes formatted.
  MarkdownPaste,
  // Copied text as plain text: one line per block (no blank lines between list items).
  ClipboardText,
  // List buttons switch a list between bullet / numbered / task (list-convert.ts).
  ListConvert,
  // Find and replace (decorations only, no schema).
  NoteSearch,
  // -> becomes → and the like (Settings > Editor can turn it off).
  SymbolLigatures,
];
