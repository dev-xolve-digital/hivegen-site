import { z } from 'zod';
import type { FieldCode } from './types';

/**
 * What the booking endpoints accept. Each schema writes its error messages as field codes
 * ('required', 'invalid', 'too_long'), so `parseInput` can name every bad field at once.
 */

const missing = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
/** The code for a value of the wrong type: nothing there is "required", anything else is "invalid". */
const wrongType = (issue: { input?: unknown }) => (missing(issue.input) ? 'required' : 'invalid');
/** An optional field: a blank value counts as not given. */
const optional = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), schema.optional());

const required = (max: number) => z.string({ error: wrongType }).trim().min(1, 'required').max(max, 'too_long');
const notBlank = (v: string) => v.trim() !== '';
/** NUL, the other C0 controls (tab, CR and LF among them) and DEL: nothing that can break a title or an email header. */
const hasControlCharacter = (v: string) => /[\u0000-\u001f\u007f]/.test(v);
const isHttpUrl = (v: string) => {
  try { const u = new URL(v); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; }
};
const attributionValue = z.string({ error: () => 'invalid' }).max(200, 'too_long').optional();
const canonicalTimeZone = (v: string) => {
  try { return new Intl.DateTimeFormat('en-US', { timeZone: v }).resolvedOptions().timeZone; } catch { return undefined; }
};

/** A lead's public id: 22 URL-safe characters. */
const PUBLIC_ID = /^[A-Za-z0-9_-]{22}$/;
const BUYER_TYPES = ['agency', 'videographer', 'agent', 'other'] as const;
const PAGE_VERSIONS = ['main', 'agencies', 'videographers', 'agents'] as const;

/** The fields the lead form and the inquiry form have in common, so the two cannot drift apart. */
const email = z.string({ error: wrongType }).trim().min(1, 'required').max(254, 'too_long').pipe(z.email('invalid'));
const phone = optional(z.string({ error: () => 'invalid' }).trim().min(6, 'invalid').max(30, 'too_long').regex(/^[0-9 +()-]+$/, 'invalid'));
const footageUrl = optional(z.string({ error: () => 'invalid' }).trim().max(500, 'too_long').refine(isHttpUrl, 'invalid'));
const pageVersion = z.enum(PAGE_VERSIONS, { error: wrongType });
const attribution = z.object({
  utm_source: attributionValue, utm_medium: attributionValue, utm_campaign: attributionValue, utm_term: attributionValue,
  utm_content: attributionValue, fbclid: attributionValue, gclid: attributionValue,
}, { error: () => 'invalid' }).optional().transform((a) => a ?? {});
const cookie = optional(z.string({ error: () => 'invalid' }).trim().max(200, 'too_long'));
/** Cloudflare's tokens are at most 2048 characters. */
const turnstileToken = z.string({ error: wrongType }).max(2048, 'too_long');
/** The honeypot: a field people never see, so only a bot fills it in. */
const website = z.string({ error: () => 'invalid' }).optional();

/** The lead form. `volumeOptions` are the choices in booking.yaml. Unknown fields (and unknown attribution keys) are dropped. */
export function leadInputSchema(volumeOptions: readonly string[]) {
  return z.object({
    /** The name goes into the invite title and email subjects, so it carries no control characters. */
    name: required(100).refine((v) => !hasControlCharacter(v), 'invalid'),
    email,
    phone,
    buyerType: z.enum(BUYER_TYPES, { error: wrongType }),
    volume: z.string({ error: wrongType }).min(1, 'required').refine((v) => volumeOptions.includes(v), 'invalid'),
    footageUrl,
    pageVersion,
    attribution,
    fbp: cookie,
    fbc: cookie,
    turnstileToken,
    website,
  });
}
export type LeadInput = z.output<ReturnType<typeof leadInputSchema>>;

/** Everything but a line break (LF, CR) and a tab: the controls a message cannot carry. */
const hasForbiddenControl = (v: string) => /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v);

/**
 * The "Send details" form: only the email is required. The rest is as in the lead form, or optional and kept as given.
 * `needOptions` are the choices of the "what do you need" question.
 */
