import type { Editor } from '@tiptap/core';
import { parseCsv, csvToTableJson } from './csv';
import { openFoldForInsert } from './heading-fold';

type Range = { from: number; to: number };

export const insertTableAt = (editor: Editor, range: Range, cols: number, rows: number): void => {
  const at = openFoldForInsert(editor, range);
  editor.chain().focus().deleteRange(at).insertTable({ rows, cols, withHeaderRow: true }).run();
};

// Removes the "/" text, then asks for a CSV file and inserts it as a table at the cursor.
export const importCsvInto = (editor: Editor, range: Range): void => {
  editor.chain().focus().deleteRange(range).run();

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.csv,.tsv,text/csv,text/tab-separated-values,text/plain';
  input.style.display = 'none';
  const cleanup = () => input.remove();

  input.addEventListener('cancel', cleanup);
  input.addEventListener('change', async () => {
    try {
      const file = input.files?.[0];
      if (!file) return;
      const table = csvToTableJson(parseCsv(await file.text()));
      const at = openFoldForInsert(editor, { from: editor.state.selection.from, to: editor.state.selection.from });
      editor.chain().focus().insertContentAt(at, table).run();
    } catch (error) {
      console.error('CSV import failed:', error);
    } finally {
      cleanup();
    }
  });

  document.body.appendChild(input);
  input.click();
};
