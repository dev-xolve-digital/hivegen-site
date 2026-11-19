import { test, expect } from './fixtures';
import { enableTracking, trackerCalls, TRACKING_IDS } from './helpers';

// Changes no server state (the page's PageView beacon is answered by the test, not by the server), so it can run on both devices.

const TRACKER = /(^|\.)(facebook\.com|facebook\.net|googletagmanager\.com)$/;
const isTracker = (url: string) => TRACKER.test(new URL(url).hostname);
/** The 2 s the trackers may wait for the browser to be idle after load, and some room. */
const IDLE_WINDOW_MS = 3000;

/** Answers the PageView beacon itself and keeps what it carried. */
async function captureBeacons(page: Parameters<typeof enableTracking>[0]): Promise<Array<Record<string, unknown>>> {
  const beacons: Array<Record<string, unknown>> = [];
  await page.route('**/api/events', (route) => {
    beacons.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill({ status: 204 });
  });
  return beacons;
}

test('the site\'s real content has no tracking ids yet, so no tracker loads at all', async ({ page }) => {
  const hits: string[] = [];
  const beacons: string[] = [];
  page.on('request', (r) => {
    if (isTracker(r.url())) hits.push(r.url());
    if (new URL(r.url()).pathname === '/api/events') beacons.push(r.url());
  });
  await page.goto('/', { waitUntil: 'load' });
  await page.waitForTimeout(IDLE_WINDOW_MS); // past the longest the trackers would wait
  expect(hits).toEqual([]);
  expect(beacons).toEqual([]);
  await expect(page.locator('script[data-tracking]')).toHaveCount(0);
  expect(await page.evaluate(() => [typeof (window as unknown as { fbq?: unknown }).fbq, typeof (window as unknown as { dataLayer?: unknown }).dataLayer])).toEqual(['undefined', 'undefined']);
});

test('no third-party script is requested before the load event', async ({ page }) => {
  await enableTracking(page);
  const beacons = await captureBeacons(page);
  await page.goto('/', { waitUntil: 'load' });
  // Both scripts do come, once the page is idle...
  await expect.poll(() => page.evaluate(() => performance.getEntriesByType('resource').filter((e) => /connect\.facebook\.net|googletagmanager\.com/.test(e.name)).length)).toBe(2);
  // ...and every one of them was asked for after the window's load event began.
  const timing = await page.evaluate(() => ({
    loadStart: (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming).loadEventStart,
    scripts: performance.getEntriesByType('resource').filter((e) => /connect\.facebook\.net|googletagmanager\.com/.test(e.name)).map((e) => ({ name: e.name, start: e.startTime })),
  }));
  expect(timing.loadStart).toBeGreaterThan(0);
  expect(timing.scripts.map((s) => new URL(s.name).hostname).sort()).toEqual(['connect.facebook.net', 'www.googletagmanager.com']);
  for (const s of timing.scripts) expect(s.start, s.name).toBeGreaterThanOrEqual(timing.loadStart);
  await expect.poll(() => beacons.length).toBe(1);
});

test('the Pixel PageView and the server beacon carry one event id, and the Google tag is configured', async ({ page }) => {
  await enableTracking(page);
  const beacons = await captureBeacons(page);
  await page.goto('/agents?utm_source=facebook&fbclid=AbC123#book');
  await expect.poll(() => beacons.length).toBe(1);
  const { fbq, gtag } = await trackerCalls(page);

  const pageView = fbq.find((c) => c[0] === 'track' && c[1] === 'PageView')!;
  const eventID = (pageView[3] as { eventID: string }).eventID;
  expect(eventID).toMatch(/^[0-9a-f-]{36}$/);
  expect(beacons[0]).toMatchObject({ name: 'PageView', eventId: eventID });
  expect(beacons[0].url).toMatch(/\/agents\?utm_source=facebook&fbclid=AbC123$/); // the page, without the #fragment
  expect(beacons[0].fbc).toMatch(/^fb\.1\.\d+\.AbC123$/);

  expect(fbq.find((c) => c[0] === 'init')).toEqual(['init', TRACKING_IDS.metaPixelId]); // the Pixel is given its id and nothing about the visitor
  expect(gtag.filter((c) => c[0] === 'config')).toEqual([['config', TRACKING_IDS.googleTagId], ['config', TRACKING_IDS.googleAdsId]]);
});

test('opening a video reports ViewContent to the Pixel and video_play to Google, with the video\'s title', async ({ page }) => {
  await enableTracking(page);
  await captureBeacons(page);
  await page.goto('/');
  const card = page.getByTestId('hero-card');
  const title = (JSON.parse((await card.getAttribute('data-lightbox'))!) as { title: string }).title;
  await card.click(); // maybe before the trackers are in: the call is kept until they are
  await expect(page.getByTestId('lightbox')).toBeVisible();
  await expect.poll(async () => (await trackerCalls(page)).fbq.some((c) => c[1] === 'ViewContent')).toBe(true);
  const { fbq, gtag } = await trackerCalls(page);
  expect(fbq).toContainEqual(['track', 'ViewContent', { content_name: title }]);
  expect(gtag).toContainEqual(['event', 'video_play', { video_title: title }]);
  // It came after the PageView: the trackers were set up first.
  expect(fbq.findIndex((c) => c[1] === 'PageView')).toBeLessThan(fbq.findIndex((c) => c[1] === 'ViewContent'));
});
