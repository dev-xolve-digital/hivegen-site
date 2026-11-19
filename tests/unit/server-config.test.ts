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
const smtpAll = { SMTP_HOST: 'h', SMTP_PORT: '465', SMTP_USER: 'u', SMTP_PASS: 'p', MAIL_FROM: 'HiveGen <connect@hivegen.co>' };

describe('readServerConfig', () => {
  it('every required setting → live; calendar defaults to primary; SMTP, Meta and Stream stay optional', () => {
    expect(readServerConfig(full)).toMatchObject({ mode: 'live', missing: [], google: { calendarId: 'primary' }, smtp: undefined, meta: undefined, stream: undefined });
  });

  it('missing settings → not_connected, naming each one', () => {
    const { DATABASE_URL, TURNSTILE_SECRET, ...rest } = full;
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
    expect(readServerConfig({ ...full, DATABASE_URL: '' })).toMatchObject({ mode: 'not_connected', missing: ['DATABASE_URL'] });
    expect(readServerConfig({ ...full, PUBLIC_SITE_URL: '  ' })).toMatchObject({ mode: 'not_connected', missing: ['PUBLIC_SITE_URL'] });
    expect(readServerConfig({}).siteUrl).toBe('http://localhost:4321');
    expect(readServerConfig(full).siteUrl).toBe('https://hivegen.co');
  });
});

describe('clientMode', () => {
  it('the browser gets live, demo (development) or off (production)', () => {
    expect(clientMode(readServerConfig(full))).toBe('live');
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
