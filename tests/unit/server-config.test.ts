import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readServerConfig, clientMode } from '../../src/server/config';
import { loadDotEnv } from '../../src/server/env';

const full = {
  DATABASE_URL: 'mysql://u:p@h:3306/db', GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 's', GOOGLE_REFRESH_TOKEN: 'r',
  TURNSTILE_SECRET: 't', CRON_SECRET: 'c', PUBLIC_SITE_URL: 'https://hivegen.co',
};
/** The same settings on this computer: a mailbox is optional there (emails go to a folder). */
const local = { ...full, PUBLIC_SITE_URL: 'http://localhost:4321' };
const smtpAll = { SMTP_HOST: 'h', SMTP_PORT: '465', SMTP_USER: 'u', SMTP_PASS: 'p', MAIL_FROM: 'HiveGen <connect@hivegen.co>' };

describe('readServerConfig', () => {
  it('every required setting → live; calendar defaults to primary; SMTP, Meta and Stream stay optional on this computer', () => {
    expect(readServerConfig(local)).toMatchObject({ mode: 'live', missing: [], google: { calendarId: 'primary' }, smtp: undefined, meta: undefined, stream: undefined });
  });

  it('missing settings → not_connected, naming each one', () => {
    const { DATABASE_URL, TURNSTILE_SECRET, ...rest } = local;
    expect(readServerConfig(rest)).toMatchObject({ mode: 'not_connected', missing: ['DATABASE_URL', 'TURNSTILE_SECRET'] });
  });

  it('fakes only outside production', () => {
    expect(readServerConfig({ HIVEGEN_FAKES: '1' }).mode).toBe('fakes');
    expect(readServerConfig({ HIVEGEN_FAKES: '1', NODE_ENV: 'production' }).mode).toBe('not_connected');
  });

  it('in production, live also needs the five SMTP settings', () => {
    expect(readServerConfig({ ...full, NODE_ENV: 'production' })).toMatchObject({ mode: 'not_connected', missing: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM'] });
    expect(readServerConfig({ ...full, ...smtpAll, SMTP_PASS: '', NODE_ENV: 'production' })).toMatchObject({ mode: 'not_connected', missing: ['SMTP_PASS'] });
    expect(readServerConfig({ ...full, ...smtpAll, NODE_ENV: 'production' })).toMatchObject({ mode: 'live', production: true, missing: [] });
  });

  it('SMTP is used only when all five values are set', () => {
    expect(readServerConfig({ ...full, SMTP_HOST: 'h', SMTP_PORT: '465' }).smtp).toBeUndefined();
    expect(readServerConfig({ ...full, ...smtpAll }).smtp)
      .toEqual({ host: 'h', port: 465, user: 'u', pass: 'p', from: 'HiveGen <connect@hivegen.co>' });
    expect(readServerConfig({ ...full, ...smtpAll, SMTP_PORT: 'abc' }).smtp).toBeUndefined();
  });

  it('Meta and Stream are all-or-nothing', () => {
    expect(readServerConfig({ ...full, META_CAPI_TOKEN: 'tok', META_TEST_EVENT_CODE: 'TEST1' }).meta).toEqual({ capiToken: 'tok', testEventCode: 'TEST1' });
    expect(readServerConfig({ ...full, META_CAPI_TOKEN: 'tok' }).meta).toEqual({ capiToken: 'tok', testEventCode: undefined });
    expect(readServerConfig({ ...full, META_TEST_EVENT_CODE: 'TEST1' }).meta).toBeUndefined();
    expect(readServerConfig({ ...full, STREAM_SIGNING_KEY_ID: 'kid' }).stream).toBeUndefined();
    expect(readServerConfig({ ...full, STREAM_SIGNING_KEY_JWK: 'jwk' }).stream).toBeUndefined();
    expect(readServerConfig({ ...full, STREAM_SIGNING_KEY_ID: 'kid', STREAM_SIGNING_KEY_JWK: 'jwk' }).stream).toEqual({ keyId: 'kid', jwkBase64: 'jwk' });
  });

  it('empty values count as not set; the site address defaults to the dev server', () => {
    expect(readServerConfig({ ...local, DATABASE_URL: '' })).toMatchObject({ mode: 'not_connected', missing: ['DATABASE_URL'] });
    expect(readServerConfig({ ...local, PUBLIC_SITE_URL: '  ' })).toMatchObject({ mode: 'not_connected', missing: ['PUBLIC_SITE_URL'] });
    expect(readServerConfig({}).siteUrl).toBe('http://localhost:4321');
    expect(readServerConfig(full).siteUrl).toBe('https://hivegen.co');
  });
});

describe('production: NODE_ENV, normalised, and the built server default', () => {
  // [NODE_ENV as set, built server?, production?]
  const cases: Array<[string | undefined, boolean, boolean]> = [
    [undefined, false, false], [undefined, true, true],
    ['', false, false], ['', true, true],
    ['   ', false, false], ['   ', true, true],
    ['production', false, true], ['production', true, true],
    ['production ', false, true], ['production ', true, true],
    [' Production\t', false, true],
    ['PRODUCTION', false, true], ['PRODUCTION', true, true],
    ['test', false, false], ['test', true, false],
    ['TEST ', true, false],
    ['development', false, false], ['development', true, false],
    ['staging', true, false],
  ];
  it.each(cases)('NODE_ENV %j, built server %s → production %s', (nodeEnv, built, expected) => {
    const env = nodeEnv === undefined ? {} : { NODE_ENV: nodeEnv };
    expect(readServerConfig(env, { builtDefault: built }).production).toBe(expected);
  });

  it('without the option the server is not built: scripts behave as before', () => {
    expect(readServerConfig({}).production).toBe(false);
    expect(readServerConfig({ NODE_ENV: 'production' }).production).toBe(true);
    expect(readServerConfig({ NODE_ENV: 'Production ' }).production).toBe(true);
  });

  it('a built server with NODE_ENV forgotten is production: the SMTP settings are required and the browser is told off', () => {
    const forgotten = readServerConfig(full, { builtDefault: true });
    expect(forgotten).toMatchObject({ mode: 'not_connected', production: true, missing: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM'] });
    expect(clientMode(forgotten)).toBe('off');
    expect(clientMode(readServerConfig({}, { builtDefault: true }))).toBe('off');
    expect(readServerConfig({ ...full, ...smtpAll }, { builtDefault: true })).toMatchObject({ mode: 'live', production: true });
  });

  it('a trailing space or other case in NODE_ENV does not turn production off', () => {
    for (const nodeEnv of ['production ', 'PRODUCTION', ' production']) {
      expect(clientMode(readServerConfig({ NODE_ENV: nodeEnv }))).toBe('off');
      expect(readServerConfig({ ...full, NODE_ENV: nodeEnv }).missing).toContain('SMTP_HOST');
    }
  });

  it('a built server that names another environment (the Playwright server: test) is not production', () => {
    expect(readServerConfig({ NODE_ENV: 'test', HIVEGEN_FAKES: '1' }, { builtDefault: true })).toMatchObject({ mode: 'fakes', production: false });
    expect(clientMode(readServerConfig({ NODE_ENV: 'test' }, { builtDefault: true }))).toBe('demo');
  });

  it('astro dev (not built) with NODE_ENV unset is not production', () => {
    expect(readServerConfig({}, { builtDefault: false })).toMatchObject({ mode: 'not_connected', production: false });
    expect(clientMode(readServerConfig({}, { builtDefault: false }))).toBe('demo');
  });

  it('HIVEGEN_FAKES is trimmed, and still ignored in production (also on a built server with NODE_ENV forgotten)', () => {
    expect(readServerConfig({ HIVEGEN_FAKES: ' 1 ' }).mode).toBe('fakes');
    expect(readServerConfig({ HIVEGEN_FAKES: '1\n', NODE_ENV: 'test' }).mode).toBe('fakes');
    expect(readServerConfig({ HIVEGEN_FAKES: '1', NODE_ENV: 'production ' }).mode).toBe('not_connected');
    expect(readServerConfig({ HIVEGEN_FAKES: '1' }, { builtDefault: true }).mode).toBe('not_connected');
    expect(readServerConfig({ HIVEGEN_FAKES: '0' }).mode).toBe('not_connected');
  });
});

describe('the outbox mailer never serves a public site', () => {
  const SMTP_NAMES = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM'];
  const dev = { ...full, NODE_ENV: 'development' };

  it('not production, public address, no mailbox → not connected, naming the SMTP settings', () => {
    expect(readServerConfig(dev)).toMatchObject({ mode: 'not_connected', production: false, missing: SMTP_NAMES, smtp: undefined });
    expect(readServerConfig({ ...full, NODE_ENV: 'test' })).toMatchObject({ mode: 'not_connected', missing: SMTP_NAMES });
    expect(readServerConfig({ ...full, NODE_ENV: 'staging' }).mode).toBe('not_connected');
    expect(readServerConfig({ ...full, PUBLIC_SITE_URL: 'https://localhost.evil.example', NODE_ENV: 'test' }).mode).toBe('not_connected');
    expect(readServerConfig({ ...full, PUBLIC_SITE_URL: 'not a url', NODE_ENV: 'test' }).mode).toBe('not_connected');
  });

  it('a half-set mailbox is still missing, by name', () => {
    expect(readServerConfig({ ...dev, ...smtpAll, SMTP_PASS: '' })).toMatchObject({ mode: 'not_connected', missing: ['SMTP_PASS'] });
  });

  it('the visitor sees the offline card, not the demo, whatever NODE_ENV says', () => {
    expect(clientMode(readServerConfig(dev))).toBe('off');
    expect(clientMode(readServerConfig({ NODE_ENV: 'test', PUBLIC_SITE_URL: 'https://hivegen.co' }))).toBe('off');
  });

  it('with the mailbox set, a public address is live', () => {
    expect(readServerConfig({ ...dev, ...smtpAll })).toMatchObject({ mode: 'live', missing: [], smtp: { host: 'h' } });
  });

  it('a local address may use the outbox in development', () => {
    for (const url of ['http://localhost:4321', 'http://127.0.0.1:4321', 'http://localhost', 'http://[::1]:4321']) {
      expect(readServerConfig({ ...dev, PUBLIC_SITE_URL: url })).toMatchObject({ mode: 'live', missing: [], smtp: undefined });
    }
    expect(clientMode(readServerConfig({ NODE_ENV: 'development' }))).toBe('demo');
  });

  it('the test services never send, so a public address needs no mailbox there', () => {
    expect(readServerConfig({ HIVEGEN_FAKES: '1', NODE_ENV: 'test', PUBLIC_SITE_URL: 'https://hivegen.co' })).toMatchObject({ mode: 'fakes', missing: [] });
  });
});

describe('clientMode', () => {
  it('the browser gets live, demo (development) or off (production)', () => {
    expect(clientMode(readServerConfig(local))).toBe('live');
    expect(clientMode(readServerConfig({ HIVEGEN_FAKES: '1' }))).toBe('live');
    expect(clientMode(readServerConfig({}))).toBe('demo');
    expect(clientMode(readServerConfig({ NODE_ENV: 'production' }))).toBe('off');
  });
});

describe('loadDotEnv', () => {
  const tempEnvFile = (text: string) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hivegen-env-'));
    const file = path.join(dir, '.env');
    fs.writeFileSync(file, text);
    return { dir, file };
  };

  it('fills only missing keys', () => {
    const { dir, file } = tempEnvFile('A=1\nB=2');
    try {
      const env: Record<string, string | undefined> = { A: '0' };
      loadDotEnv(file, env);
      expect(env).toEqual({ A: '0', B: '2' });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does nothing when there is no .env file', () => {
    const env: Record<string, string | undefined> = { A: '0' };
    expect(() => loadDotEnv(path.join(os.tmpdir(), 'hivegen-no-such-dir', '.env'), env)).not.toThrow();
    expect(env).toEqual({ A: '0' });
  });
});
