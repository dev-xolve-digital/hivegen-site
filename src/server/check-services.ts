import { createGoogleCalendar } from './calendar/google';
import { CalendarUnavailableError, type ServerEvent } from './booking/types';
import type { ServerConfig } from './config';
import { createMemoryStore } from './store/memory';
import { signStreamToken } from './stream/sign';
import { createMetaTracker } from './tracking/meta';
import { streamIframeUrl } from '../lib/stream-urls';

/**
 * `npm run check:services`: one check for each service the site talks to, and the words that say what is wrong and what to do.
 * Everything that touches the outside world comes in through `CheckDeps`, so the tests run every case with fakes. Nothing here prints a
 * secret or anything about a person: the lines are made of fixed sentences, the names of settings, and the error codes services use.
 */

/** The names the report uses (the tests look the rows up by them). */
export const SERVICES = {
  database: 'Database (MySQL)',
  google: 'Google Calendar',
  smtp: 'Sending mailbox (SMTP)',
  turnstile: 'Turnstile bot check (secret)',
  turnstileKey: 'Turnstile bot check (site key)',
  meta: 'Meta Conversions API',
  stream: 'Cloudflare Stream signed links',
} as const;

/** Where in HOW-TO-SETUP.md each service is explained. */
const STEP = {
  google: 'step 1 (Google Calendar)',
  database: 'step 2 (the booking database)',
  smtp: 'step 3 (the sending mailbox)',
  meta: 'step 4 (Meta Pixel and Conversions API)',
  turnstile: 'step 6 (the Turnstile bot check)',
  stream: 'step 7 (signed video links)',
} as const;
const see = (step: string) => `See HOW-TO-SETUP.md, ${step}.`;

export interface CheckResult {
  service: string;
  /** Working. A service that is not set up yet is not "ok", and not a failure either (see `notSetUp`). */
  ok: boolean;
  /** The service has no settings yet: it is shown with a pointer to the guide, and does not make the check fail. */
  notSetUp?: boolean;
  detail: string;
  /** What to do. For a service that works, a note instead. */
  fix?: string;
}

/** What the checks need from content/site.yaml and videos.yaml (all public). */
export interface SiteSettings {
  problem?: undefined;
  turnstileSiteKey?: string;
  metaPixelId?: string;
  /** `customerCode` is empty when the site plays its videos from files instead of Stream (settings.videoSource: local). */
  stream: { customerCode?: string; signedUrls: boolean; video?: { id: string; uid: string } };
}
/** The settings, or why they could not be read (a mistake in a content file: its message names the file and the line). */
export type SiteFacts = SiteSettings | { problem: string };

type SmtpSettings = NonNullable<ServerConfig['smtp']>;

export interface CheckDeps {
  /** The raw settings: only used to say which ones are still missing, never to print a value. */
  env: Record<string, string | undefined>;
  fetchFn: typeof fetch;
  now(): Date;
  site: SiteFacts;
  /** The migration files the database has not applied yet. Throws when the database cannot be used. */
  pendingMigrations(databaseUrl: string): Promise<string[]>;
  /** Logs in to the mail server and sends nothing. Throws when it cannot. */
  verifySmtp(smtp: SmtpSettings): Promise<void>;
}

const TIMEOUT_MS = 10_000;

const ok = (service: string, detail: string, fix?: string): CheckResult => ({ service, ok: true, detail, ...(fix && { fix }) });
const failed = (service: string, detail: string, fix?: string): CheckResult => ({ service, ok: false, detail, ...(fix && { fix }) });
const notSetUp = (service: string, step: string, hint = ''): CheckResult => ({ service, ok: false, notSetUp: true, detail: 'not set up yet', fix: `${hint}${hint ? ' ' : ''}${see(step)}` });

/** The names among `names` that have no value in `env`. */
const blank = (env: CheckDeps['env'], names: readonly string[]) => names.filter((n) => !env[n]?.trim());
const still = (missing: string[]) => (missing.length ? `Still missing: ${missing.join(', ')}.` : '');

