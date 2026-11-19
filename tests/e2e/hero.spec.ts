import { test, expect } from './fixtures';
import { listPages, loadSection, loadSite, getVideo } from '../../src/lib/content/load';
for (const p of listPages()) {
  test(`"/${p.slug}" shows its headline and highlight`, async ({ page }) => {
    await page.goto('/' + p.slug);
    const h1 = page.getByRole('heading', { level: 1 });
    for (const line of p.hero.headline) await expect(h1).toContainText(line);
    await expect(h1.locator('.hl')).toHaveText(p.hero.highlight);
  });
}
test('tailored versions show their why-us line; main has none', async ({ page }) => {
  for (const p of listPages()) {
    await page.goto('/' + p.slug);
    if (p.whyUs) await expect(page.getByTestId('why-us')).toHaveText(p.whyUs);
    else await expect(page.getByTestId('why-us')).toHaveCount(0);
  }
});
test('Instagram link uses the DM link from site.yaml', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: loadSection('hero').instagramCta.label }).first())
    .toHaveAttribute('href', loadSite().contact.instagramUrl);
});
test('desktop: the hero loop starts after load', async ({ page, isMobile }) => {
  test.skip(!!isMobile);
  await page.goto('/');
  await expect.poll(() => page.getByTestId('hero-video').evaluate((v: HTMLVideoElement) => !!v.currentSrc && !v.paused)).toBe(true);
});
test('reduced motion keeps the poster', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.waitForLoadState('load');
  await expect(page.getByTestId('hero-video')).not.toHaveAttribute('src', /.+/);
});
test('data saver keeps the poster, and the reel still opens', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'connection', { value: { saveData: true } }));
  await page.goto('/');
  await page.waitForLoadState('load');
  await expect(page.getByTestId('hero-video')).not.toHaveAttribute('src', /.+/);
  await page.getByTestId('hero-card').click();
  await expect(page.getByTestId('lightbox')).toBeVisible();
});
test('the hero opens the full reel from Stream; Escape closes and restores focus', async ({ page }) => {
  await page.goto('/');
  const card = page.getByTestId('hero-card');
  await card.click();
  await expect(page.getByTestId('lightbox').locator('iframe')).toHaveAttribute('src', new RegExp(getVideo('v-portfolio-reel').streamUid!));
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('lightbox')).toBeHidden();
  await expect(card).toBeFocused();
});
test('the hero loop is served by the site and offers no download or save menu', async ({ page }) => {
  await page.goto('/');
  const v = page.getByTestId('hero-video');
  await expect(v).toHaveAttribute('data-src', '/media/clips/hero-loop.mp4');
  await expect(v).toHaveAttribute('controlslist', /nodownload/);
  await expect(v).toHaveAttribute('disablepictureinpicture', '');
  expect(await page.getByTestId('hero-card').evaluate((el) =>
    !el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))).toBe(true);
});
