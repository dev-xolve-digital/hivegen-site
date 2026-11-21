import { bookingEmailKinds, emailSender, logFailure } from './booking/emails';
import { isActive } from './booking/status';
import type { Clock, Notifier, Store, TrackingRecord } from './booking/types';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** A booking's (or an inquiry's) first emails are retried only once it is this old: before that the request may still be sending them. */
const EMAIL_RETRY_AFTER = 2 * MIN;
/** Only bookings and inquiries from this long ago are looked at for unsent first emails; older ones are let go. */
const EMAIL_RETRY_WINDOW = 2 * DAY;
/** A lead gets the "no time picked" email to Hassan once it has been waiting this long. */
const NEW_LEAD_AFTER = 30 * MIN;
/** Leads older than this are no longer announced. */
const NEW_LEAD_WINDOW = 7 * DAY;
/** A failed tracking event is sent again until it has had this many attempts; then it is skipped for good. */
const MAX_TRACKING_ATTEMPTS = 3;
/** One pass sends at most this many events again, so a Meta that stalls (5 s each) cannot hold a pass up for long. The rest wait for the next. */
const MAX_TRACKING_RETRIES_PER_PASS = 20;

/** What one pass did. Every number counts what went through; a send that failed is in the log and is tried again next pass. */
export interface ScheduledSummary { reminders24h: number; reminders1h: number; newLeadEmails: number; emailRetries: number; trackingRetries: number }

export interface ScheduledDeps {
  store: Store;
  notifier: Notifier;
  /** Sends a failed tracking event again; true when it went through. It only sends: the pass records the attempt. */
  retryTracking(r: TrackingRecord): Promise<boolean>;
  clock: Clock;
}

/**
 * One pass of the scheduled work. Hostinger's cron job starts it every 5 minutes (POST /api/cron/run), so every task is idempotent:
 * a timestamp on the row marks it done, and it is set only after the email went out. Each email is on its own and best-effort:
 * one that fails is logged, leaves its timestamp unset so the next pass tries again, and does not stop the rest.
 * A failure of the store itself is thrown.
 */
