import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { loadBookingSite, loadSection, loadSite } from '../../src/lib/content/load';
import { clientMode, readServerConfig } from '../../src/server/config';
import { createContext } from '../../src/server/context';

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

  it('a context that could not be made is tried again on the next call', async () => {
    vi.resetModules();
    vi.stubEnv('HIVEGEN_FAKES', '1');
    vi.stubEnv('NODE_ENV', 'test');
    const dir = tempDir();
    vi.stubEnv('CONTENT_DIR', dir); // an empty folder: the content files are missing
    const { getContext } = await import('../../src/server/context');
    await expect(getContext()).rejects.toThrow(/site\.yaml|booking\.yaml/);
    vi.unstubAllEnvs();
    vi.stubEnv('HIVEGEN_FAKES', '1');
    vi.stubEnv('NODE_ENV', 'test');
    await expect(getContext()).resolves.toMatchObject({ config: { mode: 'fakes' } });
  });
});

describe('loadBookingSite', () => {
  it('gives the call rules and where Hassan\'s emails go, from site.yaml alone', () => {
    const site = loadSite();
    expect(loadBookingSite()).toEqual({ rules: site.booking, hassanEmail: site.contact.notificationEmail });
  });
});
