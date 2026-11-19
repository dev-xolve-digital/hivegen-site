import fs from 'node:fs';
import path from 'node:path';
import { loadBookingSite, loadSection } from '../lib/content/load';
import { createBookingService, type BookingService } from './booking/service';
import { createRateLimiter, type RateLimiter } from './booking/rate-limit';
import { verifyTurnstile } from './booking/turnstile';
import type { ServerEvent } from './booking/types';
import { createFakeCalendar, type FakeCalendar } from './calendar/fake';
import { createGoogleCalendar } from './calendar/google';
import { readServerConfig, type ServerConfig } from './config';
import { loadDotEnv } from './env';
import { createOutboxMailer, createSmtpMailer, type Mailer } from './mail/mailer';
import { createNotifier } from './mail/notifier';
import { runMigrations } from './store/migrate';
import { createMemoryStore } from './store/memory';
import { createMysqlStore, createPool } from './store/mysql';

const HOUR = 3_600_000;

/** The server's rate limits, each per client address: lead posts, booking and manage posts, and reads (slots; video and event requests later). */
export interface RateLimits { leads: RateLimiter; writes: RateLimiter; reads: RateLimiter }
const createLimits = (): RateLimits => ({
  leads: createRateLimiter({ limit: 10, windowMs: HOUR }),
  writes: createRateLimiter({ limit: 10, windowMs: HOUR }),
  reads: createRateLimiter({ limit: 120, windowMs: HOUR }),
});

export type OutboxMailer = ReturnType<typeof createOutboxMailer>;

export interface ServerContext {
  /** What the server runs as. Differs from the settings when a live setup fails at startup: then it says not_connected. */
  config: ServerConfig;
  /** Null when booking is not connected: the booking routes answer 503. */
  service: BookingService | null;
  limits: RateLimits;
  /** Only in fakes mode: the test services, for the test-only routes. Never set in any other mode. */
  fakes?: { calendar: FakeCalendar; mailer: OutboxMailer; tracked: ServerEvent[]; reset(): void };
}

export interface ContextOptions {
  /** Where the outbox mailer writes its files. Default `.outbox/test` in fakes mode, `.outbox` otherwise. */
  outboxDir?: string;
  /** Where the SQL migrations are. Default `db/migrations` in the working directory (the app is started from the repository root). */
  migrationsDir?: string;
}

const clock = { now: () => new Date() };
/** The test server's stand-in for Hassan's inbox: the test services never mail the real one. */
const FAKE_HASSAN_EMAIL = 'hassan@example.test';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** The words and rules the service needs, from the content files. A mistake in them is a ContentError naming the file. */
function loadServiceContent() {
  const { rules, hassanEmail } = loadBookingSite();
  const booking = loadSection('booking');
  return { rules, hassanEmail, calendarCopy: booking.calendarEvent, volumeOptions: booking.volumeOptions };
}

const logOutbox = (dir: string) => console.info(`booking: emails are written to ${path.resolve(dir)} instead of being sent`);

function notConnected(config: ServerConfig, missing: string[]): ServerContext {
  return { config: { ...config, mode: 'not_connected', missing }, service: null, limits: createLimits() };
}

/** Everything in memory: the services the Playwright server runs on, which never touch a real service whatever `.env` holds. */
function fakesContext(config: ServerConfig, outboxDir: string): ServerContext {
  const content = loadServiceContent();
  const calendar = createFakeCalendar();
  const mailer = createOutboxMailer(outboxDir);
  logOutbox(outboxDir);
  const tracked: ServerEvent[] = [];
  const notifier = createNotifier({ mailer, hassanEmail: FAKE_HASSAN_EMAIL, siteUrl: config.siteUrl, hassanTz: content.rules.timeZone });
  const build = () => createBookingService({
    store: createMemoryStore(), calendar, notifier, clock, rules: content.rules, siteUrl: config.siteUrl,
    calendarCopy: content.calendarCopy, volumeOptions: content.volumeOptions,
    tracker: { send: async (event) => { tracked.push(event); } },
    verifyBot: async (token) => token !== 'fail',
  });
  const limits = createLimits();
  const ctx: ServerContext = {
    config, service: build(), limits,
    fakes: {
      calendar, mailer, tracked,
      reset() {
        ctx.service = build(); // a new, empty store
        calendar.setDown(false);
        calendar.setBusy([]);
        calendar.events.clear();
        mailer.sent.length = 0;
        tracked.length = 0;
        for (const limiter of Object.values(limits)) limiter.reset();
        fs.rmSync(outboxDir, { recursive: true, force: true, maxRetries: 3 });
      },
    },
  };
  return ctx;
}

