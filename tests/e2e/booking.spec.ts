import { test, expect } from '@playwright/test';
import { loadSection } from '../../src/lib/content/load';
const b = loadSection('booking');
test.use({ timezoneId: 'America/New_York' });
test.beforeEach(async ({ page }) => { await page.clock.setFixedTime(new Date('2026-11-23T13:00:00Z')); });

test('an empty submit shows the messages from content', async ({ page }) => {
  await page.goto('/#book');
  await page.getByRole('button', { name: b.nextLabel }).click();
  await expect(page.getByText(b.errors.name)).toBeVisible();
  await expect(page.getByText(b.errors.email)).toBeVisible();
});
test('versions preselect the buyer type', async ({ page }) => {
  await page.goto('/agents#book');
  await expect(page.getByRole('radio', { name: 'Agent', exact: true })).toBeChecked();
  await page.goto('/agencies#book');
  await expect(page.getByRole('radio', { name: 'Media agency' })).toBeChecked();
});
test('international details, first slot at 9:00 AM New York time, confirmation', async ({ page }) => {
  await page.goto('/#book');
  await page.getByLabel(b.fields.name).fill("José María O'Brien-Núñez");
  await page.getByLabel(b.fields.email).fill('jose+listing@example.co.uk');
  await page.getByRole('button', { name: b.nextLabel }).click();
  const first = page.getByTestId('slot').first();
  await expect(first).toHaveText('9:00 AM');
  await first.click();
  await page.getByRole('button', { name: b.confirmLabel }).click();
  await expect(page.getByTestId('booking-done')).toContainText('Monday, November 23, 9:00 AM EST');
  await expect(page.getByTestId('booking-done')).toContainText('jose+listing@example.co.uk');
});
test('the demo note is visible in draft mode', async ({ page }) => {
  await page.goto('/#book');
  await expect(page.getByText(b.demoNote)).toBeVisible();
});
test('booking buttons scroll to the booking section', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: loadSection('hero').primaryCta.label }).first().click();
  await expect(page.getByTestId('booking')).toBeInViewport();
});
