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

export interface BookingApi {
  createLead(i: LeadInput & { turnstileToken: string; website: string }): Promise<{ leadId: string; eventId: string }>;
  getSlots(): Promise<{ slots: Slot[]; calendarChecked: boolean }>;
  confirm(leadId: string, slot: Slot, visitorTz: string): Promise<Booked>;
}

/** Thrown by confirm() when someone else booked the time first. */
export class SlotTakenError extends Error { constructor() { super('slot_taken'); this.name = 'SlotTakenError'; } }
/** The server refused the form; `fields` names each bad field with a code ('required', 'invalid', 'too_long'). */
export class FieldsError extends Error {
  fields: Record<string, string>;
  constructor(fields: Record<string, string>) { super('invalid'); this.name = 'FieldsError'; this.fields = fields; }
}
/** The bot check failed (or its token never came). */
export class BotCheckError extends Error { constructor() { super('bot_check_failed'); this.name = 'BotCheckError'; } }
export class RateLimitedError extends Error { constructor() { super('rate_limited'); this.name = 'RateLimitedError'; } }
/** The server could not be reached, or answered something the page cannot use. */
export class NetworkError extends Error { constructor() { super('network'); this.name = 'NetworkError'; } }

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isSlot = (v: unknown): v is Slot => isObject(v) && typeof v.start === 'string' && typeof v.end === 'string';

/** How long a call to the booking server may take before the page gives up on it (a stalled phone connection would otherwise wait for minutes). */
const CALL_TIMEOUT_MS = 15_000;

/** A signal that aborts after `ms`. A browser too old to have AbortSignal.timeout simply waits, as it did before. */
export const timeoutSignal = (ms: number): AbortSignal | undefined => (typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(ms) : undefined);

/** The booking server's own API (`/api/booking/*`). Every failure, a call that takes too long included, becomes one of the errors above. */
export function httpApi(fetchFn: typeof fetch = fetch, timeoutMs = CALL_TIMEOUT_MS): BookingApi {
  async function call(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
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
    if (res.status === 409) throw new SlotTakenError();
    if (res.status === 429) throw new RateLimitedError();
    throw new NetworkError();
  }
  const post = (path: string, data: unknown) => call(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });

  return {
    async createLead(input) {
      const out = await post('/api/booking/leads', input);
      if (typeof out.leadId !== 'string' || typeof out.eventId !== 'string') throw new NetworkError();
      return { leadId: out.leadId, eventId: out.eventId };
    },
    async getSlots() {
      const out = await call('/api/booking/slots', { cache: 'no-store' });
      if (!Array.isArray(out.slots) || !out.slots.every(isSlot) || typeof out.calendarChecked !== 'boolean') throw new NetworkError();
      return { slots: out.slots, calendarChecked: out.calendarChecked };
    },
    async confirm(leadId, slot, visitorTz) {
      const out = await post('/api/booking/bookings', { leadId, start: slot.start, visitorTz });
      const { status, start, end, meetUrl, manageUrl, eventId } = out;
      if ((status !== 'booked' && status !== 'requested') || typeof start !== 'string' || typeof end !== 'string' || typeof manageUrl !== 'string' || typeof eventId !== 'string') {
        throw new NetworkError();
      }
      return { status, start, end, manageUrl, eventId, ...(typeof meetUrl === 'string' && { meetUrl }) };
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
