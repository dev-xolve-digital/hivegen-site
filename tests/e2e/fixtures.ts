import { test as base, expect } from '@playwright/test';
import { stubTurnstile } from './helpers';

/**
 * The `test` every browser spec uses. Its `page` never reaches Cloudflare: the booking section loads Turnstile whenever it comes near
 * the screen (a test that scrolls to the 3D objects or the footer wakes it too), so Cloudflare's script is answered with a stub, and a
 * test that asks Cloudflare for anything else fails. (tests/unit/e2e-fixtures.test.ts keeps specs from importing Playwright's own `test`.)
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    const strays: string[] = [];
    // The later route wins: the stub answers Turnstile's script, and anything else aimed at Cloudflare is refused and reported.
    await page.route('https://challenges.cloudflare.com/**', (route) => { strays.push(route.request().url()); return route.abort(); });
    await stubTurnstile(page);
    await use(page);
    expect(strays, 'the test asked Cloudflare for something the Turnstile stub does not cover').toEqual([]);
  },
});

export { expect };
