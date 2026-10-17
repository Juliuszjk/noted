import type { Editor } from '@tiptap/core';
import { parseCsv, csvToTableJson } from './csv';

type Range = { from: number; to: number };

export const insertTableAt = (editor: Editor, range: Range, cols: number, rows: number): void => {
  editor.chain().focus().deleteRange(range).insertTable({ rows, cols, withHeaderRow: true }).run();
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
      editor.chain().focus().insertContent(table).run();
    } catch (error) {
      console.error('CSV import failed:', error);
    } finally {
      cleanup();
    }
  });

  document.body.appendChild(input);
  input.click();
};
