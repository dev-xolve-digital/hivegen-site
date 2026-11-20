import { generateSlots, type Slot } from './slots';
import type { BookingRules } from '../content/schemas';

export type BuyerType = 'agency' | 'videographer' | 'agent' | 'other';
/** Where the visitor came from: the ad tags of their first landing. */
export interface Attribution {
  utm_source?: string; utm_medium?: string; utm_campaign?: string; utm_term?: string; utm_content?: string; fbclid?: string; gclid?: string;
}
export interface LeadInput {
  name: string; email: string; phone?: string; buyerType: BuyerType; volume: string;
  footageUrl?: string; pageVersion: string; attribution: Attribution; fbp?: string; fbc?: string;
}
/** What the visitor's booking turned out as: `booked` (Google made the event) or `requested` (held, confirmed by hand). */
export interface Booked { status: 'booked' | 'requested'; start: string; end: string; meetUrl?: string; manageUrl: string; eventId: string }

/** The Turnstile action the booking form's widget is rendered with; the server refuses tokens made for any other action. */
export const TURNSTILE_ACTION = 'booking';

export interface BookingApi {
  createLead(i: LeadInput & { turnstileToken: string; website: string }): Promise<{ leadId: string; eventId: string }>;
  getSlots(): Promise<{ slots: Slot[]; calendarChecked: boolean }>;
  confirm(leadId: string, slot: Slot, visitorTz: string): Promise<Booked>;
}

/** What the manage page does with one booking (the token is the link's own): the offered times, cancelling, and moving the call. */
export interface ManageApi {
  getSlots: BookingApi['getSlots'];
  cancel(): Promise<void>;
  reschedule(slot: Slot): Promise<{ status: 'booked' | 'requested'; start: string; end: string }>;
}

/** Thrown by confirm() and reschedule() when someone else booked the time first. */
export class SlotTakenError extends Error { constructor() { super('slot_taken'); this.name = 'SlotTakenError'; } }
/** The server refused the form; `fields` names each bad field with a code ('required', 'invalid', 'too_long'). */
export class FieldsError extends Error {
  fields: Record<string, string>;
  constructor(fields: Record<string, string>) { super('invalid'); this.name = 'FieldsError'; this.fields = fields; }
}
/** The bot check failed (or its token never came). */
export class BotCheckError extends Error { constructor() { super('bot_check_failed'); this.name = 'BotCheckError'; } }
export class RateLimitedError extends Error { constructor() { super('rate_limited'); this.name = 'RateLimitedError'; } }
/** The change came too late: the call is too close (rescheduling) or has started (cancelling). */
export class TooLateError extends Error { constructor() { super('too_late'); this.name = 'TooLateError'; } }
/** The server could not be reached, or answered something the page cannot use. */
export class NetworkError extends Error { constructor() { super('network'); this.name = 'NetworkError'; } }

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isSlot = (v: unknown): v is Slot => isObject(v) && typeof v.start === 'string' && typeof v.end === 'string';

/** How long a call to the booking server may take before the page gives up on it (a stalled phone connection would otherwise wait for minutes). */
const CALL_TIMEOUT_MS = 15_000;

/** A signal that aborts after `ms`. A browser too old to have AbortSignal.timeout simply waits, as it did before. */
export const timeoutSignal = (ms: number): AbortSignal | undefined => (typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(ms) : undefined);

/**
 * One call to the booking server over `fetchFn`, with the time limit. Every failure becomes one of the errors above: a call that takes too long,
 * a connection that fails and an answer the page cannot use are a NetworkError. A 409 is a TooLateError or a SlotTakenError, as the answer says.
 */
function caller(fetchFn: typeof fetch, timeoutMs: number) {
  return async function call(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await fetchFn(path, { ...init, signal: timeoutSignal(timeoutMs) });
    } catch {
      throw new NetworkError();
    }
    // The same signal also ends a body that stalls after the headers: it fails the read below, and that is a NetworkError too.
    let body: unknown = null;
    try { body = await res.json(); } catch { /* not JSON: handled below */ }
    if (res.ok) {
      if (!isObject(body)) throw new NetworkError();
      return body;
    }
    if (res.status === 400) throw new FieldsError(isObject(body) && isObject(body.fields) ? (body.fields as Record<string, string>) : {});
    if (res.status === 403) throw new BotCheckError();
    if (res.status === 409) throw isObject(body) && body.error === 'too_late' ? new TooLateError() : new SlotTakenError();
    if (res.status === 429) throw new RateLimitedError();
    throw new NetworkError();
  };
}
const postJson = (call: ReturnType<typeof caller>, path: string, data?: unknown) =>
  call(path, { method: 'POST', ...(data !== undefined && { headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) }) });

