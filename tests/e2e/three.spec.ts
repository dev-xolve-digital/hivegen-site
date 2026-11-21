import { test, expect } from './fixtures';
test('desktop: seven 3D objects render', async ({ page, isMobile }) => {
  test.skip(!!isMobile);
  await page.goto('/');
  const canvases = page.getByTestId('three-canvas');
  await expect(canvases).toHaveCount(7);
  for (const c of await canvases.all()) { await c.scrollIntoViewIfNeeded(); await expect(c).toHaveAttribute('data-ready', 'true'); }
});
test('desktop with reduced motion renders once and does not animate', async ({ page, isMobile }) => {
  test.skip(!!isMobile);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByTestId('three-canvas').first()).toHaveAttribute('data-animating', 'false');
});
test('phone: still images only, three.js never downloaded', async ({ page, isMobile }) => {
  test.skip(!isMobile);
  const scripts: string[] = [];
  page.on('request', (r) => { if (r.resourceType() === 'script') scripts.push(r.url()); });
  await page.goto('/');
  await page.mouse.wheel(0, 20000);
  await page.waitForLoadState('networkidle');
  expect(scripts.filter((u) => /three/i.test(u))).toEqual([]);
  await expect(page.getByTestId('three-still').first()).toBeVisible();
  await expect(page.getByTestId('three-still')).toHaveCount(4);
});
