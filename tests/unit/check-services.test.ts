import { generateKeyPairSync, verify } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readServerConfig } from '../../src/server/config';
import {
  SERVICES, checkServices, classifyTurnstile, exitCode, formatReport,
  type CheckDeps, type CheckResult, type SiteSettings,
} from '../../src/server/check-services';
import { pendingMigrations } from '../../src/server/store/migrate';

// `npm run check:services`: the checks, their wording and the exit code, with every service replaced by a fake. Nothing here reaches the internet.

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const JWK = Buffer.from(JSON.stringify(privateKey.export({ format: 'jwk' }))).toString('base64');

/** Every secret and personal detail the settings hold: none of them may ever show up in a report. */
const SECRETS = {
  DATABASE_URL: 'mysql://hguser:hgsecretpw@db.example.test:3306/hivegen',
  GOOGLE_CLIENT_ID: 'gid-123.apps.example', GOOGLE_CLIENT_SECRET: 'gsecret-xyz', GOOGLE_REFRESH_TOKEN: 'grefresh-xyz',
  TURNSTILE_SECRET: 'tsecret-xyz', CRON_SECRET: 'csecret-xyz', PUBLIC_SITE_URL: 'https://hivegen.co',
  SMTP_HOST: 'smtp.example.test', SMTP_PORT: '465', SMTP_USER: 'mailer@example.test', SMTP_PASS: 'smtp-pass-xyz', MAIL_FROM: 'HiveGen <connect@hivegen.co>',
  META_CAPI_TOKEN: 'EAAB-meta-xyz', META_TEST_EVENT_CODE: 'TEST123',
  STREAM_SIGNING_KEY_ID: 'key-id-1', STREAM_SIGNING_KEY_JWK: JWK,
};
const FULL = SECRETS;
const secretValues = [SECRETS.DATABASE_URL, 'hgsecretpw', SECRETS.GOOGLE_CLIENT_SECRET, SECRETS.GOOGLE_REFRESH_TOKEN, SECRETS.TURNSTILE_SECRET, SECRETS.CRON_SECRET,
  SECRETS.SMTP_PASS, SECRETS.SMTP_USER, SECRETS.META_CAPI_TOKEN, SECRETS.STREAM_SIGNING_KEY_JWK];
const config = (env: Record<string, string> = {}) => readServerConfig(env);

const SITE: SiteSettings = { turnstileSiteKey: '0xSITEKEY', metaPixelId: '123456789012345', stream: { customerCode: 'abc123', signedUrls: false, video: { id: 'v-reel', uid: 'uid-1' } } };
/** A site.yaml with nothing filled in yet (the Turnstile site key and the Pixel ID are empty). */
const EMPTY_SITE: SiteSettings = { stream: SITE.stream };
const NOW = new Date('2026-11-20T12:00:00.000Z');

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
/** A fetch that answers by address and records every call. An address nobody planned for is a failure of the test. */
function fakeFetch(answers: Record<string, Handler>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const key = Object.keys(answers).find((k) => url.includes(k));
    if (!key) throw new Error(`unexpected request to ${url}`);
    return answers[key](url, init);
  });
  return { fetchFn: fn as unknown as typeof fetch, calls };
}
const json = (body: unknown, status = 200) => Response.json(body, { status });

/** Fakes for every service answering well. */
function goodFetch(over: Record<string, Handler> = {}) {
  return fakeFetch({
    'oauth2.googleapis.com/token': () => json({ access_token: 'access-xyz', expires_in: 3600 }),
    'calendar/v3/freeBusy': () => json({ calendars: { primary: { busy: [{ start: '2026-11-20T12:10:00Z', end: '2026-11-20T12:25:00Z' }] } } }),
    'challenges.cloudflare.com': () => json({ success: false, 'error-codes': ['invalid-input-response'] }),
    'graph.facebook.com': () => json({ events_received: 1 }),
    'cloudflarestream.com': () => new Response(null, { status: 200 }),
    ...over,
  });
}
function deps(env: Record<string, string>, over: Partial<CheckDeps>, fetched: ReturnType<typeof goodFetch>): CheckDeps {
  return {
    env, fetchFn: fetched.fetchFn, now: () => NOW, site: SITE,
    pendingMigrations: async () => [], verifySmtp: async () => {},
    ...over,
  };
}
const run = (env: Record<string, string>, d: Partial<CheckDeps> = {}, fetched = goodFetch()) => checkServices(config(env), deps(env, d, fetched));
const row = (results: CheckResult[], service: string) => results.find((r) => r.service === service)!;
const text = (r: CheckResult) => `${r.detail} ${r.fix ?? ''}`;
const failure = (code: string, extra: object = {}) => Object.assign(new Error(`message with ${SECRETS.DATABASE_URL} and ${SECRETS.SMTP_PASS}`), { code, ...extra });

