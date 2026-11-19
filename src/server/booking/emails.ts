import type { ActiveStatus } from './status';
import type { EmailData, EmailKind, Notifier } from './types';

/**
 * The first two emails of a booking, by its status: to the visitor and to Hassan. `book()` sends them and cron sends them again
 * when one did not go out, so both ask here: a retried email is always the one that was meant the first time.
 */
export const bookingEmailKinds = (status: ActiveStatus): [toVisitor: EmailKind, toHassan: EmailKind] =>
  status === 'booked' ? ['booking-confirmed', 'hassan-new-booking'] : ['booking-requested', 'hassan-confirm-by-hand'];

/** One short line for the server log. It names what failed and the kind of error, never the error's message or anything about the visitor. */
export const logFailure = (area: 'booking' | 'cron', what: string, e: unknown) =>
  console.warn(`${area}: ${what} (${e instanceof Error ? e.name : 'unknown error'})`);

/**
 * A function that sends one email and reports whether it went out. A failure is logged and reported as `false`; it never throws,
 * so the caller can leave the email unmarked and try again later.
 */
export const emailSender = (notifier: Notifier, area: 'booking' | 'cron') => async (kind: EmailKind, data: EmailData): Promise<boolean> => {
  try {
    await notifier.send(kind, data);
    return true;
  } catch (e) {
    logFailure(area, `email ${kind} not sent`, e);
    return false;
  }
};
