import { test, expect } from '@playwright/test';
import { loadSection, loadSite } from '../../src/lib/content/load';
import { pretendMode, stubTurnstile } from './helpers';

// This file runs on both devices, in parallel, against one test server: so every test here leaves the server's state alone.
// (Demo and offline are the page being told another mode; real bookings are in booking-flow.spec.ts.)
const b = loadSection('booking');
test.use({ timezoneId: 'America/New_York' });
test.beforeEach(async ({ page }) => {
  await stubTurnstile(page); // the booking section loads Turnstile when it comes near; no test reaches Cloudflare
  await page.clock.setFixedTime(new Date('2026-11-23T13:00:00Z'));
});

test('an empty submit shows the messages from content, and focus goes to the first field to fix', async ({ page }) => {
  await page.goto('/#book');
  await page.getByRole('button', { name: b.nextLabel }).click();
  await expect(page.getByText(b.errors.name)).toBeVisible();
  await expect(page.getByText(b.errors.email)).toBeVisible();
  await expect(page.getByText(b.errors.buyer)).toBeVisible();
  await expect(page.getByText(b.errors.volume)).toBeVisible();
  await expect(page.getByLabel(b.fields.name)).toBeFocused();
});

test('"I am a…" and videos per month are required', async ({ page }) => {
  const leadRequests: string[] = [];
  page.on('request', (r) => { if (r.url().includes('/api/booking/leads')) leadRequests.push(r.url()); });
  await page.goto('/#book');
  await page.getByLabel(b.fields.name).fill('Zoë');
  await page.getByLabel(b.fields.email).fill('zoe@example.com');
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

test('demo mode: international details, first slot at 9:00 AM New York time, confirmation', async ({ page }) => {
  await pretendMode(page, 'demo');
  await page.goto('/#book');
  await expect(page.getByText(b.demoNote)).toBeVisible();
  await page.getByLabel(b.fields.name).fill("José María O'Brien-Núñez");
  await page.getByLabel(b.fields.email).fill('jose+listing@example.co.uk');
  await page.getByRole('radio', { name: 'Videographer' }).check({ force: true });
  await page.getByRole('radio', { name: b.volumeOptions[1], exact: true }).check({ force: true });
  await page.getByRole('button', { name: b.nextLabel }).click();
  const first = page.getByTestId('slot').first();
  await expect(first).toHaveText('9:00 AM');
  await first.click();
  await page.getByRole('button', { name: b.confirmLabel }).click();
  const done = page.getByTestId('booking-done');
  await expect(done).toContainText('Monday, November 23, 9:00 AM EST');
  await expect(done).toContainText('jose+listing@example.co.uk');
  await expect(done.getByRole('link', { name: b.confirmation.manageLabel })).toBeVisible();
});

test('the demo note shows only in demo mode', async ({ page }) => {
  const config = page.waitForResponse('**/api/booking/config');
  await page.goto('/#book'); // the test server says "live"
  await config;
  await expect(page.getByTestId('booking').locator('form')).toBeVisible();
  await expect(page.getByText(b.demoNote)).toBeHidden();
});

test('off mode: no form, an offline card with Instagram instead', async ({ page }) => {
  await pretendMode(page, 'off');
  await page.goto('/#book');
  const card = page.getByTestId('booking-offline');
  await expect(card).toBeVisible();
  await expect(card.getByRole('heading', { name: b.offline.heading })).toBeVisible();
  await expect(card.getByRole('link', { name: b.confirmation.instagramLabel })).toHaveAttribute('href', loadSite().contact.instagramUrl);
  await expect(page.getByTestId('booking').locator('form')).toBeHidden();
  await expect(page.getByText(b.demoNote)).toBeHidden();
  await expect(page.getByTestId('booking-done')).toBeHidden();
});

test('booking buttons scroll to the booking section', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: loadSection('hero').primaryCta.label }).first().click();
  await expect(page.getByTestId('booking')).toBeInViewport();
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
    const form = page.getByTestId('booking').locator('form');
    await expect(form).toHaveAttribute('method', 'post');
    await expect(form).toHaveAttribute('action', '#book');
    await expect(page.getByRole('button', { name: b.nextLabel })).toBeDisabled();
    await page.getByLabel(b.fields.name).fill('Zoe Private');
    await page.getByLabel(b.fields.email).fill('zoe.private@example.com');
    await page.getByLabel(b.fields.email).press('Enter');
    await expect(page).toHaveURL(/\/#book$/);
    expect(page.url()).not.toMatch(/zoe/i);
    await expect(page.getByText(b.demoNote)).toBeHidden();
    await expect(page.getByTestId('booking-offline')).toBeHidden();
  });
});