export function inquiryInputSchema(volumeOptions: readonly string[], needOptions: readonly string[]) {
  return z.object({
    email,
    /** Goes into email subjects, so no control characters. */
    name: optional(z.string({ error: () => 'invalid' }).trim().max(100, 'too_long').refine((v) => !hasControlCharacter(v), 'invalid')),
    phone,
    buyerType: optional(z.enum(BUYER_TYPES, { error: () => 'invalid' })),
    volume: optional(z.string({ error: () => 'invalid' }).refine((v) => volumeOptions.includes(v), 'invalid')),
    footageUrl,
    needs: optional(z.array(z.string({ error: () => 'invalid' }).refine((v) => needOptions.includes(v), 'invalid'), { error: () => 'invalid' })
      .max(needOptions.length, 'invalid')
      .refine((list) => new Set(list).size === list.length, 'invalid')),
    /** Free text: it keeps its line breaks. */
    message: optional(z.string({ error: () => 'invalid' }).trim().max(2000, 'too_long').refine((v) => !hasForbiddenControl(v), 'invalid')),
    pageVersion,
    attribution,
    fbp: cookie,
    fbc: cookie,
    turnstileToken,
    website,
    /** The browser's id for this send: a repeat of it is the same send, not a new inquiry. */
    requestId: z.string({ error: wrongType }).refine(notBlank, 'required').regex(/^[A-Za-z0-9-]{8,64}$/, 'invalid'),
    /** The lead from an earlier step, when there is one. */
    leadId: optional(z.string({ error: () => 'invalid' }).regex(PUBLIC_ID, 'invalid')),
  });
}
export type InquiryInput = z.output<ReturnType<typeof inquiryInputSchema>>;

/**
 * A chosen start time, converted to UTC. It has to carry `Z` or an offset: a bare `2026-12-02T14:00:00` would be read
 * as the server's own time zone.
 */
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const startField = z.string({ error: wrongType })
  .refine(notBlank, 'required')
  .refine((v) => ISO_WITH_ZONE.test(v) && !Number.isNaN(Date.parse(v)), 'invalid')
  .transform((v) => new Date(v).toISOString());

/** Confirming a time: which lead, which slot and the visitor's time zone (anything unknown becomes UTC). */
export const bookingInputSchema = z.object({
  leadId: z.string({ error: wrongType }).refine(notBlank, 'required').regex(PUBLIC_ID, 'invalid'),
  start: startField,
  visitorTz: z.unknown().optional().transform((v) => (typeof v === 'string' && v.length <= 64 ? canonicalTimeZone(v) : undefined) ?? 'UTC'),
});
export type BookingInput = z.output<typeof bookingInputSchema>;

/** Moving a booking to another time. */
export const rescheduleInputSchema = z.object({ start: startField });

const RANK: Record<FieldCode, number> = { required: 3, too_long: 2, invalid: 1 };
const asCode = (message: string): FieldCode => (message === 'required' || message === 'too_long' ? message : 'invalid');

/** Checks `raw` against `schema`. When it fails, names every bad field, with the most telling code for each. */
export function parseInput<S extends z.ZodType>(schema: S, raw: unknown):
  { ok: true; value: z.output<S> } | { ok: false; fields: Record<string, FieldCode> } {
  const result = schema.safeParse(raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {});
  if (result.success) return { ok: true, value: result.data };
  const fields: Record<string, FieldCode> = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0];
    if (typeof field !== 'string') continue;
    const code = asCode(issue.message);
    if (!fields[field] || RANK[code] > RANK[fields[field]]) fields[field] = code;
  }
  return { ok: false, fields };
}

const EVENT_ID = /^[A-Za-z0-9-]{8,64}$/; // a UUID; never a "lead." or "schedule." id (they have a dot)
const FACEBOOK_COOKIE = /^fb\.\d\.\d+\.[A-Za-z0-9_-]+$/;

/**
 * What the browser reports of a page view (POST /api/events), or null when it is not one. Only the name and the event id are checked
 * hard: a PageView is not worth refusing for its other fields, so an fbp or fbc that does not look like Facebook's is simply left out.
 */
export function parsePageView(raw: unknown): { eventId: string; url?: string; fbp?: string; fbc?: string } | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const { name, eventId, url, fbp, fbc } = raw as Record<string, unknown>;
  if (name !== 'PageView' || typeof eventId !== 'string' || !EVENT_ID.test(eventId)) return null;
  const cookie = (v: unknown) => (typeof v === 'string' && v.length <= 200 && FACEBOOK_COOKIE.test(v) ? v : undefined);
  return { eventId, url: typeof url === 'string' ? url : undefined, fbp: cookie(fbp), fbc: cookie(fbc) };
}
