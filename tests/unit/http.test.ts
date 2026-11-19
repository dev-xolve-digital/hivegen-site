import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookingService } from '../../src/server/booking/service';
import { createRateLimiter } from '../../src/server/booking/rate-limit';
import type { ErrorCode } from '../../src/server/booking/types';
import { readServerConfig } from '../../src/server/config';
import { createContext, type ServerContext } from '../../src/server/context';
import { clientIp } from '../../src/server/http/client-ip';
import {
  MAX_BODY_BYTES, bookingsHandler, cancelHandler, configHandler, leadsHandler, rescheduleHandler, slotsHandler,
  testCalendarHandler, testEventsHandler, testOutboxHandler, testResetHandler, withContext,
} from '../../src/server/http/handlers';
import { removeTempContent, tempContent } from '../helpers/temp-content';

const SITE = 'https://hivegen.co';
const lead = { name: 'Zoë O’Brien', email: 'zoe+ads@example.com', phone: '+1 (555) 010-2000', buyerType: 'agent', volume: '6–15',
  footageUrl: 'https://drive.google.com/x', pageVersion: 'agents', attribution: { utm_source: 'facebook' }, turnstileToken: 'ok', website: '' };

const tempDirs: string[] = [];
function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hg-http-'));
  tempDirs.push(dir);
  return dir;
}

/** A context on the test services, with its emails going to a temp folder. */
const fakesContext = (env: Record<string, string> = {}) =>
  createContext(readServerConfig({ HIVEGEN_FAKES: '1', NODE_ENV: 'test', ...env }), { outboxDir: tempDir() });
const notConnectedContext = () => createContext(readServerConfig({ NODE_ENV: 'test' }));

const req = (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) => new Request(`http://localhost:4321${url}`, {
  method,
  headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
  body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
});
const post = (url: string, body?: unknown, headers?: Record<string, string>) => req('POST', url, body, headers);
const get = (url: string, headers?: Record<string, string>) => req('GET', url, undefined, headers);

/** Saves a lead through the handler and gives its id. */
async function addLead(ctx: ServerContext, over: Record<string, unknown> = {}, headers?: Record<string, string>): Promise<string> {
  const res = await leadsHandler(post('/api/booking/leads', { ...lead, ...over }, headers), ctx);
  expect(res.status).toBe(200);
  return ((await res.json()) as { leadId: string }).leadId;
}
async function slotsOf(ctx: ServerContext) {
  return ((await (await slotsHandler(get('/api/booking/slots'), ctx)).json()) as { slots: Array<{ start: string; end: string }>; calendarChecked: boolean });
}

beforeEach(() => {
  // Starting a context says where the emails go, and warns about a public address outside production; these tests are not about that.
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.CONTENT_DIR;
  removeTempContent();
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('createRateLimiter', () => {
  it('allows `limit` takes per key within the window, then refuses', () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 1000, now: () => 0 });
    expect([1, 2, 3, 4].map(() => limiter.take('a'))).toEqual([true, true, true, false]);
    expect(limiter.take('b')).toBe(true);
  });

  it('is a sliding window: a take frees up when it is one window old', () => {
    let t = 0;
    const limiter = createRateLimiter({ limit: 2, windowMs: 1000, now: () => t });
    expect(limiter.take('a')).toBe(true);
    t = 600;
    expect(limiter.take('a')).toBe(true);
    expect(limiter.take('a')).toBe(false);
    t = 1001; // the first take is over a window old, the second is not
    expect(limiter.take('a')).toBe(true);
    expect(limiter.take('a')).toBe(false);
  });

  it('refused takes do not extend the block', () => {
    let t = 0;
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: () => t });
    expect(limiter.take('a')).toBe(true);
    for (t = 100; t < 1000; t += 100) expect(limiter.take('a')).toBe(false);
    t = 1000;
    expect(limiter.take('a')).toBe(true);
  });

  it('reset forgets every key', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: () => 0 });
    limiter.take('a');
    limiter.take('b');
    limiter.reset();
    expect(limiter.take('a')).toBe(true);
    expect(limiter.take('b')).toBe(true);
  });

  it('keeps its memory bounded when the keys keep changing: the least recently used key is forgotten first', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 3_600_000, now: () => 0, maxKeys: 100 });
    for (let i = 0; i < 1000; i += 1) limiter.take(`ip-${i}`);
    expect(limiter.take('ip-999')).toBe(false); // recent: still counted
    expect(limiter.take('ip-0')).toBe(true); // long ago: forgotten
  });

  it('a key that keeps coming is not the one forgotten', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 3_600_000, now: () => 0, maxKeys: 3 });
    limiter.take('busy');
    for (let i = 0; i < 20; i += 1) { limiter.take(`other-${i}`); limiter.take('busy'); }
    expect(limiter.take('busy')).toBe(false);
  });
});

