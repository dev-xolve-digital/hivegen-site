import { describe, it, expect, vi, afterEach, beforeEach, type MockInstance } from 'vitest';
import { readServerConfig } from '../../src/server/config';
import { bookingConfigResponse } from '../../src/server/booking-config';
import { loadTurnstileSiteKey } from '../../src/lib/content/load';
import { tempContent, removeTempContent } from '../helpers/temp-content';

const full = {
  DATABASE_URL: 'mysql://u:p@h:3306/db', GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 's', GOOGLE_REFRESH_TOKEN: 'r',
  TURNSTILE_SECRET: 't', CRON_SECRET: 'c', PUBLIC_SITE_URL: 'https://hivegen.co',
};

/** The same settings on this computer, where a mailbox is optional. */
const local = { ...full, PUBLIC_SITE_URL: 'http://localhost:4321' };

describe('bookingConfigResponse', () => {
  it('fakes → Cloudflare test key, without reading the site setting', () => {
    const readKey = vi.fn(() => 'real-key');
    expect(bookingConfigResponse(readServerConfig({ HIVEGEN_FAKES: '1' }), readKey)).toEqual({ mode: 'live', turnstileSiteKey: '1x00000000000000000000AA' });
    expect(readKey).not.toHaveBeenCalled();
  });

  it('live → the key from the site setting', () => {
    const readKey = vi.fn(() => 'site-key');
    expect(bookingConfigResponse(readServerConfig(local), readKey)).toEqual({ mode: 'live', turnstileSiteKey: 'site-key' });
    expect(readKey).toHaveBeenCalledTimes(1);
  });

  it('live with an empty site setting → no key in the JSON', () => {
    const body = bookingConfigResponse(readServerConfig(local), () => undefined);
    expect(JSON.stringify(body)).toBe('{"mode":"live"}');
    expect(JSON.stringify(bookingConfigResponse(readServerConfig(local), () => ''))).toBe('{"mode":"live"}');
  });

  it('demo and off → no key, and the site setting is never read', () => {
    const readKey = vi.fn(() => 'site-key');
    expect(JSON.stringify(bookingConfigResponse(readServerConfig({}), readKey))).toBe('{"mode":"demo"}');
    expect(JSON.stringify(bookingConfigResponse(readServerConfig({ NODE_ENV: 'production' }), readKey))).toBe('{"mode":"off"}');
    expect(readKey).not.toHaveBeenCalled();
  });
});

describe('bookingConfigResponse in production with no Turnstile site key', () => {
  const live = { ...full, SMTP_HOST: 'h', SMTP_PORT: '465', SMTP_USER: 'u', SMTP_PASS: 'p', MAIL_FROM: 'HiveGen <connect@hivegen.co>' };
  let error: MockInstance;
  beforeEach(() => { error = vi.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); });
  /** The module afresh, so its "said once" memory starts empty. */
  const fresh = async () => (await import('../../src/server/booking-config')).bookingConfigResponse;

  it('a live production server with an empty key is off: a form that every visitor fails on is never shown', async () => {
    const respond = await fresh();
    const production = readServerConfig({ ...live, NODE_ENV: 'production' });
    expect(production.mode).toBe('live');
    expect(JSON.stringify(respond(production, () => undefined))).toBe('{"mode":"off"}');
    expect(JSON.stringify(respond(production, () => ''))).toBe('{"mode":"off"}');
  });

  it('also on a built server with NODE_ENV forgotten, and with NODE_ENV written oddly', async () => {
    const respond = await fresh();
    expect(respond(readServerConfig(live, { builtDefault: true }), () => undefined)).toEqual({ mode: 'off' });
    expect(respond(readServerConfig({ ...live, NODE_ENV: 'Production ' }), () => undefined)).toEqual({ mode: 'off' });
  });

  it('says so once, in one line, without any secret', async () => {
    const respond = await fresh();
    const secrets = { DATABASE_URL: 'mysql://hguser:hgsecretpw@db.example:3306/hivegen', GOOGLE_CLIENT_SECRET: 'gsecret-value', GOOGLE_REFRESH_TOKEN: 'grefresh-value', TURNSTILE_SECRET: 'tsecret-value', CRON_SECRET: 'csecret-value', SMTP_PASS: 'smtppass-value' };
    const production = readServerConfig({ ...live, ...secrets, NODE_ENV: 'production' });
    expect(production.mode).toBe('live');
    for (let i = 0; i < 5; i++) respond(production, () => undefined);
    expect(error).toHaveBeenCalledTimes(1);
    const line = String(error.mock.calls[0].join(' '));
    expect(line).not.toContain('\n');
    expect(line).toContain('turnstileSiteKey');
    for (const secret of Object.values(secrets)) expect(line).not.toContain(secret);
  });

  it('with the key set, production is live as before and logs nothing', async () => {
    const respond = await fresh();
    expect(respond(readServerConfig({ ...live, NODE_ENV: 'production' }), () => 'site-key')).toEqual({ mode: 'live', turnstileSiteKey: 'site-key' });
    expect(error).not.toHaveBeenCalled();
  });

  it('outside production an empty key keeps today\'s behaviour (developers may test without Turnstile), and logs nothing', async () => {
    const respond = await fresh();
    const dev = readServerConfig({ ...local, NODE_ENV: 'development' });
    expect(dev.mode).toBe('live');
    expect(JSON.stringify(respond(dev, () => undefined))).toBe('{"mode":"live"}');
    expect(JSON.stringify(respond(readServerConfig(local), () => undefined))).toBe('{"mode":"live"}');
    expect(error).not.toHaveBeenCalled();
  });

  it('production that is not connected stays off, without asking for the key or logging', async () => {
    const respond = await fresh();
    const readKey = vi.fn(() => undefined);
    expect(respond(readServerConfig({ NODE_ENV: 'production' }), readKey)).toEqual({ mode: 'off' });
    expect(readKey).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});

describe('loadTurnstileSiteKey', () => {
  beforeEach(() => { delete process.env.CONTENT_DIR; delete process.env.PUBLIC_DIR; });
  afterEach(() => { delete process.env.CONTENT_DIR; delete process.env.PUBLIC_DIR; removeTempContent(); });

  it('is undefined while the setting is empty, and the key once it is filled in', () => {
    process.env.CONTENT_DIR = tempContent(); // not the real file: it gets its key when the site goes live
    expect(loadTurnstileSiteKey()).toBeUndefined();
    process.env.CONTENT_DIR = tempContent({ 'site.yaml': (t) => t.replace('turnstileSiteKey: ""', 'turnstileSiteKey: "0xABC"') });
    expect(loadTurnstileSiteKey()).toBe('0xABC');
  });

  it('reads only site.yaml: no check of the other content files or of public/', () => {
    process.env.CONTENT_DIR = tempContent({ 'site.yaml': (t) => t.replace('turnstileSiteKey: ""', 'turnstileSiteKey: "0xABC"') });
    process.env.PUBLIC_DIR = 'no-such-public-dir'; // loadSite() would throw: the logo and hero loop are not there
    expect(loadTurnstileSiteKey()).toBe('0xABC');
  });
});
