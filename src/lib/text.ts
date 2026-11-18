const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** HTML for a heading where hyphenated words ("15-minute") never break at the hyphen. */
export function keepHyphenated(s: string): string {
  return esc(s).replace(/(\S+-\S+)/g, '<span class="nw">$1</span>');
}
