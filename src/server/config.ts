/** The settings the booking server reads from its environment. Pure: give it `process.env` or a test object. */
type Env = Record<string, string | undefined>;

export type ServerConfig = {
  /** live = real services; fakes = in-memory test services (never in production); not_connected = something is not set up. */
  mode: 'live' | 'fakes' | 'not_connected';
  /** NODE_ENV says production (trimmed, any case), or this is the built site and NODE_ENV is not set (see ReadOptions). */
  production: boolean;
  /** The settings that stop live mode, by name. Empty when live or fakes. */
  missing: string[];
  siteUrl: string;
  databaseUrl?: string;
  google?: { clientId: string; clientSecret: string; refreshToken: string; calendarId: string };
  smtp?: { host: string; port: number; user: string; pass: string; from: string };
  turnstileSecret?: string;
  meta?: { capiToken: string; testEventCode?: string };
  stream?: { keyId: string; jwkBase64: string };
  cronSecret?: string;
};

/** Without these, booking is not connected. */
export const LIVE_REQUIRED = ['DATABASE_URL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN', 'TURNSTILE_SECRET', 'CRON_SECRET', 'PUBLIC_SITE_URL'] as const;
/** In production, and on any public address, these are required too: the live site waits for a mailbox that can send. */
const SMTP_REQUIRED = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM'] as const;

const DEV_SITE_URL = 'http://localhost:4321';
/** The addresses that mean this computer. */
export const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Whether `siteUrl` is this computer (the only place the outbox mailer, which sends nothing to anyone, may stand in for a mailbox). An address that is not a URL is not local. */
export function isLocalSite(siteUrl: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(siteUrl).hostname);
  } catch {
    return false;
  }
}

export interface ReadOptions {
  /**
   * The server is the built site (the Astro build), not `astro dev` or a script. Such a server counts as production unless NODE_ENV
   * names another environment: a host that forgets NODE_ENV must not run the demo or an outbox for real visitors. The server runtime
   * passes `import.meta.env.PROD`; a script, which has no `import.meta.env`, leaves it out.
   */
  builtDefault?: boolean;
}

export function readServerConfig(env: Env, options: ReadOptions = {}): ServerConfig {
  // An empty or blank value (as in a copied .env.example) counts as not set.
  const get = (key: string): string | undefined => env[key]?.trim() || undefined;

  // `production ` or `PRODUCTION` in a host's settings is still production.
  const nodeEnv = (get('NODE_ENV') ?? '').toLowerCase();
  const production = nodeEnv === 'production' || (options.builtDefault === true && nodeEnv === '');
  const fakes = get('HIVEGEN_FAKES') === '1' && !production;
  const siteUrl = get('PUBLIC_SITE_URL') ?? DEV_SITE_URL;
  const needsMailbox = production || !isLocalSite(siteUrl); // the outbox never stands in for a mailbox on a public site, whatever NODE_ENV says

  const port = Number(get('SMTP_PORT'));
  const validPort = Number.isInteger(port) && port > 0 && port <= 65535;
  const host = get('SMTP_HOST'), user = get('SMTP_USER'), pass = get('SMTP_PASS'), from = get('MAIL_FROM');
  const smtp = host && validPort && user && pass && from ? { host, port, user, pass, from } : undefined;

  const missing: string[] = fakes ? [] : [
    ...LIVE_REQUIRED.filter((k) => !get(k)),
    ...(needsMailbox ? SMTP_REQUIRED.filter((k) => (k === 'SMTP_PORT' ? !validPort : !get(k))) : []),
  ];

  const clientId = get('GOOGLE_CLIENT_ID'), clientSecret = get('GOOGLE_CLIENT_SECRET'), refreshToken = get('GOOGLE_REFRESH_TOKEN');
  const capiToken = get('META_CAPI_TOKEN');
  const keyId = get('STREAM_SIGNING_KEY_ID'), jwkBase64 = get('STREAM_SIGNING_KEY_JWK');

  return {
    mode: fakes ? 'fakes' : missing.length ? 'not_connected' : 'live',
    production,
    missing,
    siteUrl,
    databaseUrl: get('DATABASE_URL'),
    google: clientId && clientSecret && refreshToken ? { clientId, clientSecret, refreshToken, calendarId: get('GOOGLE_CALENDAR_ID') ?? 'primary' } : undefined,
    smtp,
    turnstileSecret: get('TURNSTILE_SECRET'),
    meta: capiToken ? { capiToken, testEventCode: get('META_TEST_EVENT_CODE') } : undefined,
    stream: keyId && jwkBase64 ? { keyId, jwkBase64 } : undefined,
    cronSecret: get('CRON_SECRET'),
  };
}

/**
 * What the browser is told: live (the real booking form, also with the test services),
 * demo (development on this computer without settings: the demo with its note) or off (production, or any public address, without settings).
 * A public site never runs the demo: its visitors would end on 'You're booked.' with nothing stored or sent.
 */
export function clientMode(c: ServerConfig): 'live' | 'demo' | 'off' {
  if (c.mode !== 'not_connected') return 'live';
  return c.production || !isLocalSite(c.siteUrl) ? 'off' : 'demo';
}
