import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { createBookingService } from '../../src/server/booking/service';
import { isActive } from '../../src/server/booking/status';
import { CalendarUnavailableError, type Booking, type EmailKind, type Slot, type Store } from '../../src/server/booking/types';
import { NOW, addLead, good, setup, withLead } from './helpers/booking';

type Ctx = Awaited<ReturnType<typeof withLead>>;
const MIN = 60_000;
const minutesBefore = (iso: string, minutes: number) => new Date(Date.parse(iso) - minutes * MIN);
const tokenOf = (manageUrl: string) => manageUrl.split('/').at(-1) as string;
const everyBooking = (store: Store) => store.bookingsStartingBetween('2000-01-01T00:00:00Z', '2100-01-01T00:00:00Z');

/** Books `slot` for `leadId` (the context's lead unless another is given), and gives back what the visitor gets. */
async function bookSlot(t: Ctx, slot: Slot, leadId = t.leadId, visitorTz = 'America/New_York') {
  const r = await t.svc.book({ leadId, start: slot.start, visitorTz }, {});
  if (!r.ok) throw new Error(`not booked: ${r.error}`);
  return r.value;
}
const rowFor = async (t: Ctx, manageUrl: string) => (await t.store.getBookingByToken(tokenOf(manageUrl))) as Booking;
const leadRow = async (t: Ctx, publicId = t.leadId) => (await t.store.getLeadByPublicId(publicId))!;
const forgetEmails = (t: Ctx) => { t.sent.length = 0; t.mails.length = 0; };

let warn: MockInstance;
beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });

