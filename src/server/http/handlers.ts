import { loadTurnstileSiteKey } from '../../lib/content/load';
import { bookingConfigResponse } from '../booking-config';
import type { RateLimiter } from '../booking/rate-limit';
import type { ErrorCode, FieldCode, Interval, Result } from '../booking/types';
import { getContext, type ServerContext } from '../context';
import { clientIp } from './client-ip';

/** One handler per route. `params` are the route's `[brackets]`; `socketIp` is the address the connection came from. */
export type Handler = (request: Request, ctx: ServerContext, params?: Record<string, string | undefined>, socketIp?: string) => Promise<Response>;

const STATUS: Record<ErrorCode, number> = {
  invalid: 400, bot_check_failed: 403, not_found: 404, slot_taken: 409, too_late: 409, rate_limited: 429, not_connected: 503, server_error: 500,
};

/** Every API answer is private and never cached: slots and bookings change by the minute. */
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const fail = (error: ErrorCode, fields?: Record<string, FieldCode>) => json({ error, ...(fields && { fields }) }, STATUS[error]);
const answer = <T>(result: Result<T>) => (result.ok ? json(result.value) : fail(result.error, result.fields));

/** The kind of an unexpected error, and its code (a database's, for one), never its message: that could hold what the visitor typed. */
export const kindOf = (e: unknown) => {
  const code = (e as { code?: unknown } | null)?.code;
  return `${e instanceof Error ? e.name : 'unknown error'}${typeof code === 'string' ? ` ${code}` : ''}`;
};

/** Runs a handler's work; anything unexpected becomes a 500, logged by route and kind of error. */
async function guarded(route: string, work: () => Promise<Response>): Promise<Response> {
  try {
    return await work();
  } catch (e) {
    console.error(`api: ${route} failed (${kindOf(e)})`);
    return fail('server_error');
  }
}

/** What a route file hands its handler: the parts of Astro's API context that handlers use. */
export interface RouteEvent { request: Request; params: Record<string, string | undefined>; clientAddress: string }

/**
 * Turns a handler into an Astro route: gets the server's context first. Starting the context is built not to fail, but if it ever does,
 * the answer is still the API's own JSON 500 (no-store), never Astro's bare error page.
 */
export function withContext(handler: Handler, load: () => Promise<ServerContext> = getContext) {
  return async ({ request, params, clientAddress }: RouteEvent): Promise<Response> => {
    let ctx: ServerContext;
    try {
      ctx = await load();
    } catch (e) {
      console.error(`api: the server could not start (${kindOf(e)})`);
      return fail('server_error');
    }
    return handler(request, ctx, params, clientAddress);
  };
}

/** The largest request body read: the biggest real one (a lead form) is a few KB. Anything bigger is refused before it fills memory. */
export const MAX_BODY_BYTES = 32 * 1024;

/**
 * The request body as JSON. `ok: false` for anything that is not valid JSON, and for a body over MAX_BODY_BYTES: a declared
 * length over the cap is refused at once, and a body with no declared length (chunked) is read only up to the cap.
 */
async function readJson(request: Request): Promise<{ ok: true; value: unknown } | { ok: false }> {
  const declared = Number(request.headers.get('content-length'));
  const reader = request.body?.getReader();
  if (!reader) return { ok: false };
  try {
    if (declared > MAX_BODY_BYTES) return { ok: false };
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) return { ok: false };
      chunks.push(value);
    }
    return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
  } catch {
    return { ok: false };
  } finally {
    await reader.cancel().catch(() => {}); // stop reading whatever is left
  }
}

/** The page a visitor came from, for tracking: the Referer when it is a web page of this site, else the site's own address. Never empty. */
function sourceUrlOf(request: Request, siteUrl: string): string {
  const referer = request.headers.get('referer');
  if (!referer) return siteUrl;
  try {
    const from = new URL(referer);
    return (from.protocol === 'http:' || from.protocol === 'https:') && from.origin === new URL(siteUrl).origin ? referer : siteUrl;
  } catch {
    return siteUrl;
  }
}

/** What the service is told about a request. */
const metaOf = (request: Request, ctx: ServerContext, ip: string | undefined) => ({
  ip,
  userAgent: request.headers.get('user-agent')?.slice(0, 500) || undefined,
  sourceUrl: sourceUrlOf(request, ctx.config.siteUrl),
});

/** Counts the request against `limiter` by client address. Requests with no known address share one allowance. */
const allowed = (limiter: RateLimiter, ip: string | undefined) => limiter.take(ip ?? 'unknown');

