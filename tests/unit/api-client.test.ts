import { describe, it, expect, vi } from 'vitest';
import {
  BotCheckError, FieldsError, NetworkError, RateLimitedError, SlotTakenError, demoApi, httpApi, type BookingApi,
} from '../../src/lib/booking/api-client';
import { loadSite } from '../../src/lib/content/load';

const slot = { start: '2026-12-07T14:00:00.000Z', end: '2026-12-07T14:15:00.000Z' };
const lead = {
  name: 'Zoë', email: 'zoe@example.com', buyerType: 'agent' as const, volume: '6–15', pageVersion: 'agents', attribution: { utm_source: 'facebook' },
  turnstileToken: 'tok', website: '',
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** An api over a fetch that answers `answer` and records what it was asked. */
function apiAnswering(answer: () => Response | Promise<Response>) {
  const fetchFn = vi.fn<typeof fetch>(async () => answer());
  return { api: httpApi(fetchFn), fetchFn };
}

describe('httpApi', () => {
  it('createLead posts the lead as JSON and gives back the ids', async () => {
    const { api, fetchFn } = apiAnswering(() => reply({ leadId: 'abc', eventId: 'lead.abc' }));
    expect(await api.createLead(lead)).toEqual({ leadId: 'abc', eventId: 'lead.abc' });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('/api/booking/leads');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(String(init?.body))).toEqual(lead);
  });

  it('getSlots gives the times and whether the calendar was checked', async () => {
    const { api, fetchFn } = apiAnswering(() => reply({ slots: [slot], calendarChecked: false }));
    expect(await api.getSlots()).toEqual({ slots: [slot], calendarChecked: false });
    expect(fetchFn.mock.calls[0][0]).toBe('/api/booking/slots');
  });

  it('confirm posts the lead, the start and the visitor time zone', async () => {
    const booked = { status: 'booked', start: slot.start, end: slot.end, meetUrl: 'https://meet.google.com/x', manageUrl: 'https://hivegen.co/booking/t', eventId: 'schedule.abc' };
    const { api, fetchFn } = apiAnswering(() => reply(booked));
    expect(await api.confirm('abc', slot, 'America/New_York')).toEqual(booked);
    expect(fetchFn.mock.calls[0][0]).toBe('/api/booking/bookings');
    expect(JSON.parse(String(fetchFn.mock.calls[0][1]?.body))).toEqual({ leadId: 'abc', start: slot.start, visitorTz: 'America/New_York' });
  });

  it.each([
    ['400 with fields', 400, { error: 'invalid', fields: { email: 'invalid' } }, FieldsError],
    ['403 bot_check_failed', 403, { error: 'bot_check_failed' }, BotCheckError],
    ['429 rate_limited', 429, { error: 'rate_limited' }, RateLimitedError],
    ['503 not_connected', 503, { error: 'not_connected' }, NetworkError],
    ['500 server_error', 500, { error: 'server_error' }, NetworkError],
  ])('createLead: %s becomes the matching error', async (_name, status, body, errorClass) => {
    const { api } = apiAnswering(() => reply(body, status));
    await expect(api.createLead(lead)).rejects.toBeInstanceOf(errorClass);
  });

  it('a FieldsError carries the fields the server named', async () => {
    const { api } = apiAnswering(() => reply({ error: 'invalid', fields: { email: 'invalid', volume: 'required' } }, 400));
    const error = await api.createLead(lead).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FieldsError);
    expect((error as FieldsError).fields).toEqual({ email: 'invalid', volume: 'required' });
  });

  it('confirm: 409 slot_taken is a SlotTakenError, 429 a RateLimitedError, anything else a NetworkError', async () => {
    for (const [status, errorClass] of [[409, SlotTakenError], [429, RateLimitedError], [404, NetworkError], [500, NetworkError]] as const) {
      const { api } = apiAnswering(() => reply({ error: 'x' }, status));
      await expect(api.confirm('abc', slot, 'UTC'), String(status)).rejects.toBeInstanceOf(errorClass);
    }
  });

  it('a fetch that fails, an answer that is not JSON and an answer of the wrong shape are all NetworkErrors', async () => {
    const failing = httpApi(vi.fn<typeof fetch>(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(failing.createLead(lead)).rejects.toBeInstanceOf(NetworkError);
    await expect(failing.getSlots()).rejects.toBeInstanceOf(NetworkError);

    const html = apiAnswering(() => new Response('<html>Bad gateway</html>', { status: 200 })).api;
    await expect(html.createLead(lead)).rejects.toBeInstanceOf(NetworkError);

    const wrongShape = apiAnswering(() => reply({ slots: 'soon' })).api;
    await expect(wrongShape.getSlots()).rejects.toBeInstanceOf(NetworkError);
    await expect(apiAnswering(() => reply({})).api.confirm('abc', slot, 'UTC')).rejects.toBeInstanceOf(NetworkError);
  });
});

/** A fetch that never answers, but gives up when its signal says so (as the browser's does). */
const stalledFetch = () => vi.fn<typeof fetch>((_input, init) => new Promise<Response>((_resolve, reject) => {
  init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'TimeoutError')));
}));