describe('book', () => {
  it('books: Meet link, manage link, both emails, Schedule event, lead booked', async () => {
    const { svc, calendar, sent, tracked, leadId, slot, store } = await withLead();
    const r = await svc.book({ leadId, start: slot.start, visitorTz: 'America/New_York' }, {});
    expect(r).toEqual({ ok: true, value: { status: 'booked', start: slot.start, end: slot.end, meetUrl: 'https://meet.google.com/fake-1',
      manageUrl: expect.stringMatching(/^https:\/\/hivegen\.co\/booking\/[A-Za-z0-9_-]{43}$/), eventId: `schedule.${leadId}` } });
    expect(sent).toEqual(['booking-confirmed', 'hassan-new-booking']);

    const ev = [...calendar.events.values()][0];
    expect(ev.summary).toBe('HiveGen call · Zoë O’Brien');
    // The description is what the guest sees: it holds the manage link (whose random token could contain any digits) and nothing about the lead.
    expect(ev.description.replace(/https:\/\/hivegen\.co\/booking\/\S+/, '')).not.toMatch(/555|6–15|facebook|zoe|Zoë/);
    expect(ev.privateProps).toMatchObject({ phone: '+1 (555) 010-2000', volume: '6–15', utm_source: 'facebook' });
    expect(ev.privateProps).toEqual({ leadId, phone: '+1 (555) 010-2000', volume: '6–15', footageUrl: 'https://drive.google.com/x', pageVersion: 'agents', utm_source: 'facebook' });
    expect(ev).toMatchObject({ start: slot.start, end: slot.end, attendee: { email: 'zoe+ads@example.com', name: 'Zoë O’Brien' } });
    if (!r.ok) throw new Error(r.error);
    expect(ev.description).toContain(r.value.manageUrl);

    const row = await store.getBookingByToken(tokenOf(r.value.manageUrl));
    expect(row).toMatchObject({ status: 'booked', start: slot.start, end: slot.end, googleEventId: 'ev-1', meetUrl: 'https://meet.google.com/fake-1',
      visitorTz: 'America/New_York', visitorNotifiedAt: NOW, hassanNotifiedAt: NOW });
    expect(await store.getLeadByPublicId(leadId)).toMatchObject({ status: 'booked' });
    expect(tracked.map((e) => e.name)).toEqual(['Lead', 'Schedule']);
  });

  it('the emails get the lead and the saved booking', async () => {
    const t = await withLead();
    const out = await bookSlot(t, t.slot);
    const row = await rowFor(t, out.manageUrl);
    expect(t.mails.map((m) => m.kind)).toEqual(['booking-confirmed', 'hassan-new-booking']);
    for (const m of t.mails) {
      expect(m.data.lead).toMatchObject({ publicId: t.leadId, email: 'zoe+ads@example.com' });
      expect(m.data.booking).toMatchObject({ id: row.id, status: 'booked', googleEventId: 'ev-1', manageToken: row.manageToken });
    }
  });

  it('sends the Schedule event with the lead, the visitor and the page', async () => {
    const t = await withLead();
    const out = await t.svc.book({ leadId: t.leadId, start: t.slot.start, visitorTz: 'UTC' }, { ip: '203.0.113.9', userAgent: 'UA', sourceUrl: 'https://hivegen.co/agents' });
    expect(out.ok).toBe(true);
    expect(t.tracked.at(-1)).toEqual({
      name: 'Schedule', eventId: `schedule.${t.leadId}`, time: NOW, sourceUrl: 'https://hivegen.co/agents', leadId: (await leadRow(t)).id,
      user: { email: 'zoe+ads@example.com', phone: '+1 (555) 010-2000', externalId: t.leadId, ip: '203.0.113.9', userAgent: 'UA', fbp: undefined, fbc: `fb.1.${NOW.getTime()}.abc` },
    });
  });

  it('the Schedule event falls back to the visitor details saved with the lead', async () => {
    const t = setup();
    const made = await t.svc.createLead(good, { ip: '198.51.100.7', userAgent: 'Saved UA' });
    if (!made.ok) throw new Error(made.error);
    const { slots } = await t.svc.getSlots();
    await t.svc.book({ leadId: made.value.leadId, start: slots[0].start, visitorTz: 'UTC' }, {});
    expect(t.tracked.at(-1)).toMatchObject({ name: 'Schedule', sourceUrl: '', user: { ip: '198.51.100.7', userAgent: 'Saved UA' } });
  });

  it('a start that is not an offered slot is slot_taken, and nothing is saved or sent', async () => {
    const t = await withLead();
    const notOffered = [
      '2026-12-01T09:00:00.000Z', // in the past
      '2026-12-01T10:30:00.000Z', // inside the 60-minute notice
      '2026-12-05T12:00:00.000Z', // Saturday noon
      '2026-12-01T14:05:00.000Z', // not on the 20-minute grid
      '2026-12-20T14:00:00.000Z', // past the 14-day horizon
    ];
    for (const start of notOffered) {
      expect(await t.svc.book({ leadId: t.leadId, start, visitorTz: 'UTC' }, {})).toEqual({ ok: false, error: 'slot_taken' });
    }
    expect(await everyBooking(t.store)).toEqual([]);
    expect(t.calendar.events.size).toBe(0);
    expect(t.sent).toEqual([]);
    expect(t.tracked.map((e) => e.name)).toEqual(['Lead']);
    expect(await leadRow(t)).toMatchObject({ status: 'started' });
  });

  it('Google busy at the re-check is slot_taken', async () => {
    const t = await withLead();
    t.calendar.setBusy([{ start: '2026-12-01T14:10:00.000Z', end: '2026-12-01T15:00:00.000Z' }]); // overlaps the end of the first slot
    expect(await t.svc.book({ leadId: t.leadId, start: t.slot.start, visitorTz: 'UTC' }, {})).toEqual({ ok: false, error: 'slot_taken' });
    expect(await everyBooking(t.store)).toEqual([]);
    expect(t.calendar.events.size).toBe(0);
    expect(t.sent).toEqual([]);
  });

  it('a slot another lead holds is slot_taken', async () => {
    const t = await withLead();
    const other = await addLead(t.svc, { email: 'other@example.com' });
    await bookSlot(t, t.slot);
    expect(await t.svc.book({ leadId: other, start: t.slot.start, visitorTz: 'UTC' }, {})).toEqual({ ok: false, error: 'slot_taken' });
    expect(t.calendar.events.size).toBe(1);
    expect(await leadRow(t, other)).toMatchObject({ status: 'started' });
    expect(t.sent).toEqual(['booking-confirmed', 'hassan-new-booking']);
    // The next slot is still free to them.
    expect(await t.svc.book({ leadId: other, start: t.slots[1].start, visitorTz: 'UTC' }, {})).toMatchObject({ ok: true });
  });

  it('two visitors confirming the same slot at once: exactly one gets it', async () => {
    const t = await withLead();
    const other = await addLead(t.svc, { email: 'other@example.com' });
    const results = await Promise.all([
      t.svc.book({ leadId: t.leadId, start: t.slot.start, visitorTz: 'UTC' }, {}),
      t.svc.book({ leadId: other, start: t.slot.start, visitorTz: 'UTC' }, {}),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, error: 'slot_taken' }]);
    expect(t.calendar.events.size).toBe(1);
    expect((await everyBooking(t.store)).filter((b) => isActive(b.status))).toHaveLength(1);
  });

  it('Google down while booking: requested, slot kept, the two "requested" emails', async () => {
    const t = await withLead();
    t.calendar.setDown(true);
    const r = await t.svc.book({ leadId: t.leadId, start: t.slot.start, visitorTz: 'America/New_York' }, {});
    expect(r).toEqual({ ok: true, value: { status: 'requested', start: t.slot.start, end: t.slot.end,
      manageUrl: expect.stringMatching(/^https:\/\/hivegen\.co\/booking\/[A-Za-z0-9_-]{43}$/), eventId: `schedule.${t.leadId}` } });
    if (!r.ok) throw new Error(r.error);
    expect(r.value.meetUrl).toBeUndefined();
    expect(t.sent).toEqual(['booking-requested', 'hassan-confirm-by-hand']);
    expect(t.calendar.events.size).toBe(0);
    expect(await rowFor(t, r.value.manageUrl)).toMatchObject({ status: 'requested', visitorNotifiedAt: NOW, hassanNotifiedAt: NOW });
    expect(await leadRow(t)).toMatchObject({ status: 'requested' });
    expect(t.tracked.at(-1)).toMatchObject({ name: 'Schedule', eventId: `schedule.${t.leadId}` });

    // The slot stays reserved: a second lead cannot take it, even once Google is back.
    const other = await addLead(t.svc, { email: 'other@example.com' });
    expect(await t.svc.book({ leadId: other, start: t.slot.start, visitorTz: 'UTC' }, {})).toEqual({ ok: false, error: 'slot_taken' });
    t.calendar.setDown(false);
    expect(await t.svc.book({ leadId: other, start: t.slot.start, visitorTz: 'UTC' }, {})).toEqual({ ok: false, error: 'slot_taken' });
    expect((await t.svc.getSlots()).slots.map((s) => s.start)).not.toContain(t.slot.start);
  });

  it('Google failing when the event is made also gives requested, whatever the error, and logs nothing personal', async () => {
    for (const failure of [new CalendarUnavailableError(), new Error('quota exceeded for zoe+ads@example.com')]) {
      const t = await withLead();
      vi.spyOn(t.calendar, 'createEvent').mockRejectedValue(failure);
      const r = await t.svc.book({ leadId: t.leadId, start: t.slot.start, visitorTz: 'UTC' }, {});
      expect(r).toMatchObject({ ok: true, value: { status: 'requested' } });
      expect(t.sent).toEqual(['booking-requested', 'hassan-confirm-by-hand']);
      expect(await leadRow(t)).toMatchObject({ status: 'requested' });
      expect(t.calendar.events.size).toBe(0);
    }
    const logged = JSON.stringify(warn.mock.calls);
    expect(warn).toHaveBeenCalled();
    expect(logged).not.toMatch(/zoe|Zoë|555|example\.com/);
  });

  it('confirming twice gives one booking and one calendar event', async () => {
    const t = await withLead();
    const first = await t.svc.book({ leadId: t.leadId, start: t.slot.start, visitorTz: 'America/New_York' }, {});
    const again = await t.svc.book({ leadId: t.leadId, start: t.slot.start, visitorTz: 'America/New_York' }, {});
    expect(again).toEqual(first);
    // Another time for the same lead does not make a second booking either: the active one comes back unchanged.
    expect(await t.svc.book({ leadId: t.leadId, start: t.slots[2].start, visitorTz: 'UTC' }, {})).toEqual(first);
    expect(await everyBooking(t.store)).toHaveLength(1);
    expect(t.calendar.events.size).toBe(1);
    expect(t.sent).toEqual(['booking-confirmed', 'hassan-new-booking']);
    expect(t.tracked.filter((e) => e.name === 'Schedule')).toHaveLength(1);
  });

  it('a requested booking confirmed again comes back as requested, without a new event', async () => {
    const t = await withLead();
    t.calendar.setDown(true);
    const first = await t.svc.book({ leadId: t.leadId, start: t.slot.start, visitorTz: 'UTC' }, {});
    t.calendar.setDown(false);
    expect(await t.svc.book({ leadId: t.leadId, start: t.slot.start, visitorTz: 'UTC' }, {})).toEqual(first);
    expect(t.calendar.events.size).toBe(0);
    expect(t.sent).toEqual(['booking-requested', 'hassan-confirm-by-hand']);
  });

  it('a double click (two confirmations at once) still leaves one booking and one event', async () => {
    const t = await withLead();
    const results = await Promise.all([
      t.svc.book({ leadId: t.leadId, start: t.slot.start, visitorTz: 'UTC' }, {}),
      t.svc.book({ leadId: t.leadId, start: t.slot.start, visitorTz: 'UTC' }, {}),
    ]);
    expect(results.some((r) => r.ok)).toBe(true);
    expect(await everyBooking(t.store)).toHaveLength(1);
    expect(t.calendar.events.size).toBe(1);
  });

  it('a fresh service on the same store (process restarted) still books the lead', async () => {
    const t = await withLead();
    const restarted = createBookingService(t.deps);
    const r = await restarted.book({ leadId: t.leadId, start: t.slot.start, visitorTz: 'UTC' }, {});
    expect(r).toMatchObject({ ok: true, value: { status: 'booked', start: t.slot.start } });
    if (!r.ok) throw new Error(r.error);
    // And a third instance can manage it.
    expect(await createBookingService(t.deps).getManaged(tokenOf(r.value.manageUrl))).toMatchObject({ booking: { start: t.slot.start }, canCancel: true });
  });

  it('an unknown time zone is stored as UTC; a known one is kept', async () => {
    const t = await withLead();
    const zones: Array<[unknown, string]> = [['Mars/Olympus', 'UTC'], [undefined, 'UTC'], [42, 'UTC'], ['Asia/Karachi', 'Asia/Karachi']];
    for (const [i, [visitorTz, stored]] of zones.entries()) {
      const leadId = i === 0 ? t.leadId : await addLead(t.svc, { email: `tz${i}@example.com` });
      const r = await t.svc.book({ leadId, start: t.slots[i].start, visitorTz }, {});
      if (!r.ok) throw new Error(r.error);
      expect((await rowFor(t, r.value.manageUrl)).visitorTz).toBe(stored);
    }
  });

  it('an email failure does not fail the booking and leaves it for cron', async () => {
    const t = await withLead({ notifier: { send: async () => { throw new Error('smtp down: refused zoe+ads@example.com'); } } });
    const r = await t.svc.book({ leadId: t.leadId, start: t.slot.start, visitorTz: 'UTC' }, {});
    expect(r).toMatchObject({ ok: true, value: { status: 'booked' } });
    if (!r.ok) throw new Error(r.error);
    const row = await rowFor(t, r.value.manageUrl);
    expect(row.status).toBe('booked');
    expect(row.visitorNotifiedAt).toBeUndefined();
    expect(row.hassanNotifiedAt).toBeUndefined();
    expect(await leadRow(t)).toMatchObject({ status: 'booked' });
    expect(t.tracked.at(-1)).toMatchObject({ name: 'Schedule' });
    // One short line for each email, with no personal data.
    expect(warn).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/zoe|Zoë|example\.com|smtp/);
  });

  it('each email is sent on its own: when one fails the other still goes and is marked sent', async () => {
    const attempts: EmailKind[] = [];
    const notifier = { send: async (kind: EmailKind) => { attempts.push(kind); if (kind === 'booking-confirmed') throw new Error('refused'); } };
    const t = await withLead({ notifier });
    const r = await t.svc.book({ leadId: t.leadId, start: t.slot.start, visitorTz: 'UTC' }, {});
    if (!r.ok) throw new Error(r.error);
    expect(attempts).toEqual(['booking-confirmed', 'hassan-new-booking']);
    const row = await rowFor(t, r.value.manageUrl);
    expect(row.visitorNotifiedAt).toBeUndefined();
    expect(row.hassanNotifiedAt).toEqual(NOW);
  });

  it('an unknown lead is not_found; bad input names its fields; nothing is sent', async () => {
    const t = await withLead();
    expect(await t.svc.book({ leadId: 'A'.repeat(22), start: t.slot.start, visitorTz: 'UTC' }, {})).toEqual({ ok: false, error: 'not_found' });
    expect(await t.svc.book({ leadId: t.leadId, start: 'tomorrow' }, {})).toEqual({ ok: false, error: 'invalid', fields: { start: 'invalid' } });
    expect(await t.svc.book({ leadId: t.leadId, start: '2026-12-01T14:00:00' }, {})).toEqual({ ok: false, error: 'invalid', fields: { start: 'invalid' } });
    expect(await t.svc.book({}, {})).toEqual({ ok: false, error: 'invalid', fields: { leadId: 'required', start: 'required' } });
    expect(await t.svc.book(null, {})).toEqual({ ok: false, error: 'invalid', fields: { leadId: 'required', start: 'required' } });
    expect(await everyBooking(t.store)).toEqual([]);
    expect(t.sent).toEqual([]);
  });

  it('builds the manage link from siteUrl with one trailing slash removed', async () => {
    for (const siteUrl of ['https://hivegen.co/', 'https://hivegen.co']) {
      const t = await withLead({ siteUrl });
      const out = await bookSlot(t, t.slot);
      expect(out.manageUrl).toMatch(/^https:\/\/hivegen\.co\/booking\/[A-Za-z0-9_-]{43}$/);
      expect([...t.calendar.events.values()][0].description).toContain(out.manageUrl);
    }
  });

  it('every booking gets its own manage token', async () => {
    const t = await withLead();
    const other = await addLead(t.svc, { email: 'other@example.com' });
    const a = await bookSlot(t, t.slots[0]);
    const b = await bookSlot(t, t.slots[1], other);
    expect(tokenOf(a.manageUrl)).not.toBe(tokenOf(b.manageUrl));
  });

  it('fills {name} and {manageUrl} as plain text, in one pass', async () => {
    const t = setup();
    const tricky = await addLead(t.svc, { name: '{manageUrl} $& A', email: 'tricky@example.com' });
    const { slots } = await t.svc.getSlots();
    const out = await t.svc.book({ leadId: tricky, start: slots[0].start, visitorTz: 'UTC' }, {});
    if (!out.ok) throw new Error(out.error);
    const ev = [...t.calendar.events.values()][0];
    expect(ev.summary).toBe('HiveGen call · {manageUrl} $& A');
    expect(ev.description).toBe(`Your 15-minute call with HiveGen. Join with the Google Meet link in this invite. To reschedule or cancel: ${out.value.manageUrl}`);
  });
});

