import { TURNSTILE_ACTION } from '../../lib/booking/api-client';

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** What a token must have been made for: the booking form's action, on this site's own address. */
export interface TurnstileExpected { action: string; hostname: string }

/** The booking form's action on the host of `siteUrl` (PUBLIC_SITE_URL). An address that is not a URL expects no host, so nothing passes. */
export function turnstileExpectation(siteUrl: string): TurnstileExpected {
  let hostname = '';
  try {
    hostname = new URL(siteUrl).hostname;
  } catch { /* not a URL */ }
  return { action: TURNSTILE_ACTION, hostname };
}

/** A value from Cloudflare's answer, made safe for one log line. */
const shown = (v: unknown) => JSON.stringify(String(v ?? '').slice(0, 100));

/**
 * Asks Cloudflare whether a Turnstile token is real, and made by the booking form on this site's address (the widget also allows
 * localhost, so a token from a copy of the site on someone's computer must not count here). Any failure (no answer, a bad answer,
 * a network error, a slow reply) counts as "not verified": it never throws.
 */
export async function verifyTurnstile(token: string, ip: string | undefined, secret: string, expected: TurnstileExpected, fetchFn: typeof fetch = fetch): Promise<boolean> {
  if (!token) return false;
  try {
    const form = new URLSearchParams({ secret, response: token });
    if (ip) form.set('remoteip', ip);
    const res = await fetchFn(SITEVERIFY, { method: 'POST', body: form, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return false;
    const answer = await res.json() as { success?: unknown; action?: unknown; hostname?: unknown } | null;
    if (answer?.success !== true) return false;
    if (expected.hostname !== '' && answer.hostname === expected.hostname && answer.action === expected.action) return true;
    // A real token for the wrong place. Every booking failing this way means PUBLIC_SITE_URL does not match the address visitors use.
    console.warn(`booking: bot check refused: the token was made on ${shown(answer.hostname)} for ${shown(answer.action)}, but this site expects ${shown(expected.hostname)} for ${shown(expected.action)} (is PUBLIC_SITE_URL right?)`);
    return false;
  } catch {
    return false;
  }
}
