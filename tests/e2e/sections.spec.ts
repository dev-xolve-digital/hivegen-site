import { test, expect } from '@playwright/test';
import { loadSection, getVideo } from '../../src/lib/content/load';
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
test('"Watch the full edit" plays the edited video from Stream', async ({ page }) => {
  await page.goto('/');
  const { slider } = loadSection('before-after');
  await page.getByRole('button', { name: slider!.fullVideoLabel! }).click();
  await expect(page.getByTestId('lightbox').locator('iframe')).toHaveAttribute('src', new RegExp(getVideo(slider!.fullVideoId!).streamUid!));
});
