import { formatSlotLong } from '../../lib/booking/format';
import type { BookingService } from './service';
import type { BookingStatus } from './types';

/** What the manage page shows about one booking: the visitor's own call and what they may do with it. Nothing about the lead goes in here. */
export interface ManageView {
  /** The secret in the page's own address; the page's script needs it to call the manage routes. */
  token: string;
  status: BookingStatus;
  start: string;
  end: string;
  visitorTz: string;
  /** The call time, with its time zone, in the zone the visitor booked in, e.g. "Monday, December 7, 9:00 AM EST". */
  when: string;
  /** Only an https address. */
  meetUrl?: string;
  canCancel: boolean;
  canReschedule: boolean;
}

/** What the page can be: a booking, a link that is not one, or a server that cannot answer (not connected, or its lookup failed). */
export type ManageState = { kind: 'found'; view: ManageView } | { kind: 'not_found' } | { kind: 'error' };

type Managed = NonNullable<Awaited<ReturnType<BookingService['getManaged']>>>;

/** The page's view of a booking found by its manage link. */
export function toManageView({ booking, canCancel, canReschedule }: Managed): ManageView {
  return {
    token: booking.manageToken,
    status: booking.status,
    start: booking.start,
    end: booking.end,
    visitorTz: booking.visitorTz,
    when: formatSlotLong(booking, booking.visitorTz),
    ...(booking.meetUrl?.startsWith('https://') && { meetUrl: booking.meetUrl }),
    canCancel,
    canReschedule,
  };
}
