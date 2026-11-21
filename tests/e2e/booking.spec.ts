import { type Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { loadSection, loadSite } from '../../src/lib/content/load';
import { formatSlotLong, formatSlotTime } from '../../src/lib/booking/format';
import { generateSlots } from '../../src/lib/booking/slots';
import { fillPlaceholders } from '../../src/lib/text';
import { callPanel, inquiryPanel, openBooking, pretendMode } from './helpers';

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
  // The switch and the "Send details" form go too: with no booking, there is nothing to choose between.
  await expect(page.locator('[data-switch]')).toBeHidden();
  await expect(page.locator('[data-view="details"]')).toBeHidden();
  await expect(inquiryPanel(page)).toBeHidden();
  await expect(page.getByText(b.demoNote)).toBeHidden();
  await expect(page.getByTestId('booking-done')).toBeHidden();
});

// The switch at the top of the card: "Book a call" (selected when the page opens) and "Send details" (lime, and it shakes now and then).

/** The ink colour of the site (--ink, #0E1233) and its lime (--lime, #D3FF52), as the browser reports them. */
const INK = 'rgb(14, 18, 51)';
const LIME = 'rgb(211, 255, 82)';
const callTab = (page: Page) => page.locator('[data-view="call"]');
const detailsTab = (page: Page) => page.locator('[data-view="details"]');

test('the card opens on Book a call, with Send details in lime', async ({ page }) => {
  await pretendMode(page, 'demo');
  await openBooking(page, '/#book');
  await expect(callTab(page)).toHaveAttribute('aria-selected', 'true');
  await expect(detailsTab(page)).toHaveAttribute('aria-selected', 'false');
  await expect(callTab(page)).toHaveText(b.switch.call);
  await expect(detailsTab(page)).toHaveText(b.switch.details);
  await expect(detailsTab(page)).toHaveCSS('background-color', LIME);
  await expect(detailsTab(page)).toHaveCSS('color', INK);
  await expect(page.locator('[data-heading="call"]')).toBeVisible();
  await expect(callPanel(page)).toBeVisible();
  await expect(inquiryPanel(page)).toBeHidden();
});

test('Send details shows the form and its heading; sending only an email thanks the visitor', async ({ page }) => {
  await pretendMode(page, 'demo');
  await openBooking(page, '/#book');
  await detailsTab(page).click();
  await expect(detailsTab(page)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-heading="details"]')).toHaveText(b.inquiry.heading);
  await expect(page.locator('[data-heading="call"]')).toBeHidden();
  await expect(callPanel(page)).toBeHidden();

  await inquiryPanel(page).getByLabel(b.inquiry.fields.email).fill('ines+inquiry@example.com');
  await inquiryPanel(page).getByRole('button', { name: b.inquiry.submitLabel }).click();
  const done = page.locator('[data-inquiry-done]');
  await expect(done).toBeVisible();
  await expect(done.locator('[data-inq-done-heading]')).toHaveText(b.inquiry.done.heading);
  await expect(done.locator('[data-inq-done-text]')).toHaveText(fillPlaceholders(b.inquiry.done.text, { email: 'ines+inquiry@example.com' }));
  await expect(inquiryPanel(page).locator('form')).toBeHidden();
});

test('a "Book a call" button brings the card back to the call after Send details was chosen', async ({ page }) => {
  await pretendMode(page, 'demo');
  await openBooking(page, '/#book');
  await detailsTab(page).click();
  await expect(inquiryPanel(page)).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);

  await page.getByRole('link', { name: loadSection('hero').primaryCta.label }).first().click();
  await expect(callTab(page)).toHaveAttribute('aria-selected', 'true');
  await expect(detailsTab(page)).toHaveAttribute('aria-selected', 'false');
  await expect(page.locator('[data-heading="call"]')).toBeVisible();
  await expect(callPanel(page)).toBeVisible();
  await expect(inquiryPanel(page)).toBeHidden();
});

test('a wrong email is told on the field and nothing is sent', async ({ page }) => {
  const sent: string[] = [];
  page.on('request', (r) => { if (r.url().includes('/api/booking/inquiries')) sent.push(r.url()); });
  await pretendMode(page, 'demo');
  await openBooking(page, '/#book');
  await detailsTab(page).click();
  await inquiryPanel(page).getByLabel(b.inquiry.fields.email).fill('nope');
  await inquiryPanel(page).getByRole('button', { name: b.inquiry.submitLabel }).click();
  await expect(inquiryPanel(page).getByText(b.inquiry.errors.email)).toBeVisible();
  await expect(inquiryPanel(page).getByLabel(b.inquiry.fields.email)).toBeFocused();
  await expect(page.locator('[data-inquiry-done]')).toBeHidden();
  expect(sent).toEqual([]);
});

/** True when `[data-view="details"]` got the class `shake` at any moment in the next `ms` ms. */
const shakesWithin = (page: Page, ms: number) => page.evaluate((window_) => new Promise<boolean>((resolve) => {
  const tab = document.querySelector('[data-view="details"]')!;
  let shook = tab.classList.contains('shake');
  const watcher = new MutationObserver(() => { if (tab.classList.contains('shake')) shook = true; });
  watcher.observe(tab, { attributes: true, attributeFilter: ['class'] });
  setTimeout(() => { watcher.disconnect(); resolve(shook); }, window_);
}), ms);

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('the button never shakes', async ({ page }) => {
    await pretendMode(page, 'demo');
    await openBooking(page, '/#book');
    await page.locator('[data-switch]').scrollIntoViewIfNeeded();
    await expect(page.locator('[data-switch]')).toBeInViewport({ ratio: 0.6 }); // the switch is on the screen, where a shake would start
    expect(await shakesWithin(page, 2000)).toBe(false);
    await expect(detailsTab(page)).toHaveCSS('background-color', LIME); // still lime: only the motion is left out
  });
});

test.describe('with normal motion', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('the Send details button shakes once the card is in view', async ({ page }) => {
    test.setTimeout(60_000); // the home page's live 3D can keep a busy machine's page waiting for a while: the 2 seconds below start once the card is in view
    await pretendMode(page, 'demo');
    await page.goto('/');
    await page.locator('[data-switch]').scrollIntoViewIfNeeded();
    // The first shake is meant to come 600 ms after the switch is on the screen. A shake lasts 0.7 s, so it is looked for on every frame.
    await page.waitForFunction(() => document.querySelector('[data-view="details"]')!.classList.contains('shake'), undefined, { timeout: 2000, polling: 'raf' });
  });

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
