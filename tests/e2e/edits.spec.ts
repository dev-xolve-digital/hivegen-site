import { test, expect } from '@playwright/test';
import { listPages, getVideo, loadSection } from '../../src/lib/content/load';
const labels = (ids: string[]) => ids.map((id) => new RegExp(getVideo(id).label));
for (const p of listPages()) {
  test(`"/${p.slug}" lists its videos in its own order`, async ({ page }) => {
    await page.goto('/' + p.slug);
    await expect(page.getByTestId('vertical-card')).toHaveText(labels(p.videoOrder.vertical));
    await expect(page.getByTestId('horizontal-card')).toHaveText(labels(p.videoOrder.horizontal));
  });
}
test('desktop: the next arrow scrolls the vertical row', async ({ page, isMobile }) => {
  test.skip(!!isMobile);
  await page.goto('/');
  await page.getByRole('button', { name: loadSection('recent-edits').nextLabel }).first().click();
  await expect.poll(() => page.getByTestId('vertical-track').evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
});
test('tapping a card opens that video from Stream', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('vertical-card').first().click();
  await expect(page.getByTestId('lightbox').locator('iframe'))
    .toHaveAttribute('src', new RegExp(getVideo(listPages()[0].videoOrder.vertical[0]).streamUid!));
});
test('Back closes the video pop-up and stays on the page', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('vertical-card').first().click();
  await expect(page.getByTestId('lightbox')).toBeVisible();
  await page.goBack();
  expect(new URL(page.url()).pathname).toBe('/');
  await expect(page.getByTestId('lightbox')).toBeHidden();
});
test('closing the pop-up with its X leaves no extra Back step', async ({ page }) => {
  await page.goto('/agents');
  await page.goto('/');
  await page.getByTestId('vertical-card').first().click();
  await page.getByTestId('lightbox').locator('.hglb-x').click();
  await expect(page.getByTestId('lightbox')).toBeHidden();
  await expect.poll(() => page.evaluate(() => history.state?.hglb ?? null)).toBeNull();
  await page.goBack();
  await expect(page).toHaveURL(/\/agents$/);
});
test('all 31 portfolio videos are listed, posters load lazily, and cards block the save menu', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('vertical-card')).toHaveCount(23);
  await expect(page.getByTestId('horizontal-card')).toHaveCount(8);
  await expect(page.getByTestId('vertical-card').nth(10).locator('img')).toHaveAttribute('loading', 'lazy');
  expect(await page.getByTestId('vertical-card').first().evaluate((el) =>
    !el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))).toBe(true);
});