/** The short reason a startup step failed: what kind of error, never anything from the settings or the data. */
const reasonOf = (e: unknown) => {
  if (!(e instanceof Error)) return 'unknown error';
  const code = (e as { code?: unknown }).code;
  return `${e.name}${typeof code === 'string' ? ` ${code}` : ''}: ${e.message}`.slice(0, 300);
};

/** The real services. When the database cannot be used the server does not crash: booking is not connected until the app is restarted. */
async function liveContext(config: ServerConfig, options: ContextOptions): Promise<ServerContext> {
  const content = loadServiceContent();

  // The app is started from the repository root, so the folder is looked up from the working directory.
  const migrationsDir = options.migrationsDir ?? path.resolve(process.cwd(), 'db', 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    console.error(`booking: NOT CONNECTED. The migrations folder was not found at ${migrationsDir}. Start the app from the repository root. The site shows the offline booking card until then.`);
    return notConnected(config, ['db/migrations (folder not found)']);
  }
  const pool = createPool(config.databaseUrl!); // live means every required setting is there
  try {
    const applied = await runMigrations(pool, migrationsDir); // once per process: this is the one place that makes the context
    if (applied.length > 0) console.info(`booking: database migrations applied: ${applied.join(', ')}`);
  } catch (e) {
    console.error(`booking: NOT CONNECTED. The database could not be used (${reasonOf(e)}). The site shows the offline booking card until this is fixed and the app is restarted.`);
    await pool.end().catch(() => {});
    return notConnected(config, ['DATABASE_URL (the database could not be reached or migrated)']);
  }

  let mailer: Mailer;
  if (config.smtp) {
    mailer = createSmtpMailer(config.smtp);
  } else { // development without a mailbox
    const dir = options.outboxDir ?? '.outbox';
    mailer = createOutboxMailer(dir);
    logOutbox(dir);
  }
  const secret = config.turnstileSecret!;
  return {
    config, limits: createLimits(),
    service: createBookingService({
      store: createMysqlStore(pool), calendar: createGoogleCalendar(config.google!),
      notifier: createNotifier({ mailer, hassanEmail: content.hassanEmail, siteUrl: config.siteUrl, hassanTz: content.rules.timeZone }),
      tracker: { send: async () => {} }, // the Meta Conversions API arrives with tracking
      clock, rules: content.rules, siteUrl: config.siteUrl, calendarCopy: content.calendarCopy, volumeOptions: content.volumeOptions,
      verifyBot: (token, ip) => verifyTurnstile(token, ip, secret),
    }),
  };
}

/** Warns when the settings look like a real site that would show the demo booking (NODE_ENV forgotten). */
function warnAboutPublicSite(config: ServerConfig): void {
  if (config.production) return;
  let host: string;
  try {
    host = new URL(config.siteUrl).hostname;
  } catch {
    return;
  }
  if (!LOCAL_HOSTS.has(host)) console.warn('booking: NODE_ENV is not production on a public site — the demo booking would show');
}

/** Wires the server for `config`'s mode and says at startup what needs attention. Called once per process, by getContext. */
export async function createContext(config: ServerConfig, options: ContextOptions = {}): Promise<ServerContext> {
  warnAboutPublicSite(config);
  if (config.mode === 'fakes') return fakesContext(config, options.outboxDir ?? path.join('.outbox', 'test'));
  if (config.mode === 'live') return liveContext(config, options);
  if (config.production) {
    console.error(`booking: NOT CONNECTED in production. Missing settings: ${config.missing.join(', ')}. The site shows the offline booking card (Instagram and the backup link) until they are set.`);
  }
  return notConnected(config, config.missing);
}

let cached: Promise<ServerContext> | undefined;

/**
 * The server's one context: the settings (the `.env` file is read first, once) and the services wired for their mode.
 * Made on first use and kept. One that could not be made (a broken content file) is forgotten, so the next request tries again.
 */
export function getContext(): Promise<ServerContext> {
  if (!cached) {
    const made = (async () => {
      loadDotEnv();
      return createContext(readServerConfig(process.env));
    })();
    cached = made;
    made.catch(() => { if (cached === made) cached = undefined; });
  }
  return cached;
}
