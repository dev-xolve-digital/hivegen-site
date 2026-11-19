import { test, expect } from '@playwright/test';
const CF = /^https:\/\/imagedelivery\.net\/[\w-]+\/[\w-]+\/public$/;

test('card images, the hero poster, 3D stills and message screenshots come from Cloudflare Images', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('head link[rel="preconnect"][href="https://imagedelivery.net"]')).toHaveCount(1);
  expect(await page.getByTestId('vertical-card').first().locator('img').getAttribute('src')).toMatch(CF);
  expect(await page.getByTestId('horizontal-card').first().locator('img').getAttribute('src')).toMatch(CF);
  expect(await page.getByTestId('hero-video').getAttribute('poster')).toMatch(CF);
  for (const src of await page.getByTestId('three-still').evaluateAll((els) => els.map((e) => e.getAttribute('src')))) expect(src).toMatch(CF);
  const shots = await page.getByTestId('shot').locator('img').evaluateAll((els) => els.map((e) => e.getAttribute('src')));
  expect(shots.length).toBeGreaterThan(0);
  for (const src of shots) expect(src).toMatch(CF);
});
test('a Cloudflare image actually loads', async ({ page }) => {
  await page.goto('/');
  const src = (await page.getByTestId('vertical-card').first().locator('img').getAttribute('src'))!;
  const r = await page.request.get(src);
  expect(r.ok()).toBe(true);
  expect(r.headers()['content-type']).toMatch(/^image\//);
});
