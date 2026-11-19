import type { APIRoute } from 'astro';
import { loadSite } from '../../../lib/content/load';
import { clientMode, readServerConfig } from '../../../server/config';
import { loadDotEnv } from '../../../server/env';

export const prerender = false;

/** Cloudflare's published test key for Turnstile: always passes, so the test server needs no account. */
const TURNSTILE_TEST_SITE_KEY = '1x00000000000000000000AA';

loadDotEnv();

/** Tells the booking form which mode to run in, and which Turnstile site key to show. */
export const GET: APIRoute = () => {
  const config = readServerConfig(process.env);
  const turnstileSiteKey = config.mode === 'fakes' ? TURNSTILE_TEST_SITE_KEY : loadSite().settings.turnstileSiteKey || undefined;
  return Response.json({ mode: clientMode(config), turnstileSiteKey });
};
