import { randomBytes } from 'node:crypto';
import type { BookingRules } from '../../lib/content/schemas';
import { generateSlots } from '../../lib/booking/slots';
import { isActive, type ActiveStatus } from './status';
import { bookingInputSchema, leadInputSchema, parseInput, rescheduleInputSchema } from './validate';
import {
  CalendarUnavailableError, SlotConflictError,
  type Booking, type BookingPatch, type BookingStatus, type Calendar, type CalendarEventInput, type Clock, type EmailData, type EmailKind,
  type Interval, type Lead, type Notifier, type Result, type Slot, type Store, type Tracker,
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

const MIN = 60_000;
const DAY = 86_400_000;
/** 16 random bytes as 22 URL-safe characters: the lead's public id. */
const randomId = () => randomBytes(16).toString('base64url');
/** 32 random bytes as 43 URL-safe characters: the secret in a booking's manage link. */
const randomToken = () => randomBytes(32).toString('base64url');
const overlaps = (a: Interval, b: Interval) => Date.parse(a.start) < Date.parse(b.end) && Date.parse(a.end) > Date.parse(b.start);
/** Copy with {name} and {manageUrl} filled in as plain text, in one pass so a value is never read as a placeholder. */
const fillCopy = (text: string, values: { name: string; manageUrl: string }) =>
  text.replace(/\{(name|manageUrl)\}/g, (_, key: 'name' | 'manageUrl') => values[key]);
const withoutUndefined = (o: Record<string, string | undefined>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Record<string, string>;
/** One short line for the server log. It names what failed and the kind of error, never anything about the visitor. */
const logFailure = (what: string, e: unknown) => console.warn(`booking: ${what} (${e instanceof Error ? e.name : 'unknown error'})`);

export function createBookingService(d: ServiceDeps): BookingService {
  const leadSchema = leadInputSchema(d.volumeOptions);
  const siteBase = d.siteUrl.replace(/\/$/, '');
  const manageUrlFor = (token: string) => `${siteBase}/booking/${token}`;
  const scheduleEventId = (lead: Lead) => `schedule.${lead.publicId}`;
  const outcomeOf = (lead: Lead, b: Booking): BookOutcome => ({
    status: b.status as ActiveStatus, // only an active booking is ever turned into an outcome
    start: b.start, end: b.end, meetUrl: b.meetUrl, manageUrl: manageUrlFor(b.manageToken), eventId: scheduleEventId(lead),
  });

  const canCancel = (b: Booking, now: Date) => b.status !== 'cancelled' && now.getTime() < Date.parse(b.start);
  const canReschedule = (b: Booking, now: Date) => b.status === 'booked' && now.getTime() <= Date.parse(b.start) - d.rules.minNoticeMinutes * MIN;

  /** The booking behind a manage link, with its lead. */
  const findManaged = async (token: string) => {
    const booking = await d.store.getBookingByToken(token);
    const lead = booking ? await d.store.getLead(booking.leadId) : null;
    return booking && lead ? { booking, lead } : null;
  };

  /** What active bookings hold in the database, for the part of the calendar that offered slots can reach. */
  const heldIntervals = async (now: Date): Promise<Interval[]> => {
    const horizon = new Date(now.getTime() + d.rules.horizonDays * DAY);
    // No slot starts before now + minNoticeMinutes, and a booking reaches a slot only if it starts less than one call length before it.
    const from = new Date(now.getTime() + (d.rules.minNoticeMinutes - d.rules.slotMinutes) * MIN);
    const rows = await d.store.bookingsStartingBetween(from.toISOString(), horizon.toISOString());
    return rows.filter((b) => isActive(b.status)).map(({ start, end }) => ({ start, end }));
  };
  /** The offered slot that starts at `start`: allowed by the rules and not held by an active booking. Google is asked separately. */
  const offeredSlot = async (now: Date, start: string): Promise<Slot | undefined> =>
    generateSlots(d.rules, now, await heldIntervals(now)).find((s) => s.start === start);
  /** Asks Google whether the slot is still free right now. */
  const checkCalendar = async (slot: Slot): Promise<'free' | 'busy' | 'unavailable'> => {
    try {
      return (await d.calendar.busy(slot.start, slot.end)).some((b) => overlaps(b, slot)) ? 'busy' : 'free';
    } catch (e) {
      if (!(e instanceof CalendarUnavailableError)) throw e;
      logFailure('calendar unavailable', e);
      return 'unavailable';
    }
  };

  /** Sends one email. A failure is logged and reported as `false`; it never reaches the visitor. */
  const trySend = async (kind: EmailKind, data: EmailData): Promise<boolean> => {
    try {
      await d.notifier.send(kind, data);
      return true;
    } catch (e) {
      logFailure(`email ${kind} not sent`, e);
      return false;
    }
  };

  /** The calendar event: the guest sees the title and description, so personal details go in `privateProps` only. */
  const eventFor = (lead: Lead, b: Booking): CalendarEventInput => {
    const values = { name: lead.name, manageUrl: manageUrlFor(b.manageToken) };
    return {
      start: b.start, end: b.end, summary: fillCopy(d.calendarCopy.title, values), description: fillCopy(d.calendarCopy.description, values),
      attendee: { email: lead.email, name: lead.name },
      privateProps: withoutUndefined({
        leadId: lead.publicId, phone: lead.phone, volume: lead.volume, footageUrl: lead.footageUrl, pageVersion: lead.pageVersion,
        utm_source: lead.attribution.utm_source, utm_campaign: lead.attribution.utm_campaign,
      }),
    };
  };

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
      return { slots: generateSlots(d.rules, now, [...busy, ...(await heldIntervals(now))]), calendarChecked };
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

    async book(raw, meta) {
      const input = parseInput(bookingInputSchema, raw);
      if (!input.ok) return { ok: false, error: 'invalid', fields: input.fields };
      const { leadId, start, visitorTz } = input.value;
      const lead = await d.store.getLeadByPublicId(leadId);
      if (!lead) return { ok: false, error: 'not_found' };

      // Confirming twice (a double click, a retry after a dropped reply) gives back the booking the lead already has.
      const existing = await d.store.getActiveBookingForLead(lead.id);
      if (existing) return { ok: true, value: outcomeOf(lead, existing) };

      const now = d.clock.now();
      const slot = await offeredSlot(now, start);
      if (!slot) return { ok: false, error: 'slot_taken' };
      const calendar = await checkCalendar(slot);
      if (calendar === 'busy') return { ok: false, error: 'slot_taken' };

      // The booking is saved as "requested", which holds the slot just the same; the store's unique start is the final guard when
      // two visitors confirm one slot at once. A confirm from this same lead that lost the race gets the booking the winner saved.
      let booking: Booking;
      try {
        booking = await d.store.insertBooking({ leadId: lead.id, start: slot.start, end: slot.end, visitorTz, status: 'requested', manageToken: randomToken() }, now);
      } catch (e) {
        if (!(e instanceof SlotConflictError)) throw e;
        const mine = await d.store.getActiveBookingForLead(lead.id);
        return mine ? { ok: true, value: outcomeOf(lead, mine) } : { ok: false, error: 'slot_taken' };
      }

      // Only an event that Google has made turns it into "booked". Without one (Google down, or the event failed) it stays "requested"
      // and Hassan confirms it by hand; the visitor keeps the slot either way.
      let event: Awaited<ReturnType<Calendar['createEvent']>> | undefined;
      if (calendar === 'free') {
        try {
          event = await d.calendar.createEvent(eventFor(lead, booking));
        } catch (e) {
          logFailure('calendar event not created', e);
        }
      }
      if (event) booking = await d.store.updateBooking(booking.id, { status: 'booked', googleEventId: event.eventId, meetUrl: event.meetUrl }, now);
      await d.store.updateLead(lead.id, { status: booking.status }, now);

      // Each email on its own: one that fails stays unmarked, and cron sends it again.
      const [toVisitor, toHassan]: [EmailKind, EmailKind] = booking.status === 'booked'
        ? ['booking-confirmed', 'hassan-new-booking'] : ['booking-requested', 'hassan-confirm-by-hand'];
      const visitorSent = await trySend(toVisitor, { lead, booking });
      const hassanSent = await trySend(toHassan, { lead, booking });
      const sentAt = d.clock.now();
      const marks: BookingPatch = { ...(visitorSent && { visitorNotifiedAt: sentAt }), ...(hassanSent && { hassanNotifiedAt: sentAt }) };
      if (visitorSent || hassanSent) await d.store.updateBooking(booking.id, marks, sentAt);

      await d.tracker.send({
        name: 'Schedule', eventId: scheduleEventId(lead), time: now, sourceUrl: meta.sourceUrl ?? '', leadId: lead.id,
        user: {
          email: lead.email, phone: lead.phone, externalId: lead.publicId, ip: meta.ip ?? lead.clientIp,
          userAgent: meta.userAgent ?? lead.userAgent, fbp: lead.fbp, fbc: lead.fbc,
        },
      });
      return { ok: true, value: outcomeOf(lead, booking) };
    },

    async getManaged(token) {
      const found = await findManaged(token);
      if (!found) return null;
      const now = d.clock.now();
      return { ...found, canCancel: canCancel(found.booking, now), canReschedule: canReschedule(found.booking, now) };
    },

    async cancel(token) {
      const found = await findManaged(token);
      if (!found) return { ok: false, error: 'not_found' };
      const { booking, lead } = found;
      if (booking.status === 'cancelled') return { ok: true, value: { status: 'cancelled' } };
      const now = d.clock.now();
      if (!canCancel(booking, now)) return { ok: false, error: 'too_late' };

      // A requested booking has no event. When Google refuses, nothing changes and the visitor can try again.
      if (booking.googleEventId) {
        try {
          await d.calendar.cancelEvent(booking.googleEventId);
        } catch (e) {
          logFailure('calendar event not cancelled', e);
          return { ok: false, error: 'server_error' };
        }
      }
      const cancelled = await d.store.updateBooking(booking.id, { status: 'cancelled' }, now); // frees the slot
      await d.store.updateLead(lead.id, { status: 'cancelled' }, now);
      const data: EmailData = { lead, booking: cancelled, change: 'cancelled' };
      await trySend('booking-cancelled', data);
      await trySend('hassan-booking-changed', data);
      return { ok: true, value: { status: 'cancelled' } };
    },

    async reschedule(token, raw) {
      const input = parseInput(rescheduleInputSchema, raw);
      if (!input.ok) return { ok: false, error: 'invalid', fields: input.fields };
      const found = await findManaged(token);
      if (!found) return { ok: false, error: 'not_found' };
      const { booking, lead } = found;
      const now = d.clock.now();
      if (!canReschedule(booking, now)) return { ok: false, error: 'too_late' };

      const slot = await offeredSlot(now, input.value.start);
      if (!slot) return { ok: false, error: 'slot_taken' };
      const calendar = await checkCalendar(slot);
      if (calendar === 'busy') return { ok: false, error: 'slot_taken' };
      if (calendar === 'unavailable') return { ok: false, error: 'server_error' };

      // Reserve the new time first (the store refuses a start someone else holds), then move the event.
      let moved: Booking;
      try {
        moved = await d.store.updateBooking(booking.id, { start: slot.start, end: slot.end, reminder24hSentAt: null, reminder1hSentAt: null }, now);
      } catch (e) {
        if (e instanceof SlotConflictError) return { ok: false, error: 'slot_taken' };
        throw e;
      }
      if (booking.googleEventId) {
        try {
          await d.calendar.moveEvent(booking.googleEventId, slot.start, slot.end);
        } catch (e) {
          logFailure('calendar event not moved', e);
          await d.store.updateBooking(booking.id, {
            start: booking.start, end: booking.end, reminder24hSentAt: booking.reminder24hSentAt ?? null, reminder1hSentAt: booking.reminder1hSentAt ?? null,
          }, now);
          return { ok: false, error: 'server_error' };
        }
      }
      const data: EmailData = { lead, booking: moved, previousStart: booking.start };
      await trySend('booking-rescheduled', data);
      await trySend('hassan-booking-changed', { ...data, change: 'rescheduled' });
      return { ok: true, value: { status: moved.status, start: moved.start, end: moved.end } };
    },
  };
}