describe('cancel', () => {
  it('frees the slot, cancels the event, sends both emails; twice is fine', async () => {
    const t = await withLead();
    const out = await bookSlot(t, t.slot);
    const token = tokenOf(out.manageUrl);
    forgetEmails(t);
    const cancelEvent = vi.spyOn(t.calendar, 'cancelEvent');

    expect(await t.svc.cancel(token)).toEqual({ ok: true, value: { status: 'cancelled' } });
    expect(t.calendar.events.get('ev-1')?.cancelled).toBe(true);
    expect(await t.store.getBookingByToken(token)).toMatchObject({ status: 'cancelled' });
    expect(await leadRow(t)).toMatchObject({ status: 'cancelled' });
    expect(t.sent).toEqual(['booking-cancelled', 'hassan-booking-changed']);
    expect(t.mails[1].data).toMatchObject({ change: 'cancelled', lead: { publicId: t.leadId }, booking: { status: 'cancelled', start: t.slot.start } });
    expect((await t.svc.getSlots()).slots.map((s) => s.start)).toContain(t.slot.start);

    // Cancelling again is fine and does nothing more.
    expect(await t.svc.cancel(token)).toEqual({ ok: true, value: { status: 'cancelled' } });
    expect(cancelEvent).toHaveBeenCalledTimes(1);
    expect(t.sent).toEqual(['booking-cancelled', 'hassan-booking-changed']);

    // Someone else can now have the time, and the first visitor can book another.
    const other = await addLead(t.svc, { email: 'other@example.com' });
    expect(await t.svc.book({ leadId: other, start: t.slot.start, visitorTz: 'UTC' }, {})).toMatchObject({ ok: true, value: { status: 'booked' } });
    const again = await t.svc.book({ leadId: t.leadId, start: t.slots[2].start, visitorTz: 'UTC' }, {});
    expect(again).toMatchObject({ ok: true, value: { status: 'booked', start: t.slots[2].start } });
    if (!again.ok) throw new Error(again.error);
    expect(tokenOf(again.value.manageUrl)).not.toBe(token);
    expect(await leadRow(t)).toMatchObject({ status: 'booked' });
  });

  it('an unknown token is not_found', async () => {
    const t = await withLead();
    expect(await t.svc.cancel('no-such-token')).toEqual({ ok: false, error: 'not_found' });
  });

  it('works until the call starts, and is too_late from the start on', async () => {
    const t = await withLead();
    const out = await bookSlot(t, t.slot);
    const token = tokenOf(out.manageUrl);
    forgetEmails(t);

    t.clock.set(new Date(t.slot.start));
    expect(await t.svc.cancel(token)).toEqual({ ok: false, error: 'too_late' });
    t.clock.set(new Date(Date.parse(t.slot.start) + 5 * MIN));
    expect(await t.svc.cancel(token)).toEqual({ ok: false, error: 'too_late' });
    expect(await t.store.getBookingByToken(token)).toMatchObject({ status: 'booked' });
    expect(t.calendar.events.get('ev-1')?.cancelled).toBeUndefined();
    expect(t.sent).toEqual([]);

    t.clock.set(new Date(Date.parse(t.slot.start) - 1));
    expect(await t.svc.cancel(token)).toEqual({ ok: true, value: { status: 'cancelled' } });
  });

  it('when Google fails the cancel is server_error and nothing changes', async () => {
    const t = await withLead();
    const out = await bookSlot(t, t.slot);
    const token = tokenOf(out.manageUrl);
    forgetEmails(t);

    t.calendar.setDown(true);
    expect(await t.svc.cancel(token)).toEqual({ ok: false, error: 'server_error' });
    expect(await t.store.getBookingByToken(token)).toMatchObject({ status: 'booked' });
    expect(await leadRow(t)).toMatchObject({ status: 'booked' });
    expect(t.sent).toEqual([]);
    expect((await t.svc.getSlots()).slots.map((s) => s.start)).not.toContain(t.slot.start);

    t.calendar.setDown(false);
    expect(await t.svc.cancel(token)).toEqual({ ok: true, value: { status: 'cancelled' } });
  });

  it('a requested booking can be cancelled (no calendar call, Hassan told) but not rescheduled', async () => {
    const t = await withLead();
    t.calendar.setDown(true);
    const out = await bookSlot(t, t.slot);
    expect(out.status).toBe('requested');
    const token = tokenOf(out.manageUrl);
    forgetEmails(t);

    expect(await t.svc.reschedule(token, { start: t.slots[3].start })).toEqual({ ok: false, error: 'too_late' });
    expect(await t.store.getBookingByToken(token)).toMatchObject({ status: 'requested', start: t.slot.start });
    expect(t.sent).toEqual([]);

    // Google is still down: a requested booking has no event, so cancelling needs none.
    const cancelEvent = vi.spyOn(t.calendar, 'cancelEvent');
    expect(await t.svc.cancel(token)).toEqual({ ok: true, value: { status: 'cancelled' } });
    expect(cancelEvent).not.toHaveBeenCalled();
    expect(t.sent).toEqual(['booking-cancelled', 'hassan-booking-changed']);
    expect(t.mails[1].data).toMatchObject({ change: 'cancelled', booking: { status: 'cancelled' } });
    expect(await leadRow(t)).toMatchObject({ status: 'cancelled' });
    expect((await t.svc.getSlots()).slots.map((s) => s.start)).toContain(t.slot.start);
  });
});

