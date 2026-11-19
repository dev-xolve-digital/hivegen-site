import fs from 'node:fs';
import path from 'node:path';
import { loadBookingSite, loadMetaPixelId, loadSection } from '../lib/content/load';
import { createBookingService, type BookingService } from './booking/service';
import { createRateLimiter, type RateLimiter } from './booking/rate-limit';
import { verifyTurnstile } from './booking/turnstile';
import type { ServerEvent, Store, Tracker, TrackingRecord } from './booking/types';
import { createFakeCalendar, type FakeCalendar } from './calendar/fake';
import { createGoogleCalendar } from './calendar/google';
import { readServerConfig, type ServerConfig } from './config';
import { runScheduledWork, type ScheduledSummary } from './cron';
import { loadDotEnv } from './env';
import { createOutboxMailer, createSmtpMailer, type Mailer } from './mail/mailer';
import { createNotifier } from './mail/notifier';
import type { Pool } from 'mysql2/promise';
import { runMigrations } from './store/migrate';
import { createMemoryStore } from './store/memory';
import { createMysqlStore, createPool } from './store/mysql';
import { createMetaTracker } from './tracking/meta';

const HOUR = 3_600_000;

/** The server's rate limits, each per client address: lead posts, booking and manage posts, reads (slots; video requests later) and tracking events. */
export interface RateLimits { leads: RateLimiter; writes: RateLimiter; reads: RateLimiter; events: RateLimiter }
const createLimits = (): RateLimits => ({
  leads: createRateLimiter({ limit: 10, windowMs: HOUR }),
  writes: createRateLimiter({ limit: 10, windowMs: HOUR }),
  reads: createRateLimiter({ limit: 120, windowMs: HOUR }),
  events: createRateLimiter({ limit: 120, windowMs: HOUR }),
});

export type OutboxMailer = ReturnType<typeof createOutboxMailer>;

export interface ServerContext {
  /** What the server runs as. Differs from the settings when starting the services failed: then it says not_connected. */
  config: ServerConfig;
  /** Null when booking is not connected: the booking routes answer 503. */
  service: BookingService | null;
  /** One pass of the scheduled work (POST /api/cron/run), on the same store and notifier as `service`. Null exactly when `service` is. */
  runScheduled: (() => Promise<ScheduledSummary>) | null;
  /** Sends tracking events to Meta (POST /api/events, and the booking service's own). Sends nothing when Meta is not set up, and is there in every mode. */
  tracker: Tracker;
  limits: RateLimits;
  /** Set (as a time in ms) when starting the services failed: getContext tries again once RETRY_AFTER_MS have passed. Never set otherwise. */
  failedAt?: number;
  /** Only in fakes mode: the test services, for the test-only routes. Never set in any other mode. */
  fakes?: { calendar: FakeCalendar; mailer: OutboxMailer; tracked: ServerEvent[]; reset(): void };
}

export interface ContextOptions {
  /** Where the outbox mailer writes its files. Default `.outbox/test` in fakes mode, `.outbox` otherwise. */
  outboxDir?: string;
  /** Where the SQL migrations are. Default `db/migrations` in the working directory (the app is started from the repository root). */
  migrationsDir?: string;
  /** This is a new try after a failed start: the failure is logged as a one-line warning and the startup warnings are not repeated. */
  retry?: boolean;
}

/** After a failed start, the services are tried again once this much time has passed. */
export const RETRY_AFTER_MS = 60_000;

const clock = { now: () => new Date() };
/** A tracker for a server with no Meta to send to: events are dropped, and there is nothing to send again. */
const NO_TRACKER: Tracker & { resend(r: TrackingRecord): Promise<boolean> } = { send: async () => {}, resend: async () => false };

/**
 * What sends the server's tracking events: Meta's Conversions API when both the access token (the environment) and the site's pixel id
 * (site.yaml) are set, else a tracker that sends nothing. `resend` is what cron uses for a failed event: it only sends, cron records it.
 */
