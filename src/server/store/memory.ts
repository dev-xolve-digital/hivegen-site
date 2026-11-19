import {
  SlotConflictError,
  type Booking, type BookingPatch, type Lead, type NewBooking, type NewLead, type Store, type TrackingRecord,
} from '../booking/types';
import { isActive } from '../booking/status';

/**
 * The booking store kept in memory: the test server's fake mode and the reference for the MySQL store,
 * which has to behave the same (tests/contract/store.contract.ts runs against both).
 * Everything handed in or out is a copy, so a caller can never change what is stored.
 */
const copy = <T>(value: T): T => structuredClone(value);
/** Fields a patch sets, leaving out the ones given as `undefined` (lead and tracking updates never clear a field). */
const defined = <T extends object>(patch: T): Partial<T> => Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<T>;

export function createMemoryStore(): Store {
  const leads: Lead[] = [];
  const bookings: Booking[] = [];
  const tracking = new Map<string, TrackingRecord>();

  const leadById = (id: number) => leads.find((l) => l.id === id);
  const heldBy = (start: string, exceptId?: number) => bookings.some((b) => isActive(b.status) && b.start === start && b.id !== exceptId);
  const inRange = (iso: string, from: string, to: string) => Date.parse(iso) >= Date.parse(from) && Date.parse(iso) < Date.parse(to);

  return {
    async createLead(l: NewLead, now: Date) {
      const lead: Lead = { ...copy(l), id: leads.length + 1, createdAt: new Date(now), status: 'started' };
      leads.push(lead);
      return copy(lead);
    },
    async getLead(id) {
      const l = leadById(id);
      return l ? copy(l) : null;
    },
    async getLeadByPublicId(publicId) {
      const l = leads.find((x) => x.publicId === publicId);
      return l ? copy(l) : null;
    },
    async updateLead(id, patch) {
      const l = leadById(id);
      if (l) Object.assign(l, copy(defined(patch)));
    },

    async insertBooking(b: NewBooking, now: Date) {
      if (isActive(b.status) && heldBy(b.start)) throw new SlotConflictError();
      const booking: Booking = { ...copy(b), id: bookings.length + 1, createdAt: new Date(now), updatedAt: new Date(now) };
      bookings.push(booking);
      return copy(booking);
    },
    async updateBooking(id, patch: BookingPatch, now: Date) {
      const current = bookings.find((b) => b.id === id);
      if (!current) throw new Error(`booking ${id} not found`);
      // A key in the patch replaces the field, and `undefined` clears it; a key left out keeps it.
      const next: Booking = { ...current, ...copy(patch), updatedAt: new Date(now) };
      // Checked before anything is written, so a refused move leaves the booking as it was.
      if (isActive(next.status) && heldBy(next.start, id)) throw new SlotConflictError();
      Object.assign(current, next);
      return copy(current);
    },
    async getActiveBookingForLead(leadId) {
      const found = bookings.filter((b) => b.leadId === leadId && isActive(b.status)).at(-1);
      return found ? copy(found) : null;
    },
    async getBookingByToken(token) {
      const found = bookings.find((b) => b.manageToken === token);
      return found ? copy(found) : null;
    },
    async bookingsStartingBetween(fromIso, toIso) {
      return bookings.filter((b) => inRange(b.start, fromIso, toIso))
        .sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || a.id - b.id).map(copy);
    },
    async bookingsCreatedSince(iso) {
      return bookings.filter((b) => b.createdAt.getTime() >= Date.parse(iso))
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id).map(copy);
    },
    async leadsCreatedBetween(fromIso, toIso) {
      return leads.filter((l) => inRange(l.createdAt.toISOString(), fromIso, toIso))
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id).map(copy);
    },

    async recordTrackingEvent(r) {
      if (!tracking.has(r.eventId)) tracking.set(r.eventId, copy(r));
    },
    async updateTrackingEvent(eventId, patch) {
      const r = tracking.get(eventId);
      if (r) Object.assign(r, defined(patch));
    },
    async trackingEventsByStatus(status) {
      return [...tracking.values()].filter((r) => r.status === status).map(copy);
    },
  };
}