describe('Turnstile secret classification', () => {
  it('invalid-input-response means the secret is fine: Cloudflare only refused the made-up visitor token', () => {
    expect(classifyTurnstile({ success: false, 'error-codes': ['invalid-input-response'] })).toMatchObject({ ok: true });
  });

  it('invalid-input-secret means the secret is wrong, and says which setting to fix', () => {
    const c = classifyTurnstile({ success: false, 'error-codes': ['invalid-input-secret'] });
    expect(c.ok).toBe(false);
    expect(c.detail).toMatch(/TURNSTILE_SECRET/);
    expect(c.fix).toMatch(/Secret key/);
    expect(c.fix).toMatch(/not the Site key/i);
  });

  it('the secret counts as wrong even when Cloudflare also complains about the token', () => {
    expect(classifyTurnstile({ success: false, 'error-codes': ['invalid-input-response', 'invalid-input-secret'] }).ok).toBe(false);
  });

  it('a missing secret is wrong too', () => {
    expect(classifyTurnstile({ success: false, 'error-codes': ['missing-input-secret'] }).ok).toBe(false);
  });

  it('success for a made-up token is Cloudflare\'s always-pass test secret: it works, but must be replaced before launch', () => {
    const c = classifyTurnstile({ success: true });
    expect(c.ok).toBe(true);
    expect(c.detail).toMatch(/test secret/i);
    expect(c.fix).toMatch(/real|before launch/i);
  });

  it('any other answer is a failure that shows only Cloudflare\'s own error words', () => {
    const c = classifyTurnstile({ success: false, 'error-codes': ['internal-error', 'something with <script> and spaces'] });
    expect(c.ok).toBe(false);
    expect(c.detail).toContain('internal-error');
    expect(text({ service: 's', ...c })).not.toContain('<script>');
    for (const nonsense of [null, undefined, 'text', 42, [], {}]) expect(classifyTurnstile(nonsense).ok, String(nonsense)).toBe(false);
  });
});