describe('clientIp', () => {
  const withHeader = (value: string) => new Request('http://localhost/', { headers: { 'cf-connecting-ip': value } });
  const bare = new Request('http://localhost/');

  it('prefers CF-Connecting-IP over the socket address', () => {
    expect(clientIp(withHeader('203.0.113.9'), '10.0.0.1')).toBe('203.0.113.9');
    expect(clientIp(withHeader('2001:db8::7'), '10.0.0.1')).toBe('2001:db8::7');
  });

  it('uses the socket address without the header, and nothing without either', () => {
    expect(clientIp(bare, '10.0.0.1')).toBe('10.0.0.1');
    expect(clientIp(bare, '::1')).toBe('::1');
    expect(clientIp(bare)).toBeUndefined();
  });

  it('ignores a header that is not an IP address, and falls back to the socket address', () => {
    for (const value of ['not-an-ip', '1.2.3.4, 5.6.7.8', '999.1.1.1', '1.2.3', '<script>', '', ' ', `${'1'.repeat(70)}`, `${'a:'.repeat(40)}1`]) {
      expect(clientIp(withHeader(value), '10.0.0.1'), JSON.stringify(value)).toBe('10.0.0.1');
    }
  });

  it('an address that is not an IP is no IP at all (never stored)', () => {
    expect(clientIp(withHeader('nope'), 'also-nope')).toBeUndefined();
    expect(clientIp(bare, 'x'.repeat(100))).toBeUndefined();
    expect(clientIp(bare, '')).toBeUndefined();
  });

  it('never returns more than 64 characters', () => {
    expect(clientIp(withHeader('::ffff:255.255.255.255'))).toBe('::ffff:255.255.255.255');
    expect(clientIp(withHeader(`fe80::1%${'z'.repeat(70)}`), '10.0.0.1')).toBe('10.0.0.1');
  });
});

describe('leads', () => {
  it('POST leads → 200 { leadId, eventId }', async () => {
    const ctx = await fakesContext();
    const res = await leadsHandler(post('/api/booking/leads', lead), ctx);
    expect(res.status).toBe(200);
    const body = await res.json() as { leadId: string; eventId: string };
    expect(body.leadId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(body.eventId).toBe(`lead.${body.leadId}`);
  });

  it('bad JSON → 400 invalid, with no fields', async () => {
    const ctx = await fakesContext();
    for (const body of ['{"name": ', 'not json', '']) {
      const res = await leadsHandler(post('/api/booking/leads', body), ctx);
      expect(res.status, body).toBe(400);
      expect(await res.json()).toEqual({ error: 'invalid' });
    }
  });

  it('invalid fields → 400 invalid, naming each field', async () => {
    const ctx = await fakesContext();
    const res = await leadsHandler(post('/api/booking/leads', { ...lead, name: '', email: 'nope' }), ctx);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid', fields: { name: 'required', email: 'invalid' } });
  });

  it('a JSON body that is not an object → 400 invalid', async () => {
    const ctx = await fakesContext();
    for (const body of ['null', '[]', '"text"', '42']) {
      const res = await leadsHandler(post('/api/booking/leads', body), ctx);
      expect(res.status, body).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe('invalid');
    }
  });

  it('a failed bot check → 403 bot_check_failed (the test bot check fails only on the token "fail")', async () => {
    const ctx = await fakesContext();
    const res = await leadsHandler(post('/api/booking/leads', { ...lead, turnstileToken: 'fail' }), ctx);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'bot_check_failed' });
  });

  it('the 11th lead from one IP within an hour → 429 rate_limited; another IP is fine', async () => {
    const ctx = await fakesContext();
    const from = (ip: string) => leadsHandler(post('/api/booking/leads', lead, { 'cf-connecting-ip': ip }), ctx);
    for (let i = 1; i <= 10; i += 1) expect((await from('203.0.113.9')).status, `lead ${i}`).toBe(200);
    const blocked = await from('203.0.113.9');
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: 'rate_limited' });
    expect((await from('203.0.113.10')).status).toBe(200);
  });

  it('bad requests count against the limit too', async () => {
    const ctx = await fakesContext();
    for (let i = 0; i < 10; i += 1) await leadsHandler(post('/api/booking/leads', 'not json', { 'cf-connecting-ip': '203.0.113.9' }), ctx);
    const res = await leadsHandler(post('/api/booking/leads', lead, { 'cf-connecting-ip': '203.0.113.9' }), ctx);
    expect(res.status).toBe(429);
  });

  it('the socket address counts when there is no CF-Connecting-IP', async () => {
    const ctx = await fakesContext();
    const fromSocket = (ip: string) => leadsHandler(post('/api/booking/leads', lead), ctx, undefined, ip);
    for (let i = 0; i < 10; i += 1) await fromSocket('198.51.100.1');
    expect((await fromSocket('198.51.100.1')).status).toBe(429);
    expect((await fromSocket('198.51.100.2')).status).toBe(200);
  });

  it('the client IP comes from CF-Connecting-IP when present', async () => {
    const ctx = await fakesContext();
    await addLead(ctx, {}, { 'cf-connecting-ip': '203.0.113.9' });
    await leadsHandler(post('/api/booking/leads', lead, { 'cf-connecting-ip': 'garbage' }), ctx, undefined, '198.51.100.7');
    await leadsHandler(post('/api/booking/leads', lead), ctx, undefined, '198.51.100.8');
    expect(ctx.fakes!.tracked.map((e) => e.user.ip)).toEqual(['203.0.113.9', '198.51.100.7', '198.51.100.8']);
  });

  it('passes the user agent along, cut to a sensible length', async () => {
    const ctx = await fakesContext();
    await leadsHandler(post('/api/booking/leads', lead, { 'user-agent': `Mozilla/5.0 ${'x'.repeat(2000)}` }), ctx);
    expect(ctx.fakes!.tracked[0].user.userAgent).toHaveLength(500);
    expect(ctx.fakes!.tracked[0].user.userAgent).toMatch(/^Mozilla\/5\.0 x/);
  });
});

