import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONNECT_REDIRECT_URI, GOOGLE_SCOPES, consentUrl, createGoogleCalendar, exchangeAuthCode } from '../../src/server/calendar/google';
import { upsertEnvLine } from '../../src/server/env';
import { CalendarUnavailableError, type CalendarEventInput } from '../../src/server/booking/types';

const cfg = { clientId: 'client-id-1', clientSecret: 'client-secret-1', refreshToken: 'refresh-token-1', calendarId: 'primary' };
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/calendar/v3';
const SECRETS = [cfg.clientSecret, cfg.refreshToken, 'access-1', 'access-2', 'zoe@example.com', 'Zoë'];

const event: CalendarEventInput = {
  start: '2026-12-02T14:00:00.000Z', end: '2026-12-02T14:15:00.000Z', summary: 'HiveGen call · Zoë', description: 'Your call',
  attendee: { email: 'zoe@example.com', name: 'Zoë' }, privateProps: { leadId: 'abc', publicId: 'p-1' },
};

type Req = { url: string; method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal | null };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * A fetch that records every request. Token requests are answered with access-1, access-2, ... (one hour each)
 * unless `token` says otherwise; every other request goes to `api`.
 */
function fakeGoogle(
  api: (req: Req) => Response | Promise<Response> = () => json({}),
  token: (req: Req, n: number) => Response | Promise<Response> = (_req, n) => json({ access_token: `access-${n}`, expires_in: 3600 }),
) {
  const requests: Req[] = [];
  let tokens = 0;
  const fetchFn = async (url: string, init?: RequestInit) => {
    const req: Req = { url, method: init?.method ?? 'GET', headers: Object.fromEntries(new Headers(init?.headers)), body: init?.body as string | undefined, signal: init?.signal };
    requests.push(req);
    if (url === TOKEN_URL) return token(req, ++tokens);
    return api(req);
  };
  return {
    fetchFn,
    requests,
    tokenRequests: () => requests.filter((r) => r.url === TOKEN_URL),
    apiRequests: () => requests.filter((r) => r.url !== TOKEN_URL),
  };
}

const busyReply = (busy: { start: string; end: string }[] = []) => json({ calendars: { primary: { busy } } });
const unavailable = (message: string | RegExp) => expect.objectContaining({ name: 'CalendarUnavailableError', message: expect.stringMatching(message) });

afterEach(() => { vi.useRealTimers(); });

