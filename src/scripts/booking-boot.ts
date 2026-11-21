import { demoApi, httpApi, INQUIRY_TURNSTILE_ACTION, timeoutSignal, type BookingApi } from '../lib/booking/api-client';
import { initSwitch } from './booking-switch';
import { initBooking, type BookingOptions, type BookingSession } from './booking-ui';
import { initInquiry, type InquiryOptions } from './inquiry-ui';
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

/** How long one try at the config may take, and how many tries there are, before the page settles on "off". */
const CONFIG_TIMEOUT_MS = 10_000;
const CONFIG_TRIES = 2;

/**
 * What the server says about booking. A try that fails or stalls is made once more; anything still unreadable is "off":
 * the safe answer, which never shows a booking that is not real (and never leaves a held submit waiting for good).
 */
async function readConfig(fetchFn: typeof fetch, timeoutMs: number): Promise<{ mode: Mode; siteKey?: string }> {
  for (let attempt = 0; attempt < CONFIG_TRIES; attempt += 1) {
    try {
      const res = await fetchFn('/api/booking/config', { cache: 'no-store', signal: timeoutSignal(timeoutMs) });
      if (!res.ok) continue;
      const body = (await res.json()) as { mode?: unknown; turnstileSiteKey?: unknown };
      const mode = body.mode === 'live' || body.mode === 'demo' ? body.mode : 'off';
      return { mode, siteKey: typeof body.turnstileSiteKey === 'string' && body.turnstileSiteKey ? body.turnstileSiteKey : undefined };
    } catch {
      // the connection failed or stalled: try again
    }
  }
  return { mode: 'off' };
}

/** Where the visitor's session (the lead the call flow saved, and whether its Lead was reported) is kept for the tab, so a reload keeps it. */
export const SESSION_KEY = 'hg_booking_session';
/** The shape of a lead's public id. The server refuses any other, so a stored id of another shape is not trusted: it would fail every send. */
const LEAD_ID = /^[A-Za-z0-9_-]{22}$/;

/**
 * The session the call flow and the "Send details" form share. It starts from what this tab stored (a reload between the two keeps one visitor
 * one lead) and stores every change. Storage that is blocked, full or holds something else only means the session lives in the page.
 */
function persistentSession(win: Win): BookingSession {
  const storage = (): Storage | null => { try { return win.sessionStorage; } catch { return null; } };
  const state: BookingSession = { leadId: null, leadTracked: false };
  try {
    const stored = JSON.parse(storage()?.getItem(SESSION_KEY) ?? 'null') as { leadId?: unknown; leadTracked?: unknown } | null;
    if (typeof stored?.leadId === 'string' && LEAD_ID.test(stored.leadId)) state.leadId = stored.leadId;
    if (stored?.leadTracked === true) state.leadTracked = true;
  } catch {
    // nothing usable stored: a fresh session
  }
  const save = () => { try { storage()?.setItem(SESSION_KEY, JSON.stringify(state)); } catch { /* blocked or full: the session lives in the page */ } };
  return {
    get leadId() { return state.leadId; },
    set leadId(id) { state.leadId = id; save(); },
    get leadTracked() { return state.leadTracked; },
    set leadTracked(tracked) { state.leadTracked = tracked; save(); },
  };
}

export interface BootEnv {
  /** Replaceable by tests: the window's load event, the section coming near, the network, and Cloudflare's widget. */
  loaded?: Promise<void>;
  near?: Promise<void>;
  fetchFn?: typeof fetch;
  /** How long one try at the config may take. */
  configTimeoutMs?: number;
  loadTurnstile?: typeof loadTurnstile;
  /** Tracking hooks, handed to the form. */
  hooks?: Pick<BookingOptions, 'onLead' | 'onSchedule'>;
}

/**
 * Starts the booking card on a page: the switch between "Book a call" and "Send details", and both forms. They can be used from the start,
 * but the server calls and Cloudflare's script wait for the window load event and for the section to come near the screen; a visitor who
 * submits before then is held until the forms are ready. What the server says (live, demo, off) decides which booking they run on.
 * The "Send details" form has a bot check of its own (its own widget, for its own action), set up when that form is first shown.
 */
