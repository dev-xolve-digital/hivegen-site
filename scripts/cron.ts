/**
 * Runs the scheduled work once, the way Hostinger's cron job does: `npm run cron`.
 * POSTs to ${PUBLIC_SITE_URL}/api/cron/run (default http://localhost:4321) with CRON_SECRET from the environment or from `.env`,
 * prints the summary, and exits non-zero when the site answers anything but 200.
 */
import { loadDotEnv } from '../src/server/env';

loadDotEnv();
const secret = process.env.CRON_SECRET?.trim();
if (!secret) {
  console.error('CRON_SECRET is not set. Put it in .env (see .env.example) or in the environment.');
  process.exit(1);
}
const site = (process.env.PUBLIC_SITE_URL?.trim() || 'http://localhost:4321').replace(/\/+$/, '');
const url = `${site}/api/cron/run`;

let response: Response;
try {
  response = await fetch(url, { method: 'POST', headers: { 'x-cron-secret': secret }, signal: AbortSignal.timeout(60_000) });
} catch (error) {
  console.error(`Could not reach ${url} (${error instanceof Error ? error.name : 'unknown error'}). Is the site running?`);
  process.exit(1);
}

const text = await response.text();
let body: unknown;
try {
  body = JSON.parse(text);
} catch {
  body = undefined;
}
if (response.status !== 200) {
  const reason = (body as { error?: unknown } | undefined)?.error;
  console.error(`The site answered ${response.status}${typeof reason === 'string' ? ` (${reason})` : ''}.`);
  process.exit(1);
}
console.log(JSON.stringify(body ?? text, null, 2));
