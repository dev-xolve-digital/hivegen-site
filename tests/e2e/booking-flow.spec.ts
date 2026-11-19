import { test, expect } from '@playwright/test';
import { book, bookNewLead, createLead, getSlots, goodLead, outbox, resetServer, setCalendar, trackedEvents } from './helpers';

// Every browser test that changes server state lives in this file. They share the test server's memory, so they run one at a time,
// on the desktop project only, and each starts from an empty server. Other spec files must not change server state.
test.describe.configure({ mode: 'serial' });
test.skip(({ isMobile }) => isMobile, 'desktop only');
test.beforeEach(async ({ request }) => { await resetServer(request); });

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
