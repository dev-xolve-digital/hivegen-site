import { afterEach, describe, it, expect, vi } from 'vitest';
import { TURNSTILE_ACTION } from '../../src/lib/booking/api-client';
import { turnstileExpectation, verifyTurnstile } from '../../src/server/booking/turnstile';

type Call = { url: string; method?: string; form: URLSearchParams };

/** A fetch that records what it was sent and answers with `reply`. */
function fakeFetch(reply: () => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method, form: new URLSearchParams(String(init?.body)) });
    return reply();
  }) as typeof fetch;
  return { fn, calls };
}
const json = (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), init);

/** What the live site expects: the booking form, on hivegen.co. */
const LIVE = { action: 'booking', hostname: 'hivegen.co' };
/** Cloudflare's answer for a check passed on the live booking form. */
const passed = (extra: Record<string, unknown> = {}) => json({ success: true, action: 'booking', hostname: 'hivegen.co', ...extra });

afterEach(() => { vi.restoreAllMocks(); });

describe('verifyTurnstile', () => {
  it('a check passed on this site\'s booking form gives true, and posts the secret, the token and the visitor IP as form fields', async () => {
    const { fn, calls } = fakeFetch(() => passed());
    expect(await verifyTurnstile('tok', '203.0.113.9', 'sec', LIVE, fn)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(calls[0].method).toBe('POST');
    expect(Object.fromEntries(calls[0].form)).toEqual({ secret: 'sec', response: 'tok', remoteip: '203.0.113.9' });
  });

  it('leaves remoteip out when there is no IP', async () => {
    const { fn, calls } = fakeFetch(() => passed());
    await verifyTurnstile('tok', undefined, 'sec', LIVE, fn);
    expect(Object.fromEntries(calls[0].form)).toEqual({ secret: 'sec', response: 'tok' });
  });

  it('success: false gives false', async () => {
    expect(await verifyTurnstile('tok', undefined, 'sec', LIVE, fakeFetch(() => json({ success: false, 'error-codes': ['invalid-input-response'] })).fn)).toBe(false);
  });

  it('a check passed on another address (a copy of the site on someone\'s computer) gives false, and the log names both addresses', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await verifyTurnstile('tok', undefined, 'sec', LIVE, fakeFetch(() => passed({ hostname: 'localhost' })).fn)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = warn.mock.calls.flat().join(' ');
    expect(line).toContain('localhost');
    expect(line).toContain('hivegen.co');
    expect(line).toContain('PUBLIC_SITE_URL');
  });

  it('a check passed for another action, or with none, gives false', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await verifyTurnstile('tok', undefined, 'sec', LIVE, fakeFetch(() => passed({ action: 'signup' })).fn)).toBe(false);
    expect(await verifyTurnstile('tok', undefined, 'sec', LIVE, fakeFetch(() => passed({ action: undefined })).fn)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(2); // both reached Cloudflare's answer and were refused there
  });

  it('Cloudflare\'s always-pass test secret gives false: its answer names example.com and no action', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const testAnswer = { success: true, 'error-codes': [], hostname: 'example.com', metadata: { result_with_testing_key: true } };
    expect(await verifyTurnstile('tok', undefined, 'sec', LIVE, fakeFetch(() => json(testAnswer)).fn)).toBe(false);
    expect(warn.mock.calls.flat().join(' ')).toContain('example.com');
  });

  it('with no expected address (PUBLIC_SITE_URL is not a URL) nothing passes', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await verifyTurnstile('tok', undefined, 'sec', { action: 'booking', hostname: '' }, fakeFetch(() => passed({ hostname: '' })).fn)).toBe(false);
  });

  it('a network error gives false', async () => {
    expect(await verifyTurnstile('tok', undefined, 'sec', LIVE, fakeFetch(() => { throw new TypeError('fetch failed'); }).fn)).toBe(false);
  });

  it('an answer that is not JSON, or has no success flag, gives false', async () => {
    expect(await verifyTurnstile('tok', undefined, 'sec', LIVE, fakeFetch(() => new Response('<html>Bad gateway</html>')).fn)).toBe(false);
    expect(await verifyTurnstile('tok', undefined, 'sec', LIVE, fakeFetch(() => json({})).fn)).toBe(false);
    expect(await verifyTurnstile('tok', undefined, 'sec', LIVE, fakeFetch(() => json(null)).fn)).toBe(false);
    expect(await verifyTurnstile('tok', undefined, 'sec', LIVE, fakeFetch(() => json({ success: 'true', action: 'booking', hostname: 'hivegen.co' })).fn)).toBe(false);
  });

  it('an error status gives false, even with a success flag in the body', async () => {
    expect(await verifyTurnstile('tok', undefined, 'sec', LIVE, fakeFetch(() => json({ success: true, action: 'booking', hostname: 'hivegen.co' }, { status: 500 })).fn)).toBe(false);
  });

  it('an empty token gives false without asking Cloudflare', async () => {
    const { fn, calls } = fakeFetch(() => passed());
    expect(await verifyTurnstile('', undefined, 'sec', LIVE, fn)).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe('turnstileExpectation', () => {
  it('expects the booking form\'s action on the host of the site address', () => {
    expect(turnstileExpectation('https://hivegen.co')).toEqual({ action: TURNSTILE_ACTION, hostname: 'hivegen.co' });
    expect(turnstileExpectation('https://hivegen.co/some/path')).toEqual({ action: TURNSTILE_ACTION, hostname: 'hivegen.co' });
    expect(turnstileExpectation('http://localhost:4321')).toEqual({ action: TURNSTILE_ACTION, hostname: 'localhost' });
  });

  it('an address that is not a URL expects no host, so nothing passes', () => {
    expect(turnstileExpectation('hivegen.co').hostname).toBe('');
  });

  it('the action is "booking", a name Cloudflare accepts (letters, numbers, _ and -, at most 32)', () => {
    expect(TURNSTILE_ACTION).toBe('booking');
    expect(TURNSTILE_ACTION).toMatch(/^[A-Za-z0-9_-]{1,32}$/);
  });
});
