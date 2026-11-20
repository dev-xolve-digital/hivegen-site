import { randomBytes } from 'node:crypto';
import type { TurnstileAction } from '../../lib/booking/api-client';
import type { BookingRules } from '../../lib/content/schemas';
import { generateSlots } from '../../lib/booking/slots';
import { bookingEmailKinds, emailSender, logFailure } from './emails';
import { manageUrl } from './links';
import { isActive, type ActiveStatus } from './status';
import { bookingInputSchema, inquiryInputSchema, leadInputSchema, parseInput, rescheduleInputSchema } from './validate';
import {
  CalendarUnavailableError, DuplicateRequestError, SlotConflictError,
  type Attribution, type Booking, type BookingPatch, type BookingStatus, type Calendar, type CalendarEventInput, type Clock, type EmailData,
  type Interval, type Lead, type Notifier, type Result, type Slot, type Store, type Tracker,
} from './types';

export interface ServiceDeps {
  store: Store; calendar: Calendar; notifier: Notifier; tracker: Tracker; clock: Clock; rules: BookingRules;
  siteUrl: string;
  /** The calendar invite's title and description from booking.yaml, with {name} and {manageUrl} still in them. */
  calendarCopy: { title: string; description: string };
  /** The "videos per month" choices from booking.yaml. */
  volumeOptions: string[];
  /** The "what do you need" choices of the "Send details" form, from booking.yaml. */
  needOptions: string[];
  /** Whether the bot check's token is real and was made for `action`: each form has its own. */
  verifyBot(token: string, ip: string | undefined, action: TurnstileAction): Promise<boolean>;
}

export type BookOutcome = { status: 'booked' | 'requested'; start: string; end: string; meetUrl?: string; manageUrl: string; eventId: string };
type RequestMeta = { ip?: string; userAgent?: string; sourceUrl?: string };

export interface BookingService {
  getSlots(): Promise<{ slots: Slot[]; calendarChecked: boolean }>;
  createLead(raw: unknown, meta: RequestMeta): Promise<Result<{ leadId: string; eventId: string }>>;
  /** The "Send details" form: one inquiry per `requestId` (a repeat gets the first one's answer), Hassan and the visitor emailed. */
  sendInquiry(raw: unknown, meta: RequestMeta): Promise<Result<{ status: 'received'; eventId: string }>>;
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
/** The id of a lead's `Lead` tracking event. The browser is given it too, so Meta can tell the two reports are one. */
const leadEventId = (publicId: string) => `lead.${publicId}`;
const withoutUndefined = (o: Record<string, string | undefined>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Record<string, string>;

export function createBookingService(d: ServiceDeps): BookingService {
  const leadSchema = leadInputSchema(d.volumeOptions);
  const inquirySchema = inquiryInputSchema(d.volumeOptions, d.needOptions);
  const manageUrlFor = (token: string) => manageUrl(d.siteUrl, token);
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
      logFailure('booking', 'calendar unavailable', e);
      return 'unavailable';
    }
  };

  /** Sends one email. A failure is logged and reported as `false`; it never reaches the visitor. */
  const trySend = emailSender(d.notifier, 'booking');

  /** The Facebook click id as the `fbc` cookie value, when the visitor sent no cookie but arrived from an ad. */
  const fbcFor = (fbc: string | undefined, attribution: Attribution, now: Date) =>
    fbc ?? (attribution.fbclid ? `fb.1.${now.getTime()}.${attribution.fbclid}` : undefined);

  /** The answer to a send of the "Send details" form, as the inquiry lead has it stored. */
  const receivedFor = (lead: Lead): Result<{ status: 'received'; eventId: string }> =>
    ({ ok: true, value: { status: 'received', eventId: leadEventId(lead.publicId) } });

  /** The call-flow lead with this public id, when it is still waiting for a time to be picked: started, with no active booking. */
  const waitingLead = async (publicId: string | undefined): Promise<Lead | null> => {
    const lead = publicId ? await d.store.getLeadByPublicId(publicId) : null;
    return lead?.status === 'started' && !(await d.store.getActiveBookingForLead(lead.id)) ? lead : null;
  };

