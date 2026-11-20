import { generateKeyPairSync, verify, type KeyObject } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readServerConfig } from '../../src/server/config';
import { createContext, type ServerContext } from '../../src/server/context';
import { slotsHandler, videoHandler, withContext } from '../../src/server/http/handlers';
import { signStreamToken } from '../../src/server/stream/sign';
import { getVideo } from '../../src/lib/content/load';
import { removeTempContent, tempContent } from '../helpers/temp-content';

const CODE = 'yph9uum1du6x869b';
const KEY_ID = 'key-id-1';
const NOW = new Date('2026-11-20T12:00:00.000Z');
const NOW_S = Math.floor(NOW.getTime() / 1000);

// One real RSA key for the whole file, exported the way Stream hands it out: the JWK as JSON, in base64.
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwkBase64 = Buffer.from(JSON.stringify(privateKey.export({ format: 'jwk' }))).toString('base64');

const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;
const verifies = (token: string, key: KeyObject = publicKey) => {
  const [header, claims, signature] = token.split('.');
  return verify('RSA-SHA256', Buffer.from(`${header}.${claims}`), key, Buffer.from(signature, 'base64url'));
};
const sign = (over: Partial<Parameters<typeof signStreamToken>[0]> = {}) => signStreamToken({ uid: 'uid-1', keyId: KEY_ID, jwkBase64, now: NOW, ...over });

describe('signStreamToken', () => {
  it('the token verifies with the public key and carries sub, kid, exp and nbf', () => {
    const token = sign();
    expect(token).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/); // three base64url parts, no padding
    expect(verifies(token)).toBe(true);
    const [header, claims] = token.split('.');
    expect(decode(header)).toEqual({ alg: 'RS256', kid: KEY_ID });
    expect(decode(claims)).toEqual({ sub: 'uid-1', kid: KEY_ID, exp: NOW_S + 3600, nbf: NOW_S - 60 });
  });

  it('lives for the ttl it is given, in whole seconds', () => {
    const claims = decode(sign({ ttlSeconds: 90, now: new Date(NOW.getTime() + 999) }).split('.')[1]);
    expect(claims).toMatchObject({ exp: NOW_S + 90, nbf: NOW_S - 60 });
  });

  it('a changed claim or another key does not verify', () => {
    const token = sign();
    const [header, , signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'someone-elses', kid: KEY_ID, exp: NOW_S + 3600, nbf: NOW_S - 60 })).toString('base64url');
    expect(verifies(`${header}.${forged}.${signature}`)).toBe(false);
    expect(verifies(token, generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey)).toBe(false);
  });

  it('a key that is not a private JWK throws, without the key in the message', () => {
    const publicOnly = Buffer.from(JSON.stringify(publicKey.export({ format: 'jwk' }))).toString('base64');
    for (const bad of [publicOnly, Buffer.from('not json').toString('base64'), '']) {
      const attempt = () => sign({ jwkBase64: bad });
      expect(attempt).toThrow();
      try { attempt(); } catch (e) { expect(String((e as Error).message)).not.toContain(bad || 'never-empty'); }
    }
  });
});

