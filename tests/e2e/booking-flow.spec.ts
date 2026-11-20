import { type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './fixtures';
import { loadSection } from '../../src/lib/content/load';
import { formatSlotLong, formatSlotTime, groupByLocalDay } from '../../src/lib/booking/format';
import { fillPlaceholders } from '../../src/lib/text';
import { book, bookNewLead, callPanel, createLead, enableTracking, getSlots, goodLead, outbox, resetServer, setCalendar, TRACKING_IDS, trackedEvents, trackerCalls, type Slot } from './helpers';

const b = loadSection('booking');
const mg = loadSection('manage-booking');

// Every browser test that changes server state lives in this file. They share the test server's memory, so they run one at a time,
// on the desktop project only, and each starts from an empty server. Other spec files must not change server state.
test.describe.configure({ mode: 'serial' });
test.skip(({ isMobile }) => isMobile, 'desktop only');
test.use({ timezoneId: 'America/New_York' }); // the same times of day for the page and for these tests, whenever they run
test.beforeEach(async ({ request }) => { await resetServer(request); });

/** Fills step 1 the way a visitor would. Anything left out is a good default. */
async function fillDetails(page: Page, who: { name?: string; email?: string; buyer?: string; volume?: string } = {}): Promise<void> {
  await callPanel(page).getByLabel(b.fields.name).fill(who.name ?? 'Zoë O’Brien');
  await callPanel(page).getByLabel(b.fields.email).fill(who.email ?? 'zoe+ui@example.com');
  // The radio itself is hidden and its pill is the control: click the pill, which waits for the page to settle (a forced check on the
  // hidden radio could miss it when the layout was still moving).
  const choose = (name: string) => page.locator('label').filter({ has: page.getByRole('radio', { name, exact: true }) }).click();
  await choose(who.buyer ?? 'Agent');
  await choose(who.volume ?? b.volumeOptions[1]);
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
  await page.goto('/#book');
  await toConfirm(page);
  await expect(page.getByText(b.calendarNote.split('{backupLink}')[0].trim())).toBeVisible();
  await page.getByRole('button', { name: b.confirmLabel }).click();
  await expect(page.getByTestId('booking-done').getByRole('heading', { name: b.requested.heading })).toBeVisible();
});

test('a slot taken meanwhile shows the message and fresh times', async ({ page, request }) => {
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
  await page.route('**/api/booking/leads', (route) => route.abort());
  await page.goto('/#book');
  await fillDetails(page);
  await page.getByRole('button', { name: b.nextLabel }).click();

  await expect(page.getByText(b.errors.network)).toBeVisible();
  await expect(page.getByRole('heading', { name: b.timeHeading })).toBeHidden();
  await expect(callPanel(page).getByLabel(b.fields.name)).toBeVisible();
  await expect(page.getByRole('button', { name: b.nextLabel })).toBeEnabled();
  expect(await outbox(request)).toEqual([]);

  await page.unroute('**/api/booking/leads');
  await page.getByRole('button', { name: b.nextLabel }).click();
  await expect(page.getByTestId('slot').first()).toBeVisible();
});

