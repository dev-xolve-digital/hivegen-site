import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { ServerEvent, TrackingRecord } from '../../src/server/booking/types';
import { createMemoryStore } from '../../src/server/store/memory';
import { normalizeEmail, normalizePhone, sha256Hex } from '../../src/server/tracking/hash';
import { META_GRAPH_VERSION, buildMetaEvent, createMetaTracker } from '../../src/server/tracking/meta';
import { good, setup } from './helpers/booking';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const NOW = new Date('2026-12-01T10:00:00Z');
const TOKEN = 'EAAB-secret-token-123';

const event = (over: Partial<ServerEvent> = {}): ServerEvent => ({
  name: 'Lead', eventId: 'lead.abc123', time: NOW, sourceUrl: 'https://hivegen.co/agents?utm_source=facebook', leadId: 7,
  user: {
    email: ' Zoe+Ads@Example.com ', phone: '(555) 010-2000', externalId: 'abc123',
    ip: '203.0.113.9', userAgent: 'Mozilla/5.0 (Test)', fbp: 'fb.1.1700000000000.111', fbc: 'fb.1.1700000000000.AbC',
  },
  ...over,
});

/** The body of the request a fake fetch received. */
const bodyOf = (call: unknown[]) => JSON.parse((call[1] as { body: string }).body) as Record<string, any>;

let warn: MockInstance;
beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });
const logged = () => warn.mock.calls.flat().join(' ');

describe('hashing', () => {
  it('email and phone are normalised before hashing', () => {
    expect(normalizeEmail(' Zoe+Ads@Example.com ')).toBe('zoe+ads@example.com');
    expect(sha256Hex(normalizeEmail(' Zoe+Ads@Example.com '))).toBe(sha256Hex('zoe+ads@example.com'));
    expect(sha256Hex('zoe+ads@example.com')).toBe(sha('zoe+ads@example.com'));
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(normalizePhone('(555) 010-2000')).toBe('15550102000'); // ten digits: the US country code is added
    expect(normalizePhone('+1 (555) 010-2000')).toBe('15550102000'); // already has it
    expect(normalizePhone('1-555-010-2000')).toBe('15550102000');
    expect(normalizePhone('+44 20 7946 0958')).toBe('442079460958'); // another country: digits only, nothing added
  });
});

describe('buildMetaEvent', () => {
  it('sets the event fields, with the time in seconds', () => {
    const body = buildMetaEvent(event()) as { data: Array<Record<string, unknown>> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      event_name: 'Lead', event_time: Math.floor(NOW.getTime() / 1000), event_id: 'lead.abc123', action_source: 'website',
      event_source_url: 'https://hivegen.co/agents?utm_source=facebook',
    });
  });

  it('hashes email, phone and the external id; the IP, user agent, fbp and fbc go as they are', () => {
    const { data } = buildMetaEvent(event()) as { data: Array<{ user_data: Record<string, unknown> }> };
    expect(data[0].user_data).toEqual({
      em: [sha('zoe+ads@example.com')], ph: [sha('15550102000')], external_id: [sha('abc123')],
      client_ip_address: '203.0.113.9', client_user_agent: 'Mozilla/5.0 (Test)', fbp: 'fb.1.1700000000000.111', fbc: 'fb.1.1700000000000.AbC',
    });
  });

  it('leaves out what the visitor never gave (no empty hashes)', () => {
    const { data } = buildMetaEvent(event({ name: 'PageView', user: { ip: '203.0.113.9', userAgent: 'UA', phone: '()' } })) as { data: Array<{ user_data: Record<string, unknown> }> };
    expect(data[0].user_data).toEqual({ client_ip_address: '203.0.113.9', client_user_agent: 'UA' });
  });

  it('the test event code is a field of the request, and only when there is one', () => {
    expect(buildMetaEvent(event(), 'TEST123')).toMatchObject({ test_event_code: 'TEST123' });
    expect(buildMetaEvent(event())).not.toHaveProperty('test_event_code');
    expect(buildMetaEvent(event(), '')).not.toHaveProperty('test_event_code');
  });

  it('the payload carries no raw email, phone or access token', () => {
    const text = JSON.stringify(buildMetaEvent(event(), 'TEST123'));
    for (const raw of ['zoe+ads', 'Zoe', 'example.com', '555', '010-2000', 'access_token']) expect(text).not.toContain(raw);
    expect(text).toContain(sha('zoe+ads@example.com'));
  });
});

