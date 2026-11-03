// Archived notebooks (desktop sidebar and the phone's drawer): a notebook whose notes are all
// archived is hidden from the notebook tree. Derived from the note metas only, nothing synced.
import type { NoteListItem, NoteView } from './note-list';

interface TreeNode { id: string; parent?: string | null }

// Notebooks hidden as archived: no live note (not archived, not trashed) of their own, every
// sub-notebook hidden too, and at least one archived note or sub-notebook. A notebook with no
// notes at all (a new one) stays, and so does a parent of one. Trashed notes do not count.
export const archivedNotebooks = (tree: TreeNode[], items: NoteListItem[]): Set<string> => {
  const own = new Map<string, { live: number; archived: number }>();
  for (const n of items) {
    if (n.trashedAt) continue;
    for (const id of n.notebooks ?? []) {
      const c = own.get(id) ?? { live: 0, archived: 0 };
      if (n.archived) c.archived++; else c.live++;
      own.set(id, c);
    }
  }
  const children = new Map<string, string[]>();
  for (const n of tree) if (n.parent) children.set(n.parent, [...(children.get(n.parent) ?? []), n.id]);
  const hidden = new Set<string>();
  const seen = new Set<string>();
  const visit = (id: string): boolean => {
    if (seen.has(id)) return hidden.has(id);
    seen.add(id);
    const kids = children.get(id) ?? [];
    const kidsHidden = kids.map(visit).every(Boolean);
    const c = own.get(id) ?? { live: 0, archived: 0 };
    const out = c.live === 0 && kidsHidden && (c.archived > 0 || kids.length > 0);
    if (out) hidden.add(id);
    return out;
  };
  tree.forEach((n) => visit(n.id));
  return hidden;
};

// The notebooks the tree shows: all of them in the Archive view, and while one of the hidden
// ones is open (reached from the Archive view); otherwise the hidden ones are left out.
export const visibleNotebooks = <T extends { id: string }>(tree: T[], hidden: ReadonlySet<string>, view: NoteView): T[] =>
  view.kind === 'archive' || (view.kind === 'notebook' && hidden.has(view.id)) ? tree : tree.filter((n) => !hidden.has(n.id));

// "Archive notebook" / "Unarchive notebook": the notes in these notebooks (a notebook and its
// sub-notebooks) that would change. Trashed notes are left alone.
export const notebookArchiveTargets = (items: NoteListItem[], notebookIds: ReadonlySet<string>, on: boolean): string[] =>
  items
    .filter((n) => !n.trashedAt && !!n.archived !== on && (n.notebooks ?? []).some((id) => notebookIds.has(id)))
    .map((n) => n.id);
