import { sheetsDocument, sheetsFromFlow, SHEET_HEIGHT, SHEET_WIDTH } from '@noted/editor/pdf-sheets';

// The phone's PDF page (src/PdfPane.tsx): the note on A4 sheets, laid out here, in a WebView
// without text zoom. The editor's WebView follows the system font size, which scales the type
// but not the spacing measured in em: pages laid out there broke elsewhere than the computer's.
// The editor page sends the note's flow (pdf-sheets.ts noteFlow) as HTML, pictures once each
// as data URLs; this page shows the sheets and makes the page React Native prints.

const GAP = 10;
const post = (msg: Record<string, unknown>) => (window as any).ReactNativeWebView?.postMessage(JSON.stringify(msg));
const list = document.getElementById('list') as HTMLElement;
// Picture address in the editor page -> its data.
const pictures = new Map<string, string>();
let sheets: HTMLElement[] = [];
let title = '';
let generation = 0;

const show = () => {
  const scale = (window.innerWidth - 2 * GAP) / SHEET_WIDTH;
  const scrollY = window.scrollY;
  list.replaceChildren(...sheets.map((sheet) => {
    const frame = document.createElement('div');
    frame.className = 'pdf-frame';
    frame.style.width = `${SHEET_WIDTH * scale}px`;
    frame.style.height = `${SHEET_HEIGHT * scale}px`;
    sheet.style.transform = `scale(${scale})`;
    sheet.style.transformOrigin = '0 0';
    frame.append(sheet);
    return frame;
  }));
  window.scrollTo(0, scrollY);
};
window.addEventListener('resize', show);

const pdf = async () => post({ type: 'pdf', html: await sheetsDocument(sheets, title, async (src) => src) });

const build = async (html: string, save: boolean) => {
  const mine = ++generation;
  const holder = document.createElement('div');
  holder.innerHTML = html;
  const flow = holder.firstElementChild as HTMLElement;
  flow.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src') ?? '';
    const data = pictures.get(src);
    if (data) img.setAttribute('src', data);
    else if (src.startsWith('blob:')) img.removeAttribute('src');
  });
  const next = await sheetsFromFlow(flow);
  if (mine !== generation) return;
  sheets = next;
  show();
  post({ type: 'pages', count: sheets.length });
  if (save) await pdf();
};

(window as any).__noted = {
  receive(raw: string) {
    const msg = JSON.parse(raw);
    if (msg.type === 'flow') {
      for (const [src, data] of Object.entries((msg.pictures ?? {}) as Record<string, string>)) pictures.set(src, data);
      title = String(msg.title ?? '');
      build(String(msg.html), !!msg.save).catch((err) => post({ type: 'log', message: `PDF failed: ${err instanceof Error ? err.message : String(err)}` }));
    } else if (msg.type === 'save') {
      if (sheets.length) pdf().catch((err) => post({ type: 'log', message: `PDF failed: ${err instanceof Error ? err.message : String(err)}` }));
    }
  },
};
post({ type: 'ready' });
