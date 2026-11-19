import { test as base, expect } from '@playwright/test';
import { stubTurnstile } from './helpers';

/** The hosts of the ad trackers (their scripts, pixels and beacons). No test may reach them. */
const TRACKER_HOSTS = ['facebook.com', 'facebook.net', 'googletagmanager.com', 'google-analytics.com', 'doubleclick.net', 'googleadservices.com'];
const isTracker = (url: URL) => TRACKER_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));

/**
 * The `test` every browser spec uses. Its `page` never reaches Cloudflare: the booking section loads Turnstile whenever it comes near
 * the screen (a test that scrolls to the 3D objects or the footer wakes it too), so Cloudflare's script is answered with a stub, and a
 * test that asks Cloudflare for anything else fails. It never reaches Meta or Google either: a test that gives the page tracking ids
 * (enableTracking in helpers.ts) answers their scripts itself, and one that asks them for anything else fails.
 * (tests/unit/e2e-fixtures.test.ts keeps specs from importing Playwright's own `test`.)
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    const strays: string[] = [];
    const trackers: string[] = [];
    // The later route wins: the stub answers Turnstile's script, and anything else aimed at Cloudflare is refused and reported.
    await page.route('https://challenges.cloudflare.com/**', (route) => { strays.push(route.request().url()); return route.abort(); });
    await page.route(isTracker, (route) => { trackers.push(route.request().url()); return route.abort(); });
    await stubTurnstile(page);
    await use(page);
    expect(strays, 'the test asked Cloudflare for something the Turnstile stub does not cover').toEqual([]);
    expect(trackers, 'the test asked Meta or Google for something it did not stub').toEqual([]);
  },
});

export { expect };