describe('reschedule', () => {
  it('moves the booking and the event, resets the reminders, sends both emails', async () => {
    const t = await withLead();
    const out = await bookSlot(t, t.slot);
    const token = tokenOf(out.manageUrl);
    const target = t.slots[3];
    const row = await rowFor(t, out.manageUrl);
    await t.store.updateBooking(row.id, { reminder24hSentAt: NOW, reminder1hSentAt: NOW }, NOW);
    forgetEmails(t);

    expect(await t.svc.reschedule(token, { start: target.start })).toEqual({ ok: true, value: { status: 'booked', start: target.start, end: target.end } });
    const moved = await t.store.getBookingByToken(token);
    expect(moved).toMatchObject({ status: 'booked', start: target.start, end: target.end, googleEventId: 'ev-1', meetUrl: out.meetUrl });
    expect(moved?.reminder24hSentAt).toBeUndefined();
    expect(moved?.reminder1hSentAt).toBeUndefined();
    expect(t.calendar.events.get('ev-1')).toMatchObject({ start: target.start, end: target.end });
    expect(t.sent).toEqual(['booking-rescheduled', 'hassan-booking-changed']);
    expect(t.mails[0].data).toMatchObject({ previousStart: t.slot.start, booking: { start: target.start } });
    expect(t.mails[1].data).toMatchObject({ change: 'rescheduled', previousStart: t.slot.start, booking: { start: target.start } });
    expect(await leadRow(t)).toMatchObject({ status: 'booked' });

    const open = (await t.svc.getSlots()).slots.map((s) => s.start);
    expect(open).toContain(t.slot.start);
    expect(open).not.toContain(target.start);
  });

  it('accepts a start with an offset, and moves again', async () => {
    const t = await withLead();
    const token = tokenOf((await bookSlot(t, t.slot)).manageUrl);
    const first = t.slots[3];
    const offset = new Date(Date.parse(first.start) + 5 * 3600_000).toISOString().replace('.000Z', '+05:00');
    expect(await t.svc.reschedule(token, { start: offset })).toMatchObject({ ok: true, value: { start: first.start } });
    expect(await t.svc.reschedule(token, { start: t.slots[5].start })).toMatchObject({ ok: true, value: { start: t.slots[5].start } });
    expect(t.calendar.events.get('ev-1')).toMatchObject({ start: t.slots[5].start });
  });

  it('works up to 60 minutes before the call and is too_late inside that', async () => {
    const t = await withLead();
    const token = tokenOf((await bookSlot(t, t.slot)).manageUrl);
    forgetEmails(t);

    t.clock.set(minutesBefore(t.slot.start, 59));
    expect(await t.svc.reschedule(token, { start: t.slots[5].start })).toEqual({ ok: false, error: 'too_late' });
    t.clock.set(new Date(t.slot.start));
    expect(await t.svc.reschedule(token, { start: t.slots[5].start })).toEqual({ ok: false, error: 'too_late' });
    expect(await t.store.getBookingByToken(token)).toMatchObject({ start: t.slot.start });
    expect(t.sent).toEqual([]);

    t.clock.set(minutesBefore(t.slot.start, 60));
    expect(await t.svc.reschedule(token, { start: t.slots[5].start })).toMatchObject({ ok: true, value: { start: t.slots[5].start } });
  });

  it('onto a taken slot is slot_taken and leaves everything as it was', async () => {
    const t = await withLead();
    const other = await addLead(t.svc, { email: 'other@example.com' });
    const token = tokenOf((await bookSlot(t, t.slot)).manageUrl);
    await bookSlot(t, t.slots[3], other);
    forgetEmails(t);

    expect(await t.svc.reschedule(token, { start: t.slots[3].start })).toEqual({ ok: false, error: 'slot_taken' });
    expect(await t.store.getBookingByToken(token)).toMatchObject({ start: t.slot.start, end: t.slot.end });
    expect(t.calendar.events.get('ev-1')).toMatchObject({ start: t.slot.start });
    expect(t.sent).toEqual([]);
  });

  it('a start that is not an offered slot, or the booking’s own time, or a busy time, is slot_taken', async () => {
    const t = await withLead();
    const token = tokenOf((await bookSlot(t, t.slot)).manageUrl);
    for (const start of ['2026-12-05T12:00:00.000Z', '2026-12-01T14:05:00.000Z', '2026-12-01T09:00:00.000Z', t.slot.start]) {
      expect(await t.svc.reschedule(token, { start })).toEqual({ ok: false, error: 'slot_taken' });
    }
    t.calendar.setBusy([t.slots[3]]);
    expect(await t.svc.reschedule(token, { start: t.slots[3].start })).toEqual({ ok: false, error: 'slot_taken' });
    expect(await t.store.getBookingByToken(token)).toMatchObject({ start: t.slot.start });
  });

  it('an unknown token is not_found; bad input names its field', async () => {
    const t = await withLead();
    const token = tokenOf((await bookSlot(t, t.slot)).manageUrl);
    expect(await t.svc.reschedule('no-such-token', { start: t.slots[3].start })).toEqual({ ok: false, error: 'not_found' });
    expect(await t.svc.reschedule(token, {})).toEqual({ ok: false, error: 'invalid', fields: { start: 'required' } });
    expect(await t.svc.reschedule(token, { start: '' })).toEqual({ ok: false, error: 'invalid', fields: { start: 'required' } });
    expect(await t.svc.reschedule(token, { start: '2026-12-01T15:00:00' })).toEqual({ ok: false, error: 'invalid', fields: { start: 'invalid' } });
    expect(await t.svc.reschedule(token, null)).toEqual({ ok: false, error: 'invalid', fields: { start: 'required' } });
  });

  it('a cancelled booking cannot be rescheduled', async () => {
    const t = await withLead();
    const token = tokenOf((await bookSlot(t, t.slot)).manageUrl);
    await t.svc.cancel(token);
    expect(await t.svc.reschedule(token, { start: t.slots[3].start })).toEqual({ ok: false, error: 'too_late' });
    expect(await t.store.getBookingByToken(token)).toMatchObject({ status: 'cancelled', start: t.slot.start });
  });

  it('Google failing while the event moves restores the old time (server_error)', async () => {
    const t = await withLead();
    const other = await addLead(t.svc, { email: 'other@example.com' });
    const out = await bookSlot(t, t.slot);
    const token = tokenOf(out.manageUrl);
    const row = await rowFor(t, out.manageUrl);
    await t.store.updateBooking(row.id, { reminder24hSentAt: NOW }, NOW);
    forgetEmails(t);

    vi.spyOn(t.calendar, 'moveEvent').mockRejectedValue(new CalendarUnavailableError());
    expect(await t.svc.reschedule(token, { start: t.slots[3].start })).toEqual({ ok: false, error: 'server_error' });
    const after = await t.store.getBookingByToken(token);
    expect(after).toMatchObject({ status: 'booked', start: t.slot.start, end: t.slot.end });
    expect(after?.reminder24hSentAt).toEqual(NOW);
    expect(after?.reminder1hSentAt).toBeUndefined();
    expect(t.calendar.events.get('ev-1')).toMatchObject({ start: t.slot.start });
    expect(t.sent).toEqual([]);
    // The old time is still the booking's, and the new one is free again.
    expect(await t.svc.book({ leadId: other, start: t.slot.start, visitorTz: 'UTC' }, {})).toEqual({ ok: false, error: 'slot_taken' });
    expect(await t.svc.book({ leadId: other, start: t.slots[3].start, visitorTz: 'UTC' }, {})).toMatchObject({ ok: true });
  });

  it('Google being down at the start of a reschedule is server_error and changes nothing', async () => {
    const t = await withLead();
    const token = tokenOf((await bookSlot(t, t.slot)).manageUrl);
    forgetEmails(t);
    t.calendar.setDown(true);
    expect(await t.svc.reschedule(token, { start: t.slots[3].start })).toEqual({ ok: false, error: 'server_error' });
    expect(await t.store.getBookingByToken(token)).toMatchObject({ start: t.slot.start });
    expect(t.sent).toEqual([]);
  });

  it('an email failure does not fail the reschedule or the cancel', async () => {
    const t = await withLead();
    const token = tokenOf((await bookSlot(t, t.slot)).manageUrl);
    const failing = createBookingService({ ...t.deps, notifier: { send: async () => { throw new Error('smtp down'); } } });
    expect(await failing.reschedule(token, { start: t.slots[3].start })).toMatchObject({ ok: true, value: { start: t.slots[3].start } });
    expect(await failing.cancel(token)).toEqual({ ok: true, value: { status: 'cancelled' } });
    expect(warn).toHaveBeenCalledTimes(4);
  });
});

