import { cookie } from './cookie';

/** The public ids from site.yaml. Empty or missing means that tracker is off. */
export interface TrackingConfig { metaPixelId?: string; googleTagId?: string; googleAdsId?: string; googleAdsScheduleLabel?: string }

const FB_SCRIPT = 'https://connect.facebook.net/en_US/fbevents.js';
const GTAG_SCRIPT = 'https://www.googletagmanager.com/gtag/js?id=';
/** The longest the trackers wait for the browser to be idle after the page has loaded. */
const IDLE_MS = 2000;

interface Fbq { (...args: unknown[]): void; callMethod?: (...args: unknown[]) => void; queue: unknown[]; push: Fbq; loaded: boolean; version: string }
/** A window as the trackers use it: with the calls the Meta and Google snippets add to it. */
export type TrackingWindow = Window & typeof globalThis & { fbq?: Fbq; _fbq?: Fbq; dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void };
interface Tracker { viewContent(title: string): void; lead(eventId: string): void; schedule(eventId: string, email: string): void }

/** The tracker of the page that was last started. Nothing until a page with ids has been: then every track call does nothing. */
let current: Tracker | undefined;

const idOf = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** Runs `work` once the page has loaded and the browser has a quiet moment (or 2 s later, in a browser that cannot tell). */
function afterLoadAndIdle(win: TrackingWindow, work: () => void): void {
  const wait = () => (win.requestIdleCallback ? win.requestIdleCallback(work, { timeout: IDLE_MS }) : win.setTimeout(work, IDLE_MS));
  if (win.document.readyState === 'complete') wait();
  else win.addEventListener('load', wait, { once: true });
}

/** Adds a third-party script. `settled` runs when it has loaded or failed to (blocked, offline). */
function addScript(win: TrackingWindow, src: string, settled?: () => void): void {
  const script = win.document.createElement('script');
  script.async = true;
  script.src = src;
  if (settled) for (const done of ['load', 'error']) script.addEventListener(done, settled);
  win.document.head.append(script);
}

/** Meta's own start-up snippet: `fbq` queues calls until fbevents.js arrives and takes them over. */
function defineFbq(win: TrackingWindow): void {
  if (win.fbq) return;
  const fbq = function () {
    if (fbq.callMethod) fbq.callMethod.apply(fbq, arguments as unknown as unknown[]);
    else fbq.queue.push(arguments);
  } as Fbq;
  fbq.push = fbq;
  fbq.loaded = true;
  fbq.version = '2.0';
  fbq.queue = [];
  win.fbq = fbq;
  win._fbq ??= fbq;
}

/** Google's own start-up snippet: `gtag` fills `dataLayer` (with `arguments` objects, which is what gtag.js reads) until gtag.js arrives. */
function defineGtag(win: TrackingWindow): void {
  const layer = win.dataLayer ??= [];
  win.gtag = function () { layer.push(arguments); };
}

/**
 * The server's half of PageView, for the Conversions API: this visit's event id (the same one the Pixel got, so Meta counts it once),
 * the page and the Facebook cookies. A page the Pixel is blocked on still sends it: there is no Pixel event to double-count.
 */
function beaconPageView(win: TrackingWindow, eventId: string): void {
  const url = win.location.href.split('#')[0];
  const fbclid = new URL(url).searchParams.get('fbclid');
  const body = {
    name: 'PageView', eventId, url,
    fbp: cookie(win.document, '_fbp'),
    fbc: cookie(win.document, '_fbc') ?? (fbclid ? `fb.1.${Date.now()}.${fbclid}`.slice(0, 200) : undefined),
  };
  win.navigator.sendBeacon?.('/api/events', new win.Blob([JSON.stringify(body)], { type: 'application/json' }));
}

/**
 * Starts the Meta Pixel and the Google tag for the ids given. Nothing is requested before the window's load event and a quiet moment
 * after it. Track calls made before that are kept and sent, in order, as soon as the trackers are in. With no ids, nothing is added
 * and every track call does nothing.
 *
 * The Pixel is started with its id only: no email or phone is handed to it (advanced matching is off). Only the server sends
 * hashed user data, and Google gets the email at Schedule time, for its enhanced conversions.
 */
