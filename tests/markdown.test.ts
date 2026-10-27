import {describe, expect, it} from 'vitest';
import {renderMarkdown} from '../src/lib/markdown';

describe('chat Markdown', () => {
 it('formats naming options with LaTeX arrows, Unicode spaces and nested bullets', () => {
  const html=renderMarkdown('**Option 1 (Close phonetic echoes of the originals):**\n\n- **Serva** $\\rightarrow$ **Šerva** (pronounced *Sher-va*) or **Sėrvis**\n\n* **Option 2 (Harsh, aristocratic, and ancient Prussian/Lithuanian):**\n  - **Serva** $\\rightarrow$ **Žvorūna** or **Skirva**');
  expect(html).toContain('<strong>Serva</strong> → <strong>Šerva</strong>');
  expect(html).toContain('<em>Sher-va</em>');
  expect(html.match(/<ul>/g)).toHaveLength(3);
  expect(html).not.toMatch(/\*\*|\\rightarrow|\$/);
 });
 it('keeps arrow syntax literal in code and leaves ordinary dollars alone', () => {
  expect(renderMarkdown('`$\\rightarrow$`\n\n```\n$\\rightarrow$\n```')).toContain('<code>$\\rightarrow$</code>');
  expect(renderMarkdown('```\n$\\rightarrow$\n```')).toContain('$\\rightarrow$');
  expect(renderMarkdown('Costs $5 or $10.')).toContain('Costs $5 or $10.');
  expect(renderMarkdown('\\(\\rightarrow\\)')).toContain('→');
 });
 it('separates headings from adjacent body text and formats screenshot examples', () => {
  const html=renderMarkdown('## Option A: The Monopole Cemetery\n* **Not an Ancient God-Machine, But a Wreck:** Kirtuana finds a **human starship**.\n* **The Unexpected Twist:** An *exact duplicate*.\n\n---\n\nWhy **Somatic Anchoring** matters.');
  expect(html).toContain('<h2>Option A: The Monopole Cemetery</h2>');
  expect(html).toContain('<ul>');
  expect(html).toContain('<li><strong>Not an Ancient God-Machine, But a Wreck:</strong>');
  expect(html).toContain('<strong>human starship</strong>');
  expect(html).toContain('<em>exact duplicate</em>');
  expect(html).toContain('<hr>');
  expect(html).not.toContain('**');
 });
 it('supports ordered and nested lists, quotes, code, links and tables', () => {
  const html=renderMarkdown('1. First\n   - Nested\n2. Second\n\n> Quote\n\n`inline`\n\n```ts\nconst n = 1;\n```\n\n[Reference](https://example.com)\n\n| A | B |\n| --- | --- |\n| One | Two |');
  for(const tag of ['<ol>','<ul>','<blockquote>','<code>inline</code>','<pre><code class="language-ts">','<a href="https://example.com">','<table>']) expect(html).toContain(tag);
 });
 it('escapes raw HTML and rejects executable links', () => {
  const html=renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[click](javascript:alert(1))');
  expect(html).not.toMatch(/<script|<img|href="javascript:/);
  expect(html).toContain('&lt;script&gt;');
 });
 it('keeps card previews formatted without nesting links inside card buttons', () => {
  const html=renderMarkdown('**Watch** [reference](https://example.com)', false);
  expect(html).toContain('<strong>Watch</strong>');
  expect(html).toContain('<span>reference</span>');
  expect(html).not.toContain('<a ');
 });
 it('renders each streaming update independently, including completed emphasis', () => {
  expect(renderMarkdown('A **human')).toContain('A **human');
  expect(renderMarkdown('A **human starship**.')).toContain('<strong>human starship</strong>');
  expect(renderMarkdown('')).toBe('');
 });
});
