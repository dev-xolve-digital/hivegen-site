import { expect, type APIRequestContext, type Page } from '@playwright/test';

/** Helpers for the browser tests that change server state (tests/e2e/booking-flow.spec.ts), over the test server's HTTP API. */

export interface Slot { start: string; end: string }
export interface Booked { status: 'booked' | 'requested'; start: string; end: string; meetUrl?: string; manageUrl: string; eventId: string }
export interface Mail { kind: string; to: string; subject: string; text: string }

/** A lead form that passes validation. The test server's bot check passes every token except "fail". */
export const goodLead = {
  name: 'Zoë O’Brien', email: 'zoe+ads@example.com', phone: '+1 (555) 010-2000', buyerType: 'agent', volume: '6–15',
  footageUrl: 'https://drive.google.com/x', pageVersion: 'agents', attribution: { utm_source: 'facebook' }, turnstileToken: 'ok', website: '',
};

/** Empties the test server: its bookings, calendar, outbox, tracked events and rate limits. */
export async function resetServer(request: APIRequestContext): Promise<void> {
  const res = await request.post('/api/test/reset');
  expect(res.status(), 'POST /api/test/reset').toBe(200);
}

/** Saves a lead through the API; gives its public id. */
export async function createLead(request: APIRequestContext, over: Record<string, unknown> = {}): Promise<string> {
  const res = await request.post('/api/booking/leads', { data: { ...goodLead, ...over } });
  expect(res.status(), 'POST /api/booking/leads').toBe(200);
  return ((await res.json()) as { leadId: string }).leadId;
}

export async function getSlots(request: APIRequestContext): Promise<{ slots: Slot[]; calendarChecked: boolean }> {
  const res = await request.get('/api/booking/slots');
  expect(res.status(), 'GET /api/booking/slots').toBe(200);
  return res.json();
}

/** Asks to book `start` for a lead. Returns the response so a test can look at its status. */
export const book = (request: APIRequestContext, leadId: string, start: string, visitorTz = 'America/New_York') =>
  request.post('/api/booking/bookings', { data: { leadId, start, visitorTz } });

/** A new lead books the offered time at `slotIndex`; gives the booking and the manage token from its link. */
export async function bookNewLead(request: APIRequestContext, slotIndex = 5): Promise<{ booked: Booked; token: string; slots: Slot[] }> {
  const leadId = await createLead(request);
  const { slots } = await getSlots(request);
  const res = await book(request, leadId, slots[slotIndex].start);
  expect(res.status(), 'POST /api/booking/bookings').toBe(200);
  const booked = (await res.json()) as Booked;
  return { booked, token: booked.manageUrl.split('/').pop()!, slots };
}

/** Sets what the fake Google Calendar does: `down` makes every call fail, `busy` lists times that are taken. */
export async function setCalendar(request: APIRequestContext, state: { down?: boolean; busy?: Slot[] }): Promise<void> {
  const res = await request.post('/api/test/calendar', { data: state });
  expect(res.status(), 'POST /api/test/calendar').toBe(200);
}

/** The emails the server "sent", oldest first. */
export async function outbox(request: APIRequestContext): Promise<Mail[]> {
  const res = await request.get('/api/test/outbox');
  expect(res.status(), 'GET /api/test/outbox').toBe(200);
  return res.json();
}

/** The tracking events the server would have sent to Meta, oldest first. */
export async function trackedEvents(request: APIRequestContext): Promise<Array<{ name: string; eventId: string; sourceUrl: string; user: Record<string, string | undefined> }>> {
  const res = await request.get('/api/test/events');
  expect(res.status(), 'GET /api/test/events').toBe(200);
  return res.json();
}

/** What Cloudflare's Turnstile script does for the form, in a few lines: a widget that hands out the token "test-token" (and a fresh one after reset). */
const TURNSTILE_STUB = `(function () {
  var callbacks = {};
  var count = 0;
  var later = function (callback) { setTimeout(function () { callback('test-token'); }, 0); };
  window.turnstile = {
    render: function (el, opts) { count += 1; var id = 'widget-' + count; callbacks[id] = opts.callback; later(opts.callback); return id; },
    getResponse: function () { return 'test-token'; },
    reset: function (id) { if (callbacks[id]) later(callbacks[id]); },
    remove: function () {}
  };
})();`;

/** Answers Cloudflare's Turnstile script with the stub above, so no browser test ever reaches Cloudflare. Every test that submits step 1 calls this. */
export async function stubTurnstile(page: Page): Promise<void> {
  await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js*', (route) => route.fulfill({ contentType: 'application/javascript', body: TURNSTILE_STUB }));
}

/** Makes the page believe the booking server is in `mode` (the test server itself always says "live"). Nothing on the server changes. */
export async function pretendMode(page: Page, mode: 'live' | 'demo' | 'off'): Promise<void> {
  await page.route('**/api/booking/config', (route) => route.fulfill({ json: mode === 'live' ? { mode, turnstileSiteKey: '1x00000000000000000000AA' } : { mode } }));
}
