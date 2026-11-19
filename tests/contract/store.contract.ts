import { it, expect } from 'vitest';
import { SlotConflictError, type NewBooking, type NewLead, type Store, type TrackingRecord } from '../../src/server/booking/types';

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
    await store.insertBooking(booking(a.id, 1), T0);
    const mine = await store.insertBooking(booking(b.id, 2), T0);

    await expect(store.updateBooking(mine.id, { start: slot(1), end: slotEnd(1) }, at(5))).rejects.toBeInstanceOf(SlotConflictError);
    expect(await store.getBookingByToken(mine.manageToken)).toEqual(mine);

    // Moving to a free start works, and frees the old one.
    const moved = await store.updateBooking(mine.id, { start: slot(3), end: slotEnd(3) }, at(6));
    expect(moved).toMatchObject({ start: slot(3), end: slotEnd(3), updatedAt: at(6) });
    await store.insertBooking(booking(a.id, 2, { status: 'requested' }), at(7));

    // Re-activating a cancelled booking onto a taken start is refused too, and it stays cancelled.
    const old = await store.insertBooking(booking(b.id, 1, { status: 'cancelled' }), at(8));
    await expect(store.updateBooking(old.id, { status: 'booked' }, at(9))).rejects.toBeInstanceOf(SlotConflictError);
    expect(await store.getBookingByToken(old.manageToken)).toMatchObject({ status: 'cancelled', start: slot(1) });
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