describe('the report', () => {
  it('shows not-set-up services with a pointer and fails only on broken ones', async () => {
    // With nothing set, every service is "not set up yet", each pointing at its part of HOW-TO-SETUP.md, and the exit code is 0.
    const nothing = await run({}, { site: EMPTY_SITE });
    expect(nothing.length).toBeGreaterThanOrEqual(6);
    expect(nothing.every((r) => r.notSetUp)).toBe(true);
    for (const r of nothing) expect(r.fix, r.service).toMatch(/HOW-TO-SETUP\.md, step \d/);
    const report = formatReport(nothing);
    const lines = report.split(String.fromCharCode(10)).filter((l) => l.startsWith('– '));
    expect(lines).toHaveLength(nothing.length);
    for (const line of lines) expect(line, line).toMatch(/: not set up yet\..*HOW-TO-SETUP\.md, step \d/);
    expect(report).toMatch(/0 working · 0 need fixing · \d+ not set up yet/);
    expect(report).not.toContain('✗');
    expect(report).not.toContain('✓');
    expect(exitCode(nothing)).toBe(0);

    // One broken service makes the exit code 1, and the others keep their own lines.
    const mixed = await run({ DATABASE_URL: SECRETS.DATABASE_URL }, { pendingMigrations: async () => { throw failure('ER_ACCESS_DENIED_ERROR'); } });
    expect(row(mixed, SERVICES.database)).toMatchObject({ ok: false });
    expect(row(mixed, SERVICES.database).notSetUp).toBeFalsy();
    expect(row(mixed, SERVICES.smtp).notSetUp).toBe(true);
    expect(exitCode(mixed)).toBe(1);
    const mixedReport = formatReport(mixed);
    expect(mixedReport).toContain(`✗ ${SERVICES.database}`);
    expect(mixedReport).toContain('not set up yet');

    // All working: ✓ lines, exit 0.
    const good = await run(FULL);
    expect(good.every((r) => r.ok && !r.notSetUp), JSON.stringify(good.filter((r) => !r.ok))).toBe(true);
    expect(exitCode(good)).toBe(0);
    expect(formatReport(good).match(/✓/g)!.length).toBe(good.length);
  });

  it('names the broken service, what is wrong, and exactly what to do, each on its own lines', () => {
    const report = formatReport([
      { service: 'Alpha', ok: true, detail: 'fine' },
      { service: 'Beta', ok: false, detail: 'the login was refused', fix: 'Check the password.' },
      { service: 'Gamma', ok: false, notSetUp: true, detail: 'not set up yet', fix: 'See HOW-TO-SETUP.md, step 9.' },
    ]);
    const lines = report.split('\n');
    expect(lines).toContain('✓ Alpha: fine');
    expect(lines).toContain('✗ Beta: the login was refused');
    expect(lines).toContain('    To fix: Check the password.');
    expect(lines).toContain('– Gamma: not set up yet. See HOW-TO-SETUP.md, step 9.');
    expect(report).toMatch(/1 working.*1 need.*1 not set up yet/s);
  });

  it('no secret and no personal detail ever reaches the report, even when an error message quotes them', async () => {
    const results = await run(FULL, {
      pendingMigrations: async () => { throw failure('ER_ACCESS_DENIED_ERROR', { sqlMessage: `Access denied for user 'hguser'@'203.0.113.9' (using password: YES)` }); },
      verifySmtp: async () => { throw failure('EAUTH', { response: `535 ${SECRETS.SMTP_PASS}` }); },
    }, fakeFetch({
      'oauth2.googleapis.com/token': () => json({ error: 'invalid_grant', error_description: `Bad refresh ${SECRETS.GOOGLE_REFRESH_TOKEN}` }, 400),
      'challenges.cloudflare.com': () => json({ success: false, 'error-codes': ['invalid-input-secret'], hint: SECRETS.TURNSTILE_SECRET }),
      'graph.facebook.com': () => json({ error: { code: 190, message: `Invalid token ${SECRETS.META_CAPI_TOKEN}` } }, 400),
      'cloudflarestream.com': () => new Response(null, { status: 403 }),
    }));
    expect(results.filter((r) => !r.ok && !r.notSetUp).length).toBeGreaterThanOrEqual(5);
    const everything = `${formatReport(results)} ${JSON.stringify(results)}`;
    for (const secret of [...secretValues, 'gid-123', 'hguser', '203.0.113.9', 'Bad refresh']) expect(everything, secret).not.toContain(secret);
  });

  it('a check that breaks in an unexpected way is a failure of its own line, not a crash of the others', async () => {
    const results = await run(FULL, { pendingMigrations: () => { throw new TypeError(`boom ${SECRETS.DATABASE_URL}`); } });
    expect(row(results, SERVICES.database).ok).toBe(false);
    expect(text(row(results, SERVICES.database))).not.toContain('hgsecretpw');
    expect(row(results, SERVICES.google).ok).toBe(true);
  });
});