describe('where a lead came from (sourceUrl)', () => {
  const sourceOf = async (headers: Record<string, string>, env: Record<string, string> = { PUBLIC_SITE_URL: SITE }) => {
    const ctx = await fakesContext(env);
    await addLead(ctx, {}, headers);
    return ctx.fakes!.tracked[0].sourceUrl;
  };

  it('is the Referer when it is a page of the site', async () => {
    expect(await sourceOf({ referer: `${SITE}/agents?utm_source=facebook` })).toBe(`${SITE}/agents?utm_source=facebook`);
  });

  it('is the site address when there is no Referer', async () => {
    expect(await sourceOf({})).toBe(SITE);
  });

  it('is the site address when the Referer is another site, not a web address, or not an address at all', async () => {
    for (const referer of ['https://evil.example/page', 'http://hivegen.co/', 'javascript:alert(1)', 'ftp://hivegen.co/x', 'not a url', '']) {
      expect(await sourceOf({ referer }), referer).toBe(SITE);
    }
  });

  it('compares the site by origin, so a look-alike host does not pass', async () => {
    expect(await sourceOf({ referer: 'https://hivegen.co.evil.example/' })).toBe(SITE);
    expect(await sourceOf({ referer: 'https://hivegen.co@evil.example/' })).toBe(SITE);
  });

  it('is never empty', async () => {
    expect(await sourceOf({}, {})).toBe('http://localhost:4321');
  });
});

