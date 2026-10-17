// Word-level difference of two HTML documents produced by the editor (getHTML), for the note
// history. The new document's structure is kept; added words are wrapped in <ins>, removed
// words (placed where they were) in <del>. Tags of removed blocks are dropped, so the result
// is always well formed. Same idea as the "htmldiff" algorithm Notesnook uses.

type Op = { kind: 'equal' | 'insert' | 'delete'; token: string };

// Above this many cells the middle part is compared as a whole (removed, then added).
const MAX_CELLS = 4_000_000;

const TOKEN = /<[^>]*>|\s+|[\p{L}\p{N}_]+|[^\s<]/gu;

export const tokenizeHtml = (html: string): string[] => html.match(TOKEN) ?? [];

const isTag = (token: string) => token.startsWith('<');

// Images in an old version never load anything from outside (privacy, same as the editor).
const safeTag = (tag: string) => (/^<img\b/i.test(tag) ? tag.replace(/\s(src|srcset)="[^"]*"/gi, '') : tag);

export function diffTokens(a: string[], b: string[]): Op[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const ops: Op[] = a.slice(0, start).map((token) => ({ kind: 'equal' as const, token }));
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const n = midA.length;
  const m = midB.length;
  if (n * m > MAX_CELLS) {
    ops.push(...midA.map((token) => ({ kind: 'delete' as const, token })), ...midB.map((token) => ({ kind: 'insert' as const, token })));
  } else if (n || m) {
    // Longest common subsequence table, filled from the end.
    const width = m + 1;
    const lcs = new Uint32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i * width + j] = midA[i] === midB[j] ? lcs[(i + 1) * width + j + 1] + 1 : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && midA[i] === midB[j]) {
        ops.push({ kind: 'equal', token: midA[i] });
        i++;
        j++;
      } else if (i < n && (j >= m || lcs[(i + 1) * width + j] >= lcs[i * width + j + 1])) {
        // Removed words come before the words that replaced them.
        ops.push({ kind: 'delete', token: midA[i] });
        i++;
      } else {
        ops.push({ kind: 'insert', token: midB[j] });
        j++;
      }
    }
  }
  ops.push(...a.slice(endA).map((token) => ({ kind: 'equal' as const, token })));
  return ops;
}

export function diffHtml(oldHtml: string, newHtml: string): string {
  const ops = diffTokens(tokenizeHtml(oldHtml), tokenizeHtml(newHtml));
  let out = '';
  let open: 'ins' | 'del' | null = null;
  const close = () => {
    if (open) out += `</${open}>`;
    open = null;
  };
  for (const op of ops) {
    if (isTag(op.token)) {
      // Structure comes from the new version: removed tags are dropped.
      if (op.kind === 'delete') continue;
      close();
      out += safeTag(op.token);
      continue;
    }
    const wrap = op.kind === 'insert' ? 'ins' : op.kind === 'delete' ? 'del' : null;
    // Spaces between two changed words stay inside the mark.
    if (wrap !== open && !(open && /^\s+$/.test(op.token) && op.kind === 'equal')) {
      close();
      if (wrap) {
        out += `<${wrap}>`;
        open = wrap;
      }
    }
    out += op.token;
  }
  close();
  return out.replace(/ <\/(ins|del)>/g, '</$1> ');
}
