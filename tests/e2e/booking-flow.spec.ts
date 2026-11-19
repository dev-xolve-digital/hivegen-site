import { test, expect, type Page } from '@playwright/test';
import { loadSection } from '../../src/lib/content/load';
import { groupByLocalDay } from '../../src/lib/booking/format';
import { book, bookNewLead, createLead, getSlots, goodLead, outbox, resetServer, setCalendar, stubTurnstile, trackedEvents } from './helpers';

const b = loadSection('booking');

// Every browser test that changes server state lives in this file. They share the test server's memory, so they run one at a time,
// on the desktop project only, and each starts from an empty server. Other spec files must not change server state.
test.describe.configure({ mode: 'serial' });
test.skip(({ isMobile }) => isMobile, 'desktop only');
test.use({ timezoneId: 'America/New_York' }); // the same times of day for the page and for these tests, whenever they run
test.beforeEach(async ({ request }) => { await resetServer(request); });

/** Fills step 1 the way a visitor would. Anything left out is a good default. */
async function fillDetails(page: Page, who: { name?: string; email?: string; buyer?: string; volume?: string } = {}): Promise<void> {
  await page.getByLabel(b.fields.name).fill(who.name ?? 'Zoë O’Brien');
  await page.getByLabel(b.fields.email).fill(who.email ?? 'zoe+ui@example.com');
  await page.getByRole('radio', { name: who.buyer ?? 'Agent', exact: true }).check({ force: true });
  await page.getByRole('radio', { name: who.volume ?? b.volumeOptions[1], exact: true }).check({ force: true });
}

/** Step 1, then the first offered time picked, ready to confirm. */
async function toConfirm(page: Page, who: Parameters<typeof fillDetails>[1] = {}): Promise<void> {
  await fillDetails(page, who);
  await page.getByRole('button', { name: b.nextLabel }).click();
  await expect(page.getByTestId('slot').first()).toBeVisible();
  await page.getByTestId('slot').first().click();
}

