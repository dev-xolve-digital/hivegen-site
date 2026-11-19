import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type {
  Booking, BookingStatus, EmailData, EmailKind, Lead, LeadStatus, NewLead, Notifier, TrackingRecord,
} from '../../src/server/booking/types';
import { readServerConfig } from '../../src/server/config';
import { createContext, type ServerContext } from '../../src/server/context';
import { runScheduledWork } from '../../src/server/cron';
import { cronHandler, withContext } from '../../src/server/http/handlers';
import { createMemoryStore } from '../../src/server/store/memory';
import { NOW, good, withLead } from './helpers/booking';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const START = '2026-12-03T14:00:00.000Z'; // a call, in UTC
const after = (at: string | Date, ms: number) => new Date((typeof at === 'string' ? Date.parse(at) : at.getTime()) + ms);
const before = (at: string | Date, ms: number) => after(at, -ms);

/** A transport failure whose message holds what the visitor typed: none of it may reach the log. */
class TransportError extends Error {
  constructor(message: string) { super(message); this.name = 'TransportError'; }
}

let warn: MockInstance;
beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

type Side = 'visitor' | 'hassan';

/** A memory store, a notifier that records every send (and fails for the kinds in `failing`), a clock the test moves, and a tracking retry. */
function world() {
  const store = createMemoryStore();
  /** Emails that went out. */
  const sent: Array<{ kind: EmailKind; data: EmailData }> = [];
  /** Every email cron tried, the failed ones too. */
  const tried: Array<{ kind: EmailKind; bookingId?: number }> = [];
  const failing = new Set<EmailKind>();
  const notifier: Notifier = {
    send: async (kind, data) => {
      tried.push({ kind, bookingId: data.booking?.id });
      if (failing.has(kind)) throw new TransportError(`550 mailbox ${data.lead.email} refused ${data.lead.name}`);
      sent.push({ kind, data });
    },
  };
  let current = NOW;
  const clock = { now: () => current };
  const retried: TrackingRecord[] = [];
  /** What the tracking retry answers per event id: true = sent, false = failed again, an Error = it threw. Default false. */
  const retryOutcome = new Map<string, boolean | Error>();
  const retryTracking = async (r: TrackingRecord) => {
    retried.push(r);
    const outcome = retryOutcome.get(r.eventId) ?? false;
    if (outcome instanceof Error) throw outcome;
    return outcome;
  };

  let n = 0;
  /** A lead saved at `createdAt`; `status` is what the lead row says. */
  async function lead(createdAt: Date, status: LeadStatus = 'started'): Promise<Lead> {
    n += 1;
    const input: NewLead = { publicId: `lead-${n}`, name: 'Zoë O’Brien', email: `zoe+${n}@example.com`, buyerType: 'agent', volume: '6–15', pageVersion: 'agents', attribution: {} };
    const l = await store.createLead(input, createdAt);
    if (status !== 'started') await store.updateLead(l.id, { status }, createdAt);
    return (await store.getLead(l.id))!;
  }
  /**
   * A lead with a booking at `start`, both made at `createdAt`. Both first emails count as sent unless listed in `unsent`.
   * `reminders` are the reminder marks. `leadStatus` is what the lead row says (default: the booking's status).
   */
  async function booking(start: string, createdAt: Date, o: {
    status?: BookingStatus; leadStatus?: LeadStatus; unsent?: Side[]; reminders?: { reminder24hSentAt?: Date; reminder1hSentAt?: Date };
  } = {}): Promise<Booking> {
    const status = o.status ?? 'booked';
    const l = await lead(createdAt, o.leadStatus ?? status);
    const b = await store.insertBooking({ leadId: l.id, start, end: after(start, 15 * MIN).toISOString(), visitorTz: 'America/New_York', status, manageToken: `token-${l.id}` }, createdAt);
    const unsent = o.unsent ?? [];
    return store.updateBooking(b.id, {
      ...(unsent.includes('visitor') ? {} : { visitorNotifiedAt: NOW }),
      ...(unsent.includes('hassan') ? {} : { hassanNotifiedAt: NOW }),
      ...o.reminders,
    }, createdAt);
  }
  const row = async (id: number) => (await store.bookingsStartingBetween('2000-01-01T00:00:00Z', '2100-01-01T00:00:00Z')).find((b) => b.id === id)!;
  /** One pass of cron at `at`. */
  const run = (at: Date) => {
    current = at;
    return runScheduledWork({ store, notifier, retryTracking, clock });
  };
  const kinds = () => sent.map((s) => s.kind);
  const track = (eventId: string, attempts: number, status: TrackingRecord['status'] = 'failed') =>
    store.recordTrackingEvent({ eventId, name: 'Lead', payload: {}, status, attempts }, NOW);
  return { store, sent, tried, failing, retried, retryOutcome, lead, booking, row, run, kinds, track };
}