describe('getManaged', () => {
  it('an unknown token is null', async () => {
    const t = await withLead();
    expect(await t.svc.getManaged('no-such-token')).toBeNull();
  });

  it('gives the booking, the lead and what the visitor may still do', async () => {
    const t = await withLead();
    const out = await bookSlot(t, t.slot);
    const m = await t.svc.getManaged(tokenOf(out.manageUrl));
    expect(m).toMatchObject({ booking: { status: 'booked', start: t.slot.start, meetUrl: out.meetUrl }, lead: { publicId: t.leadId, email: 'zoe+ads@example.com' }, canCancel: true, canReschedule: true });
  });

  it('cancel works until the start, reschedule until 60 minutes before', async () => {
    const t = await withLead();
    const token = tokenOf((await bookSlot(t, t.slot)).manageUrl);
    const can = async (at: Date) => { t.clock.set(at); const m = await t.svc.getManaged(token); return [m?.canCancel, m?.canReschedule]; };
    expect(await can(minutesBefore(t.slot.start, 120))).toEqual([true, true]);
    expect(await can(minutesBefore(t.slot.start, 60))).toEqual([true, true]);
    expect(await can(minutesBefore(t.slot.start, 59))).toEqual([true, false]);
    expect(await can(new Date(Date.parse(t.slot.start) - 1))).toEqual([true, false]);
    expect(await can(new Date(t.slot.start))).toEqual([false, false]);
    expect(await can(new Date(Date.parse(t.slot.start) + 30 * MIN))).toEqual([false, false]);
  });

  it('a requested booking can be cancelled but not rescheduled; a cancelled one neither', async () => {
    const t = await withLead();
    t.calendar.setDown(true);
    const token = tokenOf((await bookSlot(t, t.slot)).manageUrl);
    expect(await t.svc.getManaged(token)).toMatchObject({ booking: { status: 'requested' }, canCancel: true, canReschedule: false });
    await t.svc.cancel(token);
    expect(await t.svc.getManaged(token)).toMatchObject({ booking: { status: 'cancelled' }, canCancel: false, canReschedule: false });
  });
});

describe('isActive', () => {
  it('booked and requested hold a slot; cancelled does not', () => {
    expect([isActive('booked'), isActive('requested'), isActive('cancelled')]).toEqual([true, true, false]);
  });
});