describe('request bodies', () => {
  const chunked = (chunks: string[], state = { pulled: 0, cancelled: false }) => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (state.pulled >= chunks.length) { controller.close(); return; }
        controller.enqueue(encoder.encode(chunks[state.pulled]));
        state.pulled += 1;
      },
      cancel() { state.cancelled = true; },
    });
    const request = new Request('http://localhost:4321/api/booking/leads', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body, duplex: 'half',
    } as RequestInit & { duplex: 'half' });
    return { request, state };
  };

  it('a body over the cap is 400 invalid, and is never given to the service', async () => {
    const ctx = await fakesContext();
    const res = await leadsHandler(post('/api/booking/leads', { ...lead, name: 'x'.repeat(MAX_BODY_BYTES) }), ctx);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid' });
    expect(ctx.fakes!.tracked).toEqual([]);
  });

  it('a length declared over the cap is refused whatever the body is', async () => {
    const ctx = await fakesContext();
    const res = await leadsHandler(post('/api/booking/leads', lead, { 'content-length': String(MAX_BODY_BYTES + 1) }), ctx);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid' });
    expect(ctx.fakes!.tracked).toEqual([]);
  });

  it('a chunked body (no length) is read only up to the cap, then refused', async () => {
    const ctx = await fakesContext();
    const { request, state } = chunked(Array.from({ length: 10_000 }, () => 'x'.repeat(1024)));
    const res = await leadsHandler(request, ctx);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid' });
    expect(state.pulled).toBeLessThan(100); // a stream of 10 MB was left unread
    expect(state.cancelled).toBe(true); // and the sender is told to stop
  });

  it('a chunked body under the cap is read whole', async () => {
    const ctx = await fakesContext();
    const text = JSON.stringify(lead);
    const { request } = chunked([text.slice(0, 40), text.slice(40, 90), text.slice(90)]);
    expect((await leadsHandler(request, ctx)).status).toBe(200);
  });

  it('a body just under the cap still reaches the service', async () => {
    const ctx = await fakesContext();
    const filler = ' '.repeat(MAX_BODY_BYTES - Buffer.byteLength(JSON.stringify(lead)));
    const res = await leadsHandler(post('/api/booking/leads', JSON.stringify(lead) + filler), ctx);
    expect(res.status).toBe(200);
  });

  it('the cap applies to bookings, reschedules and the test calendar too', async () => {
    const ctx = await fakesContext();
    const huge = JSON.stringify({ leadId: 'A'.repeat(22), start: '2030-01-01T00:00:00Z', filler: 'x'.repeat(MAX_BODY_BYTES) });
    expect((await bookingsHandler(post('/api/booking/bookings', huge), ctx)).status).toBe(400);
    const token = 'T'.repeat(43);
    expect((await rescheduleHandler(post(`/api/booking/manage/${token}/reschedule`, huge), ctx, { token })).status).toBe(400);
    expect((await testCalendarHandler(post('/api/test/calendar', huge), ctx)).status).toBe(400);
  });
});

describe('withContext (the route wrapper)', () => {
  it('gives the handler the context, the route parameters and the socket address', async () => {
    const ctx = await fakesContext();
    const handler = vi.fn(async () => new Response('ok'));
    const request = get('/api/booking/slots');
    const res = await withContext(handler, async () => ctx)({ request, params: { token: 't' }, clientAddress: '198.51.100.4' });
    expect(await res.text()).toBe('ok');
    expect(handler).toHaveBeenCalledWith(request, ctx, { token: 't' }, '198.51.100.4');
  });

  it('a context that could not be made → the API\'s own JSON 500, no-store, and the log names only the kind of error', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const handler = vi.fn();
    const boom = Object.assign(new Error('connect to mysql://hguser:hgsecretpw@db failed'), { code: 'ECONNREFUSED' });
    const res = await withContext(handler, async () => { throw boom; })({ request: get('/api/booking/slots'), params: {}, clientAddress: '198.51.100.4' });
    expect(res.status).toBe(500);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({ error: 'server_error' });
    expect(handler).not.toHaveBeenCalled();
    expect(errors).toHaveBeenCalledTimes(1);
    expect(errors.mock.calls.flat().join(' ')).toContain('ECONNREFUSED');
    expect(errors.mock.calls.flat().join(' ')).not.toContain('hgsecretpw');
  });

  it('an unreadable content file does not take /api/booking/config down: production says "off"', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.CONTENT_DIR = tempContent({ 'site.yaml': () => 'brand: [' });
    const live = readServerConfig({
      NODE_ENV: 'production', DATABASE_URL: 'mysql://u:p@127.0.0.1:1/db', GOOGLE_CLIENT_ID: 'i', GOOGLE_CLIENT_SECRET: 's', GOOGLE_REFRESH_TOKEN: 'r',
      TURNSTILE_SECRET: 't', CRON_SECRET: 'c', PUBLIC_SITE_URL: SITE, ...{ SMTP_HOST: 'h', SMTP_PORT: '465', SMTP_USER: 'u', SMTP_PASS: 'p', MAIL_FROM: 'a@b.test' },
    });
    expect(live.mode).toBe('live');
    const res = await withContext(configHandler, () => createContext(live))({ request: get('/api/booking/config'), params: {}, clientAddress: '198.51.100.4' });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ mode: 'off' });
  });
});

