import { test, expect } from './fixtures';
import { listPages, loadSection, loadSite } from '../../src/lib/content/load';
test('home serves a page titled HiveGen', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/HiveGen/);
});
for (const p of listPages()) {
  test(`"/${p.slug}" has its own title and robots rule`, async ({ page }) => {
    await page.goto('/' + p.slug);
    await expect(page).toHaveTitle(p.seo.title);
    const robots = page.locator('meta[name="robots"]');
    if (p.seo.noindex) await expect(robots).toHaveAttribute('content', /noindex/);
    else await expect(robots).toHaveCount(0);
  });
}
test('nav shows the logo and a booking button to #book', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('img', { name: loadSite().brand.name }).first()).toBeVisible();
  await expect(page.getByRole('navigation').getByRole('link', { name: loadSection('nav').cta.label }))
    .toHaveAttribute('href', '#book');
});
test('legal pages and the 404 page', async ({ page }) => {
  for (const path of ['/privacy', '/terms']) expect((await page.goto(path))?.status()).toBe(200);
  expect((await page.goto('/no-such-page'))?.status()).toBe(404);
  await expect(page.getByRole('link', { name: loadSection('hero').primaryCta.label })).toBeVisible();
});
test('phone: mobile bar appears after scrolling past the hero button', async ({ page, isMobile }) => {
  test.skip(!isMobile);
  await page.goto('/');
  await expect(page.getByTestId('mobile-bar')).toBeHidden();
  await page.getByRole('contentinfo').scrollIntoViewIfNeeded();
  await expect(page.getByTestId('mobile-bar')).toBeVisible();
});
test('phone: mobile bar hides while the booking form is on screen', async ({ page, isMobile }) => {
  test.skip(!isMobile);
  await page.goto('/');
  const bar = page.getByTestId('mobile-bar');
  await page.getByRole('contentinfo').scrollIntoViewIfNeeded();
  await expect(bar).toBeVisible();
  await page.getByTestId('booking').locator('[data-flow] form').scrollIntoViewIfNeeded();
  await expect(bar).toBeHidden();
});
test('the footer email is a hivegen.co address, and the private Gmail is on no page', async ({ page, isMobile }) => {
  test.skip(!!isMobile);
  const privateEmail = loadSite().contact.notificationEmail;
  for (const path of [...listPages().map((p) => '/' + p.slug), '/privacy', '/terms', '/no-such-page']) {
    expect(await (await page.request.get(path)).text(), path).not.toContain(privateEmail);
  }
  await page.goto('/');
  await expect(page.getByRole('contentinfo').getByRole('link', { name: 'Email' })).toHaveAttribute('href', /^mailto:[^@]+@hivegen\.co$/);
});