describe('Google access token', () => {
  it('refreshes the access token once and reuses it', async () => {
    const g = fakeGoogle(() => busyReply());
    const cal = createGoogleCalendar(cfg, g.fetchFn);
    await cal.busy('2026-12-02T00:00:00.000Z', '2026-12-03T00:00:00.000Z');
    await cal.busy('2026-12-03T00:00:00.000Z', '2026-12-04T00:00:00.000Z');

    expect(g.tokenRequests()).toHaveLength(1);
    const t = g.tokenRequests()[0];
    expect(t.method).toBe('POST');
    expect(t.headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(Object.fromEntries(new URLSearchParams(t.body))).toEqual({
      client_id: 'client-id-1', client_secret: 'client-secret-1', refresh_token: 'refresh-token-1', grant_type: 'refresh_token',
    });
    expect(g.apiRequests().map((r) => r.headers.authorization)).toEqual(['Bearer access-1', 'Bearer access-1']);
  });

  it('shares one token request between calls that start together', async () => {
    const g = fakeGoogle(() => busyReply());
    const cal = createGoogleCalendar(cfg, g.fetchFn);
    await Promise.all([cal.busy('2026-12-02T00:00:00.000Z', '2026-12-03T00:00:00.000Z'), cal.busy('2026-12-03T00:00:00.000Z', '2026-12-04T00:00:00.000Z')]);
    expect(g.tokenRequests()).toHaveLength(1);
  });

  it('asks for a new token 60 seconds before the old one runs out', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-12-01T00:00:00.000Z'));
    const g = fakeGoogle(() => busyReply());
    const cal = createGoogleCalendar(cfg, g.fetchFn);
    const ask = () => cal.busy('2026-12-02T00:00:00.000Z', '2026-12-03T00:00:00.000Z');

    await ask();
    vi.setSystemTime(new Date('2026-12-01T00:58:59.000Z')); // 3539 s: still good
    await ask();
    expect(g.tokenRequests()).toHaveLength(1);
    vi.setSystemTime(new Date('2026-12-01T00:59:01.000Z')); // 3541 s: inside the last minute
    await ask();
    expect(g.tokenRequests()).toHaveLength(2);
    expect(g.apiRequests().map((r) => r.headers.authorization)).toEqual(['Bearer access-1', 'Bearer access-1', 'Bearer access-2']);
  });

  it('after a 401 drops the token and retries once with a fresh one', async () => {
    let first = true;
    const g = fakeGoogle(() => {
      if (first) { first = false; return json({ error: { code: 401 } }, 401); }
      return busyReply([{ start: '2026-12-02T14:00:00Z', end: '2026-12-02T14:15:00Z' }]);
    });
    const cal = createGoogleCalendar(cfg, g.fetchFn);
    await expect(cal.busy('2026-12-02T00:00:00.000Z', '2026-12-03T00:00:00.000Z')).resolves.toHaveLength(1);
    expect(g.tokenRequests()).toHaveLength(2);
    expect(g.apiRequests().map((r) => r.headers.authorization)).toEqual(['Bearer access-1', 'Bearer access-2']);
  });

  it('gives up when the fresh token is refused too', async () => {
    const g = fakeGoogle(() => json({}, 401));
    const cal = createGoogleCalendar(cfg, g.fetchFn);
    await expect(cal.busy('2026-12-02T00:00:00.000Z', '2026-12-03T00:00:00.000Z')).rejects.toEqual(unavailable('google freeBusy 401'));
    expect(g.apiRequests()).toHaveLength(2);
    expect(g.tokenRequests()).toHaveLength(2);
  });
});

describe('Google busy times', () => {
  it('reads busy times for the calendar', async () => {
    const g = fakeGoogle(() => busyReply([
      { start: '2026-12-02T14:00:00Z', end: '2026-12-02T14:30:00Z' },
      { start: '2026-12-02T16:00:00+00:00', end: '2026-12-02T17:00:00.500Z' },
    ]));
    const cal = createGoogleCalendar(cfg, g.fetchFn);
    const busy = await cal.busy('2026-12-02T00:00:00.000Z', '2026-12-03T00:00:00.000Z');

    const [req] = g.apiRequests();
    expect(req.url).toBe(`${API}/freeBusy`);
    expect(req.method).toBe('POST');
    expect(req.headers['content-type']).toBe('application/json');
    expect(JSON.parse(req.body!)).toEqual({ timeMin: '2026-12-02T00:00:00.000Z', timeMax: '2026-12-03T00:00:00.000Z', items: [{ id: 'primary' }] });
    expect(busy).toEqual([
      { start: '2026-12-02T14:00:00.000Z', end: '2026-12-02T14:30:00.000Z' },
      { start: '2026-12-02T16:00:00.000Z', end: '2026-12-02T17:00:00.500Z' },
    ]);
  });

  it('returns an empty list when nothing is busy', async () => {
    const cal = createGoogleCalendar(cfg, fakeGoogle(() => json({ calendars: { primary: {} } })).fetchFn);
    await expect(cal.busy('2026-12-02T00:00:00.000Z', '2026-12-03T00:00:00.000Z')).resolves.toEqual([]);
  });

  it('asks about the configured calendar', async () => {
    const g = fakeGoogle(() => json({ calendars: { 'sales@example.com': { busy: [] } } }));
    const cal = createGoogleCalendar({ ...cfg, calendarId: 'sales@example.com' }, g.fetchFn);
    await expect(cal.busy('2026-12-02T00:00:00.000Z', '2026-12-03T00:00:00.000Z')).resolves.toEqual([]);
    expect(JSON.parse(g.apiRequests()[0].body!).items).toEqual([{ id: 'sales@example.com' }]);
  });
});

