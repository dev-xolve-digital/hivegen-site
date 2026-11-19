import { demoApi, httpApi, type BookingApi } from '../lib/booking/api-client';
import { initBooking, type BookingOptions } from './booking-ui';
import { loadTurnstile } from './turnstile';

type Mode = BookingOptions['mode'];
type Win = Window & typeof globalThis;

/** How far from the screen the booking section is when its server calls and the bot check start. */
const NEAR = '600px 0px';

/** Resolves at the window's load event (at once if the page has already loaded). Nothing third-party may start before it. */
export function whenLoaded(win: Win): Promise<void> {
  if (win.document.readyState === 'complete') return Promise.resolve();
  return new Promise((resolve) => win.addEventListener('load', () => resolve(), { once: true }));
}

/** Resolves the first time `el` is within 600px of the screen (at once in a browser that cannot tell). */
export function whenNear(el: Element, win: Win): Promise<void> {
  if (!win.IntersectionObserver) return Promise.resolve();
  return new Promise((resolve) => {
    const watcher = new win.IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { watcher.disconnect(); resolve(); }
    }, { rootMargin: NEAR });
    watcher.observe(el);
  });
}

/** What the server says about booking. Anything unreadable is "off": the safe answer, which never shows a booking that is not real. */
async function readConfig(fetchFn: typeof fetch): Promise<{ mode: Mode; siteKey?: string }> {
  try {
    const res = await fetchFn('/api/booking/config', { cache: 'no-store' });
    if (!res.ok) return { mode: 'off' };
    const body = (await res.json()) as { mode?: unknown; turnstileSiteKey?: unknown };
    const mode = body.mode === 'live' || body.mode === 'demo' ? body.mode : 'off';
    return { mode, siteKey: typeof body.turnstileSiteKey === 'string' && body.turnstileSiteKey ? body.turnstileSiteKey : undefined };
  } catch {
    return { mode: 'off' };
  }
}

export interface BootEnv {
  /** Replaceable by tests: the window's load event, the section coming near, the network, and Cloudflare's widget. */
  loaded?: Promise<void>;
  near?: Promise<void>;
  fetchFn?: typeof fetch;
  loadTurnstile?: typeof loadTurnstile;
  /** Tracking hooks, handed to the form. */
  hooks?: Pick<BookingOptions, 'onLead' | 'onSchedule'>;
}

/**
 * Starts the booking form on a page. The form can be used from the start, but the server calls and Cloudflare's script wait for the
 * window load event and for the section to come near the screen; a visitor who submits before then is held until the form is ready.
 * What the server says (live, demo, off) decides which booking the form runs on.
 */
export function bootBooking(root: HTMLElement, env: BootEnv = {}): void {
  const win = root.ownerDocument.defaultView as Win;
  const fetchFn = env.fetchFn ?? ((input, init) => win.fetch(input, init));
  const turnstile = env.loadTurnstile ?? loadTurnstile;
  const form = root.querySelector<HTMLFormElement>('[data-step="details"]')!;
  const submitBtn = form.querySelector<HTMLButtonElement>('[data-submit]')!;

  // Before the real form takes over: a submit is held, and it wakes the loading.
  let held = false;
  let wake!: () => void;
  const submitted = new Promise<void>((resolve) => { wake = resolve; });
  const hold = (e: Event) => { e.preventDefault(); held = true; submitBtn.disabled = true; wake(); };
  form.noValidate = true; // our own messages, not the browser's
  form.addEventListener('submit', hold);
  submitBtn.disabled = false;

  const loaded = env.loaded ?? whenLoaded(win);
  const near = env.near ?? whenNear(root, win);
  void Promise.all([loaded, Promise.race([near, submitted])]).then(async () => {
    const { mode, siteKey } = await readConfig(fetchFn);
    let api: BookingApi = httpApi(fetchFn);
    let getBotToken: BookingOptions['getBotToken'];
    if (mode === 'demo') {
      api = demoApi(JSON.parse(root.querySelector('[data-booking-rules]')!.textContent!));
    } else if (mode === 'live' && siteKey) {
      getBotToken = turnstile(siteKey, root.querySelector<HTMLElement>('[data-turnstile]')!).getToken;
    } else if (mode === 'live') {
      getBotToken = async () => ''; // no site key set: the server will refuse the empty token
    }
    form.removeEventListener('submit', hold);
    initBooking(root, api, { mode, getBotToken, ...env.hooks });
    if (held && mode !== 'off') form.dispatchEvent(new win.Event('submit', { cancelable: true, bubbles: true }));
  });
}
