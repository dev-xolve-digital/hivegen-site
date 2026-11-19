import { randomBytes } from 'node:crypto';
import type { BookingRules } from '../../lib/content/schemas';
import { generateSlots } from '../../lib/booking/slots';
import { leadInputSchema, parseInput } from './validate';
import {
  CalendarUnavailableError,
  type Booking, type BookingStatus, type Calendar, type Clock, type Interval, type Lead, type Notifier, type Result, type Slot, type Store, type Tracker,
} from './types';

export interface ServiceDeps {
  store: Store; calendar: Calendar; notifier: Notifier; tracker: Tracker; clock: Clock; rules: BookingRules;
  siteUrl: string;
  /** The calendar invite's title and description from booking.yaml, with {name} and {manageUrl} still in them. */
  calendarCopy: { title: string; description: string };
  /** The "videos per month" choices from booking.yaml. */
  volumeOptions: string[];
  verifyBot(token: string, ip?: string): Promise<boolean>;
}

export type BookOutcome = { status: 'booked' | 'requested'; start: string; end: string; meetUrl?: string; manageUrl: string; eventId: string };
type RequestMeta = { ip?: string; userAgent?: string; sourceUrl?: string };

export interface BookingService {
  getSlots(): Promise<{ slots: Slot[]; calendarChecked: boolean }>;
  createLead(raw: unknown, meta: RequestMeta): Promise<Result<{ leadId: string; eventId: string }>>;
  book(raw: unknown, meta: RequestMeta): Promise<Result<BookOutcome>>;
  getManaged(token: string): Promise<{ booking: Booking; lead: Lead; canCancel: boolean; canReschedule: boolean } | null>;
  cancel(token: string): Promise<Result<{ status: 'cancelled' }>>;
  reschedule(token: string, raw: unknown): Promise<Result<{ status: BookingStatus; start: string; end: string }>>;
}

const DAY = 86_400_000;
/** 16 random bytes as 22 URL-safe characters: the lead's public id. */
const randomId = () => randomBytes(16).toString('base64url');
const notBuilt = (name: string) => async (): Promise<never> => { throw new Error(`${name} is not implemented yet`); };

export function createBookingService(d: ServiceDeps): BookingService {
  const leadSchema = leadInputSchema(d.volumeOptions);

  return {
    async getSlots() {
      const now = d.clock.now();
      const horizon = new Date(now.getTime() + d.rules.horizonDays * DAY);
      let busy: Interval[] = [];
      let calendarChecked = true;
      try {
        busy = await d.calendar.busy(now.toISOString(), horizon.toISOString());
      } catch (e) {
        if (!(e instanceof CalendarUnavailableError)) throw e;
        calendarChecked = false; // offer the times the rules allow, minus what the database holds
      }
      // A booking that began up to one call ago can still overlap the first slot.
      const from = new Date(now.getTime() - d.rules.slotMinutes * 60_000);
      const held = (await d.store.bookingsStartingBetween(from.toISOString(), horizon.toISOString()))
        .filter((b) => b.status === 'booked' || b.status === 'requested')
        .map(({ start, end }) => ({ start, end }));
      return { slots: generateSlots(d.rules, now, [...busy, ...held]), calendarChecked };
    },

    async createLead(raw, meta) {
      // A bot fills the hidden field: say yes, keep nothing.
      const honeypot = (raw as { website?: unknown } | null)?.website;
      if (typeof honeypot === 'string' && honeypot.trim() !== '') {
        const leadId = randomId();
        return { ok: true, value: { leadId, eventId: `lead.${leadId}` } };
      }

      const input = parseInput(leadSchema, raw);
      if (!input.ok) return { ok: false, error: 'invalid', fields: input.fields };
      const v = input.value;
      if (!(await d.verifyBot(v.turnstileToken, meta.ip))) return { ok: false, error: 'bot_check_failed' };

      const now = d.clock.now();
      const publicId = randomId();
      const eventId = `lead.${publicId}`;
      const fbc = v.fbc ?? (v.attribution.fbclid ? `fb.1.${now.getTime()}.${v.attribution.fbclid}` : undefined);
      const lead = await d.store.createLead({
        publicId, name: v.name, email: v.email, phone: v.phone, buyerType: v.buyerType, volume: v.volume, footageUrl: v.footageUrl,
        pageVersion: v.pageVersion, attribution: v.attribution, fbp: v.fbp, fbc, clientIp: meta.ip, userAgent: meta.userAgent,
      }, now);
      await d.tracker.send({
        name: 'Lead', eventId, time: now, sourceUrl: meta.sourceUrl ?? '', leadId: lead.id,
        user: { email: v.email, phone: v.phone, externalId: publicId, ip: meta.ip, userAgent: meta.userAgent, fbp: v.fbp, fbc },
      });
      return { ok: true, value: { leadId: publicId, eventId } };
    },

    book: notBuilt('book'),
    getManaged: notBuilt('getManaged'),
    cancel: notBuilt('cancel'),
    reschedule: notBuilt('reschedule'),
  };
}
