import { describe, it, expect } from 'vitest';
import { verifyTurnstile } from '../../src/server/booking/turnstile';

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

describe('verifyTurnstile', () => {
  it('success: true gives true, and posts the secret, the token and the visitor IP as form fields', async () => {
    const { fn, calls } = fakeFetch(() => json({ success: true }));
    expect(await verifyTurnstile('tok', '203.0.113.9', 'sec', fn)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(calls[0].method).toBe('POST');
    expect(Object.fromEntries(calls[0].form)).toEqual({ secret: 'sec', response: 'tok', remoteip: '203.0.113.9' });
  });

  it('leaves remoteip out when there is no IP', async () => {
    const { fn, calls } = fakeFetch(() => json({ success: true }));
    await verifyTurnstile('tok', undefined, 'sec', fn);
    expect(Object.fromEntries(calls[0].form)).toEqual({ secret: 'sec', response: 'tok' });
  });

  it('success: false gives false', async () => {
    expect(await verifyTurnstile('tok', undefined, 'sec', fakeFetch(() => json({ success: false, 'error-codes': ['invalid-input-response'] })).fn)).toBe(false);
  });

  it('a network error gives false', async () => {
    expect(await verifyTurnstile('tok', undefined, 'sec', fakeFetch(() => { throw new TypeError('fetch failed'); }).fn)).toBe(false);
  });

  it('an answer that is not JSON, or has no success flag, gives false', async () => {
    expect(await verifyTurnstile('tok', undefined, 'sec', fakeFetch(() => new Response('<html>Bad gateway</html>')).fn)).toBe(false);
    expect(await verifyTurnstile('tok', undefined, 'sec', fakeFetch(() => json({})).fn)).toBe(false);
    expect(await verifyTurnstile('tok', undefined, 'sec', fakeFetch(() => json(null)).fn)).toBe(false);
    expect(await verifyTurnstile('tok', undefined, 'sec', fakeFetch(() => json({ success: 'true' })).fn)).toBe(false);
  });

  it('an error status gives false, even with a success flag in the body', async () => {
    expect(await verifyTurnstile('tok', undefined, 'sec', fakeFetch(() => json({ success: true }, { status: 500 })).fn)).toBe(false);
  });

  it('an empty token gives false without asking Cloudflare', async () => {
    const { fn, calls } = fakeFetch(() => json({ success: true }));
    expect(await verifyTurnstile('', undefined, 'sec', fn)).toBe(false);
    expect(calls).toEqual([]);
  });
});
