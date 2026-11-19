const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** HTML for a heading where hyphenated words ("15-minute") never break at the hyphen. */
export function keepHyphenated(s: string): string {
  return esc(s).replace(/(\S+-\S+)/g, '<span class="nw">$1</span>');
}

/** Fills a plan terms line from plans.yaml: {min} and {revisions} become the numbers, {s} becomes "s" unless revisions is 1. */
export function fillTerms(template: string, min: number, revisions: number): string {
  return template.replace(/\{min\}/g, String(min)).replace(/\{revisions\}/g, String(revisions)).replace(/\{s\}/g, revisions === 1 ? '' : 's');
}

/** JSON for a `<script type="application/json">` in a page: "<" is escaped, so no wording can ever close the script tag. */
export function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}