/** The offered times, as the booking form and the manage page both read them. */
async function readSlots(call: ReturnType<typeof caller>): Promise<{ slots: Slot[]; calendarChecked: boolean }> {
  const out = await call('/api/booking/slots', { cache: 'no-store' });
  if (!Array.isArray(out.slots) || !out.slots.every(isSlot) || typeof out.calendarChecked !== 'boolean') throw new NetworkError();
  return { slots: out.slots, calendarChecked: out.calendarChecked };
}

/**
 * The address a video plays from, asked of the server each time a video is opened: with signed links on, the address holds a token
 * that stops working an hour later, so it cannot be put in the page. Fails like every other call (a NetworkError for an unknown video,
 * a server that is not set up or a connection that does not answer in time; a RateLimitedError when asked too often).
 */
export async function fetchVideoSrc(videoId: string, fetchFn: typeof fetch = fetch, timeoutMs = CALL_TIMEOUT_MS): Promise<string> {
  const out = await caller(fetchFn, timeoutMs)(`/api/video/${encodeURIComponent(videoId)}`, { cache: 'no-store' });
  if (typeof out.src !== 'string' || !out.src) throw new NetworkError();
  return out.src;
}

/** The booking server's own API (`/api/booking/*`). Every failure, a call that takes too long included, becomes one of the errors above. */
export function httpApi(fetchFn: typeof fetch = fetch, timeoutMs = CALL_TIMEOUT_MS): BookingApi {
  const call = caller(fetchFn, timeoutMs);
  return {
    async createLead(input) {
      const out = await postJson(call, '/api/booking/leads', input);
      if (typeof out.leadId !== 'string' || typeof out.eventId !== 'string') throw new NetworkError();
      return { leadId: out.leadId, eventId: out.eventId };
    },
    getSlots: () => readSlots(call),
    async confirm(leadId, slot, visitorTz) {
      const out = await postJson(call, '/api/booking/bookings', { leadId, start: slot.start, visitorTz });
      const { status, start, end, meetUrl, manageUrl, eventId } = out;
      if ((status !== 'booked' && status !== 'requested') || typeof start !== 'string' || typeof end !== 'string' || typeof manageUrl !== 'string' || typeof eventId !== 'string') {
        throw new NetworkError();
      }
      return { status, start, end, manageUrl, eventId, ...(typeof meetUrl === 'string' && { meetUrl }) };
    },
  };
}

/** The manage routes of one booking (`/api/booking/manage/<token>/*`), with the same limits and errors as httpApi. */
export function httpManageApi(token: string, fetchFn: typeof fetch = fetch, timeoutMs = CALL_TIMEOUT_MS): ManageApi {
  const call = caller(fetchFn, timeoutMs);
  const route = (action: 'cancel' | 'reschedule') => `/api/booking/manage/${encodeURIComponent(token)}/${action}`;
  return {
    getSlots: () => readSlots(call),
    async cancel() {
      const out = await postJson(call, route('cancel'));
      if (out.status !== 'cancelled') throw new NetworkError();
    },
    async reschedule(slot) {
      const { status, start, end } = await postJson(call, route('reschedule'), { start: slot.start });
      if ((status !== 'booked' && status !== 'requested') || typeof start !== 'string' || typeof end !== 'string') throw new NetworkError();
      return { status, start, end };
    },
  };
}

/** The pretend booking for a copy of the site with no server behind it: real slot rules, nothing leaves the browser. */
export function demoApi(rules: BookingRules, now: () => Date = () => new Date()): BookingApi {
  const taken = new Set<string>();
  let n = 0;
  return {
    async createLead() { n += 1; return { leadId: `demo-${n}`, eventId: `demo-lead-${n}` }; },
    async getSlots() { return { slots: generateSlots(rules, now()).filter((s) => !taken.has(s.start)), calendarChecked: true }; },
    async confirm(leadId, slot) {
      if (taken.has(slot.start)) throw new SlotTakenError();
      taken.add(slot.start);
      return { status: 'booked', start: slot.start, end: slot.end, manageUrl: '#book', eventId: `demo-schedule-${leadId}` };
    },
  };
}
