import { test, expect } from '@playwright/test';
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
test('the reveal labels switch at the cut', async ({ page }) => {
  await page.goto('/');
  const ba = page.getByTestId('before-after'), { labels } = loadSection('before-after');
  const video = ba.locator('video');
  await video.evaluate((v: HTMLVideoElement) => { v.pause(); v.currentTime = 2.0; });
  await expect(ba.getByText(labels.after)).toHaveClass(/\bon\b/);
  await video.evaluate((v: HTMLVideoElement) => { v.currentTime = 0.5; });
  await expect(ba.getByText(labels.before)).toHaveClass(/\bon\b/);
});
