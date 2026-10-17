// Ranking for the note pickers ("[[", "/goto", "/linkto"): titles starting with the query first,
// then titles that contain it, each group alphabetical. Case- and accent-insensitive. With an
// empty query the notes keep the caller's order (the apps pass the most recently edited first).
export interface NoteChoice {
  id: string;
  title: string;
  // Where it is (notebooks, tags, linking note), shown under the title in pickers.
  place?: string;
  // Archived notes are not offered in the pickers (links to them still work).
  archived?: boolean;
}

// NFD strips most accents; "ł" has no decomposition, so it is mapped by hand.
const fold = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/ł/g, 'l').trim();

export const searchNotes = (notes: NoteChoice[], query: string, excludeId: string | null, limit = 8): NoteChoice[] => {
  const q = fold(query);
  const candidates = notes.filter((n) => n.id !== excludeId && !n.archived);
  if (!q) return candidates.slice(0, limit);
  const starts: NoteChoice[] = [];
  const contains: NoteChoice[] = [];
  for (const note of candidates) {
    const title = fold(note.title);
    if (title.startsWith(q)) starts.push(note);
    else if (title.includes(q)) contains.push(note);
  }
  const byTitle = (a: NoteChoice, b: NoteChoice) => a.title.localeCompare(b.title);
  return [...starts.sort(byTitle), ...contains.sort(byTitle)].slice(0, limit);
};

// Whether "Create note" should be offered: any title, also one a note already has (two notes
// may share a name, e.g. "Zakupy" in two notebooks).
export const canCreateNote = (_notes: NoteChoice[], query: string): boolean => fold(query).length > 0;

// An existing note already has exactly this title ("Create another note …").
export const titleTaken = (notes: NoteChoice[], query: string): boolean => {
  const q = fold(query);
  return q.length > 0 && notes.some((n) => fold(n.title) === q);
};
