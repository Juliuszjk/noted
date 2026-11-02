// Test notes. No personal data, and no external addresses except where a test needs one.

const filler = (name: string, count: number) =>
  Array.from({ length: count }, (_, i) => `<p>${name} paragraph ${i + 1}: the quick brown fox jumps over the lazy dog and keeps on running along the river bank until the evening comes.</p>`).join('');

// Near the width of a line on paper (A4 text width, Inter 700 at the H1 size): the double spaces
// make it wrap, with single spaces it fits one line. A collapsed double space (the phone's PDF
// page before 7a6e88f) would give a different line count, then different pages.
const WRAP_HEADING = 'The~~notes~~of~~a~~year~~in~~the~~life~~of~~a~~release';
const WRAP_HEADING_2 = 'Numbers,~~plans~~and~~the~~open~~questions~~of~~autumn~~planning~~in~~the~~team';

export const FIXTURES = {
  fold: {
    title: 'Folding',
    html: `<h2 data-foldable="true">Section one</h2><p>Alpha text under one.</p><p>Beta text under one.</p>`
      + `<h2 data-foldable="true">Section two</h2><p>Gamma text under two.</p><h3 data-foldable="true">Nested three</h3><p>Delta text under three.</p>`
      + `<h2>Plain section</h2><p>Epsilon text at the end.</p>`,
  },
  // Long enough to scroll: folding must keep the arrow under the pointer.
  foldLong: {
    title: 'Folding a long note',
    html: `${filler('Before', 40)}<h2 data-foldable="true">Middle section</h2>${filler('Inside', 30)}<h2 data-foldable="true">Later section</h2>${filler('After', 40)}`,
  },
  // Everything that must reach paper although the note shows it folded.
  collapsed: {
    title: 'Collapsed content',
    html: `<p>Visible opening line.</p>`
      + `<h2 data-foldable="true" data-collapsed="true">Folded heading</h2><p>HIDDENPARAGRAPH under the folded heading.</p>`
      + `<h3>Hidden subheading</h3><p>HIDDENNESTED under the subheading.</p>`
      + `<h2>Open heading</h2><p>Visible closing line.</p>`
      + `<ul data-outline="true"><li data-collapsed="true"><p>Outline parent</p><ul><li><p>HIDDENOUTLINE child item</p></li></ul></li></ul>`,
  },
  wrap: {
    title: 'Heading wrap',
    html: `<h1>${WRAP_HEADING}</h1><p>Text after the first heading.</p><h2>${WRAP_HEADING_2}</h2><p>Text after the second heading.</p>`
      + `<h1 data-foldable="true">Foldable~~heading~~with~~kept~~spaces~~that~~also~~wraps~~nicely</h1><p>Text after the third heading.</p>${filler('Page', 34)}<h2>Heading on a later page</h2><p>Last words.</p>`,
  },
  // A note ending in a folded section: the blocks at its end have no box on the screen.
  foldEnd: {
    title: 'Ends folded',
    html: `<p>Opening line of the note.</p><p>Second line of the note.</p><h2 data-foldable="true" data-collapsed="true">Last section</h2><p>Hidden end of the note.</p>`,
  },
  // A bit of everything the schema renders: exports and PDF must carry all of it.
  kitchen: {
    title: 'Kitchen sink',
    html: `<h1>Kitchen sink</h1><p>Plain <strong>bold</strong> <em>italic</em> <u>underlined</u> <mark data-color="var(--hl-yellow)">marked</mark> and <a href="https://example.com/page">a link</a>.</p>`
      + `<ul><li><p>Bullet one</p></li><li><p>Bullet two</p><ul><li><p>Nested bullet</p></li></ul></li></ul>`
      + `<ol><li><p>Number one</p></li><li><p>Number two</p></li></ol>`
      + `<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked><span></span></label><div><p>Done task</p></div></li><li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>Open task</p></div></li></ul>`
      + `<blockquote><p>A quoted line.</p></blockquote>`
      + `<pre><code class="language-javascript">const answer = 42;\nconsole.log(answer);</code></pre>`
      + `<table><tbody><tr><th><p>Name</p></th><th><p>Value</p></th></tr><tr><td><p>Cell A</p></td><td><p>Cell B</p></td></tr></tbody></table>`
      + `<div data-type="callout" data-variant="info"><p>Callout text.</p></div>`
      + `<p>Formula <span data-type="inline-math" data-latex="x^2"></span> inline.</p>`
      + `<h2 data-foldable="true" data-collapsed="true">Folded part</h2><p>Text inside the folded part.</p>`
      + `<h2>Open part</h2><p>Text in the open part.</p>`,
  },
  // Wide content that must scroll inside itself on a phone.
  wide: {
    title: 'Wide content',
    html: `<h1>A heading with a verylongunbrokenwordthatkeepsgoingandgoingandgoingandgoingandgoingandgoing</h1>`
      + `<table><tbody><tr>${Array.from({ length: 9 }, (_, i) => `<th><p>Column number ${i + 1}</p></th>`).join('')}</tr><tr>${Array.from({ length: 9 }, (_, i) => `<td><p>Value ${i + 1}</p></td>`).join('')}</tr></tbody></table>`
      + `<pre><code>${'const long = "a single line of code that does not wrap at all and runs far past the edge of any phone";'}</code></pre>`,
  },
  pages: {
    title: 'Pagination',
    html: `<h1>First page</h1><p>Text on the first page.</p><div data-type="page-break" class="page-break"><span>Page break</span></div><h1>Second page</h1>${filler('Flow', 30)}`,
  },
} satisfies Record<string, { title: string; html: string }>;
