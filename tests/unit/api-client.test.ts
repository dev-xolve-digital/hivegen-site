import { describe, it, expect, vi } from 'vitest';
import {
  BotCheckError, FieldsError, NetworkError, RateLimitedError, SlotTakenError, TooLateError, demoApi, fetchVideoSrc, httpApi, httpManageApi, type BookingApi,
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

describe('httpManageApi', () => {
  const TOKEN = 'T'.repeat(43);
  const manageApiAnswering = (answer: () => Response | Promise<Response>) => {
    const fetchFn = vi.fn<typeof fetch>(async () => answer());
    return { api: httpManageApi(TOKEN, fetchFn), fetchFn };
  };

  it('cancel posts to the cancel route of its own booking', async () => {
    const { api, fetchFn } = manageApiAnswering(() => reply({ status: 'cancelled' }));
    await expect(api.cancel()).resolves.toBeUndefined();
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(`/api/booking/manage/${TOKEN}/cancel`);
    expect(init?.method).toBe('POST');
  });

  it('reschedule posts the chosen start and gives back the moved call', async () => {
    const moved = { status: 'booked', start: slot.start, end: slot.end };
    const { api, fetchFn } = manageApiAnswering(() => reply(moved));
    expect(await api.reschedule(slot)).toEqual(moved);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(`/api/booking/manage/${TOKEN}/reschedule`);
    expect(JSON.parse(String(init?.body))).toEqual({ start: slot.start });
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
  });

  it('getSlots is the same call the booking form makes', async () => {
    const { api, fetchFn } = manageApiAnswering(() => reply({ slots: [slot], calendarChecked: true }));
    expect(await api.getSlots()).toEqual({ slots: [slot], calendarChecked: true });
    expect(fetchFn.mock.calls[0][0]).toBe('/api/booking/slots');
  });

  it('a token with unusual characters cannot change the route', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => reply({ status: 'cancelled' }));
    await httpManageApi('a/b?c#d', fetchFn).cancel();
    expect(fetchFn.mock.calls[0][0]).toBe('/api/booking/manage/a%2Fb%3Fc%23d/cancel');
  });

  it('409 too_late is a TooLateError and 409 slot_taken a SlotTakenError (the same status, told apart by the answer)', async () => {
    const tooLate = manageApiAnswering(() => reply({ error: 'too_late' }, 409)).api;
    await expect(tooLate.cancel()).rejects.toBeInstanceOf(TooLateError);
    await expect(tooLate.reschedule(slot)).rejects.toBeInstanceOf(TooLateError);
    const taken = manageApiAnswering(() => reply({ error: 'slot_taken' }, 409)).api;
    await expect(taken.reschedule(slot)).rejects.toBeInstanceOf(SlotTakenError);
    await expect(manageApiAnswering(() => reply({}, 409)).api.reschedule(slot)).rejects.toBeInstanceOf(SlotTakenError);
  });

  it('429 is a RateLimitedError; 404, 500 and 503 are NetworkErrors; a 400 is the server calling the request invalid', async () => {
    await expect(manageApiAnswering(() => reply({ error: 'rate_limited' }, 429)).api.cancel()).rejects.toBeInstanceOf(RateLimitedError);
    for (const status of [404, 500, 503]) {
      await expect(manageApiAnswering(() => reply({ error: 'x' }, status)).api.cancel(), String(status)).rejects.toBeInstanceOf(NetworkError);
    }
    await expect(manageApiAnswering(() => reply({ error: 'invalid' }, 400)).api.reschedule(slot)).rejects.toBeInstanceOf(FieldsError);
  });

  it('an answer of the wrong shape is a NetworkError, so the page never claims a change that was not confirmed', async () => {
    await expect(manageApiAnswering(() => reply({ status: 'booked' })).api.cancel()).rejects.toBeInstanceOf(NetworkError);
    await expect(manageApiAnswering(() => reply({})).api.reschedule(slot)).rejects.toBeInstanceOf(NetworkError);
    await expect(manageApiAnswering(() => new Response('<html></html>')).api.cancel()).rejects.toBeInstanceOf(NetworkError);
  });

  it('a fetch that fails, or stalls past the timeout (15 seconds by default), is a NetworkError', async () => {
    const failing = httpManageApi(TOKEN, vi.fn<typeof fetch>(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(failing.cancel()).rejects.toBeInstanceOf(NetworkError);

    const stalled = httpManageApi(TOKEN, stalledFetch(), 30);
    await expect(stalled.cancel()).rejects.toBeInstanceOf(NetworkError);
    await expect(stalled.reschedule(slot)).rejects.toBeInstanceOf(NetworkError);
    await expect(stalled.getSlots()).rejects.toBeInstanceOf(NetworkError);

    const seen: Array<AbortSignal | null | undefined> = [];
    await httpManageApi(TOKEN, vi.fn<typeof fetch>(async (_input, init) => { seen.push(init?.signal); return reply({ status: 'cancelled' }); })).cancel();
    expect(seen[0]).toBeInstanceOf(AbortSignal);
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

describe('fetchVideoSrc', () => {
  const answering = (answer: () => Response | Promise<Response>) => vi.fn<typeof fetch>(async () => answer());

  it('asks the server for the video by id and gives back the address it answers with', async () => {
    const fetchFn = answering(() => reply({ src: 'https://customer-abc.cloudflarestream.com/tok.en.x/iframe?autoplay=true' }));
    expect(await fetchVideoSrc('v-portfolio-reel', fetchFn)).toBe('https://customer-abc.cloudflarestream.com/tok.en.x/iframe?autoplay=true');
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('/api/video/v-portfolio-reel');
    expect(init?.cache).toBe('no-store');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('puts the id in the address as one path piece', async () => {
    const fetchFn = answering(() => reply({ src: 'x' }));
    await fetchVideoSrc('a/b?c', fetchFn);
    expect(fetchFn.mock.calls[0][0]).toBe('/api/video/a%2Fb%3Fc');
  });

  it('every failure is an error the pop-up can answer with its message: 404, 503, 429, a bad answer, a dead connection', async () => {
    for (const bad of [reply({ error: 'not_found' }, 404), reply({ error: 'not_connected' }, 503), reply({ error: 'server_error' }, 500), reply({ nope: 1 }), reply({ src: 7 }), reply([])]) {
      await expect(fetchVideoSrc('v', answering(() => bad.clone()))).rejects.toBeInstanceOf(Error);
    }
    await expect(fetchVideoSrc('v', answering(() => reply({ error: 'rate_limited' }, 429)))).rejects.toBeInstanceOf(RateLimitedError);
    await expect(fetchVideoSrc('v', answering(() => reply({ error: 'x' }, 503)))).rejects.toBeInstanceOf(NetworkError);
    await expect(fetchVideoSrc('v', vi.fn<typeof fetch>(async () => { throw new TypeError('Failed to fetch'); }))).rejects.toBeInstanceOf(NetworkError);
  });

  it('gives up after the timeout, like every other call', async () => {
    await expect(fetchVideoSrc('v', stalledFetch(), 30)).rejects.toBeInstanceOf(NetworkError);
  });
});