test('the visitor\'s ad tags reach the lead', async ({ page, request }) => {
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

// Tracking in a real browser, on the real API: the page's own tracking code runs, with the Meta and Google scripts stubbed (nothing reaches either).

const SITE = 'http://127.0.0.1:4322'; // the test server's PUBLIC_SITE_URL: an address on it is a usable source for an event

test('a page view reaches the server with the event id the Pixel got, the page, and the visitor browser', async ({ page, request }) => {
  await enableTracking(page);
  await page.goto(`${SITE}/agents?utm_source=facebook&fbclid=AbC123`);
  await expect.poll(async () => (await trackedEvents(request)).some((e) => e.name === 'PageView')).toBe(true);
  const { fbq } = await trackerCalls(page);
  const eventID = (fbq.find((c) => c[0] === 'track' && c[1] === 'PageView')![3] as { eventID: string }).eventID;
  const [view] = (await trackedEvents(request)).filter((e) => e.name === 'PageView');
  expect(view.eventId).toBe(eventID);
  expect(view.sourceUrl).toBe(`${SITE}/agents?utm_source=facebook&fbclid=AbC123`);
  expect(view.user.fbc).toMatch(/^fb\.1\.\d+\.AbC123$/);
  expect(view.user.userAgent).toMatch(/Chrome/);
  expect(view.user.ip).toBeTruthy();
  expect(view.user.email).toBeUndefined(); // nothing personal in a PageView
});

test('the Pixel Lead and Schedule events carry the event ids the server sent to Meta, and Google gets the conversion with the email', async ({ page, request }) => {
  await enableTracking(page);
  await page.goto(`${SITE}/#book`);
  await toConfirm(page, { email: 'zoe+ui@example.com' });
  await page.getByRole('button', { name: b.confirmLabel }).click();
  await expect(page.getByTestId('booking-done').getByRole('heading', { name: b.confirmation.heading })).toBeVisible();
  await expect.poll(async () => (await trackedEvents(request)).some((e) => e.name === 'PageView')).toBe(true); // the page's own beacon, so it does not land in a later test

  const server = await trackedEvents(request);
  const lead = server.find((e) => e.name === 'Lead')!;
  const schedule = server.find((e) => e.name === 'Schedule')!;
  expect(lead.eventId).toMatch(/^lead\.[A-Za-z0-9_-]{22}$/);
  expect(schedule.eventId).toBe(lead.eventId.replace('lead.', 'schedule.'));

  const { fbq, gtag } = await trackerCalls(page);
  expect(fbq).toContainEqual(['track', 'Lead', {}, { eventID: lead.eventId }]); // the same id on both sides: Meta counts each once
  expect(fbq).toContainEqual(['track', 'Schedule', {}, { eventID: schedule.eventId }]);
  expect(gtag.filter((c) => c[0] === 'set' || (c[0] === 'event' && c[1] !== 'video_play'))).toEqual([
    ['event', 'generate_lead'],
    ['set', 'user_data', { email: 'zoe+ui@example.com' }],
    ['event', 'conversion', { send_to: `${TRACKING_IDS.googleAdsId}/${TRACKING_IDS.googleAdsScheduleLabel}` }],
    ['event', 'book_call'],
  ]);
  expect(JSON.stringify(fbq)).not.toContain('zoe'); // the Pixel never sees the visitor email
});

// The manage page (/booking/<token>) in a real browser: each booking is made through the HTTP API, as an email link would lead to it.

const TZ = 'America/New_York';
const manageNotice = (page: Page) => page.getByTestId('manage-notice');
const manageWhen = (page: Page) => page.getByTestId('manage-when');
const outboxKinds = async (request: Parameters<typeof outbox>[0]) => (await outbox(request)).map((m) => m.kind);

/** In the reschedule picker: the day of `target`, then its time. */
async function pickTime(page: Page, slots: Slot[], target: Slot): Promise<void> {
  const day = groupByLocalDay(slots, TZ).findIndex((g) => g.slots.some((s) => s.start === target.start));
  await page.locator('[data-days] button').nth(day).click();
  await page.getByRole('button', { name: formatSlotTime(target, TZ), exact: true }).click();
}

test('the manage page shows the call time and the Meet link', async ({ page, request }) => {
  const { booked, token, slots } = await bookNewLead(request, 5);
  await page.goto(`/booking/${token}`);

  await expect(page).toHaveTitle(mg.title);
  await expect(page.getByRole('heading', { level: 1, name: mg.heading })).toBeVisible();
  await expect(page.getByText(mg.whenLabel, { exact: true })).toBeVisible();
  await expect(manageWhen(page)).toHaveText(formatSlotLong(slots[5], TZ));
  await expect(page.getByText(mg.meetLabel, { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: booked.meetUrl!.replace(/^https:\/\//, '') })).toHaveAttribute('href', booked.meetUrl!);
  await expect(page.getByRole('button', { name: mg.rescheduleLabel })).toBeVisible();
  await expect(page.getByRole('button', { name: mg.cancelLabel })).toBeVisible();
  // Nothing the visitor typed (name, email, phone) is in the page: only their own call.
  const html = await page.content();
  for (const secret of ['zoe+ads@example.com', 'O’Brien', '555) 010-2000', 'drive.google.com']) expect(html).not.toContain(secret);
});

test('the time is shown, with its zone, in the zone the visitor booked in, whatever the browser\'s zone is', async ({ page, request }) => {
  const { token, slots } = await bookNewLead(request, 5, 'Asia/Tokyo');
  await page.goto(`/booking/${token}`); // this browser is in New York
  await expect(manageWhen(page)).toHaveText(formatSlotLong(slots[5], 'Asia/Tokyo'));
  await expect(manageWhen(page)).toContainText('GMT+9');
  await page.getByRole('button', { name: mg.rescheduleLabel }).click();
  await expect(page.getByText(fillPlaceholders(b.timeNote, { timezone: 'Asia/Tokyo' }))).toBeVisible();
});

test('rescheduling moves the call and sends the "rescheduled" emails', async ({ page, request }) => {
  const { token, slots } = await bookNewLead(request, 5);
  const target = slots[9];
  await page.goto(`/booking/${token}`);
  await page.getByRole('button', { name: mg.rescheduleLabel }).click();
  await expect(page.getByRole('heading', { name: mg.rescheduleHeading })).toBeVisible();
  const confirm = page.getByRole('button', { name: mg.confirmRescheduleLabel });
  await expect(confirm).toBeDisabled(); // until a time is picked
  await pickTime(page, slots, target);
  await expect(confirm).toBeEnabled();
  await confirm.click();

  const when = formatSlotLong(target, TZ);
  await expect(manageNotice(page)).toHaveText(fillPlaceholders(mg.rescheduledText, { when }));
  await expect(manageWhen(page)).toHaveText(when);
  await expect(page.getByRole('heading', { name: mg.rescheduleHeading })).toBeHidden();
  expect(await outboxKinds(request)).toEqual(['booking-confirmed', 'hassan-new-booking', 'booking-rescheduled', 'hassan-booking-changed']);
  const offered = (await getSlots(request)).slots.map((s) => s.start);
  expect(offered).toContain(slots[5].start); // the old time is free again
  expect(offered).not.toContain(target.start);

  await page.reload();
  await expect(manageWhen(page)).toHaveText(when);
});

test('a time taken meanwhile shows the message and fresh times, and nothing moves', async ({ page, request }) => {
  const { token, slots } = await bookNewLead(request, 5);
  const target = slots[9];
  await page.goto(`/booking/${token}`);
  await page.getByRole('button', { name: mg.rescheduleLabel }).click();
  await pickTime(page, slots, target);
  await setCalendar(request, { busy: [target] }); // someone else gets that time first
  await page.getByRole('button', { name: mg.confirmRescheduleLabel }).click();

  await expect(page.getByText(b.errors.slotTaken)).toBeVisible();
  await expect(page.getByRole('button', { name: mg.confirmRescheduleLabel })).toBeDisabled(); // pick again
  await expect(page.getByRole('button', { name: formatSlotTime(target, TZ), exact: true })).toHaveCount(0); // fresh times, without it
  await expect(manageWhen(page)).toHaveText(formatSlotLong(slots[5], TZ));
  expect(await outboxKinds(request)).toEqual(['booking-confirmed', 'hassan-new-booking']);

  await setCalendar(request, { busy: [] });
  await pickTime(page, slots, slots[10]);
  await page.getByRole('button', { name: mg.confirmRescheduleLabel }).click();
  await expect(manageNotice(page)).toHaveText(fillPlaceholders(mg.rescheduledText, { when: formatSlotLong(slots[10], TZ) }));
});

test('cancelling asks first, then cancels and sends the "cancelled" emails', async ({ page, request }) => {
  const { token, slots } = await bookNewLead(request, 5);
  await page.goto(`/booking/${token}`);
  await expect(page.getByText(mg.cancelConfirmText)).toBeHidden();
  await page.getByRole('button', { name: mg.cancelLabel }).click();
  await expect(page.getByText(mg.cancelConfirmText)).toBeVisible();
  expect(await outboxKinds(request)).toEqual(['booking-confirmed', 'hassan-new-booking']); // asking is not cancelling

  await page.getByRole('button', { name: mg.keepLabel }).click();
  await expect(page.getByText(mg.cancelConfirmText)).toBeHidden();
  expect(await outboxKinds(request)).toEqual(['booking-confirmed', 'hassan-new-booking']);

  await page.getByRole('button', { name: mg.cancelLabel }).click();
  await page.getByRole('button', { name: mg.cancelConfirmLabel }).click();
  const when = formatSlotLong(slots[5], TZ);
  await expect(manageNotice(page)).toHaveText(fillPlaceholders(mg.cancelledText, { when }));
  await expect(page.getByRole('button', { name: mg.cancelLabel })).toBeHidden();
  await expect(page.getByRole('button', { name: mg.rescheduleLabel })).toBeHidden();
  expect(await outboxKinds(request)).toEqual(['booking-confirmed', 'hassan-new-booking', 'booking-cancelled', 'hassan-booking-changed']);
  expect((await getSlots(request)).slots.map((s) => s.start)).toContain(slots[5].start); // the time is free again

  // The same link later: still cancelled, nothing left to press.
  await page.reload();
  await expect(manageNotice(page)).toHaveText(fillPlaceholders(mg.cancelledText, { when }));
  await expect(page.getByRole('button')).toHaveCount(0);
});

test('a booking that is only requested can be cancelled but not rescheduled, and has no Meet link', async ({ page, request }) => {
  await setCalendar(request, { down: true });
  const { booked, token } = await bookNewLead(request, 5);
  expect(booked.status).toBe('requested');
  await page.goto(`/booking/${token}`);
  await expect(page.getByRole('button', { name: mg.cancelLabel })).toBeVisible();
  await expect(page.getByRole('button', { name: mg.rescheduleLabel })).toHaveCount(0);
  await expect(page.getByText(mg.meetLabel, { exact: true })).toHaveCount(0);
  await expect(manageNotice(page)).toBeHidden(); // cancelling is still possible: nothing to explain

  await page.getByRole('button', { name: mg.cancelLabel }).click();
  await page.getByRole('button', { name: mg.cancelConfirmLabel }).click();
  await expect(manageNotice(page)).toContainText(mg.cancelledText.split('{when}')[0].trim());
});

test('an unknown link shows the not-found text with status 404', async ({ page }) => {
  const res = await page.goto(`/booking/${'x'.repeat(43)}`);
  expect(res!.status()).toBe(404);
  expect(res!.headers()['cache-control']).toBe('no-store');
  await expect(page.getByText(mg.notFoundText)).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  await expect(page.getByRole('button')).toHaveCount(0); // nothing to press, and no time or link to see
});

test('the manage page is not indexed and not cached', async ({ page, request }) => {
  const { token } = await bookNewLead(request, 5);
  const res = await page.goto(`/booking/${token}`);
  expect(res!.status()).toBe(200);
  expect(res!.headers()['cache-control']).toBe('no-store');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
});

test('leaving the manage page by a link sends no referrer, so its secret address never reaches a tracker on the next page', async ({ page, request }) => {
  const { token } = await bookNewLead(request, 5);
  const res = await page.goto(`/booking/${token}`);
  expect(res!.headers()['referrer-policy']).toBe('no-referrer');
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer');
  const landing = page.waitForRequest((r) => r.isNavigationRequest() && new URL(r.url()).pathname === '/');
  await page.locator('a.logo-link').click();
  expect(await (await landing).headerValue('referer')).toBeNull();
  await expect(page).toHaveURL(/\/$/);
  expect(await page.evaluate(() => document.referrer)).toBe('');
});

test('a "too late" answer hides the action and says so; the other action stays', async ({ page, request }) => {
  const { token } = await bookNewLead(request, 5);
  await page.route('**/api/booking/manage/*/reschedule', (route) => route.fulfill({ status: 409, json: { error: 'too_late' } }));
  await page.goto(`/booking/${token}`);
  await page.getByRole('button', { name: mg.rescheduleLabel }).click();
  await page.getByTestId('slot').first().click();
  await page.getByRole('button', { name: mg.confirmRescheduleLabel }).click();

  await expect(manageNotice(page)).toHaveText(mg.tooLateText);
  await expect(page.getByRole('button', { name: mg.rescheduleLabel })).toBeHidden();
  await expect(page.getByRole('button', { name: mg.confirmRescheduleLabel })).toBeHidden();
  await expect(page.getByRole('button', { name: mg.cancelLabel })).toBeVisible();

  await page.route('**/api/booking/manage/*/cancel', (route) => route.fulfill({ status: 409, json: { error: 'too_late' } }));
  await page.getByRole('button', { name: mg.cancelLabel }).click();
  await page.getByRole('button', { name: mg.cancelConfirmLabel }).click();
  await expect(manageNotice(page)).toHaveText(mg.tooLateText);
  await expect(page.getByRole('button')).toHaveCount(0); // too late for both
  expect(await outboxKinds(request)).toEqual(['booking-confirmed', 'hassan-new-booking']);
});

test('a failed request shows the error text, nothing changes, and trying again works', async ({ page, request }) => {
  const { token } = await bookNewLead(request, 5);
  await page.route('**/api/booking/manage/*/cancel', (route) => route.abort());
  await page.goto(`/booking/${token}`);
  await page.getByRole('button', { name: mg.cancelLabel }).click();
  await page.getByRole('button', { name: mg.cancelConfirmLabel }).click();

  await expect(page.getByText(mg.errorText)).toBeVisible();
  await expect(page.getByRole('button', { name: mg.cancelConfirmLabel })).toBeEnabled();
  await expect(page.getByRole('button', { name: mg.cancelConfirmLabel })).toBeFocused(); // a keyboard user is still where they were
  await expect(page.getByRole('button', { name: mg.cancelLabel })).toBeEnabled();
  expect(await outboxKinds(request)).toEqual(['booking-confirmed', 'hassan-new-booking']);

  await page.unroute('**/api/booking/manage/*/cancel');
  await page.getByRole('button', { name: mg.cancelConfirmLabel }).click();
  await expect(manageNotice(page)).toContainText(mg.cancelledText.split('{when}')[0].trim());
  await expect(page.getByText(mg.errorText)).toBeHidden();
});

test('a double click on Confirm cancel sends one request, and the buttons are disabled while it is in flight', async ({ page, request }) => {
  const { token } = await bookNewLead(request, 5);
  const posts: string[] = [];
  await page.route('**/api/booking/manage/*/cancel', async (route) => {
    posts.push(route.request().url());
    await new Promise((resolve) => setTimeout(resolve, 400)); // a slow answer
    await route.continue();
  });
  await page.goto(`/booking/${token}`);
  await page.getByRole('button', { name: mg.cancelLabel }).click();
  const confirm = page.getByRole('button', { name: mg.cancelConfirmLabel });
  await confirm.dblclick();
  await expect(confirm).toBeDisabled();
  await expect(page.getByRole('button', { name: mg.cancelLabel })).toBeDisabled();
  await expect(manageNotice(page)).toContainText(mg.cancelledText.split('{when}')[0].trim());
  expect(posts).toHaveLength(1);
  expect(await outboxKinds(request)).toEqual(['booking-confirmed', 'hassan-new-booking', 'booking-cancelled', 'hassan-booking-changed']);
});

test('a double click on Confirm reschedule sends one request', async ({ page, request }) => {
  const { token, slots } = await bookNewLead(request, 5);
  const posts: string[] = [];
  await page.route('**/api/booking/manage/*/reschedule', async (route) => {
    posts.push(route.request().url());
    await new Promise((resolve) => setTimeout(resolve, 400));
    await route.continue();
  });
  await page.goto(`/booking/${token}`);
  await page.getByRole('button', { name: mg.rescheduleLabel }).click();
  await pickTime(page, slots, slots[9]);
  await page.getByRole('button', { name: mg.confirmRescheduleLabel }).dblclick();
  await expect(manageNotice(page)).toContainText(mg.rescheduledText.split('{when}')[0].trim());
  expect(posts).toHaveLength(1);
  expect((await outboxKinds(request)).filter((k) => k === 'booking-rescheduled')).toHaveLength(1);
});

test('axe: the manage page, with its panels open, has no serious or critical issues', async ({ page, request }) => {
  const { token } = await bookNewLead(request, 5);
  await page.goto(`/booking/${token}`);
  const serious = async () => (await new AxeBuilder({ page }).analyze()).violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(await serious()).toEqual([]);
  await page.getByRole('button', { name: mg.rescheduleLabel }).click();
  await page.getByTestId('slot').first().click();
  await page.getByRole('button', { name: mg.cancelLabel }).click();
  await expect(page.getByText(mg.cancelConfirmText)).toBeVisible();
  expect(await serious()).toEqual([]);
});
