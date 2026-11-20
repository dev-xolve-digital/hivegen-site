import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { readServerConfig } from '../../src/server/config';
import { bookingConfigResponse } from '../../src/server/booking-config';
import { loadTurnstileSiteKey } from '../../src/lib/content/load';
import { tempContent, removeTempContent } from '../helpers/temp-content';

const full = {
  DATABASE_URL: 'mysql://u:p@h:3306/db', GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 's', GOOGLE_REFRESH_TOKEN: 'r',
  TURNSTILE_SECRET: 't', CRON_SECRET: 'c', PUBLIC_SITE_URL: 'https://hivegen.co',
};

describe('bookingConfigResponse', () => {
  it('fakes → Cloudflare test key, without reading the site setting', () => {
    const readKey = vi.fn(() => 'real-key');
    expect(bookingConfigResponse(readServerConfig({ HIVEGEN_FAKES: '1' }), readKey)).toEqual({ mode: 'live', turnstileSiteKey: '1x00000000000000000000AA' });
    expect(readKey).not.toHaveBeenCalled();
  });

  it('live → the key from the site setting', () => {
    const readKey = vi.fn(() => 'site-key');
    expect(bookingConfigResponse(readServerConfig(full), readKey)).toEqual({ mode: 'live', turnstileSiteKey: 'site-key' });
    expect(readKey).toHaveBeenCalledTimes(1);
  });

  it('live with an empty site setting → no key in the JSON', () => {
    const body = bookingConfigResponse(readServerConfig(full), () => undefined);
    expect(JSON.stringify(body)).toBe('{"mode":"live"}');
    expect(JSON.stringify(bookingConfigResponse(readServerConfig(full), () => ''))).toBe('{"mode":"live"}');
  });

  it('demo and off → no key, and the site setting is never read', () => {
    const readKey = vi.fn(() => 'site-key');
    expect(JSON.stringify(bookingConfigResponse(readServerConfig({}), readKey))).toBe('{"mode":"demo"}');
    expect(JSON.stringify(bookingConfigResponse(readServerConfig({ NODE_ENV: 'production' }), readKey))).toBe('{"mode":"off"}');
    expect(readKey).not.toHaveBeenCalled();
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
