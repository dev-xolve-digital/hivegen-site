import { test, expect } from '@playwright/test';
import { loadTestimonials } from '../../src/lib/content/load';
const t = loadTestimonials();
test('three testimonial cards with role labels and Sample tags', async ({ page }) => {
  await page.goto('/');
  const cards = page.getByTestId('testimonial-card');
  await expect(cards).toHaveCount(3);
  await expect(cards).toContainText(t.videos.map((v) => v.role));
  await expect(cards.getByText('Sample', { exact: true })).toHaveCount(3);
});
test('front row moves right, back row moves left', async ({ page }) => {
  await page.goto('/');
  const anim = (row: string) => page.getByTestId(`marquee-${row}`).locator('[data-track]').evaluate((el) => getComputedStyle(el).animationName);
  expect(await anim('front')).toBe('marquee-right');
  expect(await anim('back')).toBe('marquee-left');
});
test('each row shows its screenshots twice', async ({ page }) => {
  await page.goto('/');
  for (const row of ['front', 'back'] as const) {
    const n = t.screenshots.filter((s) => s.row === row).length;
    await expect(page.getByTestId(`marquee-${row}`).getByTestId('shot')).toHaveCount(n * 2);
    await expect(page.getByTestId(`marquee-${row}`).locator('[data-testid="shot"][aria-hidden="true"]')).toHaveCount(n);
  }
});
test('reduced motion stops the marquees', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  expect(await page.getByTestId('marquee-front').locator('[data-track]').evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
});
test('desktop: hovering a row pauses it', async ({ page, isMobile }) => {
  test.skip(!!isMobile);
  await page.goto('/');
  const row = page.getByTestId('marquee-front');
  await row.hover();
  expect(await row.locator('[data-track]').evaluate((el) => getComputedStyle(el).animationPlayState)).toBe('paused');
});
