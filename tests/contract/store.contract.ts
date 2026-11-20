import { it, expect } from 'vitest';
import { DuplicateRequestError, SlotConflictError, type BookingPatch, type NewBooking, type NewLead, type Store, type TrackingRecord } from '../../src/server/booking/types';

/**
 * The behaviour every Store must have: the memory store and the MySQL store both run these tests.
 * This file is a helper, not a test file (it does not match Vitest's include pattern); a test file
 * calls `storeContract(make)` inside a `describe`. `make` gives a fresh, empty store each time.
 * Dates are whole seconds, because a database may not keep milliseconds.
 */
type Make = () => Promise<{ store: Store; done(): Promise<void> }>;

const T0 = new Date('2026-12-01T10:00:00Z');
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
/** A slot start: the same instants the site offers (20 minutes apart), counted from 2026-12-02T14:00Z. */
const slot = (n: number) => new Date(Date.parse('2026-12-02T14:00:00Z') + n * 20 * 60_000).toISOString();
const slotEnd = (n: number) => new Date(Date.parse(slot(n)) + 15 * 60_000).toISOString();

const lead = (n: number, over: Partial<NewLead> = {}): NewLead => ({
  publicId: `public-id-${n}`, name: `Lead ${n}`, email: `lead${n}@example.com`,
  buyerType: 'agent', volume: '6–15', pageVersion: 'agents', attribution: {}, ...over,
});
const booking = (leadId: number, n: number, over: Partial<NewBooking> = {}): NewBooking => ({
  leadId, start: slot(n), end: slotEnd(n), visitorTz: 'America/New_York', status: 'booked', manageToken: `token-${leadId}-${n}-${Math.random().toString(36).slice(2)}`, ...over,
});
const tracking = (eventId: string, over: Partial<TrackingRecord> = {}): TrackingRecord => ({
  eventId, name: 'Lead', payload: { value: 1 }, status: 'pending', attempts: 0, ...over,
});

async function withStore(make: Make, run: (store: Store) => Promise<void>): Promise<void> {
  const { store, done } = await make();
  try { await run(store); } finally { await done(); }
}