export async function runScheduledWork(d: ScheduledDeps): Promise<ScheduledSummary> {
  const now = d.clock.now();
  const at = now.getTime();
  const iso = (ms: number) => new Date(ms).toISOString();

  const trySend = emailSender(d.notifier, 'cron');

  const summary: ScheduledSummary = { reminders24h: 0, reminders1h: 0, newLeadEmails: 0, emailRetries: 0, trackingRetries: 0 };

  // The first emails of a booking that `book()` could not send (the mailbox was down, or the server stopped half way). They go first,
  // so a visitor gets the confirmation before any reminder.
  for (const b of await d.store.bookingsCreatedSince(iso(at - EMAIL_RETRY_WINDOW))) {
    if (!isActive(b.status)) continue;
    if (at - b.createdAt.getTime() < EMAIL_RETRY_AFTER) continue;
    if (b.visitorNotifiedAt && b.hassanNotifiedAt) continue;
    const lead = await d.store.getLead(b.leadId);
    if (!lead) continue;
    const [toVisitor, toHassan] = bookingEmailKinds(b.status); // the same ones `book()` sends first
    if (!b.visitorNotifiedAt && await trySend(toVisitor, { lead, booking: b })) {
      await d.store.updateBooking(b.id, { visitorNotifiedAt: now }, now);
      summary.emailRetries += 1;
    }
    if (!b.hassanNotifiedAt && await trySend(toHassan, { lead, booking: b })) {
      await d.store.updateBooking(b.id, { hassanNotifiedAt: now }, now);
      summary.emailRetries += 1;
    }
  }

  // The same for an inquiry ("Send details"): the email to Hassan and the one to the visitor that `sendInquiry()` could not send. Each is
  // sent only if its mark is unset, and marked once it went out. Hassan's goes first, as in `sendInquiry()`.
  for (const lead of await d.store.leadsCreatedBetween(iso(at - EMAIL_RETRY_WINDOW), iso(at - EMAIL_RETRY_AFTER + 1))) {
    if (lead.status !== 'inquiry' || (lead.hassanNotifiedAt && lead.visitorNotifiedAt)) continue;
    if (lead.createdAt.getTime() > at - EMAIL_RETRY_AFTER || lead.createdAt.getTime() < at - EMAIL_RETRY_WINDOW) continue;
    if (!lead.hassanNotifiedAt && await trySend('hassan-new-inquiry', { lead })) {
      await d.store.updateLead(lead.id, { hassanNotifiedAt: now }, now);
      summary.emailRetries += 1;
    }
    if (!lead.visitorNotifiedAt && await trySend('inquiry-received', { lead })) {
      await d.store.updateLead(lead.id, { visitorNotifiedAt: now }, now);
      summary.emailRetries += 1;
    }
  }

  // Reminders, for booked calls only (a requested call is not confirmed yet, a cancelled one is off). The 24-hour one is for a call
  // booked at least 24 hours ahead and is dropped once the call is under an hour away, when the 1-hour one takes over.
  // Asking up to a day ahead covers both windows; the exact edges are checked below.
  for (const b of await d.store.bookingsStartingBetween(iso(at), iso(at + DAY + 1))) {
    if (b.status !== 'booked') continue;
    const start = Date.parse(b.start);
    const due24h = at >= start - DAY && at < start - HOUR && b.createdAt.getTime() <= start - DAY && !b.reminder24hSentAt;
    const due1h = at >= start - HOUR && at < start && !b.reminder1hSentAt;
    if (!due24h && !due1h) continue;
    const lead = await d.store.getLead(b.leadId);
    if (!lead) continue;
    if (due24h && await trySend('reminder-24h', { lead, booking: b })) {
      await d.store.updateBooking(b.id, { reminder24hSentAt: now }, now);
      summary.reminders24h += 1;
    } else if (due1h && await trySend('reminder-1h', { lead, booking: b })) {
      await d.store.updateBooking(b.id, { reminder1hSentAt: now }, now);
      summary.reminders1h += 1;
    }
  }

  // A lead that filled in the form but picked no time: Hassan hears of it once, after 30 minutes. A lead who booked no longer has the
  // status "started"; the active-booking check covers the moment inside `book()`, when the booking is saved and the lead is not yet updated.
  // A visitor who also sent the "Send details" form (an inquiry with the same address, made up to 7 days before or after the lead, in this
  // tab or another) is already known to Hassan by an email of its own: no "no time picked" email, and the lead is marked so it is not looked at again.
  let inquiryTimes: Map<string, number[]> | undefined;
  const inquiriesOf = async (email: string): Promise<number[]> => {
    if (!inquiryTimes) {
      inquiryTimes = new Map();
      // A lead looked at here is at most 7 days old, and an inquiry counts up to 7 days before it: so 14 days back is enough.
      for (const l of await d.store.leadsCreatedBetween(iso(at - 2 * NEW_LEAD_WINDOW), iso(at + 1))) {
        if (l.status !== 'inquiry') continue;
        const key = l.email.toLowerCase();
        inquiryTimes.set(key, [...(inquiryTimes.get(key) ?? []), l.createdAt.getTime()]);
      }
    }
    return inquiryTimes.get(email.toLowerCase()) ?? [];
  };
  for (const lead of await d.store.leadsCreatedBetween(iso(at - NEW_LEAD_WINDOW), iso(at - NEW_LEAD_AFTER + 1))) {
    if (lead.status !== 'started' || lead.newLeadNotifiedAt) continue;
    if (lead.createdAt.getTime() > at - NEW_LEAD_AFTER || lead.createdAt.getTime() < at - NEW_LEAD_WINDOW) continue;
    if (await d.store.getActiveBookingForLead(lead.id)) continue;
    if ((await inquiriesOf(lead.email)).some((made) => Math.abs(made - lead.createdAt.getTime()) <= NEW_LEAD_WINDOW)) {
      await d.store.updateLead(lead.id, { newLeadNotifiedAt: now }, now);
      continue;
    }
    if (await trySend('hassan-new-lead', { lead })) {
      await d.store.updateLead(lead.id, { newLeadNotifiedAt: now }, now);
      summary.newLeadEmails += 1;
    }
  }

  // Tracking events that failed are sent again, up to MAX_TRACKING_RETRIES_PER_PASS a pass, until they have had their attempts; the pass
  // records each attempt. An event whose last attempt fails is skipped: it leaves the failed list for good, so it is never read again.
  let tried = 0;
  for (const r of await d.store.trackingEventsByStatus('failed')) {
    if (r.attempts >= MAX_TRACKING_ATTEMPTS) continue;
    if (tried >= MAX_TRACKING_RETRIES_PER_PASS) break;
    tried += 1;
    let sent = false;
    try {
      sent = await d.retryTracking(r);
    } catch (e) {
      logFailure('cron', 'tracking event not sent again', e);
    }
    const attempts = r.attempts + 1;
    const status = sent ? 'sent' : attempts >= MAX_TRACKING_ATTEMPTS ? 'skipped' : undefined; // undefined: still failed, tried again next pass
    await d.store.updateTrackingEvent(r.eventId, status ? { status, attempts } : { attempts }, now);
    if (sent) summary.trackingRetries += 1;
  }

  return summary;
}