describe('httpApi: a stalled connection', () => {
  it('gives up after the timeout, so no button stays disabled for minutes: every call becomes a NetworkError', async () => {
    const api = httpApi(stalledFetch(), 30);
    await expect(api.createLead(lead)).rejects.toBeInstanceOf(NetworkError);
    await expect(api.getSlots()).rejects.toBeInstanceOf(NetworkError);
    await expect(api.confirm('abc', slot, 'UTC')).rejects.toBeInstanceOf(NetworkError);
  });

  it('every request carries a signal, with a 15 second limit by default', async () => {
    const seen: Array<AbortSignal | null | undefined> = [];
    const api = httpApi(vi.fn<typeof fetch>(async (_input, init) => { seen.push(init?.signal); return reply({ slots: [], calendarChecked: true }); }));
    await api.getSlots();
    expect(seen[0]).toBeInstanceOf(AbortSignal);
    expect(seen[0]!.aborted).toBe(false);
  });

  it('an answer that stalls halfway (headers, then no body) is a NetworkError too', async () => {
    const stalledBody = vi.fn<typeof fetch>((_input, init) => {
      const body = new ReadableStream({ start(controller) { init?.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'TimeoutError'))); } });
      return Promise.resolve(new Response(body, { status: 200 }));
    });
    await expect(httpApi(stalledBody, 30).createLead(lead)).rejects.toBeInstanceOf(NetworkError);
  });
});

describe('demoApi', () => {
  const rules = loadSite().booking;
  const NOW = new Date('2026-11-23T13:00:00Z'); // Monday 18:00 in Pakistan
  const demo = (): BookingApi => demoApi(rules, () => NOW);

  it('offers the real call times, checked, and always books', async () => {
    const api = demo();
    const { leadId, eventId } = await api.createLead(lead);
    expect(leadId).toBeTruthy();
    expect(eventId).toBeTruthy();
    const { slots, calendarChecked } = await api.getSlots();
    expect(calendarChecked).toBe(true);
    expect(slots[0].start).toBe('2026-11-23T14:00:00.000Z');
    expect(await api.confirm(leadId, slots[0], 'UTC')).toMatchObject({ status: 'booked', start: slots[0].start, end: slots[0].end, manageUrl: '#book' });
  });

  it('a time booked is no longer offered, and booking it again is "taken"', async () => {
    const api = demo();
    const { slots } = await api.getSlots();
    await api.confirm('demo-1', slots[0], 'UTC');
    expect((await api.getSlots()).slots.map((s) => s.start)).not.toContain(slots[0].start);
    await expect(api.confirm('demo-2', slots[0], 'UTC')).rejects.toBeInstanceOf(SlotTakenError);
  });
});
