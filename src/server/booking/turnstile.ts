const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Asks Cloudflare whether a Turnstile token is real. Any failure (no answer, a bad answer,
 * a network error, a slow reply) counts as "not verified": it never throws.
 */
export async function verifyTurnstile(token: string, ip: string | undefined, secret: string, fetchFn: typeof fetch = fetch): Promise<boolean> {
  if (!token) return false;
  try {
    const form = new URLSearchParams({ secret, response: token });
    if (ip) form.set('remoteip', ip);
    const res = await fetchFn(SITEVERIFY, { method: 'POST', body: form, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return false;
    const answer = await res.json() as { success?: unknown } | null;
    return answer?.success === true;
  } catch {
    return false;
  }
}