describe('Google events', () => {
  it('creates the event with a Meet request, the visitor as guest, private details, and invites sent', async () => {
    const g = fakeGoogle(() => json({ id: 'ev1', hangoutLink: 'https://meet.google.com/abc-defg-hij' }));
    const cal = createGoogleCalendar(cfg, g.fetchFn);
    const result = await cal.createEvent(event);

    const [req] = g.apiRequests();
    expect(req.url).toBe(`${API}/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all`);
    expect(req.method).toBe('POST');
    expect(req.headers.authorization).toBe('Bearer access-1');
    const body = JSON.parse(req.body!);
    expect(body.summary).toBe(event.summary);
    expect(body.description).toBe(event.description);
    expect(body.start).toEqual({ dateTime: '2026-12-02T14:00:00.000Z' });
    expect(body.end).toEqual({ dateTime: '2026-12-02T14:15:00.000Z' });
    expect(body.attendees).toEqual([{ email: 'zoe@example.com', displayName: 'Zoë' }]);
    expect(body.conferenceData.createRequest.conferenceSolutionKey.type).toBe('hangoutsMeet');
    expect(body.conferenceData.createRequest.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.extendedProperties.private).toEqual(event.privateProps);
    expect(result).toEqual({ eventId: 'ev1', meetUrl: 'https://meet.google.com/abc-defg-hij' });
  });

  it('uses a new Meet request id for every event', async () => {
    const g = fakeGoogle(() => json({ id: 'ev1' }));
    const cal = createGoogleCalendar(cfg, g.fetchFn);
    await cal.createEvent(event);
    await cal.createEvent(event);
    const ids = g.apiRequests().map((r) => JSON.parse(r.body!).conferenceData.createRequest.requestId);
    expect(new Set(ids).size).toBe(2);
  });

  it('falls back to the video entry point for the Meet link, and to none', async () => {
    const withEntryPoints = fakeGoogle(() => json({
      id: 'ev2',
      conferenceData: { entryPoints: [{ entryPointType: 'phone', uri: 'tel:+1555' }, { entryPointType: 'video', uri: 'https://meet.google.com/xyz-xyz-xyz' }] },
    }));
    await expect(createGoogleCalendar(cfg, withEntryPoints.fetchFn).createEvent(event)).resolves.toEqual({ eventId: 'ev2', meetUrl: 'https://meet.google.com/xyz-xyz-xyz' });

    const bare = fakeGoogle(() => json({ id: 'ev3' }));
    const made = await createGoogleCalendar(cfg, bare.fetchFn).createEvent(event);
    expect(made.eventId).toBe('ev3');
    expect(made.meetUrl).toBeUndefined();
  });

  it('treats a created event without an id as a failure', async () => {
    const cal = createGoogleCalendar(cfg, fakeGoogle(() => json({ hangoutLink: 'https://meet.google.com/abc' })).fetchFn);
    await expect(cal.createEvent(event)).rejects.toEqual(unavailable('google create'));
  });

  it('moves an event and sends the update to the guest', async () => {
    const g = fakeGoogle(() => json({ id: 'ev1' }));
    const cal = createGoogleCalendar(cfg, g.fetchFn);
    await cal.moveEvent('ev1', '2026-12-02T15:00:00.000Z', '2026-12-02T15:15:00.000Z');

    const [req] = g.apiRequests();
    expect(req.url).toBe(`${API}/calendars/primary/events/ev1?sendUpdates=all`);
    expect(req.method).toBe('PATCH');
    expect(JSON.parse(req.body!)).toEqual({ start: { dateTime: '2026-12-02T15:00:00.000Z' }, end: { dateTime: '2026-12-02T15:15:00.000Z' } });
  });

  it('cancels an event and tells the guest', async () => {
    const g = fakeGoogle(() => new Response(null, { status: 204 }));
    const cal = createGoogleCalendar(cfg, g.fetchFn);
    await expect(cal.cancelEvent('ev1')).resolves.toBeUndefined();

    const [req] = g.apiRequests();
    expect(req.url).toBe(`${API}/calendars/primary/events/ev1?sendUpdates=all`);
    expect(req.method).toBe('DELETE');
    expect(req.body).toBeUndefined();
  });

  it('cancelling an event Google already removed counts as done', async () => {
    for (const status of [410, 404]) {
      const cal = createGoogleCalendar(cfg, fakeGoogle(() => json({ error: { code: status } }, status)).fetchFn);
      await expect(cal.cancelEvent('ev1')).resolves.toBeUndefined();
    }
  });

  it('puts calendar and event ids safely into the path', async () => {
    const g = fakeGoogle(() => json({ id: 'x' }));
    const cal = createGoogleCalendar({ ...cfg, calendarId: 'sales@example.com' }, g.fetchFn);
    await cal.moveEvent('ev/1?x', event.start, event.end);
    expect(g.apiRequests()[0].url).toBe(`${API}/calendars/sales%40example.com/events/ev%2F1%3Fx?sendUpdates=all`);
  });
});