  /** The calendar event: the guest sees the title and description, so personal details go in `privateProps` only. */
  const eventFor = (lead: Lead, b: Booking): CalendarEventInput => {
    const values = { name: lead.name ?? '', manageUrl: manageUrlFor(b.manageToken) };
    return {
      start: b.start, end: b.end, summary: fillCopy(d.calendarCopy.title, values), description: fillCopy(d.calendarCopy.description, values),
      attendee: { email: lead.email, name: lead.name ?? '' },
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
        return { ok: true, value: { leadId, eventId: leadEventId(leadId) } };
      }

      const input = parseInput(leadSchema, raw);
      if (!input.ok) return { ok: false, error: 'invalid', fields: input.fields };
      const v = input.value;
      if (!(await d.verifyBot(v.turnstileToken, meta.ip, 'booking'))) return { ok: false, error: 'bot_check_failed' };

      const now = d.clock.now();
      const publicId = randomId();
      const eventId = leadEventId(publicId);
      const fbc = fbcFor(v.fbc, v.attribution, now);
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

    async sendInquiry(raw, meta) {
      // A bot fills the hidden field: say yes, keep nothing.
      const honeypot = (raw as { website?: unknown } | null)?.website;
      if (typeof honeypot === 'string' && honeypot.trim() !== '') return { ok: true, value: { status: 'received', eventId: leadEventId(randomId()) } };

      const input = parseInput(inquirySchema, raw);
      if (!input.ok) return { ok: false, error: 'invalid', fields: input.fields };
      const v = input.value;

      // The same send again (a double click, a retry after a dropped reply) gets the first one's answer, before the bot check:
      // its token has been used already. Nothing is stored or sent a second time.
      const already = await d.store.getLeadByRequestId(v.requestId);
      if (already) return receivedFor(already);
      if (!(await d.verifyBot(v.turnstileToken, meta.ip, 'inquiry'))) return { ok: false, error: 'bot_check_failed' };

      const now = d.clock.now();
      const publicId = randomId();
      const fbc = fbcFor(v.fbc, v.attribution, now);
      let lead: Lead;
      try {
        lead = await d.store.createLead({
          publicId, status: 'inquiry', email: v.email, name: v.name, phone: v.phone, buyerType: v.buyerType, volume: v.volume, footageUrl: v.footageUrl,
          needs: v.needs, message: v.message, requestId: v.requestId,
          pageVersion: v.pageVersion, attribution: v.attribution, fbp: v.fbp, fbc, clientIp: meta.ip, userAgent: meta.userAgent,
        }, now);
      } catch (e) {
        if (!(e instanceof DuplicateRequestError)) throw e;
        // Two sends of one request at once: the other one stored it and sends the emails, this one only answers.
        const winner = await d.store.getLeadByRequestId(v.requestId);
        if (!winner) throw e;
        return receivedFor(winner);
      }

      // A visitor who first filled in the call form and then chose "Send details" is one visitor: the earlier lead is marked as told, so
      // Hassan gets no "no time picked" email about them, and it is not counted a second time. A lead that booked, an unknown one or
      // another inquiry changes nothing.
      const waiting = await waitingLead(v.leadId);
      if (waiting) {
        await d.store.updateLead(waiting.id, { newLeadNotifiedAt: now }, now);
      } else {
        await d.tracker.send({
          name: 'Lead', eventId: leadEventId(publicId), time: now, sourceUrl: meta.sourceUrl ?? '', leadId: lead.id,
          user: { email: v.email, phone: v.phone, externalId: publicId, ip: meta.ip, userAgent: meta.userAgent, fbp: v.fbp, fbc },
        });
      }

      // Each email on its own: one that fails stays unmarked, and cron sends it again.
      const hassanSent = await trySend('hassan-new-inquiry', { lead });
      const visitorSent = await trySend('inquiry-received', { lead });
      const sentAt = d.clock.now();
      if (hassanSent || visitorSent) {
        await d.store.updateLead(lead.id, { ...(hassanSent && { hassanNotifiedAt: sentAt }), ...(visitorSent && { visitorNotifiedAt: sentAt }) }, sentAt);
      }
      return receivedFor(lead);
    },

    async book(raw, meta) {
      const input = parseInput(bookingInputSchema, raw);
      if (!input.ok) return { ok: false, error: 'invalid', fields: input.fields };
      const { leadId, start, visitorTz } = input.value;
      const lead = await d.store.getLeadByPublicId(leadId);
      if (!lead || lead.status === 'inquiry') return { ok: false, error: 'not_found' }; // an inquiry has no call to book

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
          logFailure('booking', 'calendar event not created', e);
        }
      }
      if (event) booking = await d.store.updateBooking(booking.id, { status: 'booked', googleEventId: event.eventId, meetUrl: event.meetUrl }, now);
      await d.store.updateLead(lead.id, { status: booking.status }, now);

      // Each email on its own: one that fails stays unmarked, and cron sends it again.
      const [toVisitor, toHassan] = bookingEmailKinds(booking.status as ActiveStatus); // saved as requested, and booked only with an event
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
          logFailure('booking', 'calendar event not cancelled', e);
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

      // Reserve the new time first (the store refuses a start someone else holds), then move the event. The reminders start over; but a call
      // moved to under 24 hours away has missed its 24-hour reminder (cron would send it at once, though the booking itself is older),
      // so that one is marked as done instead of cleared.
      const tooSoonFor24h = Date.parse(slot.start) - now.getTime() < DAY;
      let moved: Booking;
      try {
        moved = await d.store.updateBooking(booking.id, { start: slot.start, end: slot.end, reminder24hSentAt: tooSoonFor24h ? now : null, reminder1hSentAt: null }, now);
      } catch (e) {
        if (e instanceof SlotConflictError) return { ok: false, error: 'slot_taken' };
        throw e;
      }
      if (booking.googleEventId) {
        try {
          await d.calendar.moveEvent(booking.googleEventId, slot.start, slot.end);
        } catch (e) {
          logFailure('booking', 'calendar event not moved', e);
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
