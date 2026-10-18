// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { buildPublishedNote } from './publish-html';

describe('buildPublishedNote', () => {
  it("leaves out other people's cursors and selections of a live note", async () => {
    const dom = document.createElement('div');
    dom.innerHTML = '<p><span class="collaboration-carets__selection" style="background-color:#f08c00">apollo</span>'
      + '<span class="collaboration-carets__caret"><div class="collaboration-carets__label">Ola</div></span> rest</p>';
    const { html } = await buildPublishedNote(dom);
    expect(html).toContain('apollo');
    expect(html).toContain('rest');
    expect(html).not.toContain('collaboration-carets');
    expect(html).not.toContain('Ola');
  });
});
