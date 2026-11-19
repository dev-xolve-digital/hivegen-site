import { describe, it, expect, vi, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { loadTurnstile } from '../../src/scripts/turnstile';

const SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

interface Fake { render: ReturnType<typeof vi.fn>; reset: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn>; options?: Record<string, unknown> }

/** A page with a container, and a way to play Cloudflare's part: the script loading, then tokens arriving. */
function page() {
  const { window } = new JSDOM('<!doctype html><body><div id="box"></div></body>', { url: 'https://hivegen.test/' });
  const container = window.document.getElementById('box')!;
  const fake: Fake = {
    render: vi.fn((_el: unknown, options: Record<string, unknown>) => { fake.options = options; return 'widget-1'; }),
    reset: vi.fn(),
    remove: vi.fn(),
  };
  /** Cloudflare's script arrives: `window.turnstile` exists and the script element's load event fires. */
  const scriptLoads = () => {
    (window as unknown as { turnstile: unknown }).turnstile = fake;
    window.document.querySelector('script')!.dispatchEvent(new window.Event('load'));
  };
  const scriptFails = () => window.document.querySelector('script')!.dispatchEvent(new window.Event('error'));
  const token = (t: string) => (fake.options!.callback as (t: string) => void)(t);
  return { window, container, fake, scriptLoads, scriptFails, token };
}

afterEach(() => { vi.useRealTimers(); });

describe('loadTurnstile', () => {
  it('loads Cloudflare\'s script (async, once) and renders an invisible-unless-needed widget with the site key', () => {
    const p = page();
    loadTurnstile('0xKEY', p.container);
    const scripts = p.window.document.querySelectorAll('script');
    expect(scripts.length).toBe(1);
    expect(scripts[0].src).toBe(SRC);
    expect(scripts[0].async).toBe(true);
    expect(p.fake.render).not.toHaveBeenCalled(); // not until the script has arrived
    p.scriptLoads();
    expect(p.fake.render).toHaveBeenCalledTimes(1);
    expect(p.fake.render.mock.calls[0][0]).toBe(p.container);
    expect(p.fake.options).toMatchObject({ sitekey: '0xKEY', appearance: 'interaction-only' });
  });

  it('getToken waits for the token, and gives it once', async () => {
    const p = page();
    const ts = loadTurnstile('k', p.container);
    const got = ts.getToken();
    p.scriptLoads();
    p.token('token-1');
    expect(await got).toBe('token-1');
    // The token is used up: the widget starts a fresh one, and the next getToken waits for it.
    expect(p.fake.reset).toHaveBeenCalledWith('widget-1');
    const second = ts.getToken();
    p.token('token-2');
    expect(await second).toBe('token-2');
  });

  it('a token that arrived before anyone asked is there when they do', async () => {
    const p = page();
    const ts = loadTurnstile('k', p.container);
    p.scriptLoads();
    p.token('early');
    expect(await ts.getToken()).toBe('early');
  });

  it('a token that expired is not handed out', async () => {
    vi.useFakeTimers();
    const p = page();
    const ts = loadTurnstile('k', p.container);
    p.scriptLoads();
    p.token('old');
    (p.fake.options!['expired-callback'] as () => void)();
    const got = ts.getToken();
    const outcome = expect(got).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(10_000);
    await outcome;
  });

  it('gives up after 10 seconds without a token', async () => {
    vi.useFakeTimers();
    const p = page();
    const ts = loadTurnstile('k', p.container);
    p.scriptLoads();
    const got = ts.getToken();
    const outcome = expect(got).rejects.toThrow(/timeout/);
    await vi.advanceTimersByTimeAsync(9_999);
    let settled = false;
    got.catch(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await outcome;
  });

  it('a script that cannot load (blocked) fails getToken at once, not after the wait', async () => {
    const p = page();
    const ts = loadTurnstile('k', p.container);
    const waiting = ts.getToken();
    const outcome = expect(waiting).rejects.toThrow();
    p.scriptFails();
    await outcome;
    await expect(ts.getToken()).rejects.toThrow();
  });

  it('uses the Turnstile that is already on the page instead of loading the script again', async () => {
    const p = page();
    (p.window as unknown as { turnstile: unknown }).turnstile = p.fake;
    const ts = loadTurnstile('k', p.container);
    expect(p.window.document.querySelectorAll('script').length).toBe(0);
    expect(p.fake.render).toHaveBeenCalledTimes(1);
    p.token('here');
    expect(await ts.getToken()).toBe('here');
  });
});
