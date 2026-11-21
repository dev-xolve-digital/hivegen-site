import { afterEach, describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { initTracking, readTrackingConfig, trackLead, trackSchedule, trackViewContent, type TrackingConfig, type TrackingWindow } from '../../src/scripts/tracking';

const ALL: TrackingConfig = { metaPixelId: '123456789012345', googleTagId: 'G-ABC123XYZ4', googleAdsId: 'AW-987654321', googleAdsScheduleLabel: 'AbC-D_efG-h' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A page that has not loaded yet, and a way to play the browser's part: the load event, idle time, and the two scripts arriving. */
function page(over: { idle?: boolean; url?: string; noUuid?: boolean; cookie?: string; beacon?: boolean } = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: over.url ?? 'https://hivegen.co/agents?utm_source=facebook' });
  const win = dom.window as TrackingWindow;
  let state = 'loading';
  Object.defineProperty(win.document, 'readyState', { get: () => state, configurable: true });
  if (over.cookie) win.document.cookie = over.cookie;
  if (over.noUuid) Object.defineProperty(win.crypto, 'randomUUID', { value: undefined, configurable: true }); // an old browser

  /** What was asked of requestIdleCallback and setTimeout, to run by hand. */
  const idle: Array<{ run: () => void; timeout?: number }> = [];
  const timers: Array<{ run: () => void; ms: number }> = [];
  if (over.idle !== false) win.requestIdleCallback = ((run: () => void, o?: { timeout?: number }) => { idle.push({ run, timeout: o?.timeout }); return idle.length; }) as typeof win.requestIdleCallback;
  win.setTimeout = ((run: () => void, ms: number) => { timers.push({ run, ms }); return timers.length; }) as unknown as typeof win.setTimeout;

  const beacons: Array<{ url: string; blob: Blob }> = [];
  if (over.beacon !== false) Object.defineProperty(win.navigator, 'sendBeacon', { value: (url: string, blob: Blob) => { beacons.push({ url, blob }); return true; }, configurable: true });

  const scripts = () => [...win.document.querySelectorAll('script')];
  const scriptFor = (part: string) => scripts().find((s) => s.src.includes(part));
  return {
    win, idle, timers, beacons, scripts, scriptFor,
    /** The browser finishes loading the page. */
    load() { state = 'complete'; win.dispatchEvent(new win.Event('load')); },
    /** The browser is idle: the waiting callback runs. */
    goIdle() { idle.shift()!.run(); },
    /** A third-party script arrives (or fails to). */
    arrives: (part: string, event: 'load' | 'error' = 'load') => scriptFor(part)!.dispatchEvent(new win.Event(event)),
    fbq: () => ((win.fbq?.queue ?? []) as IArguments[]).map((a) => Array.from(a)),
    gtag: () => ((win.dataLayer ?? []) as IArguments[]).map((a) => Array.from(a)),
    beaconBody: async (i = 0) => JSON.parse(await beacons[i].blob.text()) as Record<string, unknown>,
  };
}

/** Loads the page and lets it go idle: the trackers are now in. */
function ready(cfg: TrackingConfig = ALL, over: Parameters<typeof page>[0] = {}) {
  const p = page(over);
  initTracking(cfg, p.win);
  p.load();
  p.goIdle();
  return p;
}

afterEach(() => { initTracking({}, page().win); }); // leaves no tracker behind for the next test