export function bootBooking(root: HTMLElement, env: BootEnv = {}): void {
  const win = root.ownerDocument.defaultView as Win;
  const fetchFn = env.fetchFn ?? ((input, init) => win.fetch(input, init));
  const turnstile = env.loadTurnstile ?? loadTurnstile;
  const session = persistentSession(win);

  // The switch works at once, before the server has answered.
  let config: { mode: Mode; siteKey?: string } | undefined;
  let detailsShown = false;
  let inquiryWidget: ReturnType<typeof loadTurnstile> | undefined;
  /** The "Send details" form's bot check: made once, on a live page with a site key, when the form is first shown (or, failing that, first sent). */
  const ensureInquiryWidget = () => {
    if (!inquiryWidget && config?.mode === 'live' && config.siteKey) {
      inquiryWidget = turnstile(config.siteKey, root.querySelector<HTMLElement>('[data-inq-turnstile]')!, INQUIRY_TURNSTILE_ACTION);
    }
    return inquiryWidget;
  };
  const switchApi = initSwitch(root, {
    onShow: (view) => { if (view === 'details') { detailsShown = true; ensureInquiryWidget(); } },
  });

  // Before the real forms take over: a submit is held, and it wakes the loading.
  const held = new Set<HTMLFormElement>();
  let wake!: () => void;
  const submitted = new Promise<void>((resolve) => { wake = resolve; });
  const holders = new Map<HTMLFormElement, (e: Event) => void>();
  const forms = [
    { form: root.querySelector<HTMLFormElement>('[data-step="details"]')!, button: root.querySelector<HTMLButtonElement>('[data-submit]')! },
    { form: root.querySelector<HTMLFormElement>('[data-inquiry-form]')!, button: root.querySelector<HTMLButtonElement>('[data-inq-submit]')! },
  ];
  for (const { form, button } of forms) {
    const hold = (e: Event) => { e.preventDefault(); held.add(form); button.disabled = true; wake(); };
    holders.set(form, hold);
    form.noValidate = true; // our own messages, not the browser's
    form.addEventListener('submit', hold);
    button.disabled = false;
  }

  const loaded = env.loaded ?? whenLoaded(win);
  const near = env.near ?? whenNear(root, win);
  void Promise.all([loaded, Promise.race([near, submitted])]).then(async () => {
    const { mode, siteKey } = await readConfig(fetchFn, env.configTimeoutMs ?? CONFIG_TIMEOUT_MS);
    config = { mode, siteKey };
    let api: BookingApi = httpApi(fetchFn);
    let getBotToken: BookingOptions['getBotToken'];
    let inquiryToken: InquiryOptions['getBotToken'];
    if (mode === 'demo') {
      api = demoApi(JSON.parse(root.querySelector('[data-booking-rules]')!.textContent!));
    } else if (mode === 'live' && siteKey) {
      getBotToken = turnstile(siteKey, root.querySelector<HTMLElement>('[data-turnstile]')!).getToken;
      if (detailsShown) ensureInquiryWidget();
    } else if (mode === 'live') {
      getBotToken = async () => ''; // no site key set: the server will refuse the empty token
    }
    // The form may be sent before its panel was ever shown: its widget is then made on demand. With no site key the token is empty, as above.
    if (mode === 'live') inquiryToken = async () => (await ensureInquiryWidget()?.getToken()) ?? '';
    for (const [form, hold] of holders) form.removeEventListener('submit', hold);
    if (mode === 'off') {
      switchApi.show('call'); // the card goes back to the call's words, whichever panel was open
      switchApi.hide();
    }
    initBooking(root, api, { mode, getBotToken, session, ...env.hooks });
    initInquiry(root, api, { mode, getBotToken: inquiryToken, session, onLead: env.hooks?.onLead });
    if (mode !== 'off') for (const form of held) form.dispatchEvent(new win.Event('submit', { cancelable: true, bubbles: true }));
  });
}
