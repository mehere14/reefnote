import MarkdownIt from 'markdown-it';

// Keep model output as text: raw HTML is disabled and unsafe link schemes
// are rejected by markdown-it's default URL validation.
const parser = new MarkdownIt({html: false});
const previewParser = new MarkdownIt({html: false});
// Models sometimes use LaTeX for simple arrows in otherwise ordinary prose.
// Parse these inline so code blocks, inline code and link URLs stay literal.
for (const markdown of [parser, previewParser]) {
 markdown.inline.ruler.before('escape', 'prose_arrow', (state, silent) => {
  const match = /^(?:\$\s*\\(rightarrow|leftarrow|leftrightarrow|Rightarrow|Leftarrow|Leftrightarrow|to)\s*\$|\\\(\s*\\(rightarrow|leftarrow|leftrightarrow|Rightarrow|Leftarrow|Leftrightarrow|to)\s*\\\))/.exec(state.src.slice(state.pos));
  if (!match) return false;
  const arrows: Record<string,string> = {rightarrow:'→',leftarrow:'←',leftrightarrow:'↔',Rightarrow:'⇒',Leftarrow:'⇐',Leftrightarrow:'⇔',to:'→'};
  if (!silent) {
   const token = state.push('text', '', 0);
   token.content = arrows[match[1] || match[2]];
  }
  state.pos += match[0].length;
  return true;
 });
}
// Card previews sit inside a button; links must not add nested controls.
previewParser.renderer.rules.link_open = () => '<span>';
previewParser.renderer.rules.link_close = () => '</span>';


export function renderMarkdown(text: string, interactive = true): string {
 return (interactive ? parser : previewParser).render(text);
}