describe('initTracking: when things load', () => {
  it('nothing loads before the load event', () => {
    const p = page();
    initTracking(ALL, p.win);
    trackViewContent('A video'); // asked for too early: kept, never a reason to load
    trackLead('lead.abc');
    expect(p.scripts()).toHaveLength(0);
    expect(p.win.fbq).toBeUndefined();
    expect(p.win.dataLayer).toBeUndefined();
    expect(p.idle).toHaveLength(0); // not even waiting for idle time yet
    expect(p.timers).toHaveLength(0);
    expect(p.beacons).toHaveLength(0);
  });

  it('after the load event it waits for idle time (at most 2 s), and only then loads', () => {
    const p = page();
    initTracking(ALL, p.win);
    p.load();
    expect(p.idle.map((i) => i.timeout)).toEqual([2000]);
    expect(p.scripts()).toHaveLength(0);
    p.goIdle();
    expect(p.scripts()).toHaveLength(2);
  });

  it('a page that has already loaded still waits for idle time', () => {
    const p = page();
    p.load();
    initTracking(ALL, p.win);
    expect(p.scripts()).toHaveLength(0);
    expect(p.idle).toHaveLength(1);
    p.goIdle();
    expect(p.scripts()).toHaveLength(2);
  });

  it('a browser without requestIdleCallback waits 2 s after load instead', () => {
    const p = page({ idle: false });
    initTracking(ALL, p.win);
    p.load();
    expect(p.timers.map((t) => t.ms)).toEqual([2000]);
    expect(p.scripts()).toHaveLength(0);
    p.timers[0].run();
    expect(p.scripts()).toHaveLength(2);
  });

  it('with no IDs nothing is injected, nothing waits, and every call does nothing', () => {
    for (const cfg of [{}, { metaPixelId: '', googleTagId: '', googleAdsId: '' }, { googleAdsScheduleLabel: 'AbC-D_efG-h' }]) {
      const p = page();
      initTracking(cfg, p.win);
      p.load();
      trackViewContent('A video');
      trackLead('lead.abc');
      trackSchedule('schedule.abc', 'zoe@example.com');
      expect(p.idle).toHaveLength(0);
      expect(p.timers).toHaveLength(0);
      expect(p.scripts()).toHaveLength(0);
      expect(p.win.fbq).toBeUndefined();
      expect(p.win.dataLayer).toBeUndefined();
      expect(p.beacons).toHaveLength(0);
    }
  });

  it('calls made before the trackers load are kept, in order, and sent once they are in', () => {
    const p = page();
    initTracking(ALL, p.win);
    trackViewContent('A video');
    trackLead('lead.abc');
    p.load();
    p.goIdle();
    expect(p.fbq().map((c) => c.slice(0, 2))).toEqual([['set', 'autoConfig'], ['init', ALL.metaPixelId], ['track', 'PageView'], ['track', 'ViewContent'], ['track', 'Lead']]);
    expect(p.gtag().filter((c) => c[0] === 'event').map((c) => c[1])).toEqual(['video_play', 'generate_lead']);
  });
});