export function storeContract(make: Make): void {
  it('round-trips a lead with non-ASCII text', () => withStore(make, async (store) => {
    const input = lead(1, {
      name: 'Zoë O’Brien', email: 'zoe+ads@example.com', phone: '+1 (555) 010-2000', footageUrl: 'https://drive.google.com/x',
      attribution: { utm_source: 'facebook', fbclid: 'abc' }, fbp: 'fb.1.1.2', fbc: 'fb.1.3.abc', clientIp: '203.0.113.9', userAgent: 'UA',
    });
    const saved = await store.createLead(input, T0);
    expect(saved).toMatchObject({ ...input, status: 'started', createdAt: T0 });
    expect(saved.id).toBeGreaterThan(0);
    expect(await store.getLead(saved.id)).toEqual(saved);
    expect(await store.getLeadByPublicId(input.publicId)).toEqual(saved);
    expect(await store.getLead(saved.id + 1000)).toBeNull();
    expect(await store.getLeadByPublicId('nobody')).toBeNull();

    await store.updateLead(saved.id, { status: 'booked', newLeadNotifiedAt: at(30) }, at(30));
    expect(await store.getLead(saved.id)).toMatchObject({ status: 'booked', newLeadNotifiedAt: at(30), name: 'Zoë O’Brien' });
  }));

  it('an inquiry lead round-trips with only an email', () => withStore(make, async (store) => {
    const input: NewLead = {
      publicId: 'inquiry-id-1', email: 'only@example.com', pageVersion: 'main', attribution: {}, status: 'inquiry',
      needs: ['Listing videos'], message: 'Hi\nthere', requestId: 'req-00000001',
    };
    const saved = await store.createLead(input, T0);
    expect(saved).toMatchObject({ ...input, createdAt: T0 });
    for (const key of ['name', 'buyerType', 'volume', 'phone', 'footageUrl', 'hassanNotifiedAt', 'visitorNotifiedAt'] as const) expect(saved[key]).toBeUndefined();
    expect(await store.getLead(saved.id)).toEqual(saved);
    expect(await store.getLeadByRequestId('req-00000001')).toEqual(saved);
    expect(await store.getLeadByPublicId('inquiry-id-1')).toEqual(saved);

    // An inquiry needs no name, buyer type, volume, needs, message or request id; a lead given no status is 'started'.
    const bare = await store.createLead(lead(2, { status: 'inquiry', name: undefined, buyerType: undefined, volume: undefined }), T0);
    expect(bare).toMatchObject({ status: 'inquiry', email: 'lead2@example.com' });
    expect([bare.needs, bare.message, bare.requestId, bare.name, bare.buyerType, bare.volume]).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
    expect((await store.createLead(lead(3), T0)).status).toBe('started');
  }));

  it('a repeated requestId throws DuplicateRequestError and stores nothing; leads without one never collide', () => withStore(make, async (store) => {
    const first = await store.createLead(lead(1, { requestId: 'req-00000001', status: 'inquiry' }), T0);
    await expect(store.createLead(lead(2, { requestId: 'req-00000001', status: 'inquiry' }), at(1))).rejects.toBeInstanceOf(DuplicateRequestError);
    await expect(store.createLead(lead(2, { requestId: 'req-00000001', status: 'inquiry' }), at(1))).rejects.toThrow('duplicate_request');
    expect(await store.getLeadByPublicId('public-id-2')).toBeNull();
    expect(await store.getLeadByRequestId('req-00000001')).toEqual(first);
    expect(await store.leadsCreatedBetween(at(-60).toISOString(), at(60).toISOString())).toEqual([first]);

    // Another request id is another send; no request id at all is never "the same send".
    const other = await store.createLead(lead(2, { requestId: 'req-00000002' }), at(2));
    const plainA = await store.createLead(lead(3), at(3));
    const plainB = await store.createLead(lead(4), at(4));
    expect(new Set([first.id, other.id, plainA.id, plainB.id]).size).toBe(4);
    expect((await store.leadsCreatedBetween(at(-60).toISOString(), at(60).toISOString())).map((l) => l.id)).toEqual([first.id, other.id, plainA.id, plainB.id]);
  }));

  it('request ids match exactly: letters of a different case are a different id', () => withStore(make, async (store) => {
    const upper = await store.createLead(lead(1, { requestId: 'req-ABC-00001' }), T0);
    const lower = await store.createLead(lead(2, { requestId: 'req-abc-00001' }), T0);
    expect(lower.id).not.toBe(upper.id);
    expect(await store.getLeadByRequestId('req-ABC-00001')).toEqual(upper);
    expect(await store.getLeadByRequestId('req-abc-00001')).toEqual(lower);
    expect(await store.getLeadByRequestId('req-Abc-00001')).toBeNull();
    await expect(store.createLead(lead(3, { requestId: 'req-abc-00001' }), T0)).rejects.toBeInstanceOf(DuplicateRequestError);
  }));

  it('getLeadByRequestId of an unknown id is null', () => withStore(make, async (store) => {
    await store.createLead(lead(1), T0);
    await store.createLead(lead(2, { requestId: 'req-00000001' }), T0);
    expect(await store.getLeadByRequestId('req-00000002')).toBeNull();
    expect(await store.getLeadByRequestId('')).toBeNull();
  }));

  it('updateLead sets hassanNotifiedAt and visitorNotifiedAt; undefined keeps them', () => withStore(make, async (store) => {
    const a = await store.createLead(lead(1, { status: 'inquiry' }), T0);
    await store.updateLead(a.id, { hassanNotifiedAt: at(1) }, at(1));
    const afterHassan = await store.getLead(a.id);
    expect(afterHassan).toMatchObject({ status: 'inquiry', hassanNotifiedAt: at(1) });
    expect(afterHassan!.visitorNotifiedAt).toBeUndefined();

    await store.updateLead(a.id, { visitorNotifiedAt: at(2), status: 'booked' }, at(2));
    expect(await store.getLead(a.id)).toMatchObject({ status: 'booked', hassanNotifiedAt: at(1), visitorNotifiedAt: at(2) });

    await store.updateLead(a.id, { hassanNotifiedAt: undefined, visitorNotifiedAt: undefined, newLeadNotifiedAt: undefined }, at(3));
    const kept = await store.getLead(a.id);
    expect(kept).toMatchObject({ status: 'booked', hassanNotifiedAt: at(1), visitorNotifiedAt: at(2) });
    expect(kept!.newLeadNotifiedAt).toBeUndefined();
  }));

  it('a taken start throws SlotConflictError; cancelling frees it', () => withStore(make, async (store) => {
    const a = await store.createLead(lead(1), T0);
    const b = await store.createLead(lead(2), T0);
    const first = await store.insertBooking(booking(a.id, 1), T0);
    await expect(store.insertBooking(booking(b.id, 1, { status: 'requested' }), T0)).rejects.toBeInstanceOf(SlotConflictError);

    const cancelled = await store.updateBooking(first.id, { status: 'cancelled' }, at(5));
    expect(cancelled.status).toBe('cancelled');
    const second = await store.insertBooking(booking(b.id, 1), at(6));
    expect(second.start).toBe(slot(1));
    // A cancelled booking holds nothing: any number of them can share a start.
    await store.insertBooking(booking(a.id, 1, { status: 'cancelled' }), at(7));
  }));

  it('two simultaneous inserts of one start: exactly one wins', () => withStore(make, async (store) => {
    const a = await store.createLead(lead(1), T0);
    const b = await store.createLead(lead(2), T0);
    const results = await Promise.allSettled([store.insertBooking(booking(a.id, 2), T0), store.insertBooking(booking(b.id, 2), T0)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(lost).toHaveLength(1);
    expect(lost[0].reason).toBeInstanceOf(SlotConflictError);
  }));

  it('moving onto a taken start throws and leaves the booking unchanged', () => withStore(make, async (store) => {
    const a = await store.createLead(lead(1), T0);
    const b = await store.createLead(lead(2), T0);
    const c = await store.createLead(lead(3), T0);
    const d = await store.createLead(lead(4), T0);
    await store.insertBooking(booking(a.id, 1), T0);
    const mine = await store.insertBooking(booking(b.id, 2), T0);

    await expect(store.updateBooking(mine.id, { start: slot(1), end: slotEnd(1) }, at(5))).rejects.toBeInstanceOf(SlotConflictError);
    expect(await store.getBookingByToken(mine.manageToken)).toEqual(mine);

    // Moving to a free start works, and frees the old one.
    const moved = await store.updateBooking(mine.id, { start: slot(3), end: slotEnd(3) }, at(6));
    expect(moved).toMatchObject({ start: slot(3), end: slotEnd(3), updatedAt: at(6) });
    await store.insertBooking(booking(c.id, 2, { status: 'requested' }), at(7));

    // Re-activating a cancelled booking onto a taken start is refused too, and it stays cancelled.
    // Lead d holds nothing else, so only the start can be the reason.
    const old = await store.insertBooking(booking(d.id, 1, { status: 'cancelled' }), at(8));
    await expect(store.updateBooking(old.id, { status: 'booked' }, at(9))).rejects.toBeInstanceOf(SlotConflictError);
    expect(await store.getBookingByToken(old.manageToken)).toMatchObject({ status: 'cancelled', start: slot(1) });
  }));

  it('a lead cannot hold two active bookings; cancelling the first lets it book again', () => withStore(make, async (store) => {
    const a = await store.createLead(lead(1), T0);
    const b = await store.createLead(lead(2), T0);
    const first = await store.insertBooking(booking(a.id, 1), T0);

    // Another start does not help: booked and requested both count as active.
    await expect(store.insertBooking(booking(a.id, 2, { status: 'requested' }), at(1))).rejects.toBeInstanceOf(SlotConflictError);
    await expect(store.insertBooking(booking(a.id, 3), at(1))).rejects.toBeInstanceOf(SlotConflictError);
    // A refused insert leaves nothing behind: its start is still free for another lead.
    const other = await store.insertBooking(booking(b.id, 2), at(2));
    expect(await store.getActiveBookingForLead(a.id)).toEqual(first);

    // A cancelled booking holds nothing, but it cannot be brought back while the lead has an active one.
    const old = await store.insertBooking(booking(a.id, 4, { status: 'cancelled' }), at(3));
    await expect(store.updateBooking(old.id, { status: 'requested' }, at(4))).rejects.toBeInstanceOf(SlotConflictError);
    expect(await store.getBookingByToken(old.manageToken)).toEqual(old);
    // Changing the active booking itself is not blocked by the rule.
    await store.updateBooking(first.id, { visitorTz: 'UTC', googleEventId: 'ev-1' }, at(4));

    // Cancelling the first lets the lead book again, in any slot the first one freed or another.
    await store.updateBooking(first.id, { status: 'cancelled' }, at(5));
    const again = await store.insertBooking(booking(a.id, 1, { status: 'requested' }), at(6));
    expect(await store.getActiveBookingForLead(a.id)).toEqual(again);
    expect(await store.getActiveBookingForLead(b.id)).toEqual(other);
  }));

  it('two simultaneous inserts for one lead at different starts: exactly one wins', () => withStore(make, async (store) => {
    const a = await store.createLead(lead(1), T0);
    const results = await Promise.allSettled([store.insertBooking(booking(a.id, 5), T0), store.insertBooking(booking(a.id, 6), T0)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(lost).toHaveLength(1);
    expect(lost[0].reason).toBeInstanceOf(SlotConflictError);
    expect(await store.getActiveBookingForLead(a.id)).not.toBeNull();
  }));

  it('finds a booking by token and the active booking for a lead', () => withStore(make, async (store) => {
    const a = await store.createLead(lead(1), T0);
    const b = await store.createLead(lead(2), T0);
    expect(await store.getActiveBookingForLead(a.id)).toBeNull();

    const old = await store.insertBooking(booking(a.id, 1, { status: 'cancelled' }), T0);
    expect(await store.getActiveBookingForLead(a.id)).toBeNull();
    const current = await store.insertBooking(booking(a.id, 2, { status: 'requested' }), at(1));
    expect(current).toMatchObject({ leadId: a.id, status: 'requested', visitorTz: 'America/New_York', createdAt: at(1), updatedAt: at(1) });

    expect(await store.getActiveBookingForLead(a.id)).toEqual(current);
    expect(await store.getActiveBookingForLead(b.id)).toBeNull();
    expect(await store.getBookingByToken(old.manageToken)).toEqual(old);
    expect(await store.getBookingByToken(current.manageToken)).toEqual(current);
    expect(await store.getBookingByToken('no-such-token')).toBeNull();

    const patched = await store.updateBooking(current.id, {
      status: 'booked', googleEventId: 'ev-1', meetUrl: 'https://meet.google.com/abc', visitorNotifiedAt: at(3), hassanNotifiedAt: at(4),
      reminder24hSentAt: at(5), reminder1hSentAt: at(6), visitorTz: 'UTC',
    }, at(7));
    expect(patched).toMatchObject({
      status: 'booked', googleEventId: 'ev-1', meetUrl: 'https://meet.google.com/abc', visitorNotifiedAt: at(3), hassanNotifiedAt: at(4),
      reminder24hSentAt: at(5), reminder1hSentAt: at(6), visitorTz: 'UTC', start: slot(2), updatedAt: at(7), createdAt: at(1),
    });
    expect(await store.getBookingByToken(current.manageToken)).toEqual(patched);
  }));

  it('a booking patch: missing or undefined keeps a field, null clears a clearable one, and start, end and status cannot be cleared', () => withStore(make, async (store) => {
    const a = await store.createLead(lead(1), T0);
    const b = await store.createLead(lead(2), T0);
    const made = await store.insertBooking(booking(a.id, 1), T0);
    await store.updateBooking(made.id, { googleEventId: 'ev-1', meetUrl: 'https://meet.google.com/abc', reminder24hSentAt: at(5), reminder1hSentAt: at(6) }, at(7));

    const added = await store.updateBooking(made.id, { visitorNotifiedAt: at(8) }, at(9));
    expect(added).toMatchObject({ googleEventId: 'ev-1', reminder24hSentAt: at(5), reminder1hSentAt: at(6), visitorNotifiedAt: at(8) });

    // undefined is the same as leaving the key out, for every field: nothing is cleared, and the slot stays held.
    const kept = await store.updateBooking(made.id, {
      status: undefined, start: undefined, end: undefined, googleEventId: undefined, meetUrl: undefined, reminder24hSentAt: undefined, visitorNotifiedAt: undefined,
    }, at(10));
    expect(kept).toMatchObject({ status: 'booked', start: slot(1), end: slotEnd(1), googleEventId: 'ev-1', meetUrl: 'https://meet.google.com/abc',
      reminder24hSentAt: at(5), reminder1hSentAt: at(6), visitorNotifiedAt: at(8), updatedAt: at(10) });
    await expect(store.insertBooking(booking(b.id, 1), at(10))).rejects.toBeInstanceOf(SlotConflictError);

    // null clears a clearable field and leaves the others alone.
    const cleared = await store.updateBooking(made.id, { reminder24hSentAt: null, reminder1hSentAt: null, meetUrl: null }, at(11));
    expect(cleared.reminder24hSentAt).toBeUndefined();
    expect(cleared.reminder1hSentAt).toBeUndefined();
    expect(cleared.meetUrl).toBeUndefined();
    expect(cleared).toMatchObject({ status: 'booked', start: slot(1), googleEventId: 'ev-1', visitorNotifiedAt: at(8), updatedAt: at(11) });
    expect(await store.getBookingByToken(made.manageToken)).toEqual(cleared);

    // A required field cannot be cleared: the type does not allow null there.
    // @ts-expect-error start, end and status are not clearable
    const notAllowed: BookingPatch = { status: null };
    void notAllowed;
  }));

  it('matches tokens and public ids exactly: letters of a different case are a different value', () => withStore(make, async (store) => {
    const upper = await store.createLead(lead(1, { publicId: 'AbCdEfGh' }), T0);
    expect(await store.getLeadByPublicId('AbCdEfGh')).toEqual(upper);
    expect(await store.getLeadByPublicId('abcdefgh')).toBeNull();
    expect(await store.getLeadByPublicId('ABCDEFGH')).toBeNull();

    const made = await store.insertBooking(booking(upper.id, 1, { manageToken: 'Tok-AbC_123' }), T0);
    expect(await store.getBookingByToken('Tok-AbC_123')).toEqual(made);
    expect(await store.getBookingByToken('tok-abc_123')).toBeNull();
    // Two ids that differ only in case are two leads.
    const lower = await store.createLead(lead(2, { publicId: 'abcdefgh' }), T0);
    expect(lower.id).not.toBe(upper.id);
    expect(await store.getLeadByPublicId('abcdefgh')).toEqual(lower);
  }));

  it('getActiveBookingForLead returns the newest active booking, not the newest booking', () => withStore(make, async (store) => {
    const a = await store.createLead(lead(1), T0);
    const first = await store.insertBooking(booking(a.id, 1), at(1));
    await store.updateBooking(first.id, { status: 'cancelled' }, at(2));
    const second = await store.insertBooking(booking(a.id, 2, { status: 'requested' }), at(3));
    await store.updateBooking(second.id, { status: 'cancelled' }, at(4));
    const third = await store.insertBooking(booking(a.id, 3), at(5));
    // A newer booking that is cancelled does not hide the active one.
    await store.insertBooking(booking(a.id, 4, { status: 'cancelled' }), at(6));

    expect(await store.getActiveBookingForLead(a.id)).toEqual(third);
    await store.updateBooking(third.id, { status: 'cancelled' }, at(7));
    expect(await store.getActiveBookingForLead(a.id)).toBeNull();
  }));

  it('updating an unknown booking throws; updating an unknown lead or tracking event does nothing', () => withStore(make, async (store) => {
    await expect(store.updateBooking(9999, { status: 'cancelled' }, T0)).rejects.toThrow(/not found/);
    await expect(store.updateBooking(9999, { status: 'cancelled' }, T0)).rejects.not.toBeInstanceOf(SlotConflictError);
    await expect(store.updateLead(9999, { status: 'booked' }, T0)).resolves.toBeUndefined();
    await expect(store.updateTrackingEvent('no.such.event', { status: 'sent', attempts: 1 }, T0)).resolves.toBeUndefined();
    // Nothing was created by the attempts.
    expect(await store.getLead(9999)).toBeNull();
    expect(await store.trackingEventsByStatus('sent')).toEqual([]);
  }));

  it('a lead or tracking patch: undefined keeps the stored value', () => withStore(make, async (store) => {
    const a = await store.createLead(lead(1), T0);
    await store.updateLead(a.id, { status: 'booked', newLeadNotifiedAt: at(3) }, at(3));
    await store.updateLead(a.id, { status: undefined, newLeadNotifiedAt: undefined }, at(4));
    expect(await store.getLead(a.id)).toMatchObject({ status: 'booked', newLeadNotifiedAt: at(3) });

    await store.recordTrackingEvent(tracking('keep.one'), T0);
    await store.updateTrackingEvent('keep.one', { status: 'failed', attempts: 2, error: 'timeout' }, at(1));
    await store.updateTrackingEvent('keep.one', { status: undefined, attempts: undefined, error: undefined }, at(2));
    expect(await store.trackingEventsByStatus('failed')).toEqual([expect.objectContaining({ eventId: 'keep.one', attempts: 2, error: 'timeout' })]);
  }));

  it('lists bookings starting in a range and leads created in a range', () => withStore(make, async (store) => {
    const a = await store.createLead(lead(1), at(0));
    const b = await store.createLead(lead(2), at(10));
    const c = await store.createLead(lead(3), at(20));
    expect((await store.leadsCreatedBetween(at(10).toISOString(), at(20).toISOString())).map((l) => l.id)).toEqual([b.id]);
    expect((await store.leadsCreatedBetween(at(0).toISOString(), at(21).toISOString())).map((l) => l.id)).toEqual([a.id, b.id, c.id]);
    expect(await store.leadsCreatedBetween(at(30).toISOString(), at(40).toISOString())).toEqual([]);

    // Inserted out of order, with one cancelled: the list is by start and has every status.
    const third = await store.insertBooking(booking(c.id, 3), at(1));
    const first = await store.insertBooking(booking(a.id, 1), at(2));
    const second = await store.insertBooking(booking(b.id, 2, { status: 'cancelled' }), at(3));
    const fourth = await store.insertBooking(booking(b.id, 6), at(4));

    expect((await store.bookingsStartingBetween(slot(1), slot(4))).map((x) => x.id)).toEqual([first.id, second.id, third.id]);
    expect((await store.bookingsStartingBetween(slot(2), slot(3))).map((x) => x.id)).toEqual([second.id]);
    expect(await store.bookingsStartingBetween(slot(4), slot(6))).toEqual([]);

    expect((await store.bookingsCreatedSince(at(3).toISOString())).map((x) => x.id)).toEqual([second.id, fourth.id]);
    expect(await store.bookingsCreatedSince(at(5).toISOString())).toEqual([]);
  }));

  it('records tracking events once per eventId and updates them', () => withStore(make, async (store) => {
    await store.recordTrackingEvent(tracking('lead.one', { leadId: 7, payload: { name: 'Zoë O’Brien', n: [1, 2] } }), T0);
    await store.recordTrackingEvent(tracking('schedule.one', { name: 'Schedule' }), T0);
    // The same eventId again changes nothing.
    await store.recordTrackingEvent(tracking('lead.one', { status: 'sent', attempts: 9, payload: 'other' }), at(1));

    const pending = await store.trackingEventsByStatus('pending');
    expect(pending.map((r) => r.eventId).sort()).toEqual(['lead.one', 'schedule.one']);
    expect(pending.find((r) => r.eventId === 'lead.one')).toEqual({
      eventId: 'lead.one', name: 'Lead', leadId: 7, payload: { name: 'Zoë O’Brien', n: [1, 2] }, status: 'pending', attempts: 0,
    });
    expect(await store.trackingEventsByStatus('sent')).toEqual([]);

    await store.updateTrackingEvent('lead.one', { status: 'failed', attempts: 1, error: 'timeout' }, at(2));
    await store.updateTrackingEvent('lead.one', { status: 'sent', attempts: 2 }, at(3));
    expect(await store.trackingEventsByStatus('failed')).toEqual([]);
    expect(await store.trackingEventsByStatus('sent')).toEqual([expect.objectContaining({ eventId: 'lead.one', attempts: 2, error: 'timeout' })]);
    expect((await store.trackingEventsByStatus('pending')).map((r) => r.eventId)).toEqual(['schedule.one']);
  }));
}
