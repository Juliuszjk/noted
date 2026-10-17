import { describe, it, expect } from 'vitest';
import { parseCsv, csvToTableJson } from './csv';

describe('parseCsv', () => {
  it('parses plain rows', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
  });
  it('handles quotes, escaped quotes and newlines inside quotes', () => {
    expect(parseCsv('"a,b","he said ""hi""","x\ny"')).toEqual([['a,b', 'he said "hi"', 'x\ny']]);
  });
  it('detects semicolon and tab delimiters', () => {
    expect(parseCsv('a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']]);
  });
  it('handles CRLF, BOM and trailing blank lines', () => {
    expect(parseCsv('\uFEFFa,b\r\n1,2\r\n\r\n')).toEqual([['a', 'b'], ['1', '2']]);
  });
  it('pads ragged rows', () => {
    expect(parseCsv('a,b,c\n1')).toEqual([['a', 'b', 'c'], ['1', '', '']]);
  });
});

describe('csvToTableJson', () => {
  it('uses the first row as header and keeps empty cells', () => {
    const table = csvToTableJson([['a', 'b'], ['1', '']]) as any;
    expect(table.type).toBe('table');
    expect(table.content[0].content[0].type).toBe('tableHeader');
    expect(table.content[1].content[0].type).toBe('tableCell');
    expect(table.content[1].content[1].content[0]).toEqual({ type: 'paragraph' });
  });
  it('rejects empty and oversized input', () => {
    expect(() => csvToTableJson([])).toThrow();
    expect(() => csvToTableJson(Array.from({ length: 1001 }, () => ['x']))).toThrow();
  });
});