describe('MySQL', () => {
  it('connects and finds nothing left to apply', async () => {
    const r = row(await run({ DATABASE_URL: SECRETS.DATABASE_URL }), SERVICES.database);
    expect(r).toMatchObject({ ok: true });
    expect(r.detail).toMatch(/up to date/);
  });

  it('lists the migrations that are still to apply, and says to run npm run db:migrate', async () => {
    const r = row(await run({ DATABASE_URL: SECRETS.DATABASE_URL }, { pendingMigrations: async () => ['001_init.sql', '002_more.sql'] }), SERVICES.database);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('001_init.sql');
    expect(r.detail).toContain('002_more.sql');
    expect(r.fix).toContain('npm run db:migrate');
  });

  it.each([
    ['ECONNREFUSED', /reach the database/i, /Remote MySQL/],
    ['ETIMEDOUT', /reach the database/i, /Remote MySQL/],
    ['ENOTFOUND', /reach the database/i, /host/i],
    ['ER_ACCESS_DENIED_ERROR', /user name or password/i, /%40/],
    ['ER_DBACCESS_DENIED_ERROR', /no access to the database/i, /hPanel/],
    ['ER_BAD_DB_ERROR', /no database with that name/i, /database name/i],
    ['ERR_INVALID_URL', /not a valid address/i, /mysql:\/\//],
  ])('%s is explained in plain words with what to do', async (code, detail, fix) => {
    const r = row(await run({ DATABASE_URL: SECRETS.DATABASE_URL }, { pendingMigrations: async () => { throw failure(code); } }), SERVICES.database);
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(detail);
    expect(r.fix).toMatch(fix);
    expect(r.fix).toMatch(/step 2/);
  });

  it('an error with no known code says only its kind', async () => {
    const r = row(await run({ DATABASE_URL: SECRETS.DATABASE_URL }, { pendingMigrations: async () => { throw failure('WEIRD_CODE'); } }), SERVICES.database);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('WEIRD_CODE');
  });
});

describe('Google Calendar', () => {
  it('refreshes the token and reads the busy times of the next hour', async () => {
    const fetched = goodFetch();
    const r = row(await run(FULL, {}, fetched), SERVICES.google);
    expect(r).toMatchObject({ ok: true });
    expect(r.detail).toMatch(/next hour/);
    const asked = fetched.calls.find((c) => c.url.includes('freeBusy'))!;
    const body = JSON.parse(String(asked.init!.body)) as { timeMin: string; timeMax: string };
    expect(body).toMatchObject({ timeMin: NOW.toISOString(), timeMax: '2026-11-20T13:00:00.000Z' });
  });

  it('invalid_grant says Hassan\'s sign-in expired or was revoked, and what to do about it', async () => {
    const r = row(await run(FULL, {}, goodFetch({ 'oauth2.googleapis.com/token': () => json({ error: 'invalid_grant' }, 400) })), SERVICES.google);
    expect(r.ok).toBe(false);
    expect(r.detail).toBe('Hassan\'s Google sign-in has expired or was revoked.');
    expect(r.fix).toContain('npm run google:connect');
    expect(r.fix).toMatch(/consent screen is In production/);
    expect(r.fix).toMatch(/step 1/);
  });

  it.each([
    [() => json({ error: 'invalid_client' }, 401), /client ID or secret/i, /GOOGLE_CLIENT_ID/],
    [() => { throw new TypeError('fetch failed'); }, /reach Google/i, /internet/i],
  ])('a refused or unreachable token answer is explained (%#)', async (answer, detail, fix) => {
    const r = row(await run(FULL, {}, goodFetch({ 'oauth2.googleapis.com/token': answer as Handler })), SERVICES.google);
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(detail);
    expect(r.fix).toMatch(fix);
  });

  it.each([
    [403, /refused/i, /Google Calendar API/],
    [404, /calendar was not found/i, /GOOGLE_CALENDAR_ID/],
  ])('a %s from the calendar is explained', async (status, detail, fix) => {
    const r = row(await run(FULL, {}, goodFetch({ 'calendar/v3/freeBusy': () => json({ error: {} }, status as number) })), SERVICES.google);
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(detail);
    expect(r.fix).toMatch(fix);
  });

  it('is not set up until the client id, secret and refresh token are all there, and says which part is missing', async () => {
    const { GOOGLE_REFRESH_TOKEN: _drop, ...partial } = FULL;
    const r = row(await run(partial), SERVICES.google);
    expect(r.notSetUp).toBe(true);
    expect(r.fix).toMatch(/google:connect/);
    expect(r.fix).toContain('GOOGLE_REFRESH_TOKEN');
  });
});

describe('SMTP', () => {
  it('logs in to the mail server without sending anything', async () => {
    const verifySmtp = vi.fn(async () => {});
    const r = row(await run(FULL, { verifySmtp }), SERVICES.smtp);
    expect(r).toMatchObject({ ok: true });
    expect(r.detail).toMatch(/nothing was sent/i);
    expect(verifySmtp).toHaveBeenCalledWith({ host: 'smtp.example.test', port: 465, user: 'mailer@example.test', pass: 'smtp-pass-xyz', from: 'HiveGen <connect@hivegen.co>' });
  });

  it.each([
    ['EAUTH', /refused the login/i, /SMTP_USER.*SMTP_PASS/],
    ['ECONNECTION', /could not connect/i, /SMTP_HOST.*SMTP_PORT/],
    ['ETIMEDOUT', /could not connect/i, /465/],
    ['EDNS', /could not connect/i, /SMTP_HOST/],
  ])('%s is explained with what to do', async (code, detail, fix) => {
    const r = row(await run(FULL, { verifySmtp: async () => { throw failure(code); } }), SERVICES.smtp);
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(detail);
    expect(r.fix).toMatch(fix);
    expect(r.fix).toMatch(/step 3/);
  });

  it('is not set up while a setting is missing, and names the missing ones', async () => {
    const { SMTP_PASS: _drop, MAIL_FROM: _drop2, ...partial } = FULL;
    const r = row(await run(partial), SERVICES.smtp);
    expect(r.notSetUp).toBe(true);
    expect(r.fix).toContain('SMTP_PASS');
    expect(r.fix).toContain('MAIL_FROM');
    expect(r.fix).not.toContain('SMTP_HOST'); // that one is set
  });
});

describe('Turnstile', () => {
  it('asks Cloudflare with the secret and a made-up token, and takes the refused token as proof the secret is right', async () => {
    const fetched = goodFetch();
    const r = row(await run(FULL, {}, fetched), SERVICES.turnstile);
    expect(r).toMatchObject({ ok: true });
    const asked = fetched.calls.find((c) => c.url.includes('challenges.cloudflare.com/turnstile/v0/siteverify'))!;
    expect(asked.init!.method).toBe('POST');
    const form = new URLSearchParams(String(asked.init!.body));
    expect(form.get('secret')).toBe(SECRETS.TURNSTILE_SECRET);
    expect(form.get('response')).toBeTruthy();
  });

  it('a wrong secret is a failure', async () => {
    const r = row(await run(FULL, {}, goodFetch({ 'challenges.cloudflare.com': () => json({ success: false, 'error-codes': ['invalid-input-secret'] }) })), SERVICES.turnstile);
    expect(r.ok).toBe(false);
    expect(r.fix).toMatch(/step 6/);
  });

  it('no answer from Cloudflare is a failure that says so', async () => {
    const r = row(await run(FULL, {}, goodFetch({ 'challenges.cloudflare.com': () => { throw new TypeError('fetch failed'); } })), SERVICES.turnstile);
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/reach Cloudflare/i);
  });

  it('is not set up without the secret', async () => {
    expect(row(await run({}), SERVICES.turnstile).notSetUp).toBe(true);
  });

  describe('the site key in content/site.yaml', () => {
    it('is a failure when the site would go live without it: every visitor would be refused', async () => {
      const r = row(await run(FULL, { site: { ...SITE, turnstileSiteKey: undefined } }), SERVICES.turnstileKey);
      expect(r.ok).toBe(false);
      expect(r.notSetUp).toBeFalsy();
      expect(r.detail).toMatch(/turnstileSiteKey/);
      expect(r.fix).toMatch(/Site key/);
      expect(r.fix).toMatch(/site\.yaml/);
      expect(r.fix).toMatch(/restart/i);
    });

    it('is fine when it is set', async () => {
      const r = row(await run(FULL), SERVICES.turnstileKey);
      expect(r).toMatchObject({ ok: true });
      expect(r.detail).not.toContain('0xSITEKEY');
    });

    it('is only "not set up yet" while booking is not live anyway', async () => {
      const notLive = await run({ TURNSTILE_SECRET: SECRETS.TURNSTILE_SECRET }, { site: { ...SITE, turnstileSiteKey: undefined } });
      expect(row(notLive, SERVICES.turnstileKey).notSetUp).toBe(true);
      expect(exitCode(notLive)).toBe(0);
    });
  });
});