/** A site.yaml that cannot be read must not take the endpoint down: the form just gets no site key. */
function readSiteKey(): string | undefined {
  try {
    return loadTurnstileSiteKey();
  } catch (e) {
    console.error(`booking config: could not read the Turnstile site key from site.yaml (${e instanceof Error ? e.message : e})`);
    return undefined;
  }
}

/** GET /api/booking/config: which mode the booking form runs in, and which Turnstile site key to show. */
export const configHandler: Handler = async (_request, ctx) => json(bookingConfigResponse(ctx.config, readSiteKey));

/** GET /api/booking/slots */
export const slotsHandler: Handler = (request, ctx, _params, socketIp) => guarded('slots', async () => {
  if (!ctx.service) return fail('not_connected');
  if (!allowed(ctx.limits.reads, clientIp(request, socketIp))) return fail('rate_limited');
  return json(await ctx.service.getSlots());
});

/** POST /api/booking/leads */
export const leadsHandler: Handler = (request, ctx, _params, socketIp) => guarded('leads', async () => {
  if (!ctx.service) return fail('not_connected');
  const ip = clientIp(request, socketIp);
  if (!allowed(ctx.limits.leads, ip)) return fail('rate_limited');
  const body = await readJson(request);
  if (!body.ok) return fail('invalid');
  return answer(await ctx.service.createLead(body.value, metaOf(request, ctx, ip)));
});

/** POST /api/booking/bookings */
export const bookingsHandler: Handler = (request, ctx, _params, socketIp) => guarded('bookings', async () => {
  if (!ctx.service) return fail('not_connected');
  const ip = clientIp(request, socketIp);
  if (!allowed(ctx.limits.writes, ip)) return fail('rate_limited');
  const body = await readJson(request);
  if (!body.ok) return fail('invalid');
  return answer(await ctx.service.book(body.value, metaOf(request, ctx, ip)));
});

/** POST /api/booking/manage/[token]/cancel */
export const cancelHandler: Handler = (request, ctx, params, socketIp) => guarded('cancel', async () => {
  if (!ctx.service) return fail('not_connected');
  if (!allowed(ctx.limits.writes, clientIp(request, socketIp))) return fail('rate_limited');
  const token = params?.token;
  return token ? answer(await ctx.service.cancel(token)) : fail('not_found');
});

/** POST /api/booking/manage/[token]/reschedule */
export const rescheduleHandler: Handler = (request, ctx, params, socketIp) => guarded('reschedule', async () => {
  if (!ctx.service) return fail('not_connected');
  if (!allowed(ctx.limits.writes, clientIp(request, socketIp))) return fail('rate_limited');
  const token = params?.token;
  if (!token) return fail('not_found');
  const body = await readJson(request);
  if (!body.ok) return fail('invalid');
  return answer(await ctx.service.reschedule(token, body.value));
});

// The test-only routes: the browser tests set up and look at the test services through them. Anywhere but fakes mode they do not exist.

const isInterval = (v: unknown): v is Interval => typeof (v as Interval | null)?.start === 'string' && typeof (v as Interval).end === 'string';

/** POST /api/test/calendar with { down?: boolean, busy?: Interval[] } */
export const testCalendarHandler: Handler = (request, ctx) => guarded('test calendar', async () => {
  if (!ctx.fakes) return fail('not_found');
  const body = await readJson(request);
  if (!body.ok || body.value === null || typeof body.value !== 'object' || Array.isArray(body.value)) return fail('invalid');
  const { down, busy } = body.value as { down?: unknown; busy?: unknown };
  if (down !== undefined && typeof down !== 'boolean') return fail('invalid');
  if (busy !== undefined && !(Array.isArray(busy) && busy.every(isInterval))) return fail('invalid');
  if (down !== undefined) ctx.fakes.calendar.setDown(down);
  if (busy !== undefined) ctx.fakes.calendar.setBusy(busy);
  return json({ ok: true });
});

/** GET /api/test/outbox: what was "sent", as [{ kind, to, subject, text }]. */
export const testOutboxHandler: Handler = async (_request, ctx) => {
  if (!ctx.fakes) return fail('not_found');
  return json(ctx.fakes.mailer.sent.map(({ tag, to, subject, text }) => ({ kind: tag, to, subject, text })));
};

/** GET /api/test/events: the tracking events the server would have sent. */
export const testEventsHandler: Handler = async (_request, ctx) => {
  if (!ctx.fakes) return fail('not_found');
  return json(ctx.fakes.tracked);
};

/** POST /api/test/reset: back to an empty server. */
export const testResetHandler: Handler = (_request, ctx) => guarded('test reset', async () => {
  if (!ctx.fakes) return fail('not_found');
  ctx.fakes.reset();
  return json({ ok: true });
});