describe('GET /api/video/[id]', () => {
  const REEL = 'v-portfolio-reel';
  const reelUid = getVideo(REEL).streamUid!;
  const keyEnv = { STREAM_SIGNING_KEY_ID: KEY_ID, STREAM_SIGNING_KEY_JWK: jwkBase64 };
  const plain = (uid: string) => `https://customer-${CODE}.cloudflarestream.com/${uid}/iframe?autoplay=true&primaryColor=%231C45F5`;

  const contextFor = (env: Record<string, string>) => createContext(readServerConfig({ NODE_ENV: 'test', ...env }));
  const notConnected = (env: Record<string, string> = {}) => contextFor(env);
  const fakes = (env: Record<string, string> = {}) => contextFor({ HIVEGEN_FAKES: '1', ...env });
  const ask = (ctx: ServerContext, id: string, headers: Record<string, string> = {}) =>
    videoHandler(new Request(`http://localhost:4321/api/video/${id}`, { headers }), ctx, { id });
  const signingOn = () => { process.env.CONTENT_DIR = tempContent({ 'site.yaml': (t) => t.replace('streamSignedUrls: false', 'streamSignedUrls: true') }); };

  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.CONTENT_DIR;
    delete process.env.PUBLIC_DIR;
    removeTempContent();
  });

  it('with signing off, the answer is the plain player address, private and never cached', async () => {
    const res = await ask(await fakes(), REEL);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ src: plain(reelUid) });
  });

  it('with signing on and a key, the address carries a signed token in place of the video ID', async () => {
    signingOn();
    const res = await ask(await fakes(keyEnv), REEL);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const { src } = (await res.json()) as { src: string };
    const match = src.match(/^https:\/\/customer-yph9uum1du6x869b\.cloudflarestream\.com\/([\w-]+\.[\w-]+\.[\w-]+)\/iframe\?autoplay=true&primaryColor=%231C45F5$/);
    expect(match, src).not.toBeNull();
    const token = match![1];
    expect(src).not.toContain(reelUid);
    expect(verifies(token)).toBe(true);
    const claims = decode(token.split('.')[1]);
    expect(claims).toMatchObject({ sub: reelUid, kid: KEY_ID });
    const now = Math.floor(Date.now() / 1000);
    expect(Math.abs((claims.exp as number) - (now + 3600))).toBeLessThan(10);
    expect(Math.abs((claims.nbf as number) - (now - 60))).toBeLessThan(10);
  });

  it('every request gets a new token', async () => {
    signingOn();
    const ctx = await fakes(keyEnv);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(NOW);
      const first = ((await (await ask(ctx, REEL)).json()) as { src: string }).src;
      vi.setSystemTime(new Date(NOW.getTime() + 5000));
      const second = ((await (await ask(ctx, REEL)).json()) as { src: string }).src;
      expect(second).not.toBe(first);
    } finally {
      vi.useRealTimers();
    }
  });

  it('with signing on and no key, the answer is 503 not_connected', async () => {
    signingOn();
    for (const ctx of [await fakes(), await notConnected()]) {
      const res = await ask(ctx, REEL);
      expect(res.status).toBe(503);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.json()).toEqual({ error: 'not_connected' });
    }
  });

  it('a half-set key (an ID without the key itself) is no key', async () => {
    signingOn();
    expect((await ask(await fakes({ STREAM_SIGNING_KEY_ID: KEY_ID }), REEL)).status).toBe(503);
  });

  it('works when booking is not connected: signing needs only the key', async () => {
    const ctx = await notConnected(keyEnv);
    expect(ctx.service).toBeNull();
    expect(await (await ask(ctx, REEL)).json()).toEqual({ src: plain(reelUid) });
    signingOn();
    const { src } = (await (await ask(ctx, REEL)).json()) as { src: string };
    expect(src).not.toContain(reelUid);
    expect(src).toMatch(/\/[\w-]+\.[\w-]+\.[\w-]+\/iframe\?/);
  });

  it('an unknown id is 404, and so is anything that is not a video id', async () => {
    const ctx = await fakes();
    for (const id of ['no-such-video', '', 'V-PORTFOLIO-REEL', '../content/site', 'v-portfolio-reel%2F']) {
      const res = await ask(ctx, id);
      expect(res.status, id).toBe(404);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.json()).toEqual({ error: 'not_found' });
    }
    expect((await videoHandler(new Request('http://localhost:4321/api/video/'), ctx)).status).toBe(404); // no id at all
  });

  it('a video that is not on Stream is 404, whether signing is on or off', async () => {
    process.env.CONTENT_DIR = tempContent({
      'videos.yaml': (t) => t.replace(/(streamUid: 69f417a2079e8572ca2ec41802f03bc2)/, '$1\n    host: local'),
      'site.yaml': (t) => t.replace('streamSignedUrls: false', 'streamSignedUrls: true'),
    });
    const ctx = await fakes(keyEnv);
    expect((await ask(ctx, REEL)).status).toBe(404);
    expect((await ask(ctx, 'v-agent-spotlight')).status).toBe(200); // the others still play
    process.env.CONTENT_DIR = tempContent({ 'site.yaml': (t) => t.replace('videoSource: stream', 'videoSource: local') });
    expect((await ask(ctx, REEL)).status).toBe(404);
  });

  it('answers for every video the pages play, the client videos included', async () => {
    const ctx = await fakes();
    for (const id of ['t-kenneth', 't-chris', 'h-agent-led', 'v-before-after-edit']) {
      expect(((await (await ask(ctx, id)).json()) as { src: string }).src, id).toContain(`/${getVideo(id).streamUid}/iframe?`);
    }
  });

  it('reads only site.yaml and videos.yaml: public/ is not looked at', async () => {
    process.env.PUBLIC_DIR = 'no-such-public-dir'; // loadSite() would throw: the logo, the hero loop and every card image are missing
    expect((await ask(await fakes(), REEL)).status).toBe(200);
  });

  it('a key that cannot sign is a 500 server_error that is logged by kind only', async () => {
    signingOn();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const brokenKey = Buffer.from('{"kty":"RSA","n":"secret-part"}').toString('base64');
    const res = await ask(await fakes({ STREAM_SIGNING_KEY_ID: KEY_ID, STREAM_SIGNING_KEY_JWK: brokenKey }), REEL);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'server_error' });
    const logged = errors.mock.calls.flat().join(' ');
    expect(logged).toContain('api: video failed');
    expect(logged).not.toContain('secret-part');
    expect(logged).not.toContain(brokenKey);
  });

  it('120 an hour per address: the 121st is 429, another address is fine, and slots have their own allowance', async () => {
    const ctx = await fakes();
    const ip = { 'cf-connecting-ip': '203.0.113.30' };
    for (let i = 1; i <= 120; i += 1) expect((await ask(ctx, REEL, ip)).status, `request ${i}`).toBe(200);
    const blocked = await ask(ctx, REEL, ip);
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: 'rate_limited' });
    expect(blocked.headers.get('cache-control')).toBe('no-store');
    expect((await ask(ctx, REEL, { 'cf-connecting-ip': '203.0.113.31' })).status).toBe(200);
    expect((await slotsHandler(new Request('http://localhost:4321/api/booking/slots', { headers: ip }), ctx)).status).toBe(200);
    ctx.fakes!.reset();
    expect((await ask(ctx, REEL, ip)).status).toBe(200); // a reset starts the count again
  });

  it('is a route through withContext: a context that cannot start is still the API\'s own 500', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const route = withContext(videoHandler, async () => { throw new Error('boom'); });
    const res = await route({ request: new Request('http://localhost:4321/api/video/v-portfolio-reel'), params: { id: REEL }, clientAddress: '203.0.113.9' });
    expect(res.status).toBe(500);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});
