import { it, expect, beforeEach, afterEach } from 'vitest';
import { loadSite, listPages, loadPage, loadSection, loadMetaPixelId } from '../../src/lib/content/load';
import { removeTempContent, tempContent } from '../helpers/temp-content';
beforeEach(() => { delete process.env.CONTENT_DIR; });
afterEach(() => { removeTempContent(); });

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

// The tracking block of site.yaml: public ids, and an empty one switches that tracker off.
const withTracking = (lines: Record<string, string>) => tempContent({
  'site.yaml': (t) => Object.entries(lines).reduce((text, [key, value]) => text.replace(new RegExp(`^  ${key}: ""`, 'm'), `  ${key}: "${value}"`), t),
});
it('the real site.yaml has no tracking ids yet, so every tracker is off', () => {
  expect(Object.values(loadSite().tracking ?? {}).filter(Boolean)).toEqual([]);
  expect(loadMetaPixelId()).toBeUndefined();
});
it('tracking ids are read as written, and an empty one is none', () => {
  process.env.CONTENT_DIR = withTracking({ metaPixelId: ' 123456789012345 ', googleTagId: 'G-ABC123XYZ4', googleAdsId: 'AW-987654321', googleAdsScheduleLabel: 'AbC-D_efG-h' });
  expect(loadSite().tracking).toEqual({ metaPixelId: '123456789012345', googleTagId: 'G-ABC123XYZ4', googleAdsId: 'AW-987654321', googleAdsScheduleLabel: 'AbC-D_efG-h' });
  expect(loadMetaPixelId()).toBe('123456789012345');
  process.env.CONTENT_DIR = withTracking({ googleTagId: 'G-ABC123XYZ4' });
  expect(loadSite().tracking).toMatchObject({ googleTagId: 'G-ABC123XYZ4', metaPixelId: undefined, googleAdsId: undefined });
});
it('a tracking id that is not the right shape is named, so a pasted snippet never reaches a page', () => {
  for (const [field, bad] of [['metaPixelId', 'fbq(init, 1)'], ['googleTagId', 'AW-123456'], ['googleAdsId', 'G-ABC123XYZ4'], ['googleAdsScheduleLabel', '><script>']] as const) {
    process.env.CONTENT_DIR = withTracking({ [field]: bad });
    expect(() => loadSite(), field).toThrow(new RegExp(`site\.yaml: "tracking\.${field}" .*\(field tracking\.${field}\)`));
  }
});
it('a site.yaml with no tracking block at all still loads (the block is optional)', () => {
  process.env.CONTENT_DIR = tempContent({ 'site.yaml': (t) => t.replace(/\ntracking:[\s\S]*?(?=\n\S|$)/, '') });
  expect(loadSite().tracking).toBeUndefined();
  expect(loadMetaPixelId()).toBeUndefined();
});
