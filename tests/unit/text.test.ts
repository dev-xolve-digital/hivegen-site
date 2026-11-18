import { it, expect } from 'vitest';
import { fillTerms } from '../../src/lib/text';
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