describe('Google failures', () => {
  const window = ['2026-12-02T00:00:00.000Z', '2026-12-03T00:00:00.000Z'] as const;
  const calls: [string, (cal: ReturnType<typeof createGoogleCalendar>) => Promise<unknown>, string][] = [
    ['busy', (cal) => cal.busy(...window), 'freeBusy'],
    ['createEvent', (cal) => cal.createEvent(event), 'create'],
    ['moveEvent', (cal) => cal.moveEvent('ev1', event.start, event.end), 'move'],
    ['cancelEvent', (cal) => cal.cancelEvent('ev1'), 'cancel'],
  ];

  it.each(calls)('%s: Google errors become CalendarUnavailableError with a short reason', async (_name, call, label) => {
    for (const status of [500, 503, 403, 429]) {
      const cal = createGoogleCalendar(cfg, fakeGoogle(() => json({ error: { message: 'zoe@example.com is busy' } }, status)).fetchFn);
      const error = await call(cal).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(CalendarUnavailableError);
      expect((error as Error).message).toBe(`google ${label} ${status}`);
    }
  });

  it.each(calls)('%s: a network error becomes CalendarUnavailableError', async (_name, call, label) => {
    const g = fakeGoogle(() => { throw new TypeError('fetch failed for access-1 zoe@example.com'); });
    const error = await call(createGoogleCalendar(cfg, g.fetchFn)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CalendarUnavailableError);
    expect((error as Error).message).toBe(`google ${label} unreachable`);
  });

  it.each(calls)('%s: a request that times out becomes CalendarUnavailableError', async (_name, call, label) => {
    const g = fakeGoogle((req) => new Promise<Response>((_resolve, reject) => req.signal?.addEventListener('abort', () => reject(req.signal?.reason))));
    const error = await call(createGoogleCalendar(cfg, g.fetchFn, 25)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CalendarUnavailableError);
    expect((error as Error).message).toBe(`google ${label} timed out`);
  });

  it('every request has a timeout signal, 8 seconds unless told otherwise', async () => {
    const spy = vi.spyOn(AbortSignal, 'timeout');
    try {
      const g = fakeGoogle(() => busyReply());
      await createGoogleCalendar(cfg, g.fetchFn).busy(...window);
      expect(g.requests).toHaveLength(2);
      for (const r of g.requests) expect(r.signal).toBeInstanceOf(AbortSignal);
      expect(spy.mock.calls).toEqual([[8000], [8000]]);
    } finally {
      spy.mockRestore();
    }
  });

  it('per-calendar errors become CalendarUnavailableError', async () => {
    const g = fakeGoogle(() => json({ calendars: { primary: { errors: [{ domain: 'global', reason: 'notFound' }], busy: [] } } }));
    await expect(createGoogleCalendar(cfg, g.fetchFn).busy(...window)).rejects.toEqual(unavailable('google freeBusy calendar error'));
  });

  it('an answer that is not what Google documents becomes CalendarUnavailableError', async () => {
    for (const reply of [() => json({}), () => json({ calendars: {} }), () => new Response('<html>oops</html>', { status: 200 }),
      () => busyReply([{ start: 'not a time', end: '2026-12-02T14:15:00Z' }])]) {
      await expect(createGoogleCalendar(cfg, fakeGoogle(reply).fetchFn).busy(...window)).rejects.toBeInstanceOf(CalendarUnavailableError);
    }
  });

  it('a failed token request becomes CalendarUnavailableError, naming only Google\'s error code', async () => {
    const g = fakeGoogle(() => busyReply(), () => json({ error: 'invalid_grant', error_description: 'Token has been revoked for refresh-token-1' }, 400));
    const error = await createGoogleCalendar(cfg, g.fetchFn).busy(...window).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CalendarUnavailableError);
    expect((error as Error).message).toBe('google token 400 invalid_grant');
    expect(g.apiRequests()).toHaveLength(0);
  });

  it('a token request that fails without a readable body, times out or answers nonsense becomes CalendarUnavailableError', async () => {
    const down = fakeGoogle(() => busyReply(), () => new Response('Bad gateway', { status: 502 }));
    await expect(createGoogleCalendar(cfg, down.fetchFn).busy(...window)).rejects.toEqual(unavailable(/^google token 502$/));

    const nonsense = fakeGoogle(() => busyReply(), () => json({ expires_in: 3600 }));
    await expect(createGoogleCalendar(cfg, nonsense.fetchFn).busy(...window)).rejects.toEqual(unavailable('google token'));

    const slow = fakeGoogle(() => busyReply(), (req) => new Promise<Response>((_resolve, reject) => req.signal?.addEventListener('abort', () => reject(req.signal?.reason))));
    await expect(createGoogleCalendar(cfg, slow.fetchFn, 25).busy(...window)).rejects.toEqual(unavailable('google token timed out'));
  });

  it('tries again with a new token request after the last one failed', async () => {
    let n = 0;
    const g = fakeGoogle(() => busyReply(), (_req, count) => (++n === 1 ? json({ error: 'temporarily_unavailable' }, 503) : json({ access_token: `access-${count}`, expires_in: 3600 })));
    const cal = createGoogleCalendar(cfg, g.fetchFn);
    await expect(cal.busy(...window)).rejects.toBeInstanceOf(CalendarUnavailableError);
    await expect(cal.busy(...window)).resolves.toEqual([]);
  });

  it('error messages never contain tokens, the client secret or event details', async () => {
    const messages: string[] = [];
    const record = async (p: Promise<unknown>) => { try { await p; } catch (e) { messages.push((e as Error).message); } };
    const failing = [
      fakeGoogle(() => json({ error: { message: 'zoe@example.com Zoë access-1 client-secret-1' } }, 500)),
      fakeGoogle(() => { throw new Error('boom zoe@example.com access-1'); }),
      fakeGoogle(() => json({ calendars: { primary: { errors: [{ reason: 'zoe@example.com' }] } } })),
      fakeGoogle(() => busyReply(), () => json({ error: 'invalid_grant', error_description: 'refresh-token-1 client-secret-1' }, 400)),
    ];
    for (const g of failing) {
      const cal = createGoogleCalendar(cfg, g.fetchFn);
      await record(cal.busy('2026-12-02T00:00:00.000Z', '2026-12-03T00:00:00.000Z'));
      await record(cal.createEvent(event));
      await record(cal.moveEvent('ev1', event.start, event.end));
      await record(cal.cancelEvent('ev1'));
    }
    expect(messages.length).toBeGreaterThan(10);
    for (const message of messages) for (const secret of SECRETS) expect(message).not.toContain(secret);
  });
});

