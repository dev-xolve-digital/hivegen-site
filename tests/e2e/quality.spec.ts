import { test, expect } from './fixtures';
import AxeBuilder from '@axe-core/playwright';
import { gzipSync } from 'node:zlib';
import { listPages, loadSection } from '../../src/lib/content/load';
import { imageUrl } from '../../src/lib/media';
import { inquiryPanel, openBooking } from './helpers';

test('phone: initial JavaScript under 50 KB gzipped, poster under 80 KB, fonts under 100 KB', async ({ page, isMobile }) => {
  test.skip(!isMobile);
  const bodies: Promise<{ type: string; url: string; size: number }>[] = [];
  page.on('response', (r) => bodies.push(r.body().then((b) => ({ type: r.request().resourceType(), url: r.url(), size: gzipSync(b).length })).catch(() => ({ type: '', url: '', size: 0 }))));
  await page.goto('/', { waitUntil: 'load' });
  const all = await Promise.all(bodies);
  expect(all.filter((x) => x.type === 'script').reduce((n, x) => n + x.size, 0)).toBeLessThan(50 * 1024);
  expect(all.find((x) => x.url === imageUrl('media/posters/hero-loop.jpg'))!.size).toBeLessThan(80 * 1024);
  expect(all.filter((x) => x.type === 'font').reduce((n, x) => n + x.size, 0)).toBeLessThan(100 * 1024);
});
test('layout shift stays under 0.05', async ({ page }) => {
  await page.goto('/');
  const cls = await page.evaluate(() => new Promise<number>((res) => {
    let s = 0;
    new PerformanceObserver((l) => { for (const e of l.getEntries() as any[]) if (!e.hadRecentInput) s += e.value; })
      .observe({ type: 'layout-shift', buffered: true });
    setTimeout(() => res(s), 1500);
  }));
  expect(cls).toBeLessThan(0.05);
});
for (const p of listPages()) {
  test(`axe: "/${p.slug}" has no serious or critical issues`, async ({ page }) => {
    test.setTimeout(90_000); // a full axe pass with live 3D on desktop can take longer than the default 30 s
    await page.goto('/' + p.slug);
    const r = await new AxeBuilder({ page }).analyze();
    expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
  });
}

// The booking card with "Send details" open, on both devices. It only looks: nothing here changes the server's state.
test('axe: the booking card with Send details open has no violations', async ({ page }) => {
  test.setTimeout(90_000); // a full axe pass with live 3D on desktop can take longer than the default 30 s
  await openBooking(page, '/');
  await page.locator('[data-view="details"]').click();
  await expect(inquiryPanel(page)).toBeVisible();
  const r = await new AxeBuilder({ page }).include('[data-testid="booking"]').analyze();
  expect(r.violations).toEqual([]);
});

test('phone (320 px wide): the switch stays on one line and nothing scrolls sideways, also mid-shake', async ({ page }) => {
  const b = loadSection('booking');
  await page.setViewportSize({ width: 320, height: 800 });
  await openBooking(page, '/');
  const bar = page.locator('[data-switch]');
  await bar.scrollIntoViewIfNeeded();
  const call = bar.getByRole('tab', { name: b.switch.call, exact: true }); // the real words of booking.yaml, not shorter ones
  const details = bar.getByRole('tab', { name: b.switch.details, exact: true });
  const sideways = () => page.evaluate(() => document.documentElement.scrollWidth);
  /** Where each tab's box starts, from the top of the page: the same number when the two sit on one line. */
  const tops = () => Promise.all([call, details].map((tab) => tab.evaluate((el) => el.getBoundingClientRect().top)));

  // The visitor uses the card first (focus in a field), which ends the page's own nudge for good. From here on no shake can start or stop on
  // its own: the one measured below is the one added by hand, and the layout measured before it is the settled one.
  await page.locator('[data-flow] [data-field="name"]').focus();
  await expect(details).not.toHaveClass(/shake/);
  expect(await sideways()).toBeLessThanOrEqual(320);
  const [callTop, detailsTop] = await tops();
  expect(detailsTop).toBe(callTop);

  // Mid-shake: the class goes on by hand, and the measure waits until its animation is half way (350 ms of 0.7 s).
  await details.evaluate((el) => { el.classList.remove('shake'); void el.getBoundingClientRect(); el.classList.add('shake'); });
  await page.waitForFunction(() => document.querySelector('[data-view="details"]')!.getAnimations().some((a) => Number(a.currentTime) >= 350), undefined, { polling: 'raf' });
  expect(await sideways()).toBeLessThanOrEqual(320);
  // The shake turns the tab a little (its box moves by a pixel or so), so "on one line" is read from where the two tabs are laid out.
  const layoutTops = await Promise.all([call, details].map((tab) => tab.evaluate((el) => (el as HTMLElement).offsetTop)));
  expect(layoutTops[1]).toBe(layoutTops[0]);

  // The form that opens from it fits too.
  await details.click();
  await expect(inquiryPanel(page)).toBeVisible();
  expect(await sideways()).toBeLessThanOrEqual(320);
});