/** An error's own code (`ECONNREFUSED`, `ER_ACCESS_DENIED_ERROR`, `EAUTH`): a fixed word, so it is safe to show. Its message is never used. */
function codeOf(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && /^[A-Z0-9_]{2,40}$/.test(code)) return code;
  return e instanceof Error && /^[A-Za-z]{1,40}$/.test(e.name) ? e.name : 'unknown error';
}
const unreachable = (e: unknown) => ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EHOSTUNREACH', 'ECONNRESET', 'ENETUNREACH', 'EAI_AGAIN', 'PROTOCOL_CONNECTION_LOST'].includes(codeOf(e));

/** Fixed sentences for a failed MySQL connection, by the error's code. */
function databaseFailure(e: unknown): CheckResult {
  const code = codeOf(e);
  const s = STEP.database;
  if (unreachable(e)) return failed(SERVICES.database, 'could not reach the database server.', `Check the host and port in DATABASE_URL. For a database on Hostinger, also allow this computer's IP address under Databases > Remote MySQL in hPanel. ${see(s)}`);
  if (code === 'ER_ACCESS_DENIED_ERROR') return failed(SERVICES.database, 'the database refused the user name or password.', `Check both in DATABASE_URL. A password with symbols must have them written as codes in the address (@ becomes %40, # becomes %23, / becomes %2F). ${see(s)}`);
  if (code === 'ER_DBACCESS_DENIED_ERROR') return failed(SERVICES.database, 'the user has no access to the database.', `In hPanel, add the user to the database with all privileges. ${see(s)}`);
  if (code === 'ER_BAD_DB_ERROR') return failed(SERVICES.database, 'there is no database with that name on the server.', `Check the database name at the end of DATABASE_URL (the full name hPanel shows, with its prefix). ${see(s)}`);
  if (code === 'ERR_INVALID_URL') return failed(SERVICES.database, 'DATABASE_URL is not a valid address.', `It must look like mysql://user:password@host:3306/database. ${see(s)}`);
  return failed(SERVICES.database, `could not use the database (${code}).`, see(s));
}

async function checkDatabase(config: ServerConfig, deps: CheckDeps): Promise<CheckResult> {
  if (!config.databaseUrl) return notSetUp(SERVICES.database, STEP.database);
  let pending: string[];
  try {
    pending = await deps.pendingMigrations(config.databaseUrl);
  } catch (e) {
    return databaseFailure(e);
  }
  if (pending.length > 0) {
    return failed(SERVICES.database, `connected, but ${pending.length} database ${pending.length === 1 ? 'update is' : 'updates are'} not applied yet (${pending.join(', ')}).`, `Run npm run db:migrate. ${see(STEP.database)}`);
  }
  return ok(SERVICES.database, 'connected, and the database is up to date.');
}

/** Fixed sentences for what Google's answers mean. The messages of CalendarUnavailableError are short fixed reasons such as `google token 400 invalid_grant`. */
function googleFailure(e: unknown): CheckResult {
  const s = STEP.google;
  const reason = e instanceof CalendarUnavailableError ? e.message : '';
  if (/^google token \d+ invalid_grant$/.test(reason)) {
    return failed(SERVICES.google, "Hassan's Google sign-in has expired or was revoked.", `Run npm run google:connect again with Hassan, and put the new GOOGLE_REFRESH_TOKEN in .env and in hPanel. Make sure the consent screen is In production: while it says Testing, Google ends the sign-in after 7 days. ${see(s)}`);
  }
  if (/^google token \d+ (invalid_client|unauthorized_client)$/.test(reason)) {
    return failed(SERVICES.google, 'Google does not accept the client ID or secret.', `Copy GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET again from Google Cloud > APIs & Services > Credentials (the OAuth client of type "Desktop app"). If you made a new client, run npm run google:connect again. ${see(s)}`);
  }
  if (/unreachable|timed out/.test(reason)) {
    return failed(SERVICES.google, 'could not reach Google.', 'Check the internet connection and run this again.');
  }
  if (/^google freeBusy 403$/.test(reason)) {
    return failed(SERVICES.google, 'Google refused to share the calendar.', `In Google Cloud, make sure the Google Calendar API is enabled for the project, then run npm run google:connect again and tick both calendar permissions. ${see(s)}`);
  }
  if (/^google freeBusy 404$/.test(reason) || reason === 'google freeBusy calendar error') {
    return failed(SERVICES.google, 'the calendar was not found or cannot be read.', `Check GOOGLE_CALENDAR_ID (leave it empty to use Hassan's main calendar). ${see(s)}`);
  }
  if (/^google [a-zA-Z]+ [\w ]{1,40}$/.test(reason)) return failed(SERVICES.google, `Google answered unexpectedly (${reason}).`, see(s));
  return failed(SERVICES.google, `could not check the calendar (${codeOf(e)}).`, see(s));
}

