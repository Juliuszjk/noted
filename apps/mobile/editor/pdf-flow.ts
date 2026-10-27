import type { Editor } from '@tiptap/core';
import { noteFlow } from '@noted/editor/pdf-sheets';

// "/pdf" and Export > PDF on the phone: the note's flow (pdf-sheets.ts) goes to the PDF page
// (editor/pdf.ts in src/PdfPane.tsx), which lays it out without this WebView's text zoom (it
// follows the system font size and broke the pages elsewhere than the computer's). Pictures
// go once each as data; while the preview is open the flow follows every change.

const REBUILD_MS = 900;

export interface PdfFlowContext {
  editor: Editor;
  title: () => string;
  noteFont: () => string | null;
  post: (msg: Record<string, unknown>) => void;
  // A picture's object URL as data the other page can load.
  toDataUrl: (src: string) => Promise<string>;
}

export const createPdfFlow = (ctx: PdfFlowContext) => {
  // Pictures the PDF page holds already (it forgets them when it is made again: `reset`).
  let sent = new Set<string>();
  let open = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const send = async (request: { save?: boolean; share?: boolean } = {}) => {
    const title = ctx.title();
    const flow = noteFlow(ctx.editor, title, ctx.noteFont());
    const pictures: Record<string, string> = {};
    for (const img of flow.querySelectorAll('img')) {
      const src = img.getAttribute('src') ?? '';
      if (!src.startsWith('blob:') || sent.has(src)) continue;
      pictures[src] = await ctx.toDataUrl(src).catch(() => '');
      sent.add(src);
    }
    ctx.post({ type: 'pdfFlow', html: flow.outerHTML, pictures, title, ...request });
  };
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { if (open) send().catch(() => {}); }, REBUILD_MS);
  };
  const report = (err: unknown) => ctx.post({ type: 'log', message: `PDF failed: ${err instanceof Error ? err.message : String(err)}` });

  return {
    send: (request: { save?: boolean; share?: boolean }) => send(request).catch(report),
    // React Native opened / closed the preview (or made the PDF page again).
    setPane: (on: boolean, reset: boolean) => {
      if (reset) sent = new Set();
      if (on && !open) {
        ctx.editor.on('update', later);
        // Pictures decrypted after the note opened change the layout too.
        ctx.editor.view.dom.addEventListener('load', later, true);
      } else if (!on && open) {
        clearTimeout(timer);
        ctx.editor.off('update', later);
        ctx.editor.view.dom.removeEventListener('load', later, true);
      }
      open = on;
      if (on) send().catch(report);
    },
  };
};