const quiet = { reminders24h: 0, reminders1h: 0, newLeadEmails: 0, emailRetries: 0, trackingRetries: 0 };

describe('the 24-hour reminder', () => {
  it('sends the 24-hour reminder once, and none for a call booked less than 24 hours ahead', async () => {
    const w = world();
    const early = await w.booking(START, before(START, 3 * DAY));
    const lateStart = after(START, 15 * MIN).toISOString();
    const late = await w.booking(lateStart, before(lateStart, 23 * HOUR)); // booked 23 hours ahead

    // One millisecond before the window opens: nothing.
    expect(await w.run(before(START, 24 * HOUR + 1))).toEqual(quiet);
    expect(w.sent).toEqual([]);

    // The window opens: the early booking gets its reminder.
    const at = before(START, 24 * HOUR);
    expect(await w.run(at)).toEqual({ ...quiet, reminders24h: 1 });
    expect(w.sent).toHaveLength(1);
    expect(w.sent[0].kind).toBe('reminder-24h');
    expect(w.sent[0].data.booking).toMatchObject({ id: early.id, start: START });
    expect(w.sent[0].data.lead).toMatchObject({ id: early.leadId, email: expect.stringContaining('@example.com') });
    expect((await w.row(early.id)).reminder24hSentAt).toEqual(at);

    // Later passes send nothing more: not for the early one (done), not for the late one (its window is open from 24 hours before
    // its start, but it was booked only 23 hours ahead).
    expect(await w.run(after(at, 5 * MIN))).toEqual(quiet);
    expect(await w.run(before(lateStart, 90 * MIN))).toEqual(quiet);
    expect(w.kinds()).toEqual(['reminder-24h']);
    expect((await w.row(late.id)).reminder24hSentAt).toBeUndefined();
  });

  it('counts a call booked exactly 24 hours ahead, but not one booked a moment later', async () => {
    const w = world();
    const exactly = await w.booking(START, before(START, 24 * HOUR));
    const lateStart = after(START, 15 * MIN);
    const justShort = await w.booking(lateStart.toISOString(), before(lateStart, 24 * HOUR - 1));
    await w.run(before(START, 24 * HOUR - 16 * MIN)); // both are inside their 24-hour windows
    expect(w.sent.map((s) => s.data.booking?.id)).toEqual([exactly.id]);
    expect((await w.row(justShort.id)).reminder24hSentAt).toBeUndefined();
  });

  it('leaves the 24-hour reminder out once the call is less than an hour away; the 1-hour one goes instead', async () => {
    const w = world();
    const b = await w.booking(START, before(START, 3 * DAY)); // cron was down for two days
    const at = before(START, HOUR - MIN);
    expect(await w.run(at)).toEqual({ ...quiet, reminders1h: 1 });
    expect(w.kinds()).toEqual(['reminder-1h']);
    const stored = await w.row(b.id);
    expect(stored.reminder24hSentAt).toBeUndefined();
    expect(stored.reminder1hSentAt).toEqual(at);
  });
});

describe('the hand-over from the 24-hour to the 1-hour reminder', () => {
  it('at exactly 60 minutes before, a booking eligible for the 24-hour reminder gets the 1-hour one, not the 24-hour one', async () => {
    const w = world();
    const b = await w.booking(START, before(START, 3 * DAY)); // no reminder sent yet: cron was down
    expect(await w.run(before(START, HOUR))).toEqual({ ...quiet, reminders1h: 1 });
    expect(w.kinds()).toEqual(['reminder-1h']);
    const stored = await w.row(b.id);
    expect(stored.reminder24hSentAt).toBeUndefined();
    expect(stored.reminder1hSentAt).toEqual(before(START, HOUR));
    // And a millisecond earlier it is still the 24-hour one's turn.
    const w2 = world();
    await w2.booking(START, before(START, 3 * DAY));
    expect(await w2.run(before(START, HOUR + 1))).toEqual({ ...quiet, reminders24h: 1 });
    expect(w2.kinds()).toEqual(['reminder-24h']);
  });
});

