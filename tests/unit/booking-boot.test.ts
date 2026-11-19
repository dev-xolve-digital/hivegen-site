import { describe, it, expect, vi } from 'vitest';
import { b, mainHtml, mount, type Mounted } from './helpers/booking-dom';
import { bootBooking, whenLoaded, whenNear, type BootEnv } from '../../src/scripts/booking-boot';

const LEAD_ID = 'L'.repeat(22);
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A server that answers the three calls the form makes; `config` is what /api/booking/config says. */
function server(config: unknown, over: Record<string, () => Response> = {}) {
  const calls: string[] = [];
  const fetchFn = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (over[url]) return over[url]();
    if (url === '/api/booking/config') return config instanceof Response ? config : reply(config);
    if (url === '/api/booking/leads') return reply({ leadId: LEAD_ID, eventId: `lead.${LEAD_ID}` });
    if (url === '/api/booking/slots') return reply({ slots: [{ start: '2026-12-07T14:00:00.000Z', end: '2026-12-07T14:15:00.000Z' }], calendarChecked: true });
    return reply({ error: 'not_found' }, 404);
  });
  return { fetchFn, calls };
}

/** Promises the test settles itself, standing in for "the page finished loading" and "the section came near". */
function gates() {
  let load!: () => void;
  let near!: () => void;
  return { loaded: new Promise<void>((r) => { load = r; }), near: new Promise<void>((r) => { near = r; }), load: () => load(), arrive: () => near() };
}

const turnstileStub = () => vi.fn<NonNullable<BootEnv['loadTurnstile']>>(() => ({ getToken: async () => 'test-token' }));
const settle = async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); };
const fillGood = (m: Mounted) => {
  m.$<HTMLInputElement>('input[name="name"]').value = 'Zoë';
  m.$<HTMLInputElement>('input[name="email"]').value = 'zoe@example.com';
  m.$<HTMLInputElement>('input[name="buyer"][value="agent"]').checked = true;
  m.$<HTMLInputElement>('input[name="volume"][value="6–15"]').checked = true;
};

describe('bootBooking: loading on demand', () => {
  it('asks nothing, and loads nothing from Cloudflare, until the page has loaded AND the section is near', async () => {
    const m = mount(await mainHtml());
    const g = gates();
    const { fetchFn } = server({ mode: 'live', turnstileSiteKey: '0xKEY' });
    const loadTurnstile = turnstileStub();
    bootBooking(m.root, { fetchFn, loadTurnstile, loaded: g.loaded, near: g.near });

    await settle();
    expect(fetchFn).not.toHaveBeenCalled();
    g.arrive(); // near, but the window load event has not fired
    await settle();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(loadTurnstile).not.toHaveBeenCalled();

    g.load();
    await vi.waitFor(() => expect(loadTurnstile).toHaveBeenCalledTimes(1));
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0][0]).toBe('/api/booking/config');
    expect(loadTurnstile).toHaveBeenCalledWith('0xKEY', m.$('[data-turnstile]'));
  });

  it('live: the form ends up on the real API, with the Turnstile token sent along with the lead', async () => {
    const m = mount(await mainHtml());
    const { fetchFn } = server({ mode: 'live', turnstileSiteKey: '0xKEY' });
    bootBooking(m.root, { fetchFn, loadTurnstile: turnstileStub(), loaded: Promise.resolve(), near: Promise.resolve() });
    await vi.waitFor(() => expect(m.$('[data-demo-note]').hidden).toBe(true));
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalled());
    await settle();
    fillGood(m);
    m.$<HTMLButtonElement>('[data-submit]').click();
    await vi.waitFor(() => expect(m.$('[data-step="time"]').hidden).toBe(false));
    const leadCall = fetchFn.mock.calls.find(([url]) => url === '/api/booking/leads')!;
    expect(JSON.parse(String(leadCall[1]?.body))).toMatchObject({ turnstileToken: 'test-token', buyerType: 'agent', volume: '6–15', website: '' });
  });

  it('demo: the demo note shows, the pretend booking works, and Turnstile is never loaded', async () => {
    const m = mount(await mainHtml());
    const { fetchFn, calls } = server({ mode: 'demo' });
    const loadTurnstile = turnstileStub();
    bootBooking(m.root, { fetchFn, loadTurnstile, loaded: Promise.resolve(), near: Promise.resolve() });
    await vi.waitFor(() => expect(m.$('[data-demo-note]').hidden).toBe(false));
    await settle();
    expect(loadTurnstile).not.toHaveBeenCalled();
    fillGood(m);
    m.$<HTMLButtonElement>('[data-submit]').click();
    await vi.waitFor(() => expect(m.$('[data-step="time"]').hidden).toBe(false));
    expect(calls).toEqual(['GET /api/booking/config']); // the demo never touches the booking API
  });

  it.each([
    ['off', { mode: 'off' }],
    ['a config that cannot be read', new Response('<html>Bad gateway</html>', { status: 502 })],
    ['a config of an unknown mode', { mode: 'surprise' }],
  ])('%s: the offline card, no demo and no Turnstile', async (_name, config) => {
    const m = mount(await mainHtml());
    const { fetchFn } = server(config);
    const loadTurnstile = turnstileStub();
    bootBooking(m.root, { fetchFn, loadTurnstile, loaded: Promise.resolve(), near: Promise.resolve() });
    await vi.waitFor(() => expect(m.$('[data-offline]').hidden).toBe(false));
    expect(m.$('[data-flow]').hidden).toBe(true);
    expect(m.$('[data-demo-note]').hidden).toBe(true);
    expect(loadTurnstile).not.toHaveBeenCalled();
  });

  it('a config request that fails outright is the offline card too', async () => {
    const m = mount(await mainHtml());
    const fetchFn = vi.fn<typeof fetch>(async () => { throw new TypeError('Failed to fetch'); });
    bootBooking(m.root, { fetchFn, loaded: Promise.resolve(), near: Promise.resolve() });
    await vi.waitFor(() => expect(m.$('[data-offline]').hidden).toBe(false));
  });

  it('live with no site key still shows the form (the server will refuse the empty token)', async () => {
    const m = mount(await mainHtml());
    const { fetchFn } = server({ mode: 'live' });
    const loadTurnstile = turnstileStub();
    bootBooking(m.root, { fetchFn, loadTurnstile, loaded: Promise.resolve(), near: Promise.resolve() });
    await vi.waitFor(() => expect(m.$<HTMLButtonElement>('[data-submit]').disabled).toBe(false));
    await settle();
    expect(loadTurnstile).not.toHaveBeenCalled();
    expect(m.$('[data-flow]').hidden).toBe(false);
  });
});