describe('Google sign-in', () => {
  it('builds the consent address with offline access, both calendar scopes and the local callback', () => {
    const url = new URL(consentUrl('client-id-1', 'state-1'));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'client-id-1',
      redirect_uri: 'http://127.0.0.1:53682/callback',
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.freebusy',
      access_type: 'offline',
      prompt: 'consent',
      state: 'state-1',
    });
    expect(CONNECT_REDIRECT_URI).toBe('http://127.0.0.1:53682/callback');
    expect([...GOOGLE_SCOPES]).toEqual(['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.freebusy']);
  });

  it('leaves the state out when none is given', () => {
    expect(new URL(consentUrl('client-id-1')).searchParams.has('state')).toBe(false);
  });

  it('exchanges the code for a refresh token', async () => {
    const g = fakeGoogle(() => json({}), () => json({ access_token: 'access-1', refresh_token: '1//refresh-from-google', expires_in: 3599 }));
    const token = await exchangeAuthCode({ clientId: cfg.clientId, clientSecret: cfg.clientSecret }, 'the-code', g.fetchFn);

    expect(token).toBe('1//refresh-from-google');
    const [req] = g.tokenRequests();
    expect(req.method).toBe('POST');
    expect(req.headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(Object.fromEntries(new URLSearchParams(req.body))).toEqual({
      client_id: 'client-id-1', client_secret: 'client-secret-1', code: 'the-code', redirect_uri: 'http://127.0.0.1:53682/callback', grant_type: 'authorization_code',
    });
  });

  it('says so when Google sends no refresh token', async () => {
    const g = fakeGoogle(() => json({}), () => json({ access_token: 'access-1', expires_in: 3599 }));
    await expect(exchangeAuthCode(cfg, 'the-code', g.fetchFn)).rejects.toThrow(/no refresh token/i);
  });

  it('names only Google\'s error code when the exchange fails', async () => {
    const refused = fakeGoogle(() => json({}), () => json({ error: 'invalid_client', error_description: 'client-secret-1 is wrong' }, 401));
    const error = await exchangeAuthCode(cfg, 'the-code', refused.fetchFn).then(() => new Error('did not fail'), (e: Error) => e);
    expect(error.message).toContain('401 invalid_client');
    for (const secret of ['client-secret-1', 'the-code']) expect(error.message).not.toContain(secret);

    const unreachable = fakeGoogle(() => json({}), () => { throw new TypeError('fetch failed'); });
    await expect(exchangeAuthCode(cfg, 'the-code', unreachable.fetchFn)).rejects.toThrow(/could not reach google/i);
  });
});

