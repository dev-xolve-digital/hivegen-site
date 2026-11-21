import { type Locator } from '@playwright/test';
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

/** The width of the phone the page is built for at the narrowest. */
const PHONE = 320;

/** Where the controls of a panel are: the edges of every text field, choice pill and submit button that takes room on the page. */
const controlEdges = (panel: Locator) => panel.locator('.inp, .seg label, button[type="submit"]').evaluateAll((els) => els
  .map((el) => ({ name: (el.textContent?.trim() || el.id || el.tagName).slice(0, 40), left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right, width: el.getBoundingClientRect().width }))
  .filter((box) => box.width > 0));

test('phone (320 px wide): the switch stays on one line and nothing scrolls sideways, also mid-shake', async ({ page }) => {
  test.setTimeout(90_000); // it loads the page with its live 3D, like the axe tests above
  const b = loadSection('booking');
  await page.setViewportSize({ width: PHONE, height: 800 });
  await openBooking(page, '/');
  const bar = page.locator('[data-switch]');
  await bar.scrollIntoViewIfNeeded();
  const details = bar.getByRole('tab', { name: b.switch.details, exact: true }); // the real words of booking.yaml, not shorter ones
  await expect(bar.getByRole('tab', { name: b.switch.call, exact: true })).toBeVisible();
  // The visitor uses the card first (focus in a field), which ends the page's own nudge for good: the only shake left is the one made below.
  await page.locator('[data-flow] [data-field="name"]').focus();
  await expect(details).not.toHaveClass(/shake/);

  // `scrollWidth` cannot see a tab or a field that sticks out: the page clips its sides (`.page{overflow-x:clip}`) instead of scrolling.
  // So the edges of the boxes are read. The shake is paused at its peaks (in the CSS keyframes: 140 ms and 245 ms to the sides, then 350, 455
  // and 560 ms) and every box is read in this one call, so nothing waits on the clock or on how busy the machine is.
  const TIMES = [0, 140, 245, 350, 455, 560];
  const frames = await details.evaluate((tab, times) => {
    const call = document.querySelector('[data-view="call"]')!;
    tab.classList.remove('shake');
    void tab.getBoundingClientRect();
    tab.classList.add('shake');
    const shake = tab.getAnimations().find((a) => (a as CSSAnimation).animationName === 'switch-shake');
    if (!shake) return null;
    shake.pause();
    const read = times.map((ms) => {
      shake.currentTime = ms;
      const box = tab.getBoundingClientRect();
      return { ms, left: box.left, right: box.right, top: box.top, callTop: call.getBoundingClientRect().top, shift: new DOMMatrix(getComputedStyle(tab).transform).e };
    });
    shake.cancel();
    tab.classList.remove('shake');
    return read;
  }, TIMES);
  expect(frames, 'the Send details tab has the animation "switch-shake" while it has the class "shake"').not.toBeNull();
  expect(frames!.find((f) => f.ms === 245)!.shift, 'at 245 ms the tab is at its right peak (about 5 px)').toBeGreaterThan(4);
  for (const f of frames!) {
    expect(f.left, `the Send details tab, ${f.ms} ms into the shake: its left edge`).toBeGreaterThanOrEqual(0);
    expect(f.right, `the Send details tab, ${f.ms} ms into the shake: its right edge`).toBeLessThanOrEqual(PHONE);
    // The turn of the shake moves the tab's box by about a pixel: the two tabs are on one line when their tops are within 2 px
    // (a tab on a second line would be about 35 px lower).
    expect(Math.abs(f.top - f.callTop), `the two tabs' tops, ${f.ms} ms into the shake`).toBeLessThanOrEqual(2);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(PHONE);

  // The call form's fields and the "Send details" form's fit the phone too.
  const call = await controlEdges(page.locator('[data-flow]'));
  expect(call.length, 'the call form has its fields, choices and button').toBeGreaterThan(8);
  expect(call.filter((c) => c.left < 0 || c.right > PHONE), 'the call form: controls outside the screen').toEqual([]);
  await details.click();
  await expect(inquiryPanel(page)).toBeVisible();
  const inquiry = await controlEdges(inquiryPanel(page));
  expect(inquiry.length, 'the Send details form has its fields, choices and button').toBeGreaterThan(14);
  expect(inquiry.filter((c) => c.left < 0 || c.right > PHONE), 'the Send details form: controls outside the screen').toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(PHONE);
});
