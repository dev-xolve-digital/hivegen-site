import { it, expect, beforeEach } from 'vitest';
import { loadSite, listPages, loadPage, loadSection } from '../../src/lib/content/load';
beforeEach(() => { delete process.env.CONTENT_DIR; });

it('loads every real content file', () => {
  expect(listPages().map((p) => p.slug)).toEqual(['', 'agencies', 'videographers', 'agents']);
  for (const s of ['nav', 'hero', 'recent-edits', 'who-its-for', 'how-it-works', 'before-after',
    'plans', 'booking', 'faq', 'final-cta', 'footer', 'not-found', 'manage-booking'] as const) expect(() => loadSection(s)).not.toThrow();
});
it('headlines match the copy deck', () => {
  expect(loadPage('').hero.headline).toEqual(['You shoot.', 'We edit.', 'Homes sell.']);
  expect(loadPage('agents').hero.headline).toEqual(['You list.', 'We edit.', 'You stand out.']);
});
it('booking rules match the spec', () => {
  expect(loadSite().booking).toEqual({ timeZone: 'Asia/Karachi', days: ['mon', 'tue', 'wed', 'thu', 'fri'],
    windowStart: '19:00', windowEnd: '02:00', slotMinutes: 15, bufferMinutes: 5, minNoticeMinutes: 60, horizonDays: 14 });
});
it('broken YAML names the file and line', () => {
  process.env.CONTENT_DIR = 'tests/fixtures/content-broken-yaml';
  expect(() => loadSite()).toThrowError(/site\.yaml.*line \d+/);
});
it('a missing field names the file and field', () => {
  process.env.CONTENT_DIR = 'tests/fixtures/content-missing-field';
  expect(() => loadPage('')).toThrowError(/pages\/main\.yaml.*hero\.subline/);
});
it('an unknown video id is named', () => {
  process.env.CONTENT_DIR = 'tests/fixtures/content-unknown-video';
  expect(() => listPages()).toThrowError(/v-nope/);
});
it('slider mode without a slider block names the missing field', () => {
  process.env.CONTENT_DIR = 'tests/fixtures/content-slider-missing';
  expect(() => loadSection('before-after')).toThrowError(/before-after\.yaml.*"slider" is needed when mode is slider \(field slider\)/);
});