export function chooseTracker(meta: ServerConfig['meta'], pixelId: string | undefined, store: Store, fetchFn?: typeof fetch): Tracker & { resend(r: TrackingRecord): Promise<boolean> } {
  if (!meta || !pixelId) return NO_TRACKER;
  return createMetaTracker({ pixelId, token: meta.capiToken, testEventCode: meta.testEventCode, store, fetchFn });
}

/** The pixel id from site.yaml. A file that cannot be read is no pixel (said in the log): tracking never keeps booking from starting. */
export function readPixelId(): string | undefined {
  try {
    return loadMetaPixelId();
  } catch (e) {
    console.error(`tracking: could not read the Meta Pixel id from site.yaml, so events are not sent to Meta (${reasonOf(e)})`);
    return undefined;
  }
}

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
  return { config: { ...config, mode: 'not_connected', missing }, service: null, runScheduled: null, tracker: NO_TRACKER, limits: createLimits() };
}

/** Everything in memory: the services the Playwright server runs on, which never touch a real service whatever `.env` holds. */
function fakesContext(config: ServerConfig, outboxDir: string): ServerContext {
  const content = loadServiceContent();
  const calendar = createFakeCalendar();
  const mailer = createOutboxMailer(outboxDir);
  logOutbox(outboxDir);
  const tracked: ServerEvent[] = [];
  const tracker: Tracker = { send: async (event) => { tracked.push(event); } };
  const notifier = createNotifier({ mailer, hassanEmail: FAKE_HASSAN_EMAIL, siteUrl: config.siteUrl, hassanTz: content.rules.timeZone });
  /** The service and the scheduled work on one new, empty store. */
  const build = () => {
    const store = createMemoryStore();
    return {
      service: createBookingService({
        store, calendar, notifier, clock, rules: content.rules, siteUrl: config.siteUrl,
        calendarCopy: content.calendarCopy, volumeOptions: content.volumeOptions,
        tracker,
        verifyBot: async (token) => token !== 'fail',
      }),
      runScheduled: () => runScheduledWork({ store, notifier, retryTracking: async () => false, clock }), // nothing is sent anywhere, so nothing is sent again
    };
  };
  const limits = createLimits();
  const ctx: ServerContext = {
    config, ...build(), tracker, limits,
    fakes: {
      calendar, mailer, tracked,
      reset() {
        Object.assign(ctx, build()); // a new, empty store
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

/** The short reason a startup step failed: the kind of error and its message, never anything from the settings or the data. */
const reasonOf = (e: unknown) => {
  if (!(e instanceof Error)) return 'unknown error';
  const code = (e as { code?: unknown }).code;
  const label = [e.name !== 'Error' ? e.name : '', typeof code === 'string' ? code : ''].filter(Boolean).join(' ');
  return `${label ? `${label}: ` : ''}${e.message}`.slice(0, 300);
};

/** The real services. Throws when they cannot be set up (a broken content file, no migrations, a database that does not answer). */
async function liveContext(config: ServerConfig, options: ContextOptions): Promise<ServerContext> {
  const content = loadServiceContent();

  // The app is started from the repository root, so the folder is looked up from the working directory.
  const migrationsDir = options.migrationsDir ?? path.resolve(process.cwd(), 'db', 'migrations');
  if (!fs.existsSync(migrationsDir)) throw new Error(`the migrations folder was not found at ${migrationsDir}; start the app from the repository root`);

  let pool: Pool | undefined;
  try {
    pool = createPool(config.databaseUrl!); // live means every required setting is there
    const applied = await runMigrations(pool, migrationsDir); // one pool per process, and migrations once: only a successful start gets here
    if (applied.length > 0) console.info(`booking: database migrations applied: ${applied.join(', ')}`);

    let mailer: Mailer;
    if (config.smtp) {
      mailer = createSmtpMailer(config.smtp);
    } else { // development without a mailbox
      const dir = options.outboxDir ?? '.outbox';
      mailer = createOutboxMailer(dir);
      logOutbox(dir);
    }
    const secret = config.turnstileSecret!;
    const store = createMysqlStore(pool);
    const notifier = createNotifier({ mailer, hassanEmail: content.hassanEmail, siteUrl: config.siteUrl, hassanTz: content.rules.timeZone });
    const tracker = chooseTracker(config.meta, readPixelId(), store);
    return {
      config, tracker, limits: createLimits(),
      service: createBookingService({
        store, calendar: createGoogleCalendar(config.google!), notifier, tracker,
        clock, rules: content.rules, siteUrl: config.siteUrl, calendarCopy: content.calendarCopy, volumeOptions: content.volumeOptions,
        verifyBot: (token, ip) => verifyTurnstile(token, ip, secret),
      }),
      runScheduled: () => runScheduledWork({ store, notifier, retryTracking: (r) => tracker.resend(r), clock }),
    };
  } catch (e) {
    await pool?.end().catch(() => {});
    throw new Error(`the database could not be used (${reasonOf(e)})`, { cause: e });
  }
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

/**
 * Wires the server for `config`'s mode and says at startup what needs attention. Starting the services can fail (a broken content file,
 * no database): the server does not crash and no request breaks. It runs as not connected, with `failedAt` set, and the failure is logged.
 */
export async function createContext(config: ServerConfig, options: ContextOptions = {}): Promise<ServerContext> {
  if (!options.retry) warnAboutPublicSite(config);
  if (config.mode === 'not_connected') {
    if (config.production) {
      console.error(`booking: NOT CONNECTED in production. Missing settings: ${config.missing.join(', ')}. The site shows the offline booking card (Instagram and the backup link) until they are set.`);
    }
    return notConnected(config, config.missing);
  }
  try {
    return config.mode === 'fakes' ? fakesContext(config, options.outboxDir ?? path.join('.outbox', 'test')) : await liveContext(config, options);
  } catch (e) {
    const reason = reasonOf(e);
    if (options.retry) console.warn(`booking: still not connected (${reason})`);
    else console.error(`booking: NOT CONNECTED. Starting booking failed (${reason}). The site shows the offline booking card; it is tried again every ${RETRY_AFTER_MS / 1000} seconds.`);
    return { ...notConnected(config, ['booking could not start (see the log)']), failedAt: Date.now() };
  }
}

/**
 * Keeps one context. A context that is not connected because starting failed is tried again once `retryAfterMs` have passed:
 * in the background, by one attempt at a time, while requests keep getting the not-connected context (503), so no request waits
 * for a database that is still down. A context that could not be made at all (a bug) is not kept: the next call tries again.
 */
export function createContextProvider(create: (retry: boolean) => Promise<ServerContext>, now: () => number = Date.now, retryAfterMs = RETRY_AFTER_MS) {
  let current: ServerContext | undefined;
  let first: Promise<ServerContext> | undefined;
  let retrying = false;

  const retry = () => {
    retrying = true;
    create(true).then((next) => {
      if (next.failedAt === undefined) console.info('booking: connected');
      current = next; // a new failure restarts the wait
    }, (e) => {
      console.error(`booking: trying again failed (${reasonOf(e)})`);
      if (current) current.failedAt = now();
    }).finally(() => { retrying = false; });
  };

  return {
    get(): Promise<ServerContext> {
      if (current) {
        if (current.failedAt !== undefined && !retrying && now() - current.failedAt >= retryAfterMs) retry();
        return Promise.resolve(current);
      }
      first ??= create(false).then(
        (made) => { current = made; return made; },
        (e: unknown) => { first = undefined; throw e; },
      );
      return first;
    },
  };
}

const provider = createContextProvider((retry) => {
  if (!retry) loadDotEnv(); // the .env file is read once; a new try runs on the same settings
  return createContext(readServerConfig(process.env), { retry });
});

/** The server's one context: the settings (the `.env` file is read first, once) and the services wired for their mode. */
export const getContext = (): Promise<ServerContext> => provider.get();
