import { clientMode, type ServerConfig } from './config';

/** Cloudflare's published test key for Turnstile: always passes, so the test server needs no account. */
export const TURNSTILE_TEST_SITE_KEY = '1x00000000000000000000AA';

let saidNoSiteKey = false;

/**
 * The body of GET /api/booking/config. The site key is looked up (through `readSiteKey`) only when
 * the real form is shown; demo and off never need it, so they never touch the content files.
 * Live in production with no site key is off (said once in the log): the bot check could never pass, so the form would refuse every visitor.
 * Outside production the form is shown anyway, so a developer can try booking without a Turnstile account.
 */
export function bookingConfigResponse(config: ServerConfig, readSiteKey: () => string | undefined): { mode: 'live' | 'demo' | 'off'; turnstileSiteKey?: string } {
  const mode = clientMode(config);
  if (config.mode === 'fakes') return { mode, turnstileSiteKey: TURNSTILE_TEST_SITE_KEY };
  if (mode !== 'live') return { mode };
  const turnstileSiteKey = readSiteKey() || undefined;
  if (!turnstileSiteKey && config.production) {
    if (!saidNoSiteKey) {
      saidNoSiteKey = true;
      console.error('booking: the Turnstile site key (turnstileSiteKey in content/site.yaml) is empty, so the booking form is switched off and the offline card shows. Add the public site key and deploy again.');
    }
    return { mode: 'off' };
  }
  return { mode, turnstileSiteKey };
}
