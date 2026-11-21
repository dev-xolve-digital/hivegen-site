import { it, expect } from 'vitest';
import { fillPlaceholders, fillTerms } from '../../src/lib/text';
import { loadSection } from '../../src/lib/content/load';

it('plan terms fill in the numbers and add "s" unless the number is 1', () => {
  const t = '{min}+ videos a month · {revisions} revision{s}';
  expect(fillTerms(t, 30, 1)).toBe('30+ videos a month · 1 revision');
  expect(fillTerms(t, 15, 2)).toBe('15+ videos a month · 2 revisions');
  expect(fillTerms(t, 10, 0)).toBe('10+ videos a month · 0 revisions');
});
it('the plan terms line comes from plans.yaml', () => {
  expect(loadSection('plans').termsLine).toBe('{min}+ videos a month · {revisions} revision{s}');
});
it('placeholders are filled in one pass, and one that is not known stays as it is', () => {
  expect(fillPlaceholders('Join on {when} at {email}. {other}', { when: 'Monday', email: 'a@b.co' })).toBe('Join on Monday at a@b.co. {other}');
  // A value is never read as a placeholder again.
  expect(fillPlaceholders('{a} {b}', { a: '{b}', b: 'x' })).toBe('{b} x');
});