test('a lead, then a booking, through the HTTP API; booking twice returns the same booking', async ({ request }) => {
  const lead = await request.post('/api/booking/leads', { data: goodLead });
  expect(lead.status()).toBe(200);
  expect(lead.headers()['cache-control']).toBe('no-store');
  const { leadId, eventId } = (await lead.json()) as { leadId: string; eventId: string };
  expect(eventId).toBe(`lead.${leadId}`);

  const { slots, calendarChecked } = await getSlots(request);
  expect(calendarChecked).toBe(true);
  expect(slots.length).toBeGreaterThan(10);

  const first = await book(request, leadId, slots[3].start);
  expect(first.status()).toBe(200);
  const booked = await first.json();
  expect(booked).toMatchObject({ status: 'booked', start: slots[3].start, end: slots[3].end, eventId: `schedule.${leadId}` });
  expect(booked.manageUrl).toMatch(/\/booking\/[A-Za-z0-9_-]{43}$/);
  expect(booked.meetUrl).toMatch(/^https:\/\/meet\.google\.com\//);

  const again = await book(request, leadId, slots[3].start);
  expect(again.status()).toBe(200);
  expect((await again.json()).manageUrl).toBe(booked.manageUrl);

  expect((await outbox(request)).map((m) => m.kind)).toEqual(['booking-confirmed', 'hassan-new-booking']);
  const events = await trackedEvents(request);
  expect(events.map((e) => e.name)).toEqual(['Lead', 'Schedule']);
  expect(events[0].sourceUrl).toMatch(/^https?:\/\//); // never empty
  expect(events[1].eventId).toBe(`schedule.${leadId}`);
  expect((await getSlots(request)).slots.map((s) => s.start)).not.toContain(slots[3].start);
});

test('a time Google shows as busy answers 409 slot_taken', async ({ request }) => {
  const leadId = await createLead(request);
  const { slots } = await getSlots(request);
  await setCalendar(request, { busy: [slots[2]] });
  expect((await getSlots(request)).slots.map((s) => s.start)).not.toContain(slots[2].start);
  const res = await book(request, leadId, slots[2].start);
  expect(res.status()).toBe(409);
  expect(await res.json()).toEqual({ error: 'slot_taken' });
});

test('with Google down, the booking is only requested and Hassan is asked to confirm it by hand', async ({ request }) => {
  await setCalendar(request, { down: true });
  const { slots, calendarChecked } = await getSlots(request);
  expect(calendarChecked).toBe(false);
  const leadId = await createLead(request);
  const res = await book(request, leadId, slots[4].start);
  expect(res.status()).toBe(200);
  const booked = await res.json();
  expect(booked.status).toBe('requested');
  expect(booked.meetUrl).toBeUndefined();
  expect((await outbox(request)).map((m) => m.kind)).toEqual(['booking-requested', 'hassan-confirm-by-hand']);
});

test('the manage routes: reschedule, then cancel; a made-up token is 404', async ({ request }) => {
  const { token, slots } = await bookNewLead(request, 5);

  const moved = await request.post(`/api/booking/manage/${token}/reschedule`, { data: { start: slots[9].start } });
  expect(moved.status()).toBe(200);
  expect(await moved.json()).toEqual({ status: 'booked', start: slots[9].start, end: slots[9].end });
  const afterMove = (await getSlots(request)).slots.map((s) => s.start);
  expect(afterMove).toContain(slots[5].start);
  expect(afterMove).not.toContain(slots[9].start);

  const cancelled = await request.post(`/api/booking/manage/${token}/cancel`);
  expect(cancelled.status()).toBe(200);
  expect(await cancelled.json()).toEqual({ status: 'cancelled' });
  expect((await getSlots(request)).slots.map((s) => s.start)).toContain(slots[9].start);
  expect((await outbox(request)).map((m) => m.kind)).toEqual([
    'booking-confirmed', 'hassan-new-booking', 'booking-rescheduled', 'hassan-booking-changed', 'booking-cancelled', 'hassan-booking-changed',
  ]);

  const unknown = await request.post(`/api/booking/manage/${'x'.repeat(43)}/cancel`);
  expect(unknown.status()).toBe(404);
  expect(await unknown.json()).toEqual({ error: 'not_found' });
});

test('the 11th lead from one address in an hour is 429, and a reset starts the count again', async ({ request }) => {
  for (let i = 1; i <= 10; i += 1) expect((await request.post('/api/booking/leads', { data: goodLead })).status(), `lead ${i}`).toBe(200);
  const blocked = await request.post('/api/booking/leads', { data: goodLead });
  expect(blocked.status()).toBe(429);
  expect(await blocked.json()).toEqual({ error: 'rate_limited' });
  // Another address (CF-Connecting-IP) has its own allowance.
  expect((await request.post('/api/booking/leads', { data: goodLead, headers: { 'cf-connecting-ip': '203.0.113.5' } })).status()).toBe(200);

  await resetServer(request);
  expect((await request.post('/api/booking/leads', { data: goodLead })).status()).toBe(200);
});

test('a failed bot check is 403 and a bad form is 400 with its fields', async ({ request }) => {
  const bot = await request.post('/api/booking/leads', { data: { ...goodLead, turnstileToken: 'fail' } });
  expect(bot.status()).toBe(403);
  expect(await bot.json()).toEqual({ error: 'bot_check_failed' });
  const bad = await request.post('/api/booking/leads', { data: { ...goodLead, name: '', email: 'nope' } });
  expect(bad.status()).toBe(400);
  expect(await bad.json()).toEqual({ error: 'invalid', fields: { name: 'required', email: 'invalid' } });
  const notJson = await request.post('/api/booking/leads', { data: 'not json', headers: { 'content-type': 'application/json' } });
  expect(notJson.status()).toBe(400);
});

test('a body over 32 KB is refused with 400 invalid before it is read into memory', async ({ request }) => {
  const res = await request.post('/api/booking/leads', { data: { ...goodLead, name: 'x'.repeat(40_000) } });
  expect(res.status()).toBe(400);
  expect(res.headers()['cache-control']).toBe('no-store');
  expect(await res.json()).toEqual({ error: 'invalid' });
  expect((await trackedEvents(request))).toEqual([]);
});

// The booking form in a real browser, on the real API (the test server's fake Google, mailbox and bot check).

test('books a real call: confirmation, manage link, both emails sent, and a double click does it only once', async ({ page, request }) => {
  await stubTurnstile(page);
  const posts: string[] = [];
  page.on('request', (r) => { if (r.method() === 'POST') posts.push(new URL(r.url()).pathname); });
  await page.goto('/#book');
  await fillDetails(page, { email: 'jose+listing@example.co.uk' });
  await page.getByRole('button', { name: b.nextLabel }).dblclick(); // one lead, however fast the clicks
  await expect(page.getByTestId('slot').first()).toBeVisible();
  await page.getByTestId('slot').first().click();
  await page.getByRole('button', { name: b.confirmLabel }).dblclick(); // one booking

  const done = page.getByTestId('booking-done');
  await expect(done.getByRole('heading', { name: b.confirmation.heading })).toBeVisible();
  await expect(done).toContainText('jose+listing@example.co.uk');
  await expect(done.getByRole('link', { name: b.confirmation.addToCalendar })).toBeVisible();
  // PUBLIC_SITE_URL of the test server: the link the visitor gets points at that server.
  await expect(done.getByRole('link', { name: b.confirmation.manageLabel })).toHaveAttribute('href', /^http:\/\/127\.0\.0\.1:4322\/booking\/[A-Za-z0-9_-]{43}$/);

  expect(posts.filter((p) => p === '/api/booking/leads')).toHaveLength(1);
  expect(posts.filter((p) => p === '/api/booking/bookings')).toHaveLength(1);
  const mails = await outbox(request);
  expect(mails.map((m) => m.kind)).toEqual(['booking-confirmed', 'hassan-new-booking']);
  expect(mails[0].to).toBe('jose+listing@example.co.uk');
  expect(mails[1].text).toContain('Type: agent');
});

test('when Google is down the visitor sees the requested panel, never "You\'re booked."', async ({ page, request }) => {
  await stubTurnstile(page);
  await page.goto('/#book');
  await toConfirm(page); // the times were offered while Google was up...
  await setCalendar(request, { down: true }); // ...and it goes down before the visitor confirms
  await page.getByRole('button', { name: b.confirmLabel }).click();

  const done = page.getByTestId('booking-done');
  await expect(done.getByRole('heading', { name: b.requested.heading })).toBeVisible();
  await expect(done).not.toContainText(b.confirmation.heading);
  await expect(page.getByText(b.confirmation.heading)).toHaveCount(0);
  await expect(done.getByRole('link', { name: b.confirmation.manageLabel })).toBeVisible();
  await expect(done.getByRole('link', { name: b.confirmation.addToCalendar })).toBeHidden();
  expect((await outbox(request)).map((m) => m.kind)).toEqual(['booking-requested', 'hassan-confirm-by-hand']);
});

test('with Google down from the start, the note says so and the booking is only requested', async ({ page, request }) => {
  await setCalendar(request, { down: true });
  await stubTurnstile(page);
  await page.goto('/#book');
  await toConfirm(page);
  await expect(page.getByText(b.calendarNote.split('{backupLink}')[0].trim())).toBeVisible();
  await page.getByRole('button', { name: b.confirmLabel }).click();
  await expect(page.getByTestId('booking-done').getByRole('heading', { name: b.requested.heading })).toBeVisible();
});

test('a slot taken meanwhile shows the message and fresh times', async ({ page, request }) => {
  await stubTurnstile(page);
  await page.goto('/#book');
  await fillDetails(page);
  await page.getByRole('button', { name: b.nextLabel }).click();
  // Tomorrow's times, whatever the time of day the test runs: the second day offered, a full 9:00 AM to 4:00 PM New York day.
  await page.locator('[data-days] button').nth(1).click();
  const before = await page.getByTestId('slot').allTextContents();
  expect(before.length).toBeGreaterThan(10);
  await page.getByTestId('slot').first().click();
  // Someone else gets that time first.
  const { slots } = await getSlots(request);
  await setCalendar(request, { busy: [groupByLocalDay(slots, 'America/New_York')[1].slots[0]] });
  await page.getByRole('button', { name: b.confirmLabel }).click();

  await expect(page.getByText(b.errors.slotTaken)).toBeVisible();
  await expect(page.getByTestId('booking-done')).toBeHidden();
  await expect(page.getByRole('button', { name: b.confirmLabel })).toBeDisabled(); // pick again
  await page.locator('[data-days] button').nth(1).click();
  await expect.poll(() => page.getByTestId('slot').allTextContents()).toEqual(before.slice(1)); // fresh times, without the taken one
  await page.getByTestId('slot').first().click();
  await page.getByRole('button', { name: b.confirmLabel }).click();
  await expect(page.getByTestId('booking-done').getByRole('heading', { name: b.confirmation.heading })).toBeVisible();
});

test('a network failure on step 1 keeps the visitor on step 1 with a clear message, and trying again works', async ({ page, request }) => {
  await stubTurnstile(page);
  await page.route('**/api/booking/leads', (route) => route.abort());
  await page.goto('/#book');
  await fillDetails(page);
  await page.getByRole('button', { name: b.nextLabel }).click();

  await expect(page.getByText(b.errors.network)).toBeVisible();
  await expect(page.getByRole('heading', { name: b.timeHeading })).toBeHidden();
  await expect(page.getByLabel(b.fields.name)).toBeVisible();
  await expect(page.getByRole('button', { name: b.nextLabel })).toBeEnabled();
  expect(await outbox(request)).toEqual([]);

  await page.unroute('**/api/booking/leads');
  await page.getByRole('button', { name: b.nextLabel }).click();
  await expect(page.getByTestId('slot').first()).toBeVisible();
});

test('the visitor\'s ad tags reach the lead', async ({ page, request }) => {
  await stubTurnstile(page);
  await page.goto('/agents?utm_source=facebook&utm_campaign=spring&fbclid=x#book');
  await page.goto('/agents#book'); // a later page view without the tags: the first touch is kept
  await toConfirm(page);
  await page.getByRole('button', { name: b.confirmLabel }).click();
  await expect(page.getByTestId('booking-done').getByRole('heading', { name: b.confirmation.heading })).toBeVisible();

  const hassan = (await outbox(request)).find((m) => m.kind === 'hassan-new-booking')!;
  expect(hassan.text).toMatch(/Came from: .*facebook/);
  expect(hassan.text).toContain('Page: agents');
  const lead = (await trackedEvents(request)).find((e) => e.name === 'Lead')!;
  expect(lead.user.fbc).toMatch(/^fb\.1\.\d+\.x$/); // built from the fbclid the visitor arrived with
});