describe('the 1-hour reminder', () => {
  it('sends the 1-hour reminder once', async () => {
    const w = world();
    const b = await w.booking(START, before(START, 3 * HOUR));

    expect(await w.run(before(START, HOUR + 1))).toEqual(quiet);
    const at = before(START, HOUR); // 60 minutes before: the window opens
    expect(await w.run(at)).toEqual({ ...quiet, reminders1h: 1 });
    expect(w.sent).toHaveLength(1);
    expect(w.sent[0].kind).toBe('reminder-1h');
    expect(w.sent[0].data.booking).toMatchObject({ id: b.id, start: START });
    expect((await w.row(b.id)).reminder1hSentAt).toEqual(at);

    expect(await w.run(after(at, 5 * MIN))).toEqual(quiet);
    expect(await w.run(before(START, MIN))).toEqual(quiet);
    expect(w.kinds()).toEqual(['reminder-1h']);
  });

  it('does not remind about a call that is starting now or has started', async () => {
    const w = world();
    await w.booking(START, before(START, 3 * HOUR));
    expect(await w.run(new Date(START))).toEqual(quiet);
    expect(await w.run(after(START, 5 * MIN))).toEqual(quiet);
    expect(w.sent).toEqual([]);
  });

  it('a rescheduled call is reminded again for its new time', async () => {
    const w = world();
    const b = await w.booking(START, before(START, 3 * HOUR));
    await w.run(before(START, HOUR));
    // Rescheduling moves the start and clears the reminder marks, as the service does.
    const newStart = after(START, 2 * DAY).toISOString();
    await w.store.updateBooking(b.id, { start: newStart, end: after(newStart, 15 * MIN).toISOString(), reminder24hSentAt: null, reminder1hSentAt: null }, before(START, HOUR));
    await w.run(before(newStart, HOUR));
    expect(w.kinds()).toEqual(['reminder-1h', 'reminder-1h']);
  });
});

describe('who gets no reminders', () => {
  it('skips cancelled and requested bookings for reminders', async () => {
    const w = world();
    const now = new Date('2026-12-03T10:00:00.000Z');
    const statuses: BookingStatus[] = ['booked', 'requested', 'cancelled'];
    const made = new Map<string, Booking>();
    // Three bookings in the 24-hour window and three in the 1-hour window, one of each status. All were made well ahead.
    for (const [i, status] of statuses.entries()) {
      made.set(`24h ${status}`, await w.booking(after(now, 23 * HOUR + i * 15 * MIN).toISOString(), before(now, 3 * DAY), { status }));
      made.set(`1h ${status}`, await w.booking(after(now, 30 * MIN + i * 15 * MIN).toISOString(), before(now, 3 * DAY), { status }));
    }

    expect(await w.run(now)).toEqual({ ...quiet, reminders24h: 1, reminders1h: 1 });
    expect(w.sent.map((s) => `${s.kind} ${s.data.booking!.id}`).sort())
      .toEqual([`reminder-1h ${made.get('1h booked')!.id}`, `reminder-24h ${made.get('24h booked')!.id}`].sort());
    for (const status of ['requested', 'cancelled']) {
      expect((await w.row(made.get(`24h ${status}`)!.id)).reminder24hSentAt).toBeUndefined();
      expect((await w.row(made.get(`1h ${status}`)!.id)).reminder1hSentAt).toBeUndefined();
    }
  });
});

