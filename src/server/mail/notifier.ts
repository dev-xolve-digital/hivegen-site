import { formatSlotLong } from '../../lib/booking/format';
import { loadEmailSite } from '../../lib/content/load';
import { manageUrl } from '../booking/links';
import type { Attribution, EmailData, EmailKind, Notifier } from '../booking/types';
import type { Mailer } from './mailer';
import { renderEmail } from './render';

/** Shown for a detail the visitor left out. */
const DASH = '—';

/** Where the visitor came from: the ad tags, or the kind of ad when only a click id is left. */
function sourceOf(a: Attribution): string {
  if (a.utm_source && a.utm_campaign) return `${a.utm_source} / ${a.utm_campaign}`;
  if (a.utm_source) return a.utm_source;
  if (a.fbclid) return 'facebook ad';
  if (a.gclid) return 'google ad';
  return 'direct';
}

/**
 * Sends each kind of email to the right person: visitor emails to the lead, `hassan-*` emails to Hassan.
 * A failure (wording that cannot be filled in, or a mailer that cannot send) is thrown, so the caller can try again later.
 */
export function createNotifier(o: { mailer: Mailer; hassanEmail: string; siteUrl: string; hassanTz: string }): Notifier {
  /** A time in a zone, e.g. "Wednesday, December 2, 9:00 AM EST". Only the start is shown. */
  const at = (startIso: string, timeZone: string) => formatSlotLong({ start: startIso, end: startIso }, timeZone);

  /** The value for each {placeholder} the data can fill. A value that is not there (no Meet link, no previous time) is left out. */
  function valuesFor(kind: EmailKind, { lead, booking, previousStart, change }: EmailData): Record<string, string> {
    const forHassan = kind.startsWith('hassan-');
    const values: Record<string, string> = { name: lead.name ?? (forHassan ? DASH : '') };
    if (forHassan) {
      Object.assign(values, {
        email: lead.email, phone: lead.phone ?? DASH, buyerType: lead.buyerType ?? DASH, volume: lead.volume ?? DASH,
        footageUrl: lead.footageUrl ?? DASH, pageVersion: lead.pageVersion, source: sourceOf(lead.attribution),
      });
      if (booking) values.whenPakistan = at(booking.start, o.hassanTz);
    }
    if (booking) {
      values.when = at(booking.start, booking.visitorTz);
      values.timezone = booking.visitorTz.replace(/_/g, ' ');
      values.manageUrl = manageUrl(o.siteUrl, booking.manageToken);
      if (booking.meetUrl) values.meetUrl = booking.meetUrl;
      if (previousStart) values.previousWhen = at(previousStart, booking.visitorTz);
    }
    if (change) values.change = change;
    return values;
  }

  return {
    async send(kind, data) {
      if (kind !== 'hassan-new-lead' && !data.booking) throw new Error(`${kind} needs a booking`);
      const message = renderEmail(kind, valuesFor(kind, data), o.siteUrl);
      await o.mailer.send({
        to: kind.startsWith('hassan-') ? o.hassanEmail : data.lead.email,
        ...message,
        replyTo: loadEmailSite().replyTo,
        tag: kind,
      });
    },
  };
}