describe('slots and bookings', () => {
  it('GET slots → { slots, calendarChecked }', async () => {
    const ctx = await fakesContext();
    const res = await slotsHandler(get('/api/booking/slots'), ctx);
    expect(res.status).toBe(200);
    const body = await res.json() as { slots: Array<{ start: string; end: string }>; calendarChecked: boolean };
    expect(body.calendarChecked).toBe(true);
    expect(body.slots.length).toBeGreaterThan(10);
    expect(body.slots[0]).toEqual({ start: expect.stringMatching(/Z$/), end: expect.stringMatching(/Z$/) });
  });

  it('a lead, then a booking; booking twice returns the same booking', async () => {
    const ctx = await fakesContext({ PUBLIC_SITE_URL: SITE });
    const leadId = await addLead(ctx);
    const { slots } = await slotsOf(ctx);
    const book = () => bookingsHandler(post('/api/booking/bookings', { leadId, start: slots[3].start, visitorTz: 'America/New_York' }), ctx);

    const first = await book();
    expect(first.status).toBe(200);
    const booked = await first.json() as { status: string; start: string; end: string; meetUrl?: string; manageUrl: string; eventId: string };
    expect(booked).toMatchObject({ status: 'booked', start: slots[3].start, end: slots[3].end, eventId: `schedule.${leadId}` });
    expect(booked.manageUrl).toMatch(new RegExp(`^${SITE}/booking/[A-Za-z0-9_-]{43}$`));
    expect(booked.meetUrl).toMatch(/^https:\/\/meet\.google\.com\//);

    const second = await (await book()).json();
    expect(second).toEqual(booked);
    expect(ctx.fakes!.calendar.events.size).toBe(1);
    // The emails went out (once), and the booked time is no longer offered.
    expect(ctx.fakes!.mailer.sent.map((m) => m.tag)).toEqual(['booking-confirmed', 'hassan-new-booking']);
    expect((await slotsOf(ctx)).slots.map((s) => s.start)).not.toContain(slots[3].start);
  });

  it('booking an unavailable slot → 409 slot_taken', async () => {
    const ctx = await fakesContext();
    const leadId = await addLead(ctx);
    const { slots } = await slotsOf(ctx);
    ctx.fakes!.calendar.setBusy([slots[2]]);
    const res = await bookingsHandler(post('/api/booking/bookings', { leadId, start: slots[2].start, visitorTz: 'UTC' }), ctx);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'slot_taken' });
    // A time the rules never offer is the same answer.
    const odd = await bookingsHandler(post('/api/booking/bookings', { leadId, start: '2020-01-01T00:00:00Z', visitorTz: 'UTC' }), ctx);
    expect(odd.status).toBe(409);
  });

  it('an unknown lead → 404 not_found; missing fields → 400 with fields; bad JSON → 400', async () => {
    const ctx = await fakesContext();
    const { slots } = await slotsOf(ctx);
    const unknown = await bookingsHandler(post('/api/booking/bookings', { leadId: 'A'.repeat(22), start: slots[0].start }), ctx);
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: 'not_found' });
    const missing = await bookingsHandler(post('/api/booking/bookings', {}), ctx);
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: 'invalid', fields: { leadId: 'required', start: 'required' } });
    expect((await bookingsHandler(post('/api/booking/bookings', '{'), ctx)).status).toBe(400);
  });

  it('with Google down, slots say so and a booking is "requested"', async () => {
    const ctx = await fakesContext();
    ctx.fakes!.calendar.setDown(true);
    const { slots, calendarChecked } = await slotsOf(ctx);
    expect(calendarChecked).toBe(false);
    const leadId = await addLead(ctx);
    const res = await bookingsHandler(post('/api/booking/bookings', { leadId, start: slots[4].start, visitorTz: 'UTC' }), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'requested' });
  });

  it('bookings and manage posts share one limit of 10 per hour per IP; slots have their own of 120', async () => {
    const ctx = await fakesContext();
    const ip = { 'cf-connecting-ip': '203.0.113.50' };
    const token = 'T'.repeat(43);
    for (let i = 0; i < 4; i += 1) await bookingsHandler(post('/api/booking/bookings', {}, ip), ctx);
    for (let i = 0; i < 3; i += 1) await cancelHandler(post(`/api/booking/manage/${token}/cancel`, undefined, ip), ctx, { token });
    for (let i = 0; i < 3; i += 1) await rescheduleHandler(post(`/api/booking/manage/${token}/reschedule`, {}, ip), ctx, { token });
    expect((await bookingsHandler(post('/api/booking/bookings', {}, ip), ctx)).status).toBe(429);
    expect((await cancelHandler(post(`/api/booking/manage/${token}/cancel`, undefined, ip), ctx, { token })).status).toBe(429);
    expect((await rescheduleHandler(post(`/api/booking/manage/${token}/reschedule`, {}, ip), ctx, { token })).status).toBe(429);
    // Leads and slots are counted apart.
    expect((await leadsHandler(post('/api/booking/leads', lead, ip), ctx)).status).toBe(200);
    expect((await slotsHandler(get('/api/booking/slots', ip), ctx)).status).toBe(200);

    for (let i = 0; i < 119; i += 1) await slotsHandler(get('/api/booking/slots', ip), ctx);
    expect((await slotsHandler(get('/api/booking/slots', ip), ctx)).status).toBe(429);
  });
});

