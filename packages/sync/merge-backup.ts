import * as Y from 'yjs';

type Parent = Y.XmlFragment | Y.XmlElement;
type Child = Y.XmlElement | Y.XmlText;

// Merges the backup into `current` (CRDT), then brings back blocks of the body (paragraphs,
// images, list items, ...) that the backup had and that were deleted since, at their old
// place: a CRDT merge alone keeps deletions. Text deleted inside a block that still exists
// stays deleted (else every edit would show the old and the new words side by side). A block
// equal to one next to it is not added again, so merging the same backup twice changes
// nothing. Returns whether a block came back.
export const mergeWithBackup = (current: Y.Doc, backup: Y.Doc): boolean => {
  Y.applyUpdate(current, Y.encodeStateAsUpdate(backup));
  const deleted = Y.createDeleteSetFromStructStore(current.store);
  const key = (id: Y.ID) => `${id.client}:${id.clock}`;
  // The current note's blocks by their id.
  const byId = new Map<string, Child>();
  const index = (type: Y.AbstractType<any>) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    for (let n = type._start; n; n = n.right) {
      if (n.deleted || !(n.content instanceof Y.ContentType)) continue;
      byId.set(key(n.id), n.content.type as Child);
      index(n.content.type);
    }
  };
  index(current.getXmlFragment('default'));
  let changed = false;
  const visit = (from: Y.AbstractType<any>, into: Parent) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    // The block (in the current note) after which the next one goes.
    let left: Child | null = null;
    for (let n = from._start; n; n = n.right) {
      if (n.deleted || !(n.content instanceof Y.ContentType)) continue;
      const block = n.content.type as Child;
      if (!Y.isDeleted(deleted, n.id)) {
        const here = byId.get(key(n.id));
        if (here) {
          left = here;
          if (here instanceof Y.XmlElement) visit(block, here);
        }
        continue;
      }
      const siblings = into.toArray() as Child[];
      const at: number = left ? siblings.indexOf(left) + 1 : 0;
      const same: Child | undefined = [siblings[at - 1], siblings[at]].find((s) => s && s.toString() === block.toString());
      if (same) { left = same; continue; }
      const copy = block.clone();
      into.insert(at, [copy]);
      left = copy;
      changed = true;
    }
  };
  current.transact(() => visit(backup.getXmlFragment('default'), current.getXmlFragment('default')));
  return changed;
};