export function initTracking(cfg: TrackingConfig, win: TrackingWindow = window as TrackingWindow): void {
  const pixelId = idOf(cfg.metaPixelId);
  const tagId = idOf(cfg.googleTagId);
  const adsId = idOf(cfg.googleAdsId);
  const label = idOf(cfg.googleAdsScheduleLabel);
  const google = tagId ?? adsId; // the one gtag.js is loaded for; both ids are configured on it
  if (!pixelId && !google) {
    current = undefined;
    return;
  }

  const fbq = (...args: unknown[]) => { if (pixelId) win.fbq!(...args); };
  const gtag = (...args: unknown[]) => { if (google) win.gtag!(...args); };

  let started = false;
  const waiting: Array<() => void> = [];
  /** Tracking must never break the page, so one call that goes wrong costs only itself. */
  const run = (work: () => void) => {
    if (!started) { waiting.push(work); return; }
    try { work(); } catch { /* a tracker that fails is not the visitor's problem */ }
  };

  current = {
    viewContent: (title) => run(() => {
      fbq('track', 'ViewContent', { content_name: title });
      gtag('event', 'video_play', { video_title: title });
    }),
    lead: (eventId) => run(() => {
      fbq('track', 'Lead', {}, { eventID: eventId });
      gtag('event', 'generate_lead');
    }),
    schedule: (eventId, email) => run(() => {
      fbq('track', 'Schedule', {}, { eventID: eventId });
      if (adsId && label) { // the email only improves a Google Ads conversion, so only then does Google get it
        gtag('set', 'user_data', { email });
        gtag('event', 'conversion', { send_to: `${adsId}/${label}` });
      }
      gtag('event', 'book_call');
    }),
  };

  afterLoadAndIdle(win, () => {
    if (pixelId) {
      defineFbq(win);
      fbq('set', 'autoConfig', false, pixelId); // no reading of form fields by the Pixel
      fbq('init', pixelId);
      const eventId = win.crypto?.randomUUID?.();
      fbq('track', 'PageView', {}, ...(eventId ? [{ eventID: eventId }] : []));
      // The beacon waits for the Pixel, so the Facebook cookies it sets are there to be sent.
      addScript(win, FB_SCRIPT, eventId ? () => beaconPageView(win, eventId) : undefined);
    }
    if (google) {
      defineGtag(win);
      gtag('js', new Date());
      if (tagId) gtag('config', tagId);
      if (adsId) gtag('config', adsId);
      addScript(win, GTAG_SCRIPT + encodeURIComponent(google));
    }
    started = true;
    for (const work of waiting.splice(0)) run(work);
  });
}

/** The ids in the page's `<script type="application/json" data-tracking>`, or null when the page has none (or it is not readable). */
export function readTrackingConfig(doc: Document): TrackingConfig | null {
  const text = doc.querySelector('script[data-tracking]')?.textContent;
  if (!text) return null;
  try {
    const raw = JSON.parse(text) as Record<string, unknown> | null;
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const { metaPixelId, googleTagId, googleAdsId, googleAdsScheduleLabel } = raw;
    return { metaPixelId: idOf(metaPixelId), googleTagId: idOf(googleTagId), googleAdsId: idOf(googleAdsId), googleAdsScheduleLabel: idOf(googleAdsScheduleLabel) };
  } catch {
    return null;
  }
}

/** Starts tracking for this page from the ids in its source. A page with none (the site's content has none yet) does nothing. */
export function bootTracking(): void {
  const cfg = readTrackingConfig(document);
  if (cfg) initTracking(cfg);
}

/** A video was opened to watch. */
export const trackViewContent = (title: string): void => current?.viewContent(title);
/** The lead was saved; `eventId` is the server's, shared with its Conversions API Lead event. */
export const trackLead = (eventId: string): void => current?.lead(eventId);
/** The call was booked (or asked for); `eventId` is the server's, shared with its Conversions API Schedule event. */
export const trackSchedule = (eventId: string, email: string): void => current?.schedule(eventId, email);