describe('Meta', () => {
  const META_ONLY = { META_CAPI_TOKEN: SECRETS.META_CAPI_TOKEN };

  it('sends one test event, to Meta\'s Conversions API for the pixel, when there is a test event code', async () => {
    const fetched = goodFetch();
    const r = row(await run(FULL, {}, fetched), SERVICES.meta);
    expect(r).toMatchObject({ ok: true });
    expect(r.detail).toMatch(/Test events/);
    const sent = fetched.calls.filter((c) => c.url.includes('graph.facebook.com'));
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toMatch(/graph\.facebook\.com\/v\d+\.\d+\/123456789012345\/events$/);
    const body = JSON.parse(String(sent[0].init!.body)) as { test_event_code: string; access_token: string; data: Array<{ event_name: string; user_data: Record<string, unknown> }> };
    expect(body.test_event_code).toBe('TEST123');
    expect(body.access_token).toBe(SECRETS.META_CAPI_TOKEN);
    expect(body.data).toHaveLength(1);
    expect(JSON.stringify(body.data)).not.toMatch(/@/); // no email: nothing personal goes in a check
  });

  it('with no test event code it sends nothing (a real event would show up in the ads data) and says how to test', async () => {
    const { META_TEST_EVENT_CODE: _drop, ...noCode } = FULL;
    const fetched = goodFetch();
    const r = row(await run(noCode, {}, fetched), SERVICES.meta);
    expect(r).toMatchObject({ ok: true });
    expect(text(r)).toMatch(/META_TEST_EVENT_CODE/);
    expect(fetched.calls.some((c) => c.url.includes('graph.facebook.com'))).toBe(false);
  });

  it.each([
    [190, /refused the access token/i, /META_CAPI_TOKEN/],
    [100, /Pixel ID/i, /metaPixelId/],
  ])('Meta error %i is explained', async (code, detail, fix) => {
    const r = row(await run(FULL, {}, goodFetch({ 'graph.facebook.com': () => json({ error: { code, message: `quoting ${SECRETS.META_CAPI_TOKEN}` } }, 400) })), SERVICES.meta);
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(detail);
    expect(r.fix).toMatch(fix);
    expect(r.fix).toMatch(/step 4/);
  });

  it('no answer from Meta is a failure that says so', async () => {
    const r = row(await run(FULL, {}, goodFetch({ 'graph.facebook.com': () => { throw new TypeError('fetch failed'); } })), SERVICES.meta);
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/reach Meta|did not answer/i);
  });

  it('a token with no Pixel ID in site.yaml is a failure: nothing would be sent to Meta', async () => {
    const r = row(await run(META_ONLY, { site: { ...SITE, metaPixelId: undefined } }), SERVICES.meta);
    expect(r.ok).toBe(false);
    expect(r.notSetUp).toBeFalsy();
    expect(r.fix).toMatch(/metaPixelId/);
  });

  it('a Pixel ID with no token is "not set up yet": the browser Pixel works, the server-side events wait for the token', async () => {
    const r = row(await run({}), SERVICES.meta); // the Pixel ID is in site.yaml (SITE), the token is not set
    expect(r.notSetUp).toBe(true);
    expect(r.fix).toMatch(/META_CAPI_TOKEN/);
    expect(r.fix).toMatch(/step 4/);
  });

  it('neither token nor Pixel ID is "not set up yet"', async () => {
    const r = row(await run({}, { site: { ...SITE, metaPixelId: undefined } }), SERVICES.meta);
    expect(r).toMatchObject({ ok: false, notSetUp: true });
    expect(r.fix).toMatch(/step 4/);
  });
});

