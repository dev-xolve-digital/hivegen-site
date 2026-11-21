import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The contact Gmail (contact.notificationEmail in content/site.yaml) must never appear in test output. A matcher such as
 * `expect(x).toBe(hassanEmail)` prints both values when it fails, so a test may only compare the address inside a boolean
 * (`expect(x === hassanEmail, 'why').toBe(true)`), and never pass it to a matcher or give it to `expect` as the value.
 */

const ROOT = join(__dirname, '..');
const PRIVATE_NAMES = /\b(hassanEmail|privateEmail|notificationEmail)\b/;
/** Ways of turning the address into a yes or no before `expect` sees it. */
const AS_BOOLEAN = /===|!==|\.includes\(|\.startsWith\(|\.endsWith\(/;

function testFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'fixtures' ? [] : testFiles(path);
    return /\.ts$/.test(name) && name !== 'test-privacy.test.ts' ? [path] : [];
  });
}

/** The text inside the parentheses that open just before `from` (the position after the "("). */
function argsFrom(text: string, from: number): string {
  let depth = 1;
  for (let i = from; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')' && --depth === 0) return text.slice(from, i);
  }
  return text.slice(from);
}

/** `args` without the text of its quoted strings (a name written inside quotes is only a word, not the value). */
const withoutStrings = (args: string) => args.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, "''");

/** The places in `text` where the address would be printed: a matcher's argument, or an `expect` value that is not a boolean test. */
function printingSpots(text: string): string[] {
  const spots: string[] = [];
  for (const m of text.matchAll(/\.(?:not\.)?to[A-Z]\w*\(/g)) {
    const args = withoutStrings(argsFrom(text, m.index! + m[0].length));
    if (PRIVATE_NAMES.test(args)) spots.push(`${m[0]}${args}`);
  }
  for (const m of text.matchAll(/\bexpect\(/g)) {
    const args = withoutStrings(argsFrom(text, m.index! + m[0].length));
    if (PRIVATE_NAMES.test(args) && !AS_BOOLEAN.test(args)) spots.push(`${m[0]}${args}`);
  }
  return spots;
}

describe('no test can print the contact address when it fails', () => {
  it('the checker finds the printing forms and lets the boolean ones through', () => {
    expect(printingSpots('expect(m.to).toBe(hassanEmail);')).toHaveLength(1);
    expect(printingSpots('expect(text, path).not.toContain(privateEmail);')).toHaveLength(1);
    expect(printingSpots('expect(x).toEqual({ rules, hassanEmail: site.contact.notificationEmail });')).toHaveLength(1);
    expect(printingSpots('expect(site.contact.notificationEmail).toBeTruthy();')).toHaveLength(1);
    expect(printingSpots("expect(m.to === hassanEmail, 'why').toBe(true);")).toEqual([]);
    expect(printingSpots("expect(text.includes(privateEmail), 'why').toBe(false);")).toEqual([]);
    expect(printingSpots("expect(Object.keys(x)).toEqual(['hassanEmail', 'rules']);")).toEqual([]);
    expect(printingSpots("const mail = createNotifier({ mailer, hassanEmail }).send(kind, { lead });")).toEqual([]);
  });

  it('every test file compares the address only as a boolean', () => {
    const found = testFiles(ROOT).flatMap((file) => printingSpots(readFileSync(file, 'utf8')).map(() => relative(ROOT, file).replaceAll('\\', '/')));
    expect(found, 'test files that could print the contact address when they fail').toEqual([]);
  });
});