describe('the new-lead email', () => {
  it('emails Hassan about a lead without a time after 30 minutes, once, and not if they booked', async () => {
    const w = world();
    const waiting = await w.lead(NOW); // filled in the form, picked no time
    const booked = await w.booking(START, NOW);
    // The moment inside book(): the booking exists, the lead row still says "started".
    const mid = await w.booking(after(START, 15 * MIN).toISOString(), NOW, { status: 'requested', leadStatus: 'started' });
    const cancelled = await w.booking(after(START, 30 * MIN).toISOString(), NOW, { status: 'cancelled' });

    expect(await w.run(after(NOW, 30 * MIN - 1))).toEqual(quiet); // not yet 30 minutes
    expect(w.sent).toEqual([]);

    const at = after(NOW, 30 * MIN);
    expect(await w.run(at)).toEqual({ ...quiet, newLeadEmails: 1 });
    expect(w.sent).toHaveLength(1);
    expect(w.sent[0].kind).toBe('hassan-new-lead');
    expect(w.sent[0].data.lead).toMatchObject({ id: waiting.id });
    expect(w.sent[0].data.booking).toBeUndefined();
    expect((await w.store.getLead(waiting.id))!.newLeadNotifiedAt).toEqual(at);
    for (const other of [booked.leadId, mid.leadId, cancelled.leadId]) expect((await w.store.getLead(other))!.newLeadNotifiedAt).toBeUndefined();

    // Once: later passes do not send it again.
    expect(await w.run(after(at, 5 * MIN))).toEqual(quiet);
    expect(await w.run(after(at, 3 * DAY))).toEqual(quiet);
    expect(w.kinds()).toEqual(['hassan-new-lead']);
  });

  it('only looks at leads from the last 7 days', async () => {
    const w = world();
    const now = new Date('2026-12-10T10:00:00.000Z');
    const exactly = await w.lead(before(now, 7 * DAY));
    const tooOld = await w.lead(before(now, 7 * DAY + 1));
    expect(await w.run(now)).toEqual({ ...quiet, newLeadEmails: 1 });
    expect(w.sent[0].data.lead.id).toBe(exactly.id);
    expect((await w.store.getLead(tooOld.id))!.newLeadNotifiedAt).toBeUndefined();
  });

  it('a failed send leaves the lead for the next pass', async () => {
    const w = world();
    const waiting = await w.lead(NOW);
    w.failing.add('hassan-new-lead');
    expect(await w.run(after(NOW, 30 * MIN))).toEqual(quiet);
    expect((await w.store.getLead(waiting.id))!.newLeadNotifiedAt).toBeUndefined();
    w.failing.clear();
    expect(await w.run(after(NOW, 35 * MIN))).toEqual({ ...quiet, newLeadEmails: 1 });
    expect(w.kinds()).toEqual(['hassan-new-lead']);
  });
});

describe('a rescheduled call', () => {
  const monday = new Date('2026-12-07T14:30:00.000Z'); // 7:30 PM in Pakistan, inside the booking window
  /** A call booked on 1 December for a day in the second week, then moved on `monday`. Gives the service pieces and the new start. */
  async function movedTo(wantedAhead: (ms: number) => boolean) {
    const t = await withLead(); // the clock is at NOW
    const original = t.slots.find((s) => Date.parse(s.start) >= Date.parse('2026-12-10T00:00:00Z'))!;
    const out = await t.svc.book({ leadId: t.leadId, start: original.start, visitorTz: 'America/New_York' }, {});
    if (!out.ok) throw new Error(out.error);
    t.clock.set(monday);
    const target = (await t.svc.getSlots()).slots.find((s) => wantedAhead(Date.parse(s.start) - monday.getTime()))!;
    const moved = await t.svc.reschedule(out.value.manageUrl.split('/').at(-1)!, { start: target.start });
    expect(moved).toMatchObject({ ok: true, value: { start: target.start } });
    t.sent.length = 0; // only what cron sends from here on
    const pass = (at: Date) => {
      t.clock.set(at);
      return runScheduledWork({ store: t.store, notifier: t.deps.notifier, retryTracking: async () => false, clock: t.clock });
    };
    return { t, target: target.start, pass };
  }

  it('moved to about 3 hours ahead: no "24 hours" reminder right after the move, and the 1-hour one still comes on time', async () => {
    const { t, target, pass } = await movedTo((ms) => ms >= 3 * HOUR && ms < 24 * HOUR);
    expect(await pass(after(monday, 5 * MIN))).toEqual(quiet); // the next cron pass
    expect(await pass(after(monday, 10 * MIN))).toEqual(quiet);
    expect(await pass(before(target, 2 * HOUR))).toEqual(quiet);
    expect(t.sent).toEqual([]);
    expect(await pass(before(target, HOUR))).toEqual({ ...quiet, reminders1h: 1 });
    expect(await pass(before(target, 55 * MIN))).toEqual(quiet);
    expect(t.sent).toEqual(['reminder-1h']);
  });

  it('moved to about 2 days ahead: the 24-hour reminder comes at 24 hours before, then the 1-hour one', async () => {
    const { t, target, pass } = await movedTo((ms) => ms >= 40 * HOUR);
    expect(Date.parse(target) - monday.getTime()).toBeLessThan(3 * DAY);
    expect(await pass(after(monday, 5 * MIN))).toEqual(quiet);
    expect(await pass(before(target, 24 * HOUR + 1))).toEqual(quiet);
    expect(await pass(before(target, 24 * HOUR))).toEqual({ ...quiet, reminders24h: 1 });
    expect(await pass(before(target, 23 * HOUR))).toEqual(quiet);
    expect(await pass(before(target, HOUR))).toEqual({ ...quiet, reminders1h: 1 });
    expect(t.sent).toEqual(['reminder-24h', 'reminder-1h']);
  });
});

