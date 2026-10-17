// Minimal CSV reader for the "Import CSV" table action.

export const CSV_MAX_ROWS = 1000;
export const CSV_MAX_COLS = 50;

// Picks the delimiter that occurs most often (outside quotes) in the first line.
const detectDelimiter = (text: string): string => {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  let best = ',';
  let bestCount = 0;
  for (const candidate of [',', ';', '\t']) {
    let count = 0;
    let inQuotes = false;
    for (const ch of firstLine) {
      if (ch === '"') inQuotes = !inQuotes;
      else if (!inQuotes && ch === candidate) count++;
    }
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
};

// RFC 4180 style parsing: quoted cells, doubled quotes, newlines inside quotes, CRLF.
// Rows are padded to the widest row; fully empty rows are dropped.
export const parseCsv = (input: string): string[][] => {
  const text = input.replace(/^\uFEFF/, '');
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"' && cell === '') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ''));
  const width = nonEmpty.reduce((max, r) => Math.max(max, r.length), 0);
  return nonEmpty.map((r) => [...r, ...Array<string>(width - r.length).fill('')]);
};

// Builds a Tiptap table node (first row becomes the header row).
export const csvToTableJson = (rows: string[][]): Record<string, unknown> => {
  if (rows.length === 0) throw new Error('The CSV file is empty.');
  if (rows.length > CSV_MAX_ROWS || rows[0].length > CSV_MAX_COLS) {
    throw new Error(`CSV too large (max ${CSV_MAX_ROWS} rows x ${CSV_MAX_COLS} columns).`);
  }
  return {
    type: 'table',
    content: rows.map((row, rowIndex) => ({
      type: 'tableRow',
      content: row.map((cell) => ({
        type: rowIndex === 0 ? 'tableHeader' : 'tableCell',
        content: [cell === '' ? { type: 'paragraph' } : { type: 'paragraph', content: [{ type: 'text', text: cell }] }],
      })),
    })),
  };
};
