import { test, expect } from './fixtures';
import { loadSection, loadSite } from '../../src/lib/content/load';
import { formatSlotLong, formatSlotTime } from '../../src/lib/booking/format';
import { generateSlots } from '../../src/lib/booking/slots';
import { callPanel, openBooking, pretendMode } from './helpers';

// This file runs on both devices, in parallel, against one test server: so every test here leaves the server's state alone.
// (Demo and offline are the page being told another mode; real bookings are in booking-flow.spec.ts.)
const b = loadSection('booking');
const VISITOR_TZ = 'America/New_York';
// The tests about the form are not about the page's motion. With reduced motion the page keeps its 3D scene, hero video and clips still
// and jumps to `#book` at once instead of scrolling smoothly, so four pages at a time cannot starve one another on a busy machine.
// (That only lightens the load: each test still waits for the form to start, with openBooking.) The one test of the "Book a call"
// buttons opts out below, so the smooth scroll to the form stays covered.
test.use({ timezoneId: VISITOR_TZ, reducedMotion: 'reduce' });
/** The clock of every test here: the page believes it is this moment, whatever day the tests really run on. */
const NOW = new Date('2026-11-23T13:00:00Z');
test.beforeEach(async ({ page }) => { await page.clock.setFixedTime(NOW); });

test('an empty submit shows the messages from content, and focus goes to the first field to fix', async ({ page }) => {
  await openBooking(page, '/#book'); // not before the form has started: it is the form's own handler that shows the messages
  await page.getByRole('button', { name: b.nextLabel }).click();
  await expect(page.getByText(b.errors.name)).toBeVisible();
  await expect(page.getByText(b.errors.email)).toBeVisible();
  await expect(page.getByText(b.errors.buyer)).toBeVisible();
  await expect(page.getByText(b.errors.volume)).toBeVisible();
  await expect(callPanel(page).getByLabel(b.fields.name)).toBeFocused();
});

test('"I am a…" and videos per month are required', async ({ page }) => {
  const leadRequests: string[] = [];
  page.on('request', (r) => { if (r.url().includes('/api/booking/leads')) leadRequests.push(r.url()); });
  await openBooking(page, '/#book');
  await callPanel(page).getByLabel(b.fields.name).fill('Zoë');
  await callPanel(page).getByLabel(b.fields.email).fill('zoe@example.com');
  await page.getByRole('button', { name: b.nextLabel }).click();
  await expect(page.getByText(b.errors.buyer)).toBeVisible();
  await expect(page.getByText(b.errors.volume)).toBeVisible();
  await expect(page.getByText(b.errors.name)).toBeHidden();
  await expect(page.getByRole('radio', { name: b.buyerOptions[0].label })).toBeFocused(); // the first invalid field
  await page.getByRole('radio', { name: b.buyerOptions[0].label }).check({ force: true });
  await page.getByRole('button', { name: b.nextLabel }).click();
  await expect(page.getByText(b.errors.buyer)).toBeHidden();
  await expect(page.getByText(b.errors.volume)).toBeVisible();
  await expect(page.getByRole('radio', { name: b.volumeOptions[0], exact: true })).toBeFocused();
  expect(leadRequests).toEqual([]); // nothing was sent
});

test('versions preselect the buyer type', async ({ page }) => {
  await page.goto('/agents#book');
  await expect(page.getByRole('radio', { name: 'Agent', exact: true })).toBeChecked();
  await page.goto('/agencies#book');
  await expect(page.getByRole('radio', { name: 'Media agency' })).toBeChecked();
});