describe('book() and the retry send the same emails', () => {
  it.each([
    ['booked', false],
    ['requested', true], // Google is down: the booking is only requested
  ])('%s: what cron sends again is what book() tried first', async (status, googleDown) => {
    const tried: EmailKind[] = [];
    const t = await withLead({ notifier: { send: async (kind) => { tried.push(kind); throw new TransportError('mailbox down'); } } });
    t.calendar.setDown(googleDown);
    const out = await t.svc.book({ leadId: t.leadId, start: t.slot.start, visitorTz: 'America/New_York' }, {});
    expect(out.ok && out.value.status).toBe(status);
    expect(tried).toHaveLength(2);

    const again: EmailKind[] = [];
    const summary = await runScheduledWork({
      store: t.store, notifier: { send: async (kind) => { again.push(kind); } }, retryTracking: async () => false, clock: { now: () => after(NOW, 5 * MIN) },
    });
    expect(again).toEqual(tried);
    expect(summary).toEqual({ ...quiet, emailRetries: 2 });
  });

  it('both log a failed email the same way, apart from the area', async () => {
    const w = world();
    await w.booking(START, NOW, { unsent: ['visitor'] });
    w.failing.add('booking-confirmed');
    await w.run(after(NOW, 5 * MIN));
    expect(warn.mock.calls.flat()).toEqual(['cron: email booking-confirmed not sent (TransportError)']);

    warn.mockClear();
    const t = await withLead({ notifier: { send: async () => { throw new TransportError('mailbox down'); } } });
    await t.svc.book({ leadId: t.leadId, start: t.slot.start, visitorTz: 'America/New_York' }, {});
    expect(warn.mock.calls.flat()).toEqual([
      'booking: email booking-confirmed not sent (TransportError)', 'booking: email hassan-new-booking not sent (TransportError)',
    ]);
  });
});