describe('initTracking: what loads', () => {
  it('after load: both scripts injected, PageView fired with an eventID and beaconed with the same id', async () => {
    const p = ready(ALL, { url: 'https://hivegen.co/agents?utm_source=facebook', cookie: '_fbp=fb.1.1700000000000.111' });
    const fb = p.scriptFor('connect.facebook.net')!;
    const g = p.scriptFor('googletagmanager.com')!;
    expect(fb.src).toBe('https://connect.facebook.net/en_US/fbevents.js');
    expect(g.src).toBe('https://www.googletagmanager.com/gtag/js?id=G-ABC123XYZ4');
    expect(fb.async && g.async).toBe(true);

    const pageView = p.fbq().find((c) => c[0] === 'track' && c[1] === 'PageView')!;
    expect(pageView[2]).toEqual({});
    const eventID = (pageView[3] as { eventID: string }).eventID;
    expect(eventID).toMatch(UUID);

    // The server's half of PageView is sent once the Pixel has settled, so the Facebook cookies it made are there to send.
    expect(p.beacons).toHaveLength(0);
    p.arrives('connect.facebook.net');
    expect(p.beacons).toHaveLength(1);
    expect(p.beacons[0].url).toBe('/api/events');
    expect(p.beacons[0].blob.type).toBe('application/json');
    expect(await p.beaconBody()).toEqual({ name: 'PageView', eventId: eventID, url: 'https://hivegen.co/agents?utm_source=facebook', fbp: 'fb.1.1700000000000.111' });
  });

  it('the Pixel is started with its id only: no email or phone is ever given to it', () => {
    const p = ready();
    p.arrives('connect.facebook.net');
    trackSchedule('schedule.abc', 'zoe@example.com');
    const init = p.fbq().find((c) => c[0] === 'init')!;
    expect(init).toEqual(['init', ALL.metaPixelId]); // no user data object: advanced matching is off
    expect(p.fbq()).toContainEqual(['set', 'autoConfig', false, ALL.metaPixelId]); // and so is the Pixel's own reading of form fields
    expect(JSON.stringify(p.fbq())).not.toContain('zoe@example.com');
  });

  it('the Google tag is configured for the tag id and the Ads id', () => {
    const p = ready();
    const g = p.gtag();
    expect(g.filter((c) => c[0] === 'config')).toEqual([['config', 'G-ABC123XYZ4'], ['config', 'AW-987654321']]);
    expect(g[0][0]).toBe('js');
    expect(p.win.document.querySelectorAll('script[src*="googletagmanager"]')).toHaveLength(1); // one script serves both ids
  });

  it('a Meta-only page loads no Google script, and a Google-only page loads no Facebook script and sends no beacon', () => {
    const meta = ready({ metaPixelId: '123456789012345' });
    expect(meta.scripts().map((s) => s.src)).toEqual(['https://connect.facebook.net/en_US/fbevents.js']);
    expect(meta.win.dataLayer).toBeUndefined();

    const google = ready({ googleAdsId: 'AW-987654321' });
    expect(google.scripts().map((s) => s.src)).toEqual(['https://www.googletagmanager.com/gtag/js?id=AW-987654321']);
    expect(google.win.fbq).toBeUndefined();
    expect(google.beacons).toHaveLength(0);
    expect(google.gtag().filter((c) => c[0] === 'config')).toEqual([['config', 'AW-987654321']]);
  });

  it('a blocked Pixel still lets the server send PageView, with the fbc built from the ad click', async () => {
    const p = ready({ metaPixelId: '123456789012345' }, { url: 'https://hivegen.co/?fbclid=AbC-123' });
    p.arrives('connect.facebook.net', 'error');
    const body = await p.beaconBody();
    expect(body.name).toBe('PageView');
    expect(body.fbc).toMatch(/^fb\.1\.\d+\.AbC-123$/);
    expect(body).not.toHaveProperty('fbp');
  });

  it('the _fbc cookie wins over the click id', async () => {
    const p = ready({ metaPixelId: '123456789012345' }, { url: 'https://hivegen.co/?fbclid=AbC-123', cookie: '_fbc=fb.1.1700000000000.Cookie' });
    p.arrives('connect.facebook.net');
    expect((await p.beaconBody()).fbc).toBe('fb.1.1700000000000.Cookie');
  });

  it('without crypto.randomUUID the Pixel still counts the visit, with no event id and no beacon', () => {
    const p = ready({ metaPixelId: '123456789012345' }, { noUuid: true });
    expect(p.fbq().find((c) => c[0] === 'track')).toEqual(['track', 'PageView', {}]);
    p.arrives('connect.facebook.net');
    expect(p.beacons).toHaveLength(0);
  });

  it('a page without sendBeacon does not break', () => {
    const p = ready(ALL, { beacon: false });
    expect(() => p.arrives('connect.facebook.net')).not.toThrow();
  });
});

