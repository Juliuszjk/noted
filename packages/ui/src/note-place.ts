// "Where is this note": a short line under a title in the note pickers, so notes with the
// same title ("Lab1" in several notebooks) can be told apart. No DOM, shared with the phone.
import { relativeTime } from './note-list';

export interface PlaceNote {
  id: string;
  title: string;
  notebooks?: string[];
  tags?: string[];
  links?: string[];
  archived?: boolean;
  updatedAt?: number;
}

export interface PlaceNames {
  notebooks: Map<string, string>;
  tags: Map<string, string>;
}

// id -> "Studia, Fizyka · from Semestr 3 · 2d" (no tags: too long for the pickers). Parents = notes linking to it.
export const notePlaces = (notes: PlaceNote[], names: PlaceNames, now = Date.now()): Record<string, string> => {
  const parents = new Map<string, string[]>();
  for (const n of notes) {
    for (const target of new Set(n.links ?? [])) {
      if (target === n.id) continue;
      const list = parents.get(target) ?? [];
      list.push(n.title);
      parents.set(target, list);
    }
  }
  const out: Record<string, string> = {};
  for (const n of notes) {
    const parts: string[] = [];
    const books = (n.notebooks ?? []).map((id) => names.notebooks.get(id)).filter((s): s is string => !!s);
    parts.push(books.length ? books.sort((a, b) => a.localeCompare(b)).join(', ') : 'No notebook');
    const from = (parents.get(n.id) ?? []).sort((a, b) => a.localeCompare(b));
    if (from.length) parts.push(`from ${from[0]}${from.length > 1 ? ` +${from.length - 1}` : ''}`);
    if (n.archived) parts.push('Archived');
    if (n.updatedAt) parts.push(relativeTime(n.updatedAt, now));
    out[n.id] = parts.join(' · ');
  }
  return out;
};