describe('retrying emails', () => {
  it('retries unsent booking emails and stops once they go through', async () => {
    const w = world();
    const b = await w.booking(START, NOW, { unsent: ['visitor', 'hassan'] });
    w.failing.add('hassan-new-booking');

    // `book()` may still be finishing: a booking under 2 minutes old is left alone.
    expect(await w.run(after(NOW, 2 * MIN - 1))).toEqual(quiet);
    expect(w.tried).toEqual([]);

    // The visitor's email goes out and is marked. Hassan's fails, stays unmarked, and is logged without anything about the visitor.
    const first = after(NOW, 2 * MIN);
    expect(await w.run(first)).toEqual({ ...quiet, emailRetries: 1 });
    expect(w.kinds()).toEqual(['booking-confirmed']);
    expect(w.sent[0].data).toMatchObject({ lead: { id: b.leadId }, booking: { id: b.id } });
    let stored = await w.row(b.id);
    expect(stored.visitorNotifiedAt).toEqual(first);
    expect(stored.hassanNotifiedAt).toBeUndefined();
    const logged = warn.mock.calls.flat().join('\n');
    expect(logged).toContain('hassan-new-booking');
    expect(logged).toContain('TransportError');
    expect(logged).not.toMatch(/zoe|Zoë|O’Brien|example\.com|550/);

    // The next pass tries only the one that is unsent, and now it works.
    w.failing.clear();
    w.tried.length = 0;
    const second = after(first, 5 * MIN);
    expect(await w.run(second)).toEqual({ ...quiet, emailRetries: 1 });
    expect(w.tried.map((t) => t.kind)).toEqual(['hassan-new-booking']);
    expect(w.kinds()).toEqual(['booking-confirmed', 'hassan-new-booking']);
    stored = await w.row(b.id);
    expect(stored.visitorNotifiedAt).toEqual(first);
    expect(stored.hassanNotifiedAt).toEqual(second);

    // Both are marked: nothing more is sent.
    expect(await w.run(after(second, 5 * MIN))).toEqual(quiet);
    expect(w.sent).toHaveLength(2);
  });

  it('picks the email by status: a requested booking gets "requested" and "confirm by hand"', async () => {
    const w = world();
    const requested = await w.booking(START, NOW, { status: 'requested', unsent: ['visitor', 'hassan'] });
    await w.run(after(NOW, 5 * MIN));
    expect(w.sent.map((s) => [s.kind, s.data.booking?.id])).toEqual([['booking-requested', requested.id], ['hassan-confirm-by-hand', requested.id]]);
  });

  it('sends only the email that is still unsent', async () => {
    const w = world();
    await w.booking(START, NOW, { unsent: ['hassan'] });
    expect(await w.run(after(NOW, 5 * MIN))).toEqual({ ...quiet, emailRetries: 1 });
    expect(w.kinds()).toEqual(['hassan-new-booking']);
  });

  it('a failing email does not stop the pass for other bookings, and its mark stays unset', async () => {
    const w = world();
    const first = await w.booking(START, NOW, { unsent: ['visitor'] });
    const second = await w.booking(after(START, 15 * MIN).toISOString(), NOW, { unsent: ['visitor'] });
    w.failing.add('booking-confirmed');

    expect(await w.run(after(NOW, 5 * MIN))).toEqual(quiet);
    expect(w.tried.map((t) => t.bookingId)).toEqual([first.id, second.id]); // the second was tried although the first failed
    expect((await w.row(first.id)).visitorNotifiedAt).toBeUndefined();
    expect((await w.row(second.id)).visitorNotifiedAt).toBeUndefined();

    w.failing.clear();
    expect(await w.run(after(NOW, 10 * MIN))).toEqual({ ...quiet, emailRetries: 2 });
  });

  it('leaves cancelled bookings alone, and bookings older than 2 days', async () => {
    const w = world();
    const now = new Date('2026-12-05T10:00:00.000Z');
    const unsent: Side[] = ['visitor', 'hassan'];
    const cancelled = await w.booking(after(now, 10 * DAY).toISOString(), before(now, HOUR), { status: 'cancelled', unsent });
    const old = await w.booking(after(now, 11 * DAY).toISOString(), before(now, 2 * DAY + 1), { unsent });
    const edge = await w.booking(after(now, 12 * DAY).toISOString(), before(now, 2 * DAY), { unsent });
    expect(await w.run(now)).toEqual({ ...quiet, emailRetries: 2 });
    expect(w.sent.map((s) => [s.kind, s.data.booking?.id])).toEqual([['booking-confirmed', edge.id], ['hassan-new-booking', edge.id]]);
    for (const left of [cancelled, old]) {
      const stored = await w.row(left.id);
      expect([stored.visitorNotifiedAt, stored.hassanNotifiedAt]).toEqual([undefined, undefined]);
    }
  });
});

describe('retrying tracking events', () => {
  it('retries failed tracking events up to 3 attempts', async () => {
    const w = world();
    await w.track('lead.one', 0);
    await w.track('lead.two', 1);
    await w.track('lead.three', 2);
    await w.track('lead.exhausted', 3);
    await w.track('lead.sent', 1, 'sent');
    await w.track('lead.pending', 0, 'pending');
    w.retryOutcome.set('lead.two', true);

    expect(await w.run(NOW)).toEqual({ ...quiet, trackingRetries: 1 });
    expect(w.retried.map((r) => r.eventId).sort()).toEqual(['lead.one', 'lead.three', 'lead.two']);
    const failed = Object.fromEntries((await w.store.trackingEventsByStatus('failed')).map((r) => [r.eventId, r.attempts]));
    expect(failed).toEqual({ 'lead.one': 1, 'lead.three': 3, 'lead.exhausted': 3 });
    expect((await w.store.trackingEventsByStatus('sent')).map((r) => [r.eventId, r.attempts]).sort()).toEqual([['lead.sent', 1], ['lead.two', 2]]);

    // lead.one is tried again until it has used 3 attempts; the others are not touched again.
    for (const minutes of [5, 10]) {
      w.retried.length = 0;
      expect(await w.run(after(NOW, minutes * MIN))).toEqual(quiet);
      expect(w.retried.map((r) => r.eventId)).toEqual(['lead.one']);
    }
    w.retried.length = 0;
    await w.run(after(NOW, 15 * MIN));
    expect(w.retried).toEqual([]);
    expect((await w.store.trackingEventsByStatus('failed')).map((r) => r.attempts)).toEqual([3, 3, 3]);
  });

  it('a retry that throws counts as a failed attempt, and does not stop the pass', async () => {
    const w = world();
    await w.track('lead.a', 1);
    await w.track('lead.b', 1);
    w.retryOutcome.set('lead.a', new TransportError('boom for zoe@example.com'));
    w.retryOutcome.set('lead.b', true);
    expect(await w.run(NOW)).toEqual({ ...quiet, trackingRetries: 1 });
    expect((await w.store.trackingEventsByStatus('failed')).map((r) => [r.eventId, r.attempts])).toEqual([['lead.a', 2]]);
    const logged = warn.mock.calls.flat().join('\n');
    expect(logged).toContain('TransportError');
    expect(logged).not.toMatch(/zoe|example\.com|boom/);
  });
});