describe('upsertEnvLine', () => {
  it('replaces an existing key and appends a new one', () => {
    const text = 'A=1\nGOOGLE_REFRESH_TOKEN=\nB=2\n';
    expect(upsertEnvLine(text, 'GOOGLE_REFRESH_TOKEN', '1//abc')).toBe('A=1\nGOOGLE_REFRESH_TOKEN=1//abc\nB=2\n');
    expect(upsertEnvLine('A=1\nB=2\n', 'GOOGLE_REFRESH_TOKEN', '1//abc')).toBe('A=1\nB=2\nGOOGLE_REFRESH_TOKEN=1//abc\n');
  });

  it('starts a new file, and adds a missing final newline before appending', () => {
    expect(upsertEnvLine('', 'K', 'v')).toBe('K=v\n');
    expect(upsertEnvLine('A=1', 'K', 'v')).toBe('A=1\nK=v\n');
  });

  it('replaces the value of an existing key whatever it was', () => {
    expect(upsertEnvLine('K=old value # note\nOTHER=1', 'K', 'new')).toBe('K=new\nOTHER=1');
  });

  it('touches only the exact key, not comments or keys that merely start the same', () => {
    const text = '# K=comment\nK_OLD=1\nPRE_K=2\nK=3\n';
    expect(upsertEnvLine(text, 'K', 'new')).toBe('# K=comment\nK_OLD=1\nPRE_K=2\nK=new\n');
  });

  it('keeps Windows line endings', () => {
    expect(upsertEnvLine('A=1\r\nK=\r\nB=2\r\n', 'K', 'v')).toBe('A=1\r\nK=v\r\nB=2\r\n');
    expect(upsertEnvLine('A=1\r\nB=2\r\n', 'K', 'v')).toBe('A=1\r\nB=2\r\nK=v\r\n');
  });

  it('writes the value as it is, even with characters that mean something in a replacement', () => {
    expect(upsertEnvLine('K=\n', 'K', 'a$&b$1$$')).toBe('K=a$&b$1$$\n');
  });
});