describe('Cloudflare Stream signed links', () => {
  it('signs a token for one video and asks for its player address with a HEAD request', async () => {
    const fetched = goodFetch();
    const r = row(await run(FULL, {}, fetched), SERVICES.stream);
    expect(r).toMatchObject({ ok: true });
    expect(r.detail).toContain('v-reel');
    const asked = fetched.calls.find((c) => c.url.includes('cloudflarestream.com'))!;
    expect(asked.init!.method).toBe('HEAD');
    const match = asked.url.match(/^https:\/\/customer-abc123\.cloudflarestream\.com\/([\w-]+\.[\w-]+\.[\w-]+)\/iframe\?/);
    expect(match, asked.url).not.toBeNull();
    const [header, claims, signature] = match![1].split('.');
    expect(verify('RSA-SHA256', Buffer.from(`${header}.${claims}`), publicKey, Buffer.from(signature, 'base64url'))).toBe(true);
    expect(JSON.parse(Buffer.from(claims, 'base64url').toString('utf8'))).toMatchObject({ sub: 'uid-1', kid: 'key-id-1' });
    expect(r.detail).not.toContain(match![1]); // the token itself is never shown
  });

  it.each([
    [401, /refused the signed link/i, /STREAM_SIGNING_KEY_ID/],
    [403, /refused the signed link/i, /Signing keys/],
    [404, /no video with that ID/i, /videos\.yaml/],
  ])('Stream answering %i is explained', async (status, detail, fix) => {
    const r = row(await run(FULL, {}, goodFetch({ 'cloudflarestream.com': () => new Response(null, { status: status as number }) })), SERVICES.stream);
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(detail);
    expect(r.fix).toMatch(fix);
    expect(r.fix).toMatch(/step 7/);
  });

  it('a key that is not a private key is a failure that names the setting, without showing the key', async () => {
    const r = row(await run({ ...FULL, STREAM_SIGNING_KEY_JWK: Buffer.from('not a key').toString('base64') }), SERVICES.stream);
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/STREAM_SIGNING_KEY_JWK/);
    expect(text(r)).not.toContain(Buffer.from('not a key').toString('base64'));
  });

  it('is not set up without a key, unless the site is already told to use signed links: then it is a failure', async () => {
    const off = row(await run({}), SERVICES.stream);
    expect(off.notSetUp).toBe(true);
    expect(off.fix).toMatch(/step 7/);
    const on = row(await run({}, { site: { ...SITE, stream: { ...SITE.stream, signedUrls: true } } }), SERVICES.stream);
    expect(on.ok).toBe(false);
    expect(on.notSetUp).toBeFalsy();
    expect(on.detail).toMatch(/streamSignedUrls/);
    expect(on.fix).toMatch(/STREAM_SIGNING_KEY_ID/);
  });

  it('says whether the site is already using signed links', async () => {
    expect(row(await run(FULL), SERVICES.stream).detail).toMatch(/not switched on yet/i);
    const on = row(await run(FULL, { site: { ...SITE, stream: { ...SITE.stream, signedUrls: true } } }), SERVICES.stream);
    expect(on.detail).toMatch(/switched on in site\.yaml/i);
  });

  it('with no Stream customer code in site.yaml, says so', async () => {
    const r = row(await run(FULL, { site: { ...SITE, stream: { ...SITE.stream, customerCode: undefined } } }), SERVICES.stream);
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/streamCustomerCode/);
  });

  it('with no video to test against, says so', async () => {
    const r = row(await run(FULL, { site: { ...SITE, stream: { customerCode: 'abc123', signedUrls: false } } }), SERVICES.stream);
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/videos\.yaml/);
  });
});