describe('createMetaTracker', () => {
  const ok = () => new Response(JSON.stringify({ events_received: 1 }), { status: 200 });
  function make(fetchFn: ReturnType<typeof vi.fn>, over: { testEventCode?: string; timeoutMs?: number } = {}) {
    const store = createMemoryStore();
    const tracker = createMetaTracker({ pixelId: '123456789', token: TOKEN, store, fetchFn: fetchFn as unknown as typeof fetch, ...over });
    return { store, tracker };
  }

  it('posts one event to the Graph API for the pixel, with the token in the body and not in the address', async () => {
    const fetchFn = vi.fn(async (_url?: unknown, _init?: unknown) => ok());
    const { tracker } = make(fetchFn, { testEventCode: 'TEST123' });
    await tracker.send(event());
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://graph.facebook.com/${META_GRAPH_VERSION}/123456789/events`);
    expect(url).not.toContain(TOKEN);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(init.signal).toBeInstanceOf(AbortSignal); // a stalled Meta cannot hold a booking up for long
    expect(bodyOf(fetchFn.mock.calls[0])).toMatchObject({ access_token: TOKEN, test_event_code: 'TEST123', data: [{ event_name: 'Lead', event_id: 'lead.abc123' }] });
  });

  it('the graph version is one constant, v-number.0', () => {
    expect(META_GRAPH_VERSION).toMatch(/^v\d+\.0$/);
  });

  it('the Conversions API payload carries the shared event id and hashed user data, and no raw email', async () => {
    const fetchFn = vi.fn(async (_url?: unknown, _init?: unknown) => ok());
    const { tracker, store } = make(fetchFn);
    await tracker.send(event());
    const sent = bodyOf(fetchFn.mock.calls[0]);
    expect(sent.data[0].event_id).toBe('lead.abc123');
    expect(sent.data[0].user_data.em).toEqual([sha('zoe+ads@example.com')]);
    expect(sent.data[0].user_data.ph).toEqual([sha('15550102000')]);
    const body = (fetchFn.mock.calls[0][1] as { body: string }).body;
    expect(body).not.toContain('zoe+ads@example.com');
    expect(body).not.toContain('5550102000"'); // the phone only appears hashed
    // What is stored for a later retry is the same request, without the token.
    const [stored] = await store.trackingEventsByStatus('sent');
    expect(JSON.stringify(stored.payload)).not.toContain(TOKEN);
    expect(stored.payload).toEqual({ ...sent, access_token: undefined });
  });

  it('records the event as pending while it is being sent, then as sent (attempts 1)', async () => {
    let during: TrackingRecord[] = [];
    const fetchFn = vi.fn(async (_url?: unknown, _init?: unknown) => { during = await store.trackingEventsByStatus('pending'); return ok(); });
    const { tracker, store } = make(fetchFn);
    await tracker.send(event());
    expect(during.map((r) => [r.eventId, r.name, r.leadId, r.attempts])).toEqual([['lead.abc123', 'Lead', 7, 1]]);
    expect(await store.trackingEventsByStatus('pending')).toEqual([]);
    const [done] = await store.trackingEventsByStatus('sent');
    expect(done).toMatchObject({ eventId: 'lead.abc123', name: 'Lead', leadId: 7, status: 'sent', attempts: 1 });
    expect(done.error).toBeUndefined();
  });

  it('a failed send is recorded as failed, never thrown', async () => {
    const down = vi.fn(async (_url?: unknown, _init?: unknown) => { throw new TypeError('fetch failed: connect ECONNREFUSED graph.facebook.com'); });
    const a = make(down);
    await expect(a.tracker.send(event())).resolves.toBeUndefined();
    const [failed] = await a.store.trackingEventsByStatus('failed');
    expect(failed).toMatchObject({ eventId: 'lead.abc123', status: 'failed', attempts: 1 });
    expect(failed.error).toBe('TypeError'); // the kind of error only

    const refused = vi.fn(async (_url?: unknown, _init?: unknown) => new Response(JSON.stringify({ error: { message: 'Invalid OAuth access token for zoe+ads@example.com', code: 190 } }), { status: 400 }));
    const b = make(refused);
    await expect(b.tracker.send(event())).resolves.toBeUndefined();
    const [rejected] = await b.store.trackingEventsByStatus('failed');
    expect(rejected.error).toBe('http 400 code 190'); // short, and never Meta's message
    expect(rejected.attempts).toBe(1);
  });

  it('a PageView is sent but leaves no row: only Lead and Schedule are recorded (and so retried)', async () => {
    const view = event({ name: 'PageView', eventId: '3f8c1c1e-2b7a-4c53-9d0e-6a1f5b7d9e21', leadId: undefined, user: { ip: '203.0.113.9', userAgent: 'Mozilla/5.0 (Test)' } });
    const fetchFn = vi.fn(async (_url?: unknown, _init?: unknown) => ok());
    const { tracker, store } = make(fetchFn);
    const record = vi.spyOn(store, 'recordTrackingEvent');
    const update = vi.spyOn(store, 'updateTrackingEvent');
    await tracker.send(view);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(bodyOf(fetchFn.mock.calls[0]).data[0]).toMatchObject({ event_name: 'PageView', event_id: view.eventId });
    expect(record).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    for (const status of ['pending', 'sent', 'failed', 'skipped'] as const) expect(await store.trackingEventsByStatus(status)).toEqual([]);
    await tracker.send(event()); // a Lead next to it is recorded as ever
    expect((await store.trackingEventsByStatus('sent')).map((r) => r.eventId)).toEqual(['lead.abc123']);
  });

  it('a PageView that fails is logged by its kind of error only, never thrown, never kept for a retry', async () => {
    const view = event({ name: 'PageView', eventId: '3f8c1c1e-2b7a-4c53-9d0e-6a1f5b7d9e21', leadId: undefined, user: { ip: '203.0.113.9', userAgent: 'Mozilla/5.0 (Test)' } });
    const refused = vi.fn(async (_url?: unknown, _init?: unknown) => new Response(JSON.stringify({ error: { message: 'Invalid OAuth access token 203.0.113.9', code: 190 } }), { status: 400 }));
    const a = make(refused);
    await expect(a.tracker.send(view)).resolves.toBeUndefined();
    for (const status of ['pending', 'sent', 'failed', 'skipped'] as const) expect(await a.store.trackingEventsByStatus(status)).toEqual([]);
    expect(logged()).toContain('tracking');
    expect(logged()).toContain('PageView');
    expect(logged()).toContain('http 400 code 190');

    const down = vi.fn(async (_url?: unknown, _init?: unknown) => { throw new TypeError('connect ECONNREFUSED 203.0.113.9'); });
    await expect(make(down).tracker.send(view)).resolves.toBeUndefined();
    expect(logged()).toContain('TypeError');
    for (const secret of [TOKEN, '203.0.113.9', 'Mozilla', view.eventId]) expect(logged()).not.toContain(secret);
  });

  it('a stalled request is cut off and counts as failed', async () => {
    const stalled = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(init.signal!.reason));
    }));
    const { tracker, store } = make(stalled, { timeoutMs: 20 });
    await expect(tracker.send(event())).resolves.toBeUndefined();
    const [failed] = await store.trackingEventsByStatus('failed');
    expect(failed.error).toMatch(/^(TimeoutError|AbortError)$/);
  });

  it('never throws and never logs the token or the visitor, even when the store breaks', async () => {
    const fetchFn = vi.fn(async (_url?: unknown, _init?: unknown) => ok());
    const { tracker, store } = make(fetchFn);
    store.recordTrackingEvent = async () => { throw Object.assign(new Error(`insert failed for zoe+ads@example.com ${TOKEN}`), { code: 'ER_DOWN' }); };
    store.updateTrackingEvent = async () => { throw new Error('update failed for zoe+ads@example.com'); };
    await expect(tracker.send(event())).resolves.toBeUndefined();
    expect(fetchFn).toHaveBeenCalledTimes(1); // the event still goes to Meta
    expect(logged()).not.toContain('zoe');
    expect(logged()).not.toContain(TOKEN);
    expect(logged()).toContain('tracking');
  });

  it('a duplicate event id is recorded once (the store ignores the second)', async () => {
    const { tracker, store } = make(vi.fn(async (_url?: unknown, _init?: unknown) => ok()));
    await tracker.send(event());
    await tracker.send(event());
    expect(await store.trackingEventsByStatus('sent')).toHaveLength(1);
  });

  describe('resend', () => {
    const stored = (over: Partial<TrackingRecord> = {}): TrackingRecord => ({
      eventId: 'lead.abc123', name: 'Lead', leadId: 7, status: 'failed', attempts: 1, error: 'http 500',
      payload: buildMetaEvent(event(), 'TEST123'), ...over,
    });

    it('sends the stored payload again, with the token, and says whether Meta took it', async () => {
      const fetchFn = vi.fn(async (_url?: unknown, _init?: unknown) => ok());
      const { tracker } = make(fetchFn);
      expect(await tracker.resend(stored())).toBe(true);
      const sent = bodyOf(fetchFn.mock.calls[0]);
      expect(sent).toEqual({ ...(buildMetaEvent(event(), 'TEST123') as object), access_token: TOKEN });
      expect(fetchFn.mock.calls[0][0]).toBe(`https://graph.facebook.com/${META_GRAPH_VERSION}/123456789/events`);
    });

    it('is false when Meta refuses or cannot be reached, and never throws', async () => {
      expect(await make(vi.fn(async (_url?: unknown, _init?: unknown) => new Response('{}', { status: 500 }))).tracker.resend(stored())).toBe(false);
      expect(await make(vi.fn(async (_url?: unknown, _init?: unknown) => { throw new TypeError('offline'); })).tracker.resend(stored())).toBe(false);
    });

    it('only sends: it writes nothing to the store (cron records the attempt)', async () => {
      const { tracker, store } = make(vi.fn(async (_url?: unknown, _init?: unknown) => ok()));
      const record = vi.spyOn(store, 'recordTrackingEvent');
      const update = vi.spyOn(store, 'updateTrackingEvent');
      await tracker.resend(stored());
      expect(record).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    });

    it('a record with nothing to send is false, and sends nothing', async () => {
      const fetchFn = vi.fn(async (_url?: unknown, _init?: unknown) => ok());
      expect(await make(fetchFn).tracker.resend(stored({ payload: undefined }))).toBe(false);
      expect(fetchFn).not.toHaveBeenCalled();
    });
  });
});