describe('managing a booking', () => {
  /** A new lead books `start` (or the sixth offered time); gives the booking's manage token and the times offered before it. */
  async function booked(ctx: ServerContext, start?: string) {
    const leadId = await addLead(ctx);
    const { slots } = await slotsOf(ctx);
    const res = await bookingsHandler(post('/api/booking/bookings', { leadId, start: start ?? slots[5].start, visitorTz: 'UTC' }), ctx);
    const body = await res.json() as { manageUrl: string };
    return { token: body.manageUrl.split('/').pop()!, slots };
  }

  it('cancel → { status: "cancelled" }, and the time is offered again', async () => {
    const ctx = await fakesContext();
    const { token, slots } = await booked(ctx);
    const res = await cancelHandler(post(`/api/booking/manage/${token}/cancel`), ctx, { token });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'cancelled' });
    expect((await slotsOf(ctx)).slots.map((s) => s.start)).toContain(slots[5].start);
  });

  it('reschedule → { status, start, end } for the new time', async () => {
    const ctx = await fakesContext();
    const { token, slots } = await booked(ctx);
    const res = await rescheduleHandler(post(`/api/booking/manage/${token}/reschedule`, { start: slots[9].start }), ctx, { token });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'booked', start: slots[9].start, end: slots[9].end });
  });

  it('reschedule onto a taken time → 409 slot_taken; no start → 400', async () => {
    const ctx = await fakesContext();
    const { token, slots } = await booked(ctx);
    await booked(ctx, slots[9].start);
    const taken = await rescheduleHandler(post(`/api/booking/manage/${token}/reschedule`, { start: slots[9].start }), ctx, { token });
    expect(taken.status).toBe(409);
    expect(await taken.json()).toEqual({ error: 'slot_taken' });
    const none = await rescheduleHandler(post(`/api/booking/manage/${token}/reschedule`, {}), ctx, { token });
    expect(none.status).toBe(400);
    expect(await none.json()).toEqual({ error: 'invalid', fields: { start: 'required' } });
  });

  it('an unknown or missing token → 404 not_found', async () => {
    const ctx = await fakesContext();
    for (const params of [{ token: 'nope' }, {}, undefined]) {
      const cancelled = await cancelHandler(post('/api/booking/manage/x/cancel'), ctx, params);
      expect(cancelled.status).toBe(404);
      expect(await cancelled.json()).toEqual({ error: 'not_found' });
      const moved = await rescheduleHandler(post('/api/booking/manage/x/reschedule', { start: '2030-01-01T00:00:00Z' }), ctx, params);
      expect(moved.status).toBe(404);
    }
  });
});

