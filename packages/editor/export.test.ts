import { describe, it, expect } from 'vitest';
import { exportNote, exportFileName } from './export';

const p = (...content: any[]) => ({ type: 'paragraph', content });
const t = (text: string, ...marks: string[]) => ({ type: 'text', text, marks: marks.map((type) => ({ type })) });

const doc = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [t('Plan')] },
    p(t('Some '), t('bold', 'bold'), t(' and '), t('code', 'code'), t(' '), { type: 'text', text: 'site', marks: [{ type: 'link', attrs: { href: 'https://a.b/c' } }] }),
    { type: 'bulletList', content: [
      { type: 'listItem', content: [p(t('one')), { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('nested'))] }] }] },
      { type: 'listItem', content: [p(t('two'))] },
    ] },
    { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [p(t('done'))] }, { type: 'taskItem', attrs: { checked: false }, content: [p(t('todo'))] }] },
    { type: 'codeBlock', attrs: { language: 'js' }, content: [t('let a = 1;')] },
    { type: 'table', content: [
      { type: 'tableRow', content: [{ type: 'tableHeader', content: [p(t('A'))] }, { type: 'tableHeader', content: [p(t('B'))] }] },
      { type: 'tableRow', content: [{ type: 'tableCell', content: [p(t('1'))] }, { type: 'tableCell', content: [p(t('x|y'))] }] },
    ] },
    { type: 'callout', attrs: { variant: 'warning' }, content: [p(t('Careful'))] },
    p({ type: 'noteLink', attrs: { noteId: 'n1' } }, t(' and '), { type: 'inlineMath', attrs: { latex: 'x^2' } }),
  ],
};

describe('exportNote', () => {
  it('writes Markdown', () => {
    expect(exportNote('Title', doc, 'markdown', { n1: 'Other' })).toBe([
      '# Title',
      '',
      '## Plan',
      '',
      'Some **bold** and `code` [site](https://a.b/c)',
      '',
      '- one',
      '  - nested',
      '- two',
      '',
      '- [x] done',
      '- [ ] todo',
      '',
      '```js',
      'let a = 1;',
      '```',
      '',
      '| A | B |',
      '| --- | --- |',
      '| 1 | x\\|y |',
      '',
      '> [!WARNING]',
      '> Careful',
      '',
      '[[Other]] and $x^2$',
      '',
    ].join('\n'));
  });

  it('writes plain text', () => {
    const text = exportNote('Title', doc, 'text', { n1: 'Other' });
    expect(text).toContain('Title\n\nPlan\n\nSome bold and code site\n\n• one\n  • nested\n• two');
    expect(text).toContain('☑ done\n☐ todo');
    expect(text).toContain('A\tB\n1\tx|y');
    expect(text).toContain('Other and x^2');
  });

  it('keeps spaces outside of emphasis and escapes markers', () => {
    expect(exportNote('', { type: 'doc', content: [p(t('a '), t(' b ', 'italic'), t('*c*'))] }, 'markdown')).toBe('a  *b* \\*c\\*\n');
  });

  it('nests task items under the text of their parent, not after its checkbox', () => {
    const task = (checked: boolean, ...content: any[]) => ({ type: 'taskItem', attrs: { checked }, content });
    const nested = { type: 'doc', content: [{ type: 'taskList', content: [
      task(false, p(t('parent')), { type: 'taskList', content: [task(true, p(t('child')))] }),
    ] }] };
    expect(exportNote('', nested, 'markdown')).toBe('- [ ] parent\n  - [x] child\n');
  });

  it('makes safe file names', () => {
    expect(exportFileName(' a/b: c? ', 'md')).toBe('a b c.md');
    expect(exportFileName('', 'pdf')).toBe('Untitled.pdf');
  });
});