describe('a content file that cannot be read', () => {
  it('fails the checks that need it, with the content error, and leaves the others alone', async () => {
    const problem = 'content/site.yaml: tab characters must not be used in indentation (line 5)';
    const results = await run(FULL, { site: { problem } });
    for (const service of [SERVICES.turnstileKey, SERVICES.meta, SERVICES.stream]) {
      expect(row(results, service).ok, service).toBe(false);
      expect(row(results, service).detail, service).toContain(problem);
    }
    expect(row(results, SERVICES.google).ok).toBe(true);
    expect(row(results, SERVICES.database).ok).toBe(true);
  });
});

describe('pendingMigrations (what the database check asks)', () => {
  const dirs: string[] = [];
  afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
  const folder = (...names: string[]) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hg-migrations-'));
    dirs.push(dir);
    for (const n of names) fs.writeFileSync(path.join(dir, n), 'SELECT 1;');
    return dir;
  };
  const poolWith = (applied: string[] | 'no-table') => ({
    query: vi.fn(async (sql: string) => {
      if (applied === 'no-table') throw Object.assign(new Error("Table 'x.schema_migrations' doesn't exist"), { code: 'ER_NO_SUCH_TABLE', errno: 1146 });
      expect(sql).toMatch(/schema_migrations/);
      return [applied.map((name) => ({ name }))];
    }),
  });

  it('lists the .sql files that are not recorded yet, in order, and changes nothing', async () => {
    const pool = poolWith(['001_init.sql']);
    expect(await pendingMigrations(pool as never, folder('003_c.sql', '001_init.sql', '002_b.sql', 'notes.txt'))).toEqual(['002_b.sql', '003_c.sql']);
    expect(pool.query).toHaveBeenCalledTimes(1); // one read
  });

  it('a database with no schema_migrations table has everything still to apply', async () => {
    expect(await pendingMigrations(poolWith('no-table') as never, folder('001_init.sql', '002_b.sql'))).toEqual(['001_init.sql', '002_b.sql']);
  });

  it('any other database error is passed on', async () => {
    const pool = { query: vi.fn(async () => { throw Object.assign(new Error('nope'), { code: 'ER_ACCESS_DENIED_ERROR' }); }) };
    await expect(pendingMigrations(pool as never, folder('001_init.sql'))).rejects.toMatchObject({ code: 'ER_ACCESS_DENIED_ERROR' });
  });

  it('the real migrations folder has at least the first migration', async () => {
    expect(await pendingMigrations(poolWith([]) as never)).toContain('001_init.sql');
  });
});