describe('the track functions', () => {
  it('trackViewContent: Pixel ViewContent and the Google video_play event, with the video title', () => {
    const p = ready();
    trackViewContent('Luxury listing, 4 bed');
    expect(p.fbq()).toContainEqual(['track', 'ViewContent', { content_name: 'Luxury listing, 4 bed' }]);
    expect(p.gtag()).toContainEqual(['event', 'video_play', { video_title: 'Luxury listing, 4 bed' }]);
  });

  it('trackLead: Pixel Lead with the server\'s event id, and the Google generate_lead event', () => {
    const p = ready();
    trackLead('lead.abc123');
    expect(p.fbq()).toContainEqual(['track', 'Lead', {}, { eventID: 'lead.abc123' }]);
    expect(p.gtag()).toContainEqual(['event', 'generate_lead']);
  });

  it('trackSchedule: Pixel Schedule with the server\'s event id; the email goes to Google only, just before the conversion', () => {
    const p = ready();
    trackSchedule('schedule.abc123', 'zoe@example.com');
    expect(p.fbq()).toContainEqual(['track', 'Schedule', {}, { eventID: 'schedule.abc123' }]);
    expect(JSON.stringify(p.fbq())).not.toContain('zoe@example.com');
    const events = p.gtag().filter((c) => c[0] === 'set' || c[0] === 'event');
    expect(events).toEqual([
      ['set', 'user_data', { email: 'zoe@example.com' }],
      ['event', 'conversion', { send_to: 'AW-987654321/AbC-D_efG-h' }],
      ['event', 'book_call'],
    ]);
  });

  it('the email is given to Google only when there is a Google Ads conversion to improve (an Ads id and its label)', () => {
    for (const cfg of [{ ...ALL, googleAdsScheduleLabel: '' }, { ...ALL, googleAdsId: '' }, { metaPixelId: '123456789012345', googleTagId: 'G-ABC123XYZ4' }]) {
      const p = ready(cfg);
      trackSchedule('schedule.abc123', 'zoe@example.com');
      expect(JSON.stringify(p.gtag())).not.toContain('zoe@example.com');
      expect(p.gtag().some((c) => c[1] === 'conversion')).toBe(false);
      expect(p.gtag()).toContainEqual(['event', 'book_call']);
    }
  });

  it('a Google-only page sends no Pixel events, and a Meta-only page no Google events', () => {
    const google = ready({ googleTagId: 'G-ABC123XYZ4' });
    trackLead('lead.abc');
    expect(google.win.fbq).toBeUndefined();
    expect(google.gtag()).toContainEqual(['event', 'generate_lead']);

    const meta = ready({ metaPixelId: '123456789012345' });
    trackLead('lead.abc');
    expect(meta.win.gtag).toBeUndefined();
    expect(meta.fbq()).toContainEqual(['track', 'Lead', {}, { eventID: 'lead.abc' }]);
  });

  it('calls after a new initTracking go to the new page, not the old one', () => {
    const first = ready();
    const second = ready();
    trackLead('lead.abc');
    expect(second.fbq()).toContainEqual(['track', 'Lead', {}, { eventID: 'lead.abc' }]);
    expect(first.fbq().filter((c) => c[1] === 'Lead')).toHaveLength(0);
  });
});

describe('readTrackingConfig', () => {
  const doc = (inner: string) => new JSDOM(`<!doctype html><body>${inner}</body>`).window.document;

  it('reads the ids from the page\'s JSON, and nothing else', () => {
    const d = doc('<script type="application/json" data-tracking>{"metaPixelId":"123","googleTagId":"G-ABC123XYZ4","evil":"x","googleAdsId":5}</script>');
    expect(readTrackingConfig(d)).toEqual({ metaPixelId: '123', googleTagId: 'G-ABC123XYZ4' });
  });

  it('is nothing when the page has no tracking element, or it is not JSON', () => {
    expect(readTrackingConfig(doc(''))).toBeNull();
    expect(readTrackingConfig(doc('<script type="application/json" data-tracking>{oops</script>'))).toBeNull();
    expect(readTrackingConfig(doc('<script type="application/json" data-tracking>[1]</script>'))).toBeNull();
  });
});