test('demo mode: international details, the first offered time in the visitor time zone, confirmation', async ({ page }) => {
  // What the demo offers first, worked out from the same clock and booking rules the page uses (not a date typed in here).
  const [first] = generateSlots(loadSite().booking, NOW);
  await pretendMode(page, 'demo');
  await openBooking(page, '/#book');
  await expect(page.getByText(b.demoNote)).toBeVisible();
  await callPanel(page).getByLabel(b.fields.name).fill("José María O'Brien-Núñez");
  await callPanel(page).getByLabel(b.fields.email).fill('jose+listing@example.co.uk');
  await page.getByRole('radio', { name: 'Videographer' }).check({ force: true });
  await page.getByRole('radio', { name: b.volumeOptions[1], exact: true }).check({ force: true });
  await page.getByRole('button', { name: b.nextLabel }).click();
  const firstSlot = page.getByTestId('slot').first();
  await expect(firstSlot).toHaveText(formatSlotTime(first, VISITOR_TZ));
  await firstSlot.click();
  await page.getByRole('button', { name: b.confirmLabel }).click();
  const done = page.getByTestId('booking-done');
  await expect(done).toContainText(formatSlotLong(first, VISITOR_TZ));
  await expect(done).toContainText('jose+listing@example.co.uk');
  await expect(done.getByRole('link', { name: b.confirmation.manageLabel })).toBeVisible();
});

test('the demo note shows only in demo mode', async ({ page }) => {
  await openBooking(page, '/#book'); // the test server says "live"
  await expect(callPanel(page).locator('form')).toBeVisible();
  await expect(page.getByText(b.demoNote)).toBeHidden();
});

test('off mode: no form, an offline card with Instagram instead', async ({ page }) => {
  await pretendMode(page, 'off');
  await openBooking(page, '/#book');
  const card = page.getByTestId('booking-offline');
  await expect(card).toBeVisible();
  await expect(card.getByRole('heading', { name: b.offline.heading })).toBeVisible();
  await expect(card.getByRole('link', { name: b.confirmation.instagramLabel })).toHaveAttribute('href', loadSite().contact.instagramUrl);
  await expect(callPanel(page).locator('form')).toBeHidden();
  await expect(page.getByText(b.demoNote)).toBeHidden();
  await expect(page.getByTestId('booking-done')).toBeHidden();
});

test.describe('with normal motion', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('booking buttons scroll to the booking section', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: loadSection('hero').primaryCta.label }).first().click();
    await expect(page.getByTestId('booking')).toBeInViewport({ timeout: 20_000 }); // the page scrolls smoothly, which takes seconds on a long page
  });
});

test('the booking server and Cloudflare are asked nothing until the section is near, and nothing before the page has loaded', async ({ page }) => {
  // Records the state of the page at the moment Cloudflare's script is added.
  await page.addInitScript(() => {
    new MutationObserver((records) => {
      for (const r of records) for (const n of Array.from(r.addedNodes)) {
        if (n instanceof HTMLScriptElement && n.src.includes('challenges.cloudflare.com')) (window as unknown as { tsAddedWhen: string }).tsAddedWhen = document.readyState;
      }
    }).observe(document, { childList: true, subtree: true });
  });
  const asked: string[] = [];
  page.on('request', (r) => { if (/\/api\/booking\/config|challenges\.cloudflare\.com/.test(r.url())) asked.push(r.url()); });

  await page.goto('/', { waitUntil: 'load' });
  await page.waitForTimeout(1500); // time for anything that was going to fire to fire
  expect(asked).toEqual([]);

  await page.getByTestId('booking').scrollIntoViewIfNeeded();
  await expect.poll(() => asked.some((u) => u.includes('/api/booking/config'))).toBe(true);
  await expect.poll(() => asked.some((u) => u.includes('challenges.cloudflare.com/turnstile/v0/api.js'))).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { tsAddedWhen: string }).tsAddedWhen)).toBe('complete');
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('without JavaScript the form cannot be submitted, so nothing lands in the URL', async ({ page }) => {
    await page.goto('/#book');
    const form = callPanel(page).locator('form');
    await expect(form).toHaveAttribute('method', 'post');
    await expect(form).toHaveAttribute('action', '#book');
    await expect(page.getByRole('button', { name: b.nextLabel })).toBeDisabled();
    await callPanel(page).getByLabel(b.fields.name).fill('Zoe Private');
    await callPanel(page).getByLabel(b.fields.email).fill('zoe.private@example.com');
    await callPanel(page).getByLabel(b.fields.email).press('Enter');
    await expect(page).toHaveURL(/\/#book$/);
    expect(page.url()).not.toMatch(/zoe/i);
    await expect(page.getByText(b.demoNote)).toBeHidden();
    await expect(page.getByTestId('booking-offline')).toBeHidden();
  });
});