describe('POST /api/cron/run', () => {
  const SECRET = 'a-long-random-cron-secret';
  const dirs: string[] = [];
  beforeEach(() => { vi.spyOn(console, 'info').mockImplementation(() => {}); });
  afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

  const fakesContext = (env: Record<string, string> = {}) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hg-cron-'));
    dirs.push(dir);
    return createContext(readServerConfig({ HIVEGEN_FAKES: '1', NODE_ENV: 'test', CRON_SECRET: SECRET, ...env }), { outboxDir: dir });
  };
  const call = (ctx: ServerContext, headers: Record<string, string> = {}) =>
    withContext(cronHandler, async () => ctx)({
      request: new Request('http://localhost:4321/api/cron/run', { method: 'POST', headers }), params: {}, clientAddress: '203.0.113.7',
    });

  it('the cron route refuses a missing or wrong secret', async () => {
    const run = vi.fn(async () => quiet);
    const ctx = { ...(await fakesContext()), runScheduled: run };
    // Wrong in every way: empty, unrelated, too long, too short, the same length with one letter changed, another case.
    const wrong = ['', 'wrong', `${SECRET}x`, SECRET.slice(0, -1), `${SECRET.slice(0, -1)}!`, SECRET.toUpperCase()];
    for (const headers of [{}, ...wrong.map((s) => ({ 'x-cron-secret': s }))]) {
      const res = await call(ctx, headers);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'unauthorized' });
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
    expect(run).not.toHaveBeenCalled(); // nothing ran
  });

  it('answers 200 with the summary for the right secret', async () => {
    const summary = { reminders24h: 1, reminders1h: 2, newLeadEmails: 3, emailRetries: 4, trackingRetries: 5 };
    const ctx = { ...(await fakesContext()), runScheduled: async () => summary };
    const res = await call(ctx, { 'x-cron-secret': SECRET });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual(summary);
  });

  it('answers 503 not_connected without a configured secret, or without the booking services', async () => {
    const noSecret = await fakesContext({ CRON_SECRET: '' });
    const attempts: Array<Record<string, string>> = [{}, { 'x-cron-secret': '' }, { 'x-cron-secret': SECRET }];
    for (const headers of attempts) {
      const res = await call(noSecret, headers);
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: 'not_connected' });
      expect(res.headers.get('cache-control')).toBe('no-store');
    }

    const offline = await createContext(readServerConfig({ NODE_ENV: 'test', CRON_SECRET: SECRET }));
    expect(offline.service).toBeNull();
    const res = await call(offline, { 'x-cron-secret': SECRET });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'not_connected' });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect((await call(offline, { 'x-cron-secret': 'wrong' })).status).toBe(401); // the secret is checked first
  });

  it('is not rate limited: the cron job always comes from one address', async () => {
    const ctx = await fakesContext();
    for (let i = 0; i < 30; i += 1) expect((await call(ctx, { 'x-cron-secret': SECRET })).status).toBe(200);
    for (let i = 0; i < 30; i += 1) expect((await call(ctx, { 'x-cron-secret': 'wrong' })).status).toBe(401);
  });

  it('a pass that throws is a 500 that logs the kind of error and nothing from it', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ctx = { ...(await fakesContext()), runScheduled: async (): Promise<never> => { throw new TransportError('zoe@example.com'); } };
    const res = await call(ctx, { 'x-cron-secret': SECRET });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'server_error' });
    expect(error.mock.calls.flat().join('\n')).toContain('TransportError');
    expect(error.mock.calls.flat().join('\n')).not.toContain('zoe');
  });

  it('in the test services it runs on the store the bookings are in, also after a reset', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const ctx = await fakesContext();
    const svc = ctx.service!;
    const lead = await svc.createLead(good, {});
    if (!lead.ok) throw new Error(lead.error);
    const { slots } = await svc.getSlots();
    const booked = await svc.book({ leadId: lead.value.leadId, start: slots[0].start, visitorTz: 'America/New_York' }, {});
    expect(booked.ok).toBe(true);
    const outbox = () => ctx.fakes!.mailer.sent.map((m) => m.tag);
    expect(outbox()).toEqual(['booking-confirmed', 'hassan-new-booking']);

    vi.setSystemTime(before(slots[0].start, HOUR));
    const res = await call(ctx, { 'x-cron-secret': SECRET });
    expect(await res.json()).toEqual({ ...quiet, reminders1h: 1 });
    expect(outbox()).toEqual(['booking-confirmed', 'hassan-new-booking', 'reminder-1h']);

    ctx.fakes!.reset(); // a new, empty store: the next pass must run on it
    const again = await call(ctx, { 'x-cron-secret': SECRET });
    expect(await again.json()).toEqual(quiet);
  });
});