describe('the browser and the server share the event id', () => {
  it('the id the browser gets for Lead and Schedule is the event_id Meta receives', async () => {
    const fetchFn = vi.fn(async (_url?: unknown, _init?: unknown) => new Response('{}', { status: 200 }));
    const store = createMemoryStore();
    const tracker = createMetaTracker({ pixelId: '123456789', token: TOKEN, store, fetchFn: fetchFn as unknown as typeof fetch });
    const t = setup({ store, tracker });
    const created = await t.svc.createLead(good, { ip: '203.0.113.9', userAgent: 'UA', sourceUrl: 'https://hivegen.co/agents' });
    expect(created.ok).toBe(true);
    const { leadId, eventId } = (created as { value: { leadId: string; eventId: string } }).value;
    const { slots } = await t.svc.getSlots();
    const booked = await t.svc.book({ leadId, start: slots[0].start, visitorTz: 'UTC' }, { ip: '203.0.113.9', userAgent: 'UA', sourceUrl: 'https://hivegen.co/agents' });
    expect(booked.ok).toBe(true);
    const scheduleId = (booked as { value: { eventId: string } }).value.eventId;

    const received = fetchFn.mock.calls.map((c) => bodyOf(c).data[0]);
    expect(received.map((e) => [e.event_name, e.event_id])).toEqual([['Lead', eventId], ['Schedule', scheduleId]]);
    expect(eventId).toBe(`lead.${leadId}`);
    expect(scheduleId).toBe(`schedule.${leadId}`);
    expect(received[0].user_data.external_id).toEqual([sha(leadId)]);
    expect(received[0].event_source_url).toBe('https://hivegen.co/agents');
    expect((await store.trackingEventsByStatus('sent')).map((r) => r.eventId)).toEqual([eventId, scheduleId]);
  });
});
