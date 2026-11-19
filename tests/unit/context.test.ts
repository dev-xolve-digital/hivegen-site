import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { loadBookingSite, loadSection, loadSite } from '../../src/lib/content/load';
import { clientMode, readServerConfig } from '../../src/server/config';
import { RETRY_AFTER_MS, chooseTracker, createContext, createContextProvider, readPixelId, type ServerContext } from '../../src/server/context';
import { createMemoryStore } from '../../src/server/store/memory';
import { META_GRAPH_VERSION } from '../../src/server/tracking/meta';
import { removeTempContent, tempContent } from '../helpers/temp-content';

const tempDirs: string[] = [];
function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hg-ctx-'));
  tempDirs.push(dir);
  return dir;
}

const full = {
  DATABASE_URL: 'mysql://hguser:hgsecretpw@127.0.0.1:1/hivegen', GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsecret', GOOGLE_REFRESH_TOKEN: 'grefresh',
  TURNSTILE_SECRET: 'tsecret', CRON_SECRET: 'csecret', PUBLIC_SITE_URL: 'https://hivegen.co',
};
const smtp = { SMTP_HOST: 'smtp.example.test', SMTP_PORT: '465', SMTP_USER: 'u', SMTP_PASS: 'p', MAIL_FROM: 'HiveGen <connect@hivegen.co>' };
const config = (env: Record<string, string>) => readServerConfig(env);