describe('npm run cron', () => {
  const ROOT = process.cwd();
  const tsx = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const script = path.join(ROOT, 'scripts', 'cron.ts');
  let server: http.Server;
  let requests: Array<{ method?: string; url?: string; secret?: string | string[] }>;
  let reply: { status: number; body: unknown };
  let cwd: string;

  const listen = (s: http.Server) => new Promise<number>((resolve) => s.listen(0, '127.0.0.1', () => resolve((s.address() as AddressInfo).port)));
  const close = (s: http.Server) => new Promise<void>((resolve) => s.close(() => resolve()));

  beforeEach(async () => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'hg-cron-script-')); // no .env in here, so only the settings the test passes are read
    requests = [];
    reply = { status: 200, body: { reminders24h: 1, reminders1h: 0, newLeadEmails: 2, emailRetries: 0, trackingRetries: 0 } };
    server = http.createServer((req, res) => {
      requests.push({ method: req.method, url: req.url, secret: req.headers['x-cron-secret'] });
      res.writeHead(reply.status, { 'content-type': 'application/json' }).end(JSON.stringify(reply.body));
    });
  });
  afterEach(async () => {
    if (server.listening) await close(server);
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  const runScript = (env: Record<string, string>) => new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    const settings: Record<string, string | undefined> = { ...process.env, CRON_SECRET: undefined, PUBLIC_SITE_URL: undefined, ...env };
    execFile(process.execPath, [tsx, script], { cwd, env: settings as NodeJS.ProcessEnv, timeout: 30_000 }, (error, stdout, stderr) => {
      resolve({ code: error ? ((error as { code?: number }).code ?? 1) : 0, stdout, stderr });
    });
  });

  it('POSTs to the site with the secret and prints the summary', async () => {
    const port = await listen(server);
    const r = await runScript({ CRON_SECRET: 'the-secret', PUBLIC_SITE_URL: `http://127.0.0.1:${port}/` });
    expect(r.code).toBe(0);
    expect(requests).toEqual([{ method: 'POST', url: '/api/cron/run', secret: 'the-secret' }]);
    expect(JSON.parse(r.stdout)).toEqual(reply.body);
    expect(r.stdout + r.stderr).not.toContain('the-secret');
  }, 30_000);

  it('exits non-zero on anything but 200, and says why without the secret', async () => {
    reply = { status: 401, body: { error: 'unauthorized' } };
    const port = await listen(server);
    const r = await runScript({ CRON_SECRET: 'the-secret', PUBLIC_SITE_URL: `http://127.0.0.1:${port}` });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('401');
    expect(r.stderr).toContain('unauthorized');
    expect(r.stdout + r.stderr).not.toContain('the-secret');
  }, 30_000);

  it('exits non-zero when the site cannot be reached', async () => {
    const port = await listen(server);
    await close(server); // nothing listens on this port any more
    const r = await runScript({ CRON_SECRET: 'the-secret', PUBLIC_SITE_URL: `http://127.0.0.1:${port}` });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/could not reach/i);
    expect(r.stdout + r.stderr).not.toContain('the-secret');
  }, 30_000);

  it('exits non-zero without a secret, and does not call the site', async () => {
    const port = await listen(server);
    const r = await runScript({ PUBLIC_SITE_URL: `http://127.0.0.1:${port}` });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('CRON_SECRET');
    expect(requests).toEqual([]);
  }, 30_000);
});
