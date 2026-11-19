import type { BookingStatus } from './types';

export type ActiveStatus = Exclude<BookingStatus, 'cancelled'>;

/** A booking is active while it is booked or requested. Only an active booking holds its start; a cancelled one holds nothing. */
export const isActive = (status: BookingStatus): status is ActiveStatus => status === 'booked' || status === 'requested';
