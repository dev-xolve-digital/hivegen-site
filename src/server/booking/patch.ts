import type { Booking, BookingPatch } from './types';

/**
 * A copy of `booking` with the patch applied, shared by every store so they agree on what a patch means:
 * a value replaces the field, a missing or `undefined` key keeps it, `null` clears it (the types allow that for optional fields only).
 */
export function applyBookingPatch(booking: Booking, patch: BookingPatch, now: Date): Booking {
  const next: Record<string, unknown> = { ...booking, updatedAt: new Date(now) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (value === null) delete next[key];
    else next[key] = structuredClone(value);
  }
  return next as unknown as Booking;
}