describe('answers', () => {
  const stub = (error: ErrorCode, fields?: Record<string, 'required'>) => {
    const fail = async () => ({ ok: false as const, error, fields });
    return { getSlots: async () => ({ slots: [], calendarChecked: true }), createLead: fail, book: fail, cancel: fail, reschedule: fail } as unknown as BookingService;
  };

  it.each([
    ['invalid', 400], ['bot_check_failed', 403], ['not_found', 404], ['slot_taken', 409], ['too_late', 409],
    ['rate_limited', 429], ['not_connected', 503], ['server_error', 500],
  ] as const)('the service answer %s → status %i, as { error }', async (error, status) => {
    const ctx = { ...(await fakesContext()), service: stub(error) };
    const res = await bookingsHandler(post('/api/booking/bookings', {}), ctx);
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error });
  });

  it('passes field codes along', async () => {
    const ctx = { ...(await fakesContext()), service: stub('invalid', { name: 'required' }) };
    expect(await (await leadsHandler(post('/api/booking/leads', {}), ctx)).json()).toEqual({ error: 'invalid', fields: { name: 'required' } });
  });

  it('an unexpected failure → 500 server_error, and the log holds no personal details', async () => {
    const boom = new Error('Duplicate entry zoe+ads@example.com for key email') as Error & { code: string };
    boom.code = 'ER_DUP_ENTRY';
    const service = { createLead: async () => { throw boom; } } as unknown as BookingService;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ctx = { ...(await fakesContext()), service };
    const res = await leadsHandler(post('/api/booking/leads', lead), ctx);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'server_error' });
    expect(errors).toHaveBeenCalledTimes(1);
    const logged = errors.mock.calls.flat().join(' ');
    expect(logged).toContain('leads');
    expect(logged).toContain('ER_DUP_ENTRY');
    expect(logged).not.toContain('zoe');
  });

  it('not connected → every booking route answers 503 not_connected', async () => {
    const ctx = await notConnectedContext();
    expect(ctx.service).toBeNull();
    const token = 'T'.repeat(43);
    const responses = [
      await slotsHandler(get('/api/booking/slots'), ctx),
      await leadsHandler(post('/api/booking/leads', lead), ctx),
      await bookingsHandler(post('/api/booking/bookings', {}), ctx),
      await cancelHandler(post(`/api/booking/manage/${token}/cancel`), ctx, { token }),
      await rescheduleHandler(post(`/api/booking/manage/${token}/reschedule`, {}), ctx, { token }),
    ];
    for (const res of responses) {
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: 'not_connected' });
    }
  });

  it('test routes answer 404 outside fakes mode, and change nothing', async () => {
    const ctx = await notConnectedContext();
    expect(ctx.fakes).toBeUndefined();
    const responses = [
      await testCalendarHandler(post('/api/test/calendar', { down: true }), ctx),
      await testOutboxHandler(get('/api/test/outbox'), ctx),
      await testEventsHandler(get('/api/test/events'), ctx),
      await testResetHandler(post('/api/test/reset'), ctx),
    ];
    for (const res of responses) {
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'not_found' });
    }
  });

  it('every API response is no-store', async () => {
    const ctx = await fakesContext();
    const down = await notConnectedContext();
    const broken = { ...ctx, service: { createLead: async () => { throw new Error('x'); } } as unknown as BookingService };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const token = 'T'.repeat(43);
    const responses = [
      await configHandler(get('/api/booking/config'), ctx),
      await slotsHandler(get('/api/booking/slots'), ctx),
      await leadsHandler(post('/api/booking/leads', lead), ctx),
      await leadsHandler(post('/api/booking/leads', '{'), ctx),
      await leadsHandler(post('/api/booking/leads', lead), broken),
      await bookingsHandler(post('/api/booking/bookings', {}), ctx),
      await cancelHandler(post(`/api/booking/manage/${token}/cancel`), ctx, { token }),
      await rescheduleHandler(post(`/api/booking/manage/${token}/reschedule`, {}), ctx, { token }),
      await slotsHandler(get('/api/booking/slots'), down),
      await configHandler(get('/api/booking/config'), down),
      await testOutboxHandler(get('/api/test/outbox'), ctx),
      await testOutboxHandler(get('/api/test/outbox'), down),
      await testCalendarHandler(post('/api/test/calendar', { down: false }), ctx),
      await testEventsHandler(get('/api/test/events'), ctx),
      await testResetHandler(post('/api/test/reset'), ctx),
    ];
    // Hit the limit too.
    for (let i = 0; i < 10; i += 1) await leadsHandler(post('/api/booking/leads', lead, { 'cf-connecting-ip': '203.0.113.77' }), ctx);
    responses.push(await leadsHandler(post('/api/booking/leads', lead, { 'cf-connecting-ip': '203.0.113.77' }), ctx));
    expect(new Set(responses.map((r) => r.status))).toEqual(new Set([200, 400, 404, 429, 500, 503]));
    for (const res of responses) {
      expect(res.headers.get('cache-control'), String(res.status)).toBe('no-store');
      expect(res.headers.get('content-type')).toContain('application/json');
    }
  });
});

describe('config', () => {
  it('tells the browser the mode', async () => {
    const live = await configHandler(get('/api/booking/config'), await fakesContext());
    expect(await live.json()).toEqual({ mode: 'live', turnstileSiteKey: '1x00000000000000000000AA' });
    const demo = await configHandler(get('/api/booking/config'), await notConnectedContext());
    expect(await demo.json()).toEqual({ mode: 'demo' });
  });
});

