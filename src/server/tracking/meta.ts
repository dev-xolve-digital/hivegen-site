import { logFailure } from '../booking/emails';
import type { ServerEvent, Store, Tracker, TrackingRecord } from '../booking/types';
import { normalizeEmail, normalizePhone, sha256Hex } from './hash';

/** The Graph API version of the Conversions API address: the newest in Meta's changelog when this was written (v27.0, 4 November 2026). */
export const META_GRAPH_VERSION = 'v27.0';
/** How long Meta may take to answer. A lead or booking waits for its event, so a stalled Meta must not hold it up for long. */
const TIMEOUT_MS = 5000;

/** One Conversions API request: the events, and the code that shows them under "Test events" in Events Manager. Never holds the access token. */
interface MetaRequest { data: Array<Record<string, unknown>>; test_event_code?: string }

/**
 * The Conversions API request for one event. Email, phone and the external id are normalised and hashed (SHA-256), as Meta requires;
 * the address, browser and Facebook cookies go as they are. Whatever the visitor never gave is left out.
 */
export function buildMetaEvent(e: ServerEvent, testEventCode?: string): MetaRequest {
  const { email, phone, externalId, ip, userAgent, fbp, fbc } = e.user;
  const em = email ? normalizeEmail(email) : '';
  const ph = phone ? normalizePhone(phone) : '';
  const userData = {
    ...(em ? { em: [sha256Hex(em)] } : {}),
    ...(ph ? { ph: [sha256Hex(ph)] } : {}),
    ...(externalId ? { external_id: [sha256Hex(externalId)] } : {}),
    ...(ip ? { client_ip_address: ip } : {}),
    ...(userAgent ? { client_user_agent: userAgent } : {}),
    ...(fbp ? { fbp } : {}),
    ...(fbc ? { fbc } : {}),
  };
  return {
    data: [{
      event_name: e.name, event_time: Math.floor(e.time.getTime() / 1000), event_id: e.eventId, action_source: 'website',
      ...(e.sourceUrl ? { event_source_url: e.sourceUrl } : {}), user_data: userData,
    }],
    ...(testEventCode ? { test_event_code: testEventCode } : {}),
  };
}

type Outcome = { ok: true } | { ok: false; error: string };

/** The short reason for a refused request: its status and Meta's error code, never Meta's message (it can quote what was sent). */
async function refusal(res: Response): Promise<string> {
  let code = '';
  try {
    const found = ((await res.json()) as { error?: { code?: unknown } } | null)?.error?.code;
    if (typeof found === 'number') code = ` code ${found}`;
  } catch {
    // an answer that is not JSON: the status says enough
  }
  return `http ${res.status}${code}`;
}

export interface MetaTrackerOptions {
  pixelId: string;
  /** The Conversions API access token. A secret: only ever in the request body, never stored or logged. */
  token: string;
  testEventCode?: string;
  store: Store;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Sends events to Meta's Conversions API. `send` (the first attempt) writes the event to `tracking_events` as pending, then sent or
 * failed, and never throws: a lead or booking is never held back by it. `resend` only sends a stored event again and says whether
 * Meta took it; the cron pass records that attempt.
 */
export function createMetaTracker(o: MetaTrackerOptions): Tracker & { resend(r: TrackingRecord): Promise<boolean> } {
  const fetchFn = o.fetchFn ?? fetch;
  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(o.pixelId)}/events`;

  /** Never throws. */
  const post = async (payload: object): Promise<Outcome> => {
    try {
      const res = await fetchFn(url, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...payload, access_token: o.token }), signal: AbortSignal.timeout(o.timeoutMs ?? TIMEOUT_MS),
      });
      if (res.ok) {
        await res.body?.cancel().catch(() => {});
        return { ok: true };
      }
      return { ok: false, error: await refusal(res) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.name : 'unknown error' };
    }
  };

  /** A step that must not stop the others (or the booking): its failure is logged by kind and then forgotten. */
  const attempt = async (what: string, work: () => Promise<unknown>) => {
    try {
      await work();
    } catch (e) {
      logFailure('tracking', what, e);
    }
  };

  return {
    async send(e) {
      let payload: MetaRequest;
      try {
        payload = buildMetaEvent(e, o.testEventCode);
      } catch (err) {
        logFailure('tracking', 'event not built', err);
        return;
      }
      await attempt('event not recorded', () => o.store.recordTrackingEvent({ eventId: e.eventId, name: e.name, leadId: e.leadId, payload, status: 'pending', attempts: 1 }, new Date()));
      const outcome = await post(payload);
      await attempt('event status not saved', () => o.store.updateTrackingEvent(e.eventId, outcome.ok ? { status: 'sent' } : { status: 'failed', error: outcome.error }, new Date()));
    },

    async resend(r) {
      const payload = r.payload;
      if (payload === null || typeof payload !== 'object') return false;
      return (await post(payload)).ok;
    },
  };
}