async function checkGoogle(config: ServerConfig, deps: CheckDeps): Promise<CheckResult> {
  if (!config.google) {
    const missing = blank(deps.env, ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN']);
    const connect = missing.includes('GOOGLE_REFRESH_TOKEN') && missing.length < 3 ? 'Run npm run google:connect to get the refresh token.' : '';
    return notSetUp(SERVICES.google, STEP.google, [missing.length < 3 ? still(missing) : '', connect].filter(Boolean).join(' '));
  }
  const from = deps.now();
  try {
    const busy = await createGoogleCalendar(config.google, deps.fetchFn, TIMEOUT_MS).busy(from.toISOString(), new Date(from.getTime() + 3_600_000).toISOString());
    return ok(SERVICES.google, `signed in, and read the calendar for the next hour (${busy.length} busy ${busy.length === 1 ? 'period' : 'periods'}).`);
  } catch (e) {
    return googleFailure(e);
  }
}

async function checkSmtp(config: ServerConfig, deps: CheckDeps): Promise<CheckResult> {
  const names = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM'] as const;
  if (!config.smtp) {
    const missing = blank(deps.env, names);
    const port = Number(deps.env.SMTP_PORT?.trim());
    const badPort = deps.env.SMTP_PORT?.trim() && !(Number.isInteger(port) && port > 0 && port <= 65535) ? ['SMTP_PORT (it must be a number, such as 465)'] : [];
    const all = [...missing, ...badPort];
    return notSetUp(SERVICES.smtp, STEP.smtp, all.length < names.length ? still(all) : '');
  }
  try {
    await deps.verifySmtp(config.smtp);
  } catch (e) {
    const code = codeOf(e);
    if (code === 'EAUTH') return failed(SERVICES.smtp, 'the mail server refused the login.', `Check SMTP_USER (usually the full address of the mailbox) and SMTP_PASS. ${see(STEP.smtp)}`);
    if (unreachable(e) || ['ECONNECTION', 'ESOCKET', 'EDNS', 'ETLS', 'EPROTOCOL'].includes(code)) {
      return failed(SERVICES.smtp, 'could not connect to the mail server.', `Check SMTP_HOST and SMTP_PORT. 465 is the usual port; if it does not work, try 587. ${see(STEP.smtp)}`);
    }
    return failed(SERVICES.smtp, `the mail server check failed (${code}).`, see(STEP.smtp));
  }
  return ok(SERVICES.smtp, 'logged in to the mail server (nothing was sent).');
}

/**
 * What Cloudflare's answer to a made-up visitor token says about the secret. Cloudflare checks the secret first: a real secret gets
 * "invalid-input-response" (the token is no good, as expected), a wrong one "invalid-input-secret".
 */
export function classifyTurnstile(answer: unknown): { ok: boolean; detail: string; fix?: string } {
  const body = answer !== null && typeof answer === 'object' && !Array.isArray(answer) ? answer as { success?: unknown; 'error-codes'?: unknown } : undefined;
  if (!body) return { ok: false, detail: 'Cloudflare answered in a way that could not be read.', fix: see(STEP.turnstile) };
  const codes = (Array.isArray(body['error-codes']) ? body['error-codes'] : []).filter((c): c is string => typeof c === 'string' && /^[a-z-]{1,40}$/.test(c));
  if (codes.includes('invalid-input-secret') || codes.includes('missing-input-secret')) {
    return { ok: false, detail: 'Cloudflare does not accept TURNSTILE_SECRET.', fix: `Copy the Secret key (not the Site key) of the Turnstile widget again, from Cloudflare > Turnstile. ${see(STEP.turnstile)}` };
  }
  if (codes.includes('invalid-input-response')) {
    return { ok: true, detail: 'Cloudflare accepted the secret (it only refused the made-up visitor token, as expected).' };
  }
  if (body.success === true) {
    return { ok: true, detail: "Cloudflare accepted a made-up token, so this is one of Cloudflare's test secrets, which lets every visitor through.", fix: `That is fine for trying things out. Before launch, replace it with the real widget's Secret key. ${see(STEP.turnstile)}` };
  }
  return { ok: false, detail: `Cloudflare gave an unexpected answer${codes.length ? ` (${codes.join(', ')})` : ''}.`, fix: see(STEP.turnstile) };
}

async function checkTurnstile(config: ServerConfig, deps: CheckDeps): Promise<CheckResult> {
  if (!config.turnstileSecret) return notSetUp(SERVICES.turnstile, STEP.turnstile);
  let status: number;
  let answer: unknown;
  try {
    const res = await deps.fetchFn('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: new URLSearchParams({ secret: config.turnstileSecret, response: 'hivegen-service-check' }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    status = res.status;
    answer = await res.json().catch(() => undefined);
  } catch {
    return failed(SERVICES.turnstile, 'could not reach Cloudflare.', 'Check the internet connection and run this again.');
  }
  const c = classifyTurnstile(answer);
  return { service: SERVICES.turnstile, ok: c.ok, detail: c.ok || answer !== undefined ? c.detail : `Cloudflare answered with status ${status}.`, ...(c.fix && { fix: c.fix }) };
}

function checkTurnstileKey(config: ServerConfig, deps: CheckDeps): CheckResult {
  if (deps.site.problem !== undefined) return failed(SERVICES.turnstileKey, `could not read content/site.yaml: ${deps.site.problem}`);
  if (deps.site.turnstileSiteKey) return ok(SERVICES.turnstileKey, 'the site key is set in content/site.yaml.');
  if (config.mode === 'live') {
    return failed(SERVICES.turnstileKey, 'settings.turnstileSiteKey in content/site.yaml is empty, so the bot check cannot load and every visitor would be refused.',
      `Paste the Site key (the public one) of the Turnstile widget between the quotes of turnstileSiteKey in content/site.yaml, and restart the app. ${see(STEP.turnstile)}`);
  }
  return notSetUp(SERVICES.turnstileKey, STEP.turnstile, 'It goes in content/site.yaml, as settings.turnstileSiteKey, before launch.');
}

/** Fixed sentences for the short reason the Meta tracker keeps (`http 400 code 190`, `TimeoutError`). */
function metaFailure(reason: string): CheckResult {
  const s = STEP.meta;
  const http = /^http (\d{3})(?: code (\d+))?$/.exec(reason);
  if (http?.[2] === '190') return failed(SERVICES.meta, 'Meta refused the access token.', `Make a new Conversions API token in Events Manager > Data sources > your Pixel > Settings and put it in META_CAPI_TOKEN. ${see(s)}`);
  if (http?.[2] === '100') return failed(SERVICES.meta, 'Meta did not accept the request: the Pixel ID may be wrong, or the token does not belong to this Pixel.', `Check metaPixelId in content/site.yaml and make the token from the same Pixel's settings. ${see(s)}`);
  if (http) return failed(SERVICES.meta, `Meta refused the test event (status ${http[1]}${http[2] ? `, code ${http[2]}` : ''}).`, see(s));
  return failed(SERVICES.meta, 'could not reach Meta, or it did not answer in time.', 'Check the internet connection and run this again.');
}

async function checkMeta(config: ServerConfig, deps: CheckDeps): Promise<CheckResult> {
  if (deps.site.problem !== undefined) return failed(SERVICES.meta, `could not read content/site.yaml: ${deps.site.problem}`);
  const pixelId = deps.site.metaPixelId;
  const meta = config.meta;
  if (!meta && !pixelId) return notSetUp(SERVICES.meta, STEP.meta);
  if (!meta) return notSetUp(SERVICES.meta, STEP.meta, 'The Pixel ID is already in content/site.yaml, so the Pixel in the browser works. For the server-side events, add META_CAPI_TOKEN.');
  if (!pixelId) return failed(SERVICES.meta, 'META_CAPI_TOKEN is set, but metaPixelId in content/site.yaml is empty, so nothing is sent to Meta.', `Put the Pixel ID (digits only) in content/site.yaml, under tracking: metaPixelId. ${see(STEP.meta)}`);
  if (!meta.testEventCode) {
    return ok(SERVICES.meta, 'the token and the Pixel ID are both set. No test event was sent.', 'To try it: put the code from Events Manager > Test events in META_TEST_EVENT_CODE and run this again (remove it again when you are done).');
  }
  const store = createMemoryStore();
  const event: ServerEvent = {
    name: 'Lead', eventId: `service-check-${deps.now().getTime()}`, time: deps.now(), sourceUrl: config.siteUrl,
    user: { ip: '203.0.113.1', userAgent: 'HiveGen service check' },
  };
  await createMetaTracker({ pixelId, token: meta.capiToken, testEventCode: meta.testEventCode, store, fetchFn: deps.fetchFn, timeoutMs: TIMEOUT_MS }).send(event);
  const [refused] = await store.trackingEventsByStatus('failed');
  if (refused) return metaFailure(refused.error ?? '');
  return ok(SERVICES.meta, 'Meta took the test event. In Events Manager > Test events, a "Lead" event from the website should show up within a minute.');
}

async function checkStream(config: ServerConfig, deps: CheckDeps): Promise<CheckResult> {
  if (deps.site.problem !== undefined) return failed(SERVICES.stream, `could not read content/site.yaml: ${deps.site.problem}`);
  const { customerCode, signedUrls, video } = deps.site.stream;
  const s = STEP.stream;
  if (!config.stream) {
    if (signedUrls) {
      return failed(SERVICES.stream, 'settings.streamSignedUrls is true in content/site.yaml, but the signing key is not set, so no video can play.',
        `Set STREAM_SIGNING_KEY_ID and STREAM_SIGNING_KEY_JWK (here and in hPanel), or set streamSignedUrls back to false until you have them. ${see(s)}`);
    }
    const missing = blank(deps.env, ['STREAM_SIGNING_KEY_ID', 'STREAM_SIGNING_KEY_JWK']);
    return notSetUp(SERVICES.stream, s, missing.length < 2 ? still(missing) : '');
  }
  if (!customerCode) return failed(SERVICES.stream, 'settings.streamCustomerCode in content/site.yaml is empty, so there is no Stream address to test.', `Put the customer code of your Stream account there (it is in every Stream player address: customer-<code>.cloudflarestream.com). ${see(s)}`);
  if (!video) return failed(SERVICES.stream, 'there is no Stream video in content/videos.yaml to test with.', 'Add a video with a streamUid there.');
  const state = signedUrls ? 'The site is already using signed links (streamSignedUrls is switched on in site.yaml).' : 'Signed links are not switched on yet in site.yaml (streamSignedUrls is false).';
  let token: string;
  try {
    token = signStreamToken({ uid: video.uid, keyId: config.stream.keyId, jwkBase64: config.stream.jwkBase64, now: deps.now() });
  } catch {
    return failed(SERVICES.stream, 'STREAM_SIGNING_KEY_JWK is not a private key in the form Cloudflare gives it out.', `Copy the whole "jwk" value from the signing key's creation answer again (it is base64 text). ${see(s)}`);
  }
  let status: number;
  try {
    status = (await deps.fetchFn(streamIframeUrl(customerCode, token), { method: 'HEAD', signal: AbortSignal.timeout(TIMEOUT_MS) })).status;
  } catch {
    return failed(SERVICES.stream, 'could not reach Cloudflare Stream.', 'Check the internet connection and run this again.');
  }
  if (status >= 200 && status < 300) return ok(SERVICES.stream, `Stream accepted a signed link for the video "${video.id}". ${state}`);
  if (status === 401 || status === 403) {
    return failed(SERVICES.stream, `Stream refused the signed link (status ${status}).`,
      `Check that STREAM_SIGNING_KEY_ID is the ID of the same key as STREAM_SIGNING_KEY_JWK, and that the key still exists under Stream > Signing keys in Cloudflare. ${see(s)}`);
  }
  if (status === 404) return failed(SERVICES.stream, `Stream has no video with that ID ("${video.id}").`, `Check streamUid and streamCustomerCode in content/videos.yaml and content/site.yaml. ${see(s)}`);
  return failed(SERVICES.stream, `Stream answered with status ${status}.`, see(s));
}

/** One check that fails on its own line, whatever goes wrong inside it. */
async function guarded(service: string, check: () => Promise<CheckResult> | CheckResult): Promise<CheckResult> {
  try {
    return await check();
  } catch (e) {
    return failed(service, `the check itself broke (${codeOf(e)}).`);
  }
}

/** One check for each service, run side by side. A service with no settings is "not set up yet", not a failure. */
export function checkServices(config: ServerConfig, deps: CheckDeps): Promise<CheckResult[]> {
  return Promise.all([
    guarded(SERVICES.database, () => checkDatabase(config, deps)),
    guarded(SERVICES.google, () => checkGoogle(config, deps)),
    guarded(SERVICES.smtp, () => checkSmtp(config, deps)),
    guarded(SERVICES.turnstile, () => checkTurnstile(config, deps)),
    guarded(SERVICES.turnstileKey, () => checkTurnstileKey(config, deps)),
    guarded(SERVICES.meta, () => checkMeta(config, deps)),
    guarded(SERVICES.stream, () => checkStream(config, deps)),
  ]);
}

/** Only a service that is set up and does not work fails the check. */
export const exitCode = (results: CheckResult[]): 0 | 1 => (results.some((r) => !r.ok && !r.notSetUp) ? 1 : 0);

/** The lines the script prints: ✓ working, ✗ broken (with what to do), – not set up yet (with where to read about it), and a count. */
export function formatReport(results: CheckResult[]): string {
  const lines: string[] = [];
  for (const r of results) {
    if (r.notSetUp) {
      lines.push(`– ${r.service}: ${r.detail}${r.fix ? `. ${r.fix}` : ''}`);
    } else if (r.ok) {
      lines.push(`✓ ${r.service}: ${r.detail}`);
      if (r.fix) lines.push(`    Note: ${r.fix}`);
    } else {
      lines.push(`✗ ${r.service}: ${r.detail}`);
      if (r.fix) lines.push(`    To fix: ${r.fix}`);
    }
  }
  const working = results.filter((r) => r.ok).length;
  const broken = results.filter((r) => !r.ok && !r.notSetUp).length;
  const waiting = results.filter((r) => r.notSetUp).length;
  lines.push('', `${working} working · ${broken} need${broken === 1 ? 's' : ''} fixing · ${waiting} not set up yet`);
  return lines.join('\n');
}
