import type { Schema } from '@tiptap/pm/model';
import * as Y from 'yjs';

// Parts of a note's body this editor's schema does not know: nodes, node attributes, marks
// and mark attributes made by a newer Noted. An editor that does not know them drops them
// and, after an edit, writes the note back without them (the loss syncs everywhere). A
// client that may lag behind the note's other devices (the live note page served by an
// older server) checks this and stays read only when anything comes back.
// Names as "node", "node.attr", "mark" or "mark.attr", each once.
export const unknownSchemaParts = (fragment: Y.XmlFragment, schema: Schema): string[] => {
  const found = new Set<string>();
  const checkMarks = (text: Y.XmlText) => {
    for (const op of text.toDelta() as { attributes?: Record<string, unknown> }[]) {
      for (const [key, value] of Object.entries(op.attributes ?? {})) {
        // y-prosemirror names marks that may overlap "<mark>--<hash>".
        const name = key.split('--')[0];
        const type = schema.marks[name];
        if (!type) {
          found.add(name);
          continue;
        }
        if (value && typeof value === 'object') {
          const known = type.spec.attrs ?? {};
          for (const attr of Object.keys(value)) if (!(attr in known)) found.add(`${name}.${attr}`);
        }
      }
    }
  };
  const walk = (parent: Y.XmlFragment | Y.XmlElement) => {
    for (const child of parent.toArray()) {
      if (child instanceof Y.XmlText) {
        checkMarks(child);
      } else if (child instanceof Y.XmlElement) {
        const type = schema.nodes[child.nodeName];
        if (!type) found.add(child.nodeName);
        else {
          for (const attr of Object.keys(child.getAttributes())) {
            // y-prosemirror's own attribute (change tracking).
            if (attr !== 'ychange' && !(attr in (type.spec.attrs ?? {}))) found.add(`${child.nodeName}.${attr}`);
          }
        }
        walk(child);
      }
    }
  };
  walk(fragment);
  return [...found];
};