describe('bootBooking: a config that does not come', () => {
  /** A fetch that answers the config with the given replies in turn (a Response, or "stall" for a request that never answers). */
  function configSequence(...replies: Array<Response | 'stall' | 'fail'>) {
    let n = 0;
    return vi.fn<typeof fetch>((_input, init) => {
      const next = replies[Math.min(n, replies.length - 1)];
      n += 1;
      if (next === 'fail') return Promise.reject(new TypeError('Failed to fetch'));
      if (next === 'stall') return new Promise<Response>((_resolve, reject) => { init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'TimeoutError'))); });
      return Promise.resolve(next);
    });
  }

  it('is asked for once more: one failed try does not turn booking off', async () => {
    const m = mount(await mainHtml());
    const fetchFn = configSequence('fail', reply({ mode: 'live', turnstileSiteKey: '0xKEY' }));
    const loadTurnstile = turnstileStub();
    bootBooking(m.root, { fetchFn, loadTurnstile, loaded: Promise.resolve(), near: Promise.resolve() });
    await vi.waitFor(() => expect(loadTurnstile).toHaveBeenCalledWith('0xKEY', m.$('[data-turnstile]')));
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(m.$('[data-offline]').hidden).toBe(true);
  });

  it('is given up on after two tries: the offline card, and a held submit is not stranded', async () => {
    const m = mount(await mainHtml());
    const fetchFn = configSequence('stall');
    bootBooking(m.root, { fetchFn, loaded: Promise.resolve(), near: new Promise(() => {}), configTimeoutMs: 30 });
    m.$<HTMLButtonElement>('[data-submit]').click(); // held, and waiting for a config that never comes
    expect(m.$<HTMLButtonElement>('[data-submit]').disabled).toBe(true);
    await vi.waitFor(() => expect(m.$('[data-offline]').hidden).toBe(false));
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(m.$('[data-flow]').hidden).toBe(true);
  });

  it('two failed answers in a row are off as well', async () => {
    const m = mount(await mainHtml());
    const fetchFn = configSequence(new Response('<html>Bad gateway</html>', { status: 502 }), new Response('nope', { status: 503 }));
    bootBooking(m.root, { fetchFn, loaded: Promise.resolve(), near: Promise.resolve() });
    await vi.waitFor(() => expect(m.$('[data-offline]').hidden).toBe(false));
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('an answer of "off" is an answer: it is not asked again', async () => {
    const m = mount(await mainHtml());
    const fetchFn = configSequence(reply({ mode: 'off' }));
    bootBooking(m.root, { fetchFn, loaded: Promise.resolve(), near: Promise.resolve() });
    await vi.waitFor(() => expect(m.$('[data-offline]').hidden).toBe(false));
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe('bootBooking: a submit before everything is ready', () => {
  it('is held, wakes the loading (once the page has loaded), and then runs as a normal submit', async () => {
    const m = mount(await mainHtml());
    const g = gates(); // the section never comes "near": only the submit asks for the booking
    const { fetchFn } = server({ mode: 'live', turnstileSiteKey: '0xKEY' });
    bootBooking(m.root, { fetchFn, loadTurnstile: turnstileStub(), loaded: g.loaded, near: g.near });

    const button = m.$<HTMLButtonElement>('[data-submit]');
    expect(button.disabled).toBe(false); // clickable at once: the script is here
    button.click(); // an empty form
    expect(button.disabled).toBe(true); // held
    await settle();
    expect(fetchFn).not.toHaveBeenCalled(); // still waiting for the window load event

    g.load();
    // Now the config arrives, the real form takes over, and the held submit is checked like any other.
    await vi.waitFor(() => expect(m.$('[data-error="name"]').hidden).toBe(false));
    expect(m.$('[data-error="name"]').textContent).toBe(b.errors.name);
    expect(button.disabled).toBe(false);
  });

  it('in off mode the held submit just shows the offline card', async () => {
    const m = mount(await mainHtml());
    const { fetchFn } = server({ mode: 'off' });
    bootBooking(m.root, { fetchFn, loaded: Promise.resolve(), near: new Promise(() => {}) });
    m.$<HTMLButtonElement>('[data-submit]').click();
    await vi.waitFor(() => expect(m.$('[data-offline]').hidden).toBe(false));
  });
});

describe('whenNear and whenLoaded', () => {
  it('whenNear watches the section with a 600px margin and resolves when it comes within it', async () => {
    const m = mount(await mainHtml());
    const watchers: Array<{ callback: IntersectionObserverCallback; options?: IntersectionObserverInit; target?: Element; disconnected: boolean }> = [];
    class FakeObserver {
      w: (typeof watchers)[number];
      constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) { this.w = { callback, options, disconnected: false }; watchers.push(this.w); }
      observe(el: Element) { this.w.target = el; }
      disconnect() { this.w.disconnected = true; }
    }
    (m.window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = FakeObserver;
    let near = false;
    void whenNear(m.root, m.window).then(() => { near = true; });
    expect(watchers[0].options?.rootMargin).toBe('600px 0px');
    expect(watchers[0].target).toBe(m.root);
    watchers[0].callback([{ isIntersecting: false } as IntersectionObserverEntry], watchers[0] as unknown as IntersectionObserver);
    await settle();
    expect(near).toBe(false);
    watchers[0].callback([{ isIntersecting: true } as IntersectionObserverEntry], watchers[0] as unknown as IntersectionObserver);
    await settle();
    expect(near).toBe(true);
    expect(watchers[0].disconnected).toBe(true);
  });

  it('whenNear resolves at once in a browser with no IntersectionObserver', async () => {
    const m = mount(await mainHtml());
    (m.window as unknown as { IntersectionObserver?: unknown }).IntersectionObserver = undefined;
    await expect(whenNear(m.root, m.window)).resolves.toBeUndefined();
  });

  it('whenLoaded resolves at the load event, or at once when the page already loaded', async () => {
    const m = mount(await mainHtml());
    Object.defineProperty(m.document, 'readyState', { value: 'interactive', configurable: true });
    let done = false;
    void whenLoaded(m.window).then(() => { done = true; });
    await settle();
    expect(done).toBe(false);
    m.window.dispatchEvent(new m.window.Event('load'));
    await settle();
    expect(done).toBe(true);

    Object.defineProperty(m.document, 'readyState', { value: 'complete', configurable: true });
    await expect(whenLoaded(m.window)).resolves.toBeUndefined();
  });
});
