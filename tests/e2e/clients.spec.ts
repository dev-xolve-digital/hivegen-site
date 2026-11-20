import { test, expect } from './fixtures';
import { loadTestimonials, getVideo } from '../../src/lib/content/load';
const t = loadTestimonials();
test('client video cards come from testimonials.yaml, carry no Sample tag, and show a frame saved as a file of the site', async ({ page }) => {
  await page.goto('/');
  const cards = page.getByTestId('testimonial-card');
  await expect(cards).toHaveCount(t.videos.length);
  await expect(cards).toContainText(t.videos.map((v) => v.role));
  await expect(cards.getByText('Sample', { exact: true })).toHaveCount(0);
  for (const [i, tv] of t.videos.entries()) {
    await expect(cards.nth(i).locator('img')).toHaveAttribute('src', new RegExp(`/media/posters/${tv.videoId}\\.jpg$`));
  }
});
test('tapping a client video plays it from Stream', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('testimonial-card').first().getByTestId('testimonial-video').click();
  await expect(page.getByTestId('lightbox').locator('iframe')).toHaveAttribute('src', new RegExp(getVideo(t.videos[0].videoId).streamUid!));
});
test('front row moves right, back row moves left', async ({ page }) => {
  await page.goto('/');
  const anim = (row: string) => page.getByTestId(`marquee-${row}`).locator('[data-track]').evaluate((el) => getComputedStyle(el).animationName);
  expect(await anim('front')).toBe('marquee-right');
  expect(await anim('back')).toBe('marquee-left');
});
test('each row announces every screenshot once, inside a doubled track', async ({ page }) => {
  await page.goto('/');
  for (const row of ['front', 'back'] as const) {
    const n = t.screenshots.filter((s) => s.row === row).length;
    const cards = page.getByTestId(`marquee-${row}`).getByTestId('shot');
    await expect(page.getByTestId(`marquee-${row}`).locator('[data-testid="shot"]:not([aria-hidden="true"])')).toHaveCount(n);
    const total = await cards.count();
    expect(total % 2).toBe(0);
    expect(total).toBeGreaterThanOrEqual(n * 2);
  }
});
test('desktop: each row loops without a gap on a 2560px screen, even before the images load', async ({ page, isMobile }) => {
  test.skip(!!isMobile);
  await page.setViewportSize({ width: 2560, height: 1200 });
  await page.goto('/');
  for (const row of ['front', 'back'] as const) {
    const { copy, width } = await page.getByTestId(`marquee-${row}`).locator('[data-track]')
      .evaluate((el) => ({ copy: el.scrollWidth / 2, width: el.parentElement!.clientWidth }));
    expect(copy).toBeGreaterThanOrEqual(width);
  }
});
test('reduced motion stops the marquees', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  expect(await page.getByTestId('marquee-front').locator('[data-track]').evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
});
test('the rows only move while they are on screen', async ({ page }) => {
  await page.goto('/');
  const state = () => page.getByTestId('marquee-front').locator('[data-track]').evaluate((el) => getComputedStyle(el).animationPlayState);
  await expect.poll(state).toBe('paused');
  await page.getByTestId('marquee-front').scrollIntoViewIfNeeded();
  await expect.poll(state).toBe('running');
});
test('desktop: hovering a row pauses it', async ({ page, isMobile }) => {
  test.skip(!!isMobile);
  await page.goto('/');
  const row = page.getByTestId('marquee-front');
  await row.hover();
  expect(await row.locator('[data-track]').evaluate((el) => getComputedStyle(el).animationPlayState)).toBe('paused');
});
