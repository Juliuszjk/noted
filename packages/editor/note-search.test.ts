import { describe, it, expect } from 'vitest';
import { searchNotes, canCreateNote } from './note-search';

const notes = [
  { id: '1', title: 'Zakupy' },
  { id: '2', title: 'Plan wakacji' },
  { id: '3', title: 'Wakacje 2027' },
  { id: '4', title: 'Żółw' },
];

describe('note search', () => {
  it('puts prefix matches before inner matches', () => {
    expect(searchNotes(notes, 'wak', null).map((n) => n.id)).toEqual(['3', '2']);
  });
  it('ignores case and accents and skips the current note', () => {
    expect(searchNotes(notes, 'zolw', null).map((n) => n.id)).toEqual(['4']);
    expect(searchNotes(notes, '', '1').map((n) => n.id)).toEqual(['2', '3', '4']);
  });
  it('keeps the given (most recent first) order for an empty query', () => {
    const recent = [notes[3], notes[0], notes[2], notes[1]];
    expect(searchNotes(recent, '', null, 3).map((n) => n.id)).toEqual(['4', '1', '3']);
  });
  it('offers creating a note only for a new title', () => {
    expect(canCreateNote(notes, 'zakupy')).toBe(true);
    expect(canCreateNote(notes, '  ')).toBe(false);
    expect(canCreateNote(notes, 'Zakupy na jutro')).toBe(true);
    expect(canCreateNote(notes, '  ')).toBe(false);
  });
});