let info: MockInstance, warn: MockInstance, error: MockInstance;
beforeEach(() => {
  info = vi.spyOn(console, 'info').mockImplementation(() => {});
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  error = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  delete process.env.CONTENT_DIR;
  removeTempContent();
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
const logged = (spy: MockInstance) => spy.mock.calls.flat().join(' ');

describe('createContext in fakes mode', () => {
  it('wires the memory store, fake calendar, outbox mailer and recording tracker', async () => {
    const ctx = await createContext(config({ HIVEGEN_FAKES: '1', NODE_ENV: 'test' }), { outboxDir: tempDir() });
    expect(ctx.config.mode).toBe('fakes');
    expect(ctx.service).not.toBeNull();
    expect(ctx.fakes).toMatchObject({ tracked: [], calendar: expect.anything(), mailer: { sent: [] } });
  });

  it('the bot check passes unless the token is "fail"', async () => {
    const ctx = await createContext(config({ HIVEGEN_FAKES: '1', NODE_ENV: 'test' }), { outboxDir: tempDir() });
    const form = { name: 'Zoe', email: 'zoe@example.com', buyerType: 'agent', volume: loadSection('booking').volumeOptions[0], pageVersion: 'main', turnstileToken: 'anything' };
    expect((await ctx.service!.createLead(form, {})).ok).toBe(true);
    expect(await ctx.service!.createLead({ ...form, turnstileToken: 'fail' }, {})).toEqual({ ok: false, error: 'bot_check_failed' });
  });

  it('never reaches a real service, even when real credentials are set', async () => {
    const fetchSpy = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetchSpy);
    const dir = tempDir();
    // These credentials point at a database that does not exist and Google/Cloudflare accounts that are not real.
    const ctx = await createContext(config({ ...full, ...smtp, HIVEGEN_FAKES: '1', NODE_ENV: 'test' }), { outboxDir: dir });
    expect(ctx.config.mode).toBe('fakes');
    const form = { name: 'Zoe', email: 'zoe@example.com', buyerType: 'agent', volume: loadSection('booking').volumeOptions[0], pageVersion: 'main', turnstileToken: 'ok' };
    const lead = await ctx.service!.createLead(form, {});
    expect(lead.ok).toBe(true);
    const { slots } = await ctx.service!.getSlots();
    const booked = await ctx.service!.book({ leadId: (lead as { value: { leadId: string } }).value.leadId, start: slots[4].start, visitorTz: 'UTC' }, {});
    expect(booked).toMatchObject({ ok: true, value: { status: 'booked' } });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(ctx.fakes!.mailer.sent).toHaveLength(2);
    // The emails went to the outbox folder, and Hassan's went to a made-up address, not the real one.
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.txt'))).toHaveLength(2);
    expect(ctx.fakes!.mailer.sent.map((m) => m.to)).toEqual(['zoe@example.com', 'hassan@example.test']);
  });

  it('uses .outbox/test for the emails unless told otherwise, and says where once (the folder only)', async () => {
    await createContext(config({ HIVEGEN_FAKES: '1', NODE_ENV: 'test' }));
    expect(info).toHaveBeenCalledTimes(1);
    expect(logged(info)).toContain(path.resolve('.outbox', 'test'));
    expect(logged(info)).not.toContain('@');
  });

  it('fakes are off in production: HIVEGEN_FAKES is ignored there', async () => {
    const ctx = await createContext(config({ HIVEGEN_FAKES: '1', NODE_ENV: 'production' }));
    expect(ctx.fakes).toBeUndefined();
    expect(ctx.service).toBeNull();
  });
});

describe('createContext when not connected', () => {
  it('has no service and no fakes', async () => {
    const ctx = await createContext(config({ NODE_ENV: 'test' }));
    expect(ctx.service).toBeNull();
    expect(ctx.fakes).toBeUndefined();
    expect(ctx.config.mode).toBe('not_connected');
  });

  it('in production: one loud error naming what is missing', async () => {
    const ctx = await createContext(config({ NODE_ENV: 'production' }));
    expect(ctx.service).toBeNull();
    expect(error).toHaveBeenCalledTimes(1);
    const text = logged(error);
    for (const name of ctx.config.missing) expect(text).toContain(name);
    expect(text).toContain('DATABASE_URL');
    expect(text).toContain('SMTP_HOST');
  });

  it('in production with only a mailbox missing, the error names just that', async () => {
    await createContext(config({ ...full, NODE_ENV: 'production' }));
    expect(error).toHaveBeenCalledTimes(1);
    expect(logged(error)).toContain('SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM');
    expect(logged(error)).not.toContain('hgsecretpw');
  });

  it('outside production: no error (the demo is what runs)', async () => {
    await createContext(config({ NODE_ENV: 'development' }));
    await createContext(config({}));
    expect(error).not.toHaveBeenCalled();
  });
});

describe('createContext in live mode', () => {
  it('a missing migrations folder: not connected, with the path in the log', async () => {
    const missing = path.join(tempDir(), 'nowhere', 'migrations');
    const ctx = await createContext(config({ ...full, ...smtp, NODE_ENV: 'production' }), { migrationsDir: missing });
    expect(ctx.service).toBeNull();
    expect(ctx.fakes).toBeUndefined();
    expect(ctx.config.mode).toBe('not_connected');
    expect(ctx.config.missing.length).toBeGreaterThan(0);
    expect(error).toHaveBeenCalled();
    expect(logged(error)).toContain(missing);
    expect(ctx.failedAt).toBeTypeOf('number');
  });

  it('a malformed DATABASE_URL is not connected too, not a rejection', async () => {
    const ctx = await createContext(config({ ...full, ...smtp, DATABASE_URL: 'this is not a url', NODE_ENV: 'production' }));
    expect(ctx.service).toBeNull();
    expect(ctx.failedAt).toBeTypeOf('number');
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('a broken content file is not connected too (the file is named in the log), not a rejection', async () => {
    process.env.CONTENT_DIR = tempContent({ 'sections/booking.yaml': () => 'heading: [' });
    const envs: Array<Record<string, string>> = [{ ...full, ...smtp, NODE_ENV: 'production' }, { HIVEGEN_FAKES: '1', NODE_ENV: 'test' }];
    for (const env of envs) {
      error.mockClear();
      const ctx = await createContext(config(env), { outboxDir: tempDir() });
      expect(ctx.service).toBeNull();
      expect(ctx.fakes).toBeUndefined();
      expect(ctx.failedAt).toBeTypeOf('number');
      expect(error).toHaveBeenCalledTimes(1);
      expect(logged(error)).toContain('booking.yaml');
    }
  });

  it('a new try after a failure logs one warning line, not the loud error, and no startup warnings', async () => {
    const ctx = await createContext(config({ ...full, ...smtp, NODE_ENV: 'test' }), { retry: true, migrationsDir: path.join(tempDir(), 'nowhere') });
    expect(ctx.service).toBeNull();
    expect(error).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(logged(warn)).toContain('still not connected');
  });

  it('a start that works has no failedAt', async () => {
    const ctx = await createContext(config({ HIVEGEN_FAKES: '1', NODE_ENV: 'test' }), { outboxDir: tempDir() });
    expect(ctx.failedAt).toBeUndefined();
    expect((await createContext(config({ NODE_ENV: 'production' }))).failedAt).toBeUndefined(); // missing settings: nothing to retry
  });

  it('looks for db/migrations in the working directory', async () => {
    const cwd = tempDir();
    vi.spyOn(process, 'cwd').mockReturnValue(cwd);
    const ctx = await createContext(config({ ...full, ...smtp, NODE_ENV: 'production' }));
    expect(ctx.service).toBeNull();
    expect(logged(error)).toContain(path.join(cwd, 'db', 'migrations'));
  });

  it('a database that cannot be reached: not connected (the browser is told "off" in production), and the log has no secrets', async () => {
    const ctx = await createContext(config({ ...full, ...smtp, NODE_ENV: 'production' }));
    expect(ctx.service).toBeNull();
    expect(ctx.fakes).toBeUndefined();
    expect(ctx.config.mode).toBe('not_connected');
    expect(clientMode(ctx.config)).toBe('off');
    expect(ctx.failedAt).toBeTypeOf('number');
    expect(error).toHaveBeenCalledTimes(1);
    expect(logged(error)).toMatch(/database|migrat/i);
    for (const secret of ['hgsecretpw', 'gsecret', 'grefresh', 'tsecret', 'csecret']) expect(logged(error)).not.toContain(secret);
  }, 30_000);
});

describe('startup warning for a public address outside production', () => {
  it('warns once when PUBLIC_SITE_URL is a public host but NODE_ENV is not production', async () => {
    await createContext(config({ HIVEGEN_FAKES: '1', NODE_ENV: 'test', PUBLIC_SITE_URL: 'https://hivegen.co' }), { outboxDir: tempDir() });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(logged(warn)).toContain('NODE_ENV is not production on a public site — the demo booking would show');
  });

  it('warns when NODE_ENV is not set at all', async () => {
    await createContext(config({ PUBLIC_SITE_URL: 'https://hivegen.co' }));
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('stays quiet for local addresses and in production', async () => {
    for (const url of ['http://localhost:4321', 'http://127.0.0.1:4322', 'http://localhost']) {
      await createContext(config({ NODE_ENV: 'test', PUBLIC_SITE_URL: url }));
    }
    await createContext(config({ NODE_ENV: 'production', PUBLIC_SITE_URL: 'https://hivegen.co' }));
    await createContext(config({ NODE_ENV: 'test' }));
    expect(warn).not.toHaveBeenCalled();
  });

  it('a look-alike host still counts as public', async () => {
    await createContext(config({ NODE_ENV: 'test', PUBLIC_SITE_URL: 'https://localhost.evil.example' }));
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('getContext', () => {
  it('is one context for the whole process, made once', async () => {
    vi.resetModules();
    vi.stubEnv('HIVEGEN_FAKES', '1');
    vi.stubEnv('NODE_ENV', 'test');
    const { getContext } = await import('../../src/server/context');
    const [a, b] = await Promise.all([getContext(), getContext()]);
    expect(a).toBe(b);
    expect(await getContext()).toBe(a);
    expect(a.config.mode).toBe('fakes');
    expect(info).toHaveBeenCalledTimes(1);
  });

  it('reads the .env file once, through loadDotEnv, before reading the settings', async () => {
    vi.resetModules();
    const calls: string[] = [];
    vi.doMock('../../src/server/env', () => ({ loadDotEnv: () => { calls.push('loadDotEnv'); vi.stubEnv('HIVEGEN_FAKES', '1'); } }));
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('HIVEGEN_FAKES', '');
    const { getContext } = await import('../../src/server/context');
    const ctx = await getContext();
    await getContext();
    expect(calls).toEqual(['loadDotEnv']);
    expect(ctx.config.mode).toBe('fakes'); // the setting came from "the .env file"
    vi.doUnmock('../../src/server/env');
  });
});

describe('createContextProvider', () => {
  let t = 0;
  const now = () => t;
  const ctxOf = (failedAt?: number) => ({ config: config({}), service: null, runScheduled: null, tracker: undefined as never, limits: undefined as never, ...(failedAt === undefined ? {} : { failedAt }) }) as ServerContext;
  /** A create() that answers from a list, and records how it was called. */
  function creator(answers: Array<() => Promise<ServerContext>>) {
    const calls: boolean[] = [];
    const create = (retry: boolean) => { calls.push(retry); return (answers[calls.length - 1] ?? answers[answers.length - 1])(); };
    return { create, calls };
  }
  const deferred = () => {
    let resolve!: (c: ServerContext) => void;
    const promise = new Promise<ServerContext>((r) => { resolve = r; });
    return { promise, resolve };
  };
  beforeEach(() => { t = 0; });

  it('makes the context once and gives the same one to everyone', async () => {
    const healthy = ctxOf();
    const { create, calls } = creator([async () => healthy]);
    const provider = createContextProvider(create, now);
    const [a, b] = await Promise.all([provider.get(), provider.get()]);
    expect(a).toBe(healthy);
    expect(b).toBe(healthy);
    expect(await provider.get()).toBe(healthy);
    expect(calls).toEqual([false]);
    t = 10 * RETRY_AFTER_MS;
    await provider.get();
    expect(calls).toEqual([false]); // nothing failed: nothing to retry
  });

  it('after a failed start: 503 for a minute, then one background try; requests never wait for it', async () => {
    const down = ctxOf(0);
    const healthy = ctxOf();
    const retry = deferred();
    const { create, calls } = creator([async () => down, () => retry.promise]);
    const provider = createContextProvider(create, now);
    expect(await provider.get()).toBe(down);

    t = RETRY_AFTER_MS - 1;
    expect(await provider.get()).toBe(down);
    expect(calls).toEqual([false]); // not yet

    t = RETRY_AFTER_MS;
    // The request that crosses the line is answered at once, with the not-connected context, while the new try runs.
    expect(await provider.get()).toBe(down);
    expect(calls).toEqual([false, true]);
    // Others arriving while it runs share that one try.
    await Promise.all([provider.get(), provider.get(), provider.get()]);
    expect(calls).toEqual([false, true]);
    expect(await provider.get()).toBe(down);

    retry.resolve(healthy);
    await vi.waitFor(async () => expect(await provider.get()).toBe(healthy));
    expect(calls).toEqual([false, true]);
    t = 100 * RETRY_AFTER_MS;
    await provider.get();
    expect(calls).toEqual([false, true]); // connected: never retried again
    expect(info.mock.calls.flat().filter((m) => String(m).includes('connected'))).toHaveLength(1);
  });

  it('a try that fails again starts the wait over', async () => {
    const { create, calls } = creator([async () => ctxOf(0), async () => ctxOf(RETRY_AFTER_MS), async () => ctxOf()]);
    const provider = createContextProvider(create, now);
    await provider.get();
    t = RETRY_AFTER_MS;
    await provider.get();
    await vi.waitFor(() => expect(calls).toEqual([false, true]));
    await vi.waitFor(async () => expect((await provider.get()).failedAt).toBe(RETRY_AFTER_MS));

    t = 2 * RETRY_AFTER_MS - 1;
    await provider.get();
    expect(calls).toEqual([false, true]);
    t = 2 * RETRY_AFTER_MS;
    await provider.get();
    expect(calls).toEqual([false, true, true]);
    await vi.waitFor(async () => expect((await provider.get()).failedAt).toBeUndefined());
  });

  it('a try that throws is logged and the wait starts over; requests are not affected', async () => {
    const { create, calls } = creator([async () => ctxOf(0), async () => { throw new Error('boom'); }, async () => ctxOf()]);
    const provider = createContextProvider(create, now);
    const down = await provider.get();
    t = RETRY_AFTER_MS;
    expect(await provider.get()).toBe(down);
    await vi.waitFor(() => expect(error).toHaveBeenCalledTimes(1));
    expect(down.failedAt).toBe(RETRY_AFTER_MS);
    t = 2 * RETRY_AFTER_MS - 1;
    await provider.get();
    expect(calls).toEqual([false, true]);
  });

  it('a context that could not be made at all is not kept: the next call tries again', async () => {
    const healthy = ctxOf();
    const { create, calls } = creator([async () => { throw new Error('bug'); }, async () => healthy]);
    const provider = createContextProvider(create, now);
    await expect(provider.get()).rejects.toThrow('bug');
    expect(await provider.get()).toBe(healthy);
    expect(calls).toEqual([false, false]);
  });
});

describe('loadBookingSite', () => {
  it('gives the call rules and where Hassan\'s emails go, from site.yaml alone', () => {
    const site = loadSite();
    expect(loadBookingSite()).toEqual({ rules: site.booking, hassanEmail: site.contact.notificationEmail });
  });
});

describe('the tracker', () => {
  const event = { name: 'PageView' as const, eventId: '3f8c1c1e-2b7a-4c53-9d0e-6a1f5b7d9e21', time: new Date('2026-12-01T10:00:00Z'), sourceUrl: 'https://hivegen.co/', user: { ip: '203.0.113.7' } };
  const meta = { capiToken: 'EAAB-secret', testEventCode: 'TEST123' };
  const answer = () => vi.fn(async () => new Response('{}', { status: 200 }));

  it('fakes and not-connected contexts both have one: the test server records, the other sends nothing', async () => {
    const fakes = await createContext(config({ HIVEGEN_FAKES: '1', NODE_ENV: 'test' }), { outboxDir: tempDir() });
    await fakes.tracker.send(event);
    expect(fakes.fakes!.tracked).toEqual([event]);
    fakes.fakes!.reset();
    await fakes.tracker.send(event); // still the same recording tracker after a reset
    expect(fakes.fakes!.tracked).toEqual([event]);

    const down = await createContext(config({ NODE_ENV: 'test' }));
    expect(down.tracker).toBeDefined();
    await expect(down.tracker.send(event)).resolves.toBeUndefined();
  });

  it('the Meta Conversions API is used when the token and the pixel id are both set', async () => {
    const fetchFn = answer();
    const store = createMemoryStore();
    const tracker = chooseTracker(meta, '123456789012345', store, fetchFn as unknown as typeof fetch);
    await tracker.send(event);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect((fetchFn.mock.calls[0] as unknown as [string])[0]).toBe(`https://graph.facebook.com/${META_GRAPH_VERSION}/123456789012345/events`);
    expect(JSON.parse((fetchFn.mock.calls[0] as unknown as [string, { body: string }])[1].body)).toMatchObject({ test_event_code: 'TEST123', access_token: 'EAAB-secret' });
    expect((await store.trackingEventsByStatus('sent')).map((r) => r.eventId)).toEqual([event.eventId]);
    expect(await tracker.resend((await store.trackingEventsByStatus('sent'))[0])).toBe(true); // cron's retry uses the same tracker
  });

  it('without the token, or without the pixel id, nothing is sent, recorded or retried', async () => {
    for (const [m, pixel] of [[undefined, '123456789012345'], [meta, undefined], [undefined, undefined]] as const) {
      const fetchFn = answer();
      const store = createMemoryStore();
      const tracker = chooseTracker(m, pixel, store, fetchFn as unknown as typeof fetch);
      await tracker.send(event);
      expect(await tracker.resend({ eventId: 'x', name: 'Lead', payload: { data: [] }, status: 'failed', attempts: 1 })).toBe(false);
      expect(fetchFn).not.toHaveBeenCalled();
      for (const status of ['pending', 'sent', 'failed', 'skipped'] as const) expect(await store.trackingEventsByStatus(status)).toEqual([]);
    }
  });

  it('the pixel id comes from site.yaml; an unreadable file means none, said once in the log without anything from the file', () => {
    expect(readPixelId()).toBeUndefined(); // the real content has none yet
    process.env.CONTENT_DIR = tempContent({ 'site.yaml': (t) => t.replace('metaPixelId: ""', 'metaPixelId: "123456789012345"') });
    expect(readPixelId()).toBe('123456789012345');
    process.env.CONTENT_DIR = tempContent({ 'site.yaml': (t) => t.replace('metaPixelId: ""', 'metaPixelId: "not-a-pixel"') });
    expect(readPixelId()).toBeUndefined();
    expect(error).toHaveBeenCalledTimes(1);
    expect(logged(error)).toContain('site.yaml');
    expect(logged(error)).toContain('Meta');
  });
});