describe('test routes (fakes mode)', () => {
  const json = async (res: Response) => res.json() as Promise<unknown>;

  it('calendar: down and busy change what Google seems to say', async () => {
    const ctx = await fakesContext();
    const { slots } = await slotsOf(ctx);
    expect((await testCalendarHandler(post('/api/test/calendar', { busy: [slots[0]] }), ctx)).status).toBe(200);
    expect((await slotsOf(ctx)).slots.map((s) => s.start)).not.toContain(slots[0].start);
    await testCalendarHandler(post('/api/test/calendar', { down: true }), ctx);
    expect((await slotsOf(ctx)).calendarChecked).toBe(false);
    await testCalendarHandler(post('/api/test/calendar', { down: false, busy: [] }), ctx);
    expect(await slotsOf(ctx)).toMatchObject({ calendarChecked: true });
    expect((await slotsOf(ctx)).slots.map((s) => s.start)).toContain(slots[0].start);
  });

  it('calendar: a body that is not { down?, busy? } → 400', async () => {
    const ctx = await fakesContext();
    for (const body of ['{', '[]', { down: 'yes' }, { busy: 'all' }, { busy: [{ start: 'x' }] }, { busy: [1] }]) {
      expect((await testCalendarHandler(post('/api/test/calendar', body), ctx)).status, JSON.stringify(body)).toBe(400);
    }
  });

  it('outbox: lists what was sent as { kind, to, subject, text }', async () => {
    const ctx = await fakesContext();
    expect(await json(await testOutboxHandler(get('/api/test/outbox'), ctx))).toEqual([]);
    const leadId = await addLead(ctx);
    const { slots } = await slotsOf(ctx);
    await bookingsHandler(post('/api/booking/bookings', { leadId, start: slots[3].start, visitorTz: 'UTC' }), ctx);
    const outbox = await json(await testOutboxHandler(get('/api/test/outbox'), ctx)) as Array<{ kind: string; to: string; subject: string; text: string }>;
    expect(outbox.map((m) => m.kind)).toEqual(['booking-confirmed', 'hassan-new-booking']);
    expect(outbox[0]).toEqual({ kind: 'booking-confirmed', to: lead.email, subject: expect.stringContaining('booked'), text: expect.stringContaining('Zoë') });
    expect(Object.keys(outbox[1]).sort()).toEqual(['kind', 'subject', 'text', 'to']);
    // The test server never mails the real inbox of the site's owner.
    expect(outbox[1].to).toBe('hassan@example.test');
  });

  it('events: lists the tracked events', async () => {
    const ctx = await fakesContext();
    const leadId = await addLead(ctx);
    const events = await json(await testEventsHandler(get('/api/test/events'), ctx)) as Array<{ name: string; eventId: string; user: { email: string } }>;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ name: 'Lead', eventId: `lead.${leadId}`, user: { email: lead.email } });
  });

  it('reset: empties the store, calendar, outbox, tracked events and every rate limit', async () => {
    const ctx = await fakesContext();
    const ip = { 'cf-connecting-ip': '203.0.113.90' };
    const leadId = await addLead(ctx, {}, ip);
    const { slots } = await slotsOf(ctx);
    await bookingsHandler(post('/api/booking/bookings', { leadId, start: slots[3].start, visitorTz: 'UTC' }, ip), ctx);
    await testCalendarHandler(post('/api/test/calendar', { down: true, busy: [slots[7]] }), ctx);
    for (let i = 0; i < 12; i += 1) await slotsHandler(get('/api/booking/slots', ip), ctx);
    for (let i = 0; i < 10; i += 1) await leadsHandler(post('/api/booking/leads', lead, ip), ctx);
    expect((await leadsHandler(post('/api/booking/leads', lead, ip), ctx)).status).toBe(429);
    expect(ctx.fakes!.mailer.sent.length).toBeGreaterThan(0);
    expect(ctx.fakes!.tracked.length).toBeGreaterThan(0);
    expect(ctx.fakes!.calendar.events.size).toBe(1);

    const res = await testResetHandler(post('/api/test/reset'), ctx);
    expect(res.status).toBe(200);

    expect(ctx.fakes!.mailer.sent).toEqual([]);
    expect(ctx.fakes!.tracked).toEqual([]);
    expect(ctx.fakes!.calendar.events.size).toBe(0);
    expect((await leadsHandler(post('/api/booking/leads', lead, ip), ctx)).status).toBe(200);
    const after = await slotsOf(ctx);
    expect(after.calendarChecked).toBe(true); // Google is up again
    expect(after.slots.map((s) => s.start)).toContain(slots[3].start); // the booking is gone
    expect(after.slots.map((s) => s.start)).toContain(slots[7].start); // nothing is busy
    // The old lead is gone from the store.
    const old = await bookingsHandler(post('/api/booking/bookings', { leadId, start: slots[3].start, visitorTz: 'UTC' }, ip), ctx);
    expect(old.status).toBe(404);
  });

  it('reset: removes the emails written to the outbox folder', async () => {
    const dir = tempDir();
    const ctx = await createContext(readServerConfig({ HIVEGEN_FAKES: '1', NODE_ENV: 'test' }), { outboxDir: dir });
    const leadId = await addLead(ctx);
    const { slots } = await slotsOf(ctx);
    await bookingsHandler(post('/api/booking/bookings', { leadId, start: slots[3].start, visitorTz: 'UTC' }), ctx);
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.html'))).toHaveLength(2);
    ctx.fakes!.reset();
    expect(fs.existsSync(dir) ? fs.readdirSync(dir) : []).toEqual([]);
  });
});
