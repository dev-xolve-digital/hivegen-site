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
  it('loads Cloudflare\'s script (async, once) and renders an invisible-unless-needed widget with the site key and the booking action', () => {
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
    // The server only accepts tokens made for this action (src/server/booking/turnstile.ts).
    expect(p.fake.options).toMatchObject({ sitekey: '0xKEY', appearance: 'interaction-only', action: 'booking' });
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

  it('a script that cannot load fails getToken at once, not after the wait', async () => {
    const p = page();
    const ts = loadTurnstile('k', p.container);
    const waiting = ts.getToken();
    const outcome = expect(waiting).rejects.toThrow();
    p.scriptFails();
    await outcome;
  });

  it('a script that failed once is loaded again on the next try, so one flaky load does not ruin the page for good', async () => {
    const p = page();
    const ts = loadTurnstile('k', p.container);
    const first = expect(ts.getToken()).rejects.toThrow();
    p.scriptFails();
    await first;
    expect(p.window.document.querySelectorAll('script').length).toBe(0); // the failed element is gone

    const retry = ts.getToken(); // the visitor tries again
    const scripts = p.window.document.querySelectorAll('script');
    expect(scripts.length).toBe(1);
    expect(scripts[0].src).toBe(SRC);
    p.scriptLoads();
    expect(p.fake.render).toHaveBeenCalledTimes(1);
    p.token('second-chance');
    expect(await retry).toBe('second-chance');
  });

  it('a script that fails again fails the next getToken again, and a script still loading is not added twice', async () => {
    const p = page();
    const ts = loadTurnstile('k', p.container);
    const first = expect(ts.getToken()).rejects.toThrow();
    p.scriptFails();
    await first;

    const second = ts.getToken();
    const third = ts.getToken(); // the script from the second try is still on its way
    expect(p.window.document.querySelectorAll('script').length).toBe(1);
    const both = Promise.all([expect(second).rejects.toThrow(), expect(third).rejects.toThrow()]);
    p.scriptFails();
    await both;
    expect(p.window.document.querySelectorAll('script').length).toBe(0);
  });

  it('two widgets share one script and keep their own tokens and actions', async () => {
    const p = page();
    const second = p.window.document.createElement('div');
    p.window.document.body.append(second);
    // Cloudflare's render, with a widget id and the options of each widget kept apart.
    const widgets: Record<string, { container: unknown; options: Record<string, unknown> }> = {};
    p.fake.render.mockImplementation((el: unknown, options: Record<string, unknown>) => {
      const id = `widget-${Object.keys(widgets).length + 1}`;
      widgets[id] = { container: el, options };
      return id;
    });
    const tokenFor = (id: string, t: string) => (widgets[id].options.callback as (t: string) => void)(t);

    const booking = loadTurnstile('0xKEY', p.container);
    const inquiry = loadTurnstile('0xKEY', second, 'inquiry'); // asked while the script is still on its way
    expect(p.window.document.querySelectorAll('script').length).toBe(1);
    p.scriptLoads();
    expect(p.window.document.querySelectorAll('script').length).toBe(1);

    expect(p.fake.render).toHaveBeenCalledTimes(2);
    expect(widgets['widget-1']).toMatchObject({ container: p.container, options: { action: 'booking', sitekey: '0xKEY' } });
    expect(widgets['widget-2']).toMatchObject({ container: second, options: { action: 'inquiry', sitekey: '0xKEY' } });

    const inquiryToken = inquiry.getToken();
    const bookingToken = booking.getToken();
    tokenFor('widget-2', 'for-the-inquiry');
    tokenFor('widget-1', 'for-the-booking');
    expect(await inquiryToken).toBe('for-the-inquiry');
    expect(await bookingToken).toBe('for-the-booking');
    // Each one starts the next token of its own widget only.
    expect(p.fake.reset.mock.calls).toEqual([['widget-2'], ['widget-1']]);
  });

  it('a widget asked for after the script has loaded renders at once, without a second script', () => {
    const p = page();
    loadTurnstile('0xKEY', p.container);
    p.scriptLoads();
    const later = p.window.document.createElement('div');
    loadTurnstile('0xKEY', later, 'inquiry');
    expect(p.window.document.querySelectorAll('script').length).toBe(1);
    expect(p.fake.render).toHaveBeenCalledTimes(2);
    expect(p.fake.render.mock.calls[1][1]).toMatchObject({ action: 'inquiry' });
  });

  it('a script that fails fails every widget waiting for it, and the next try of either loads it again (once)', async () => {
    const p = page();
    const second = p.window.document.createElement('div');
    const booking = loadTurnstile('k', p.container);
    const inquiry = loadTurnstile('k', second, 'inquiry');
    const both = Promise.all([expect(booking.getToken()).rejects.toThrow(), expect(inquiry.getToken()).rejects.toThrow()]);
    p.scriptFails();
    await both;
    expect(p.window.document.querySelectorAll('script').length).toBe(0);

    const callbacks: Array<(t: string) => void> = [];
    p.fake.render.mockImplementation((_el: unknown, options: Record<string, unknown>) => { callbacks.push(options.callback as (t: string) => void); return `widget-${callbacks.length}`; });
    const retryBooking = booking.getToken();
    const retryInquiry = inquiry.getToken(); // the script from the first retry is still on its way
    expect(p.window.document.querySelectorAll('script').length).toBe(1);
    p.scriptLoads();
    expect(callbacks.length).toBe(2);
    callbacks[0]('b');
    callbacks[1]('i');
    expect(await retryBooking).toBe('b');
    expect(await retryInquiry).toBe('i');
  });

  describe('a script that is broken does not leave the widgets stuck', () => {
    /** What a promise came to, as soon as the microtasks have run: 'pending', 'resolved: …' or the error's message. */
    function outcomeOf(promise: Promise<string>) {
      let outcome = 'pending';
      promise.then((t) => { outcome = `resolved: ${t}`; }, (e: Error) => { outcome = e.message; });
      return async () => { await new Promise((r) => setTimeout(r, 0)); return outcome; };
    }
    /** The script element's load event fires, but Cloudflare's code never defined `window.turnstile`. */
    const loadsEmpty = (p: ReturnType<typeof page>) => p.window.document.querySelector('script')!.dispatchEvent(new p.window.Event('load'));
    const scriptCount = (p: ReturnType<typeof page>) => p.window.document.querySelectorAll('script').length;

    it('a script that loads without defining turnstile counts as a failure: the waiting getToken rejects at once, and the next one adds a fresh script', async () => {
      const p = page();
      const ts = loadTurnstile('k', p.container);
      const first = outcomeOf(ts.getToken());
      loadsEmpty(p);
      expect(await first()).toBe('turnstile_unavailable');
      expect(p.fake.render).not.toHaveBeenCalled();
      expect(scriptCount(p)).toBe(0); // the dead element is gone

      const retry = outcomeOf(ts.getToken());
      expect(scriptCount(p)).toBe(1); // a fresh script
      p.scriptLoads();
      expect(p.fake.render).toHaveBeenCalledTimes(1);
      p.token('second-chance');
      expect(await retry()).toBe('resolved: second-chance');
    });

    it('it fails every widget that waited for it, and both load the next script together', async () => {
      const p = page();
      const second = p.window.document.createElement('div');
      const booking = loadTurnstile('k', p.container);
      const inquiry = loadTurnstile('k', second, 'inquiry');
      const a = outcomeOf(booking.getToken());
      const b = outcomeOf(inquiry.getToken());
      loadsEmpty(p);
      expect(await a()).toBe('turnstile_unavailable');
      expect(await b()).toBe('turnstile_unavailable');

      const callbacks: Array<(t: string) => void> = [];
      p.fake.render.mockImplementation((_el: unknown, options: Record<string, unknown>) => { callbacks.push(options.callback as (t: string) => void); return `widget-${callbacks.length}`; });
      const retryBooking = outcomeOf(booking.getToken());
      const retryInquiry = outcomeOf(inquiry.getToken());
      expect(scriptCount(p)).toBe(1);
      p.scriptLoads();
      expect(callbacks).toHaveLength(2);
      callbacks[0]('b');
      callbacks[1]('i');
      expect(await retryBooking()).toBe('resolved: b');
      expect(await retryInquiry()).toBe('resolved: i');
    });

    it('a render that throws for one widget does not stop the other from rendering', async () => {
      const p = page();
      const second = p.window.document.createElement('div');
      const callbacks: Array<(t: string) => void> = [];
      p.fake.render.mockImplementation((el: unknown, options: Record<string, unknown>) => {
        if (el === p.container) throw new Error('render failed');
        callbacks.push(options.callback as (t: string) => void);
        return 'widget-inquiry';
      });
      const booking = loadTurnstile('k', p.container);
      const inquiry = loadTurnstile('k', second, 'inquiry');
      const a = outcomeOf(booking.getToken());
      const b = outcomeOf(inquiry.getToken());
      p.scriptLoads();
      expect(p.fake.render).toHaveBeenCalledTimes(2); // the second was still tried
      expect(await a()).toBe('turnstile_unavailable'); // nobody waits for a widget that is not there
      callbacks[0]('for-the-inquiry');
      expect(await b()).toBe('resolved: for-the-inquiry');
    });

    it('a widget whose render threw is not "rendered": the next getToken renders it again, without a second script', async () => {
      const p = page();
      p.fake.render.mockImplementationOnce(() => { throw new Error('render failed'); });
      const ts = loadTurnstile('k', p.container);
      const first = outcomeOf(ts.getToken());
      p.scriptLoads();
      expect(await first()).toBe('turnstile_unavailable');

      const retry = outcomeOf(ts.getToken()); // Cloudflare's script is there: only the widget is made again
      expect(p.fake.render).toHaveBeenCalledTimes(2);
      expect(scriptCount(p)).toBe(1);
      p.token('now');
      expect(await retry()).toBe('resolved: now');
    });

    it('a render that throws on the very first try, with the script already on the page, is a rejected getToken, not a thrown error', async () => {
      const p = page();
      (p.window as unknown as { turnstile: unknown }).turnstile = p.fake;
      p.fake.render.mockImplementationOnce(() => { throw new Error('render failed'); });
      const ts = loadTurnstile('k', p.container); // does not throw
      const first = outcomeOf(ts.getToken()); // renders again, and this time it works
      expect(p.fake.render).toHaveBeenCalledTimes(2);
      p.token('here');
      expect(await first()).toBe('resolved: here');
    });
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
