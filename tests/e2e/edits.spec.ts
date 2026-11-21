import { test, expect } from './fixtures';
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
test('tapping a card asks the server for the video link, then plays it', async ({ page }) => {
  await page.goto('/');
  const video = getVideo(listPages()[0].videoOrder.vertical[0]);
  const answer = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/video/${video.id}`);
  await page.getByTestId('vertical-card').first().click();
  const res = await answer;
  expect(res.status()).toBe(200);
  expect(res.headers()['cache-control']).toBe('no-store');
  const { src } = (await res.json()) as { src: string };
  await expect(page.getByTestId('lightbox').locator('iframe')).toHaveAttribute('src', src);
  expect(src).toContain(`/${video.streamUid}/iframe?`);
});
test('when the server cannot give the video link, the pop-up says so, and closes as usual', async ({ page }) => {
  await page.route('**/api/video/*', (route) => route.fulfill({ status: 503, json: { error: 'not_connected' } }));
  await page.goto('/');
  await page.getByTestId('vertical-card').first().click();
  const lightbox = page.getByTestId('lightbox');
  await expect(lightbox).toContainText(loadSection('hero').videoErrorText);
  await expect(lightbox.locator('iframe')).toHaveCount(0);
  await page.goBack();
  await expect(lightbox).toBeHidden();
  expect(new URL(page.url()).pathname).toBe('/');
});
test('the page loads nothing from Stream until a card is tapped: the card images are files of the site', async ({ page }) => {
  const asked: string[] = [];
  page.on('request', (r) => { if (new URL(r.url()).hostname.endsWith('cloudflarestream.com')) asked.push(r.url()); });
  await page.goto('/');
  await page.getByTestId('testimonial-video').last().scrollIntoViewIfNeeded();
  await page.waitForLoadState('load');
  expect(asked).toEqual([]);
  const html = await page.content();
  expect(html).not.toContain('cloudflarestream.com');
  expect(html).not.toMatch(/eyJ[\w-]{10,}\.[\w-]+\./); // no signed token in the page, whatever the settings
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
