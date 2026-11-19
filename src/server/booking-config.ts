import { clientMode, type ServerConfig } from './config';

/** Cloudflare's published test key for Turnstile: always passes, so the test server needs no account. */
export const TURNSTILE_TEST_SITE_KEY = '1x00000000000000000000AA';

/**
 * The body of GET /api/booking/config. The site key is looked up (through `readSiteKey`) only when
 * the real form is shown; demo and off never need it, so they never touch the content files.
 */
export function bookingConfigResponse(config: ServerConfig, readSiteKey: () => string | undefined): { mode: 'live' | 'demo' | 'off'; turnstileSiteKey?: string } {
  const mode = clientMode(config);
  if (config.mode === 'fakes') return { mode, turnstileSiteKey: TURNSTILE_TEST_SITE_KEY };
  if (mode !== 'live') return { mode };
  return { mode, turnstileSiteKey: readSiteKey() || undefined };
}
