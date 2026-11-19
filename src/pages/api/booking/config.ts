import type { APIRoute } from 'astro';
import { loadTurnstileSiteKey } from '../../../lib/content/load';
import { bookingConfigResponse } from '../../../server/booking-config';
import { readServerConfig } from '../../../server/config';
import { loadDotEnv } from '../../../server/env';

export const prerender = false;

loadDotEnv();

/** A site.yaml that cannot be read must not take the endpoint down: the form just gets no site key. */
function readSiteKey(): string | undefined {
  try {
    return loadTurnstileSiteKey();
  } catch (e) {
    console.error(`booking config: could not read the Turnstile site key from site.yaml (${e instanceof Error ? e.message : e})`);
    return undefined;
  }
}

/** Tells the booking form which mode to run in, and which Turnstile site key to show. */
export const GET: APIRoute = () => Response.json(bookingConfigResponse(readServerConfig(process.env), readSiteKey));
