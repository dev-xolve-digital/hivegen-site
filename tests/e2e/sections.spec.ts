import { test, expect } from './fixtures';
import { loadSection } from '../../src/lib/content/load';
test('who-it\'s-for appears on the main version only and links to the three versions', async ({ page }) => {
  await page.goto('/');
  const hrefs = await page.getByTestId('who-its-for').getByRole('link').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  expect(hrefs).toEqual(['/agencies', '/videographers', '/agents']);
  for (const s of ['agencies', 'videographers', 'agents']) {
    await page.goto('/' + s);
    await expect(page.getByTestId('who-its-for')).toHaveCount(0);
  }
});
test('how it works shows the three steps', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('step')).toHaveText(loadSection('how-it-works').steps.map((s) => new RegExp(s.title)));
});
test('section 05 compares the raw clip with the edit; drag and arrow keys move the handle', async ({ page }) => {
  await page.goto('/');
  const slider = page.getByTestId('before-after').getByRole('slider');
  await expect(slider).toHaveAttribute('aria-valuenow', '50');
  await slider.focus();
  await page.keyboard.press('ArrowRight');
  await expect(slider).toHaveAttribute('aria-valuenow', '55');
  await slider.scrollIntoViewIfNeeded();
  const box = (await slider.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  await expect(slider).toHaveAttribute('aria-valuenow', '20');
  const srcs = await slider.locator('video').evaluateAll((vs) => vs.map((v) => v.getAttribute('src')));
  expect(srcs).toEqual(['/media/clips/ba-before.mp4', '/media/clips/ba-after.mp4']); // the site's own files, never Stream
});
test('section 05 plays both whole videos from the site, with no Stream', async ({ page }) => {
  await page.goto('/');
  const ba = page.locator('#ba');
  const videos = ba.locator('[data-ba-slider] video');
  await expect(videos).toHaveCount(2);
  const srcs = await videos.evaluateAll((vs) => vs.map((v) => v.getAttribute('src')));
  for (const src of srcs) expect(src).toMatch(/^\/media\/clips\//);
  // The videos wait (preload none) until they play, so ask each one for its length.
  const durations = await videos.evaluateAll((vs) => Promise.all((vs as HTMLVideoElement[]).map((v) => new Promise<number>((resolve, reject) => {
    v.addEventListener('loadedmetadata', () => resolve(v.duration), { once: true });
    v.addEventListener('error', () => reject(new Error(`${v.getAttribute('src')} did not load`)), { once: true });
    v.load();
  }))));
  for (const d of durations) { expect(d).toBeGreaterThan(60); expect(d).toBeLessThan(61); }
  // no "Watch the full edit" button, no Stream player, and opening section 05 opens no pop-up
  await expect(ba.getByRole('button')).toHaveCount(0);
  await expect(ba.locator('iframe')).toHaveCount(0);
  await expect(ba.locator('[data-lightbox]')).toHaveCount(0);
  await ba.scrollIntoViewIfNeeded();
  await expect(page.getByTestId('lightbox')).toBeHidden();
});
