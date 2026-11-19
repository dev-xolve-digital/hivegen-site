# HiveGen Site · Phase 2 Implementation Plan (real booking, tracking, protected video)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When Phase 2 is done:
- Visitors book real 15-minute calls into Hassan's Google Calendar, with a Meet link, emails, reminders, and reschedule or cancel.
- Leads are stored in MySQL.
- Meta and Google receive de-duplicated conversion events.
- Stream videos can play through expiring signed links.

All of it runs on this computer with fake services, and connects to the real accounts once they exist.

**Architecture:**
- **Server.** The site keeps its prerendered pages and adds on-demand server routes through `@astrojs/node` (standalone), for Hostinger's Node.js hosting.
- **Booking service.** Every booking rule lives in a service in `src/server/booking/`. The service receives what it uses (store, calendar, notifier, tracker, clock, bot check) as plain interfaces.
- **Adapters behind those interfaces:**
  - MySQL store;
  - Google Calendar over REST;
  - SMTP or outbox mailer;
  - Meta Conversions API tracker;
  - Stream token signer.
- **Server modes.** A server config picks `live`, `fakes` (tests only) or `not_connected`.
- **Browser.** The page asks `/api/booking/config` and then uses one of three things: the real API, the Phase 1 demo (development), or an offline card (production).

**Tech Stack:**
- Already in the project: Astro 7.4, TypeScript strict, Zod 4, js-yaml, Vitest 5, Playwright 1.65.
- New:
  - `@astrojs/node` 11.1.14, `mysql2` 3.24.6, `nodemailer` 10.6.0 with `@types/nodemailer`;
  - development only: `tsx` (to run TypeScript scripts) and `mysql-memory-server` 1.18.0 (a throwaway real MySQL for tests).
- Google Calendar, Turnstile, the Meta Conversions API and Stream signing use plain `fetch` and `node:crypto`, with no SDKs.

**Spec:** `docs/design/2026-11-19-phase-2-design.md` is the authority for Phase 2. For everything Phase 2 doesn't change, sections 10–11 of `docs/design/2026-11-18-hivegen-website-design.md` apply. Code conventions follow the Phase 1 plan (`docs/superpowers/plans/2026-11-18-hivegen-site-phase-1.md`).

## Roadmap

| Task | Delivers |
|---|---|
| 1 | Node adapter, server config and modes, `/api/booking/config`, the test server, `.env.example` |
| 2 | Shared booking types, memory store, fake calendar; service: slots and leads |
| 3 | Service: book, cancel, reschedule (all booking rules) |
| 4 | MySQL store, migrations, store contract tests on real MySQL |
| 5 | Google Calendar adapter (REST), `npm run google:connect` |
| 6 | Emails: content files, renderer, SMTP/outbox mailer, notifier |
| 7 | HTTP layer: route handlers, rate limits, wiring by mode, fakes-only test routes |
| 8 | Booking UI on the real API (modes, Turnstile, honeypot, requested/offline states, attribution) |
| 9 | Manage-booking page `/booking/[token]` (cancel, reschedule) |
| 10 | Scheduled work: reminders, new-lead email, email and tracking retries; `/api/cron/run` |
| 11 | Tracking: Meta Pixel + Conversions API, Google tag, `/api/events` |
| 12 | Signed Stream links: token signer, `/api/video/[id]`, lightbox fetch, static client-card images |
| 13 | `HOW-TO-SETUP.md`, `npm run check:services`, `HOW-TO-EDIT.md` updates |
| 14 | Connect the real accounts the user provides; live end-to-end check (needs the user) |

## Global Constraints

- **Pages and server routes.** Pages stay prerendered. Only `src/pages/api/**` and `src/pages/booking/[token].astro` run on demand (`export const prerender = false`), through `@astrojs/node` in `mode: 'standalone'`.
- **Copy.** Every visible word comes from `content/`: booking states, emails, the calendar invite, and the manage page. Components and server code hold no copy.
- **Secrets.**
  - They live only in environment variables: a git-ignored `.env` locally, hPanel settings on Hostinger.
  - `.env.example` lists every variable.
  - No secret appears in the repository or in page source.
- **Personal data.** It never appears in a URL, in page source, in logs beyond the request line, or in the description of the visitor's calendar invite. Hassan's address (`contact.notificationEmail`) is never rendered on a page.
- **Phone budget.**
  - Initial first-party JavaScript stays under 50 KB gzipped.
  - No third-party script (Meta Pixel, gtag, Turnstile) is requested before the window `load` event.
  - Turnstile loads only when the booking section comes within 600px of the screen.
- **Not connected.**
  - Production (`NODE_ENV=production`) with booking not connected: the booking card shows Instagram and the backup link, never the demo, and never "You're booked".
  - Fakes run only when `HIVEGEN_FAKES=1` **and** `NODE_ENV !== 'production'`.
- **Booking rules** (unchanged from Phase 1):
  - Time zone `Asia/Karachi`.
  - Windows start Monday–Friday, 19:00–02:00.
  - 15-minute calls with a 5-minute buffer.
  - 60-minute minimum notice and a 14-day horizon.
- **Booking timing:**
  - Reminders go out 24 hours and 1 hour before the call.
  - The new-lead email goes after 30 minutes.
  - Cron runs every 5 minutes.
  - Cancel works until the call starts; reschedule works until 60 minutes before.
- **Rate limits,** per client IP (`CF-Connecting-IP` header, otherwise the socket address):
  - 10 lead posts per hour;
  - 10 booking or manage posts per hour;
  - 120 slot, video or event requests per hour.
- **Google Calendar:**
  - Scopes `https://www.googleapis.com/auth/calendar.events` and `https://www.googleapis.com/auth/calendar.freebusy`.
  - `GOOGLE_CALENDAR_ID` defaults to `primary`.
  - Events use `conferenceDataVersion=1` (Meet) and `sendUpdates=all`.
  - The event title and description come from `booking.yaml` `calendarEvent`; the title is `HiveGen call · {name}`.
- **Signed video links:** RS256 JWT `{ sub: <uid>, kid, exp: now+3600, nbf: now-60 }`. The URL is `https://customer-<code>.cloudflarestream.com/<token>/iframe?autoplay=true&primaryColor=%231C45F5`.
- **Cloudflare changes** need the user's explicit approval, one request each: the Turnstile widget, the Stream signing key, `requireSignedURLs`, and uploads to Cloudflare Images. No code task needs one.
- **Browser tests and server state.** Browser tests that change server state (booking, managing, toggling fakes) live only in `tests/e2e/booking-flow.spec.ts`, which runs serially and on desktop only. Every other browser test must leave server state alone, because test files run in parallel against one test server.
- **Housekeeping.** Text files use LF line endings. Edit with the Edit tool; when scripting edits in Python, read and write with `newline=''`. Run Vitest from `C:\` (uppercase drive letter). Commit once per task.

## Review Focus

1. **Two visitors confirm the same slot at the same moment.** Exactly one gets it; the other gets `slot_taken` and fresh slots. Pinned in Task 4 (concurrent inserts on real MySQL) and Task 3.
2. **Google fails after the lead is saved** (timeout or 5xx during booking). The visitor sees the "requested" panel, never "You're booked". Hassan gets "please confirm by hand", and the slot stays reserved. Pinned in Task 3 and Task 8 (end-to-end).
3. **Hostinger stops the idle Node process between step 1 and step 2.** Booking still works, because everything lives in the store. Pinned in Task 3: a fresh service instance on the same store.
4. **Double-clicking Confirm, or a network retry.** It produces one booking and one calendar event. Pinned in Task 3.
5. **A name like `<b>Bob</b>` or `Zoë O’Brien`.** It shows as typed in emails, never as HTML, and the calendar invite carries it as plain text. Pinned in Task 6.

## File structure

```
astro.config.mjs                     + node adapter (standalone)
.env.example                         every variable, commented            (.gitignore: !.env.example, .outbox/)
db/migrations/001_init.sql           leads, bookings, tracking_events, schema_migrations
scripts/  google-connect.ts  db-migrate.ts  cron.ts  check-services.ts    (run with tsx)
content/
  site.yaml                          + booking.backupUrl, tracking:, settings.turnstileSiteKey, settings.streamSignedUrls
  sections/booking.yaml              + calendarEvent, errors.{buyer,volume,network,botCheck,rateLimited}, requested, calendarNote, offline, honeypotLabel, confirmation.manageLabel
  sections/manage-booking.yaml       manage page words
  sections/hero.yaml                 + videoErrorText (video pop-up)
  emails/<kind>.yaml                 one file per email kind (10)
src/server/
  env.ts                             loadDotEnv()
  config.ts                          readServerConfig(), clientMode()
  booking/types.ts                   shared records, ports, errors (below)
  booking/validate.ts                input schemas + field error codes
  booking/service.ts                 createBookingService()
  booking/rate-limit.ts              createRateLimiter()
  booking/turnstile.ts               verifyTurnstile()
  store/memory.ts  store/mysql.ts  store/migrate.ts
  calendar/fake.ts  calendar/google.ts
  mail/render.ts  mail/mailer.ts  mail/notifier.ts
  tracking/hash.ts  tracking/meta.ts
  stream/sign.ts
  cron.ts                            runScheduledWork()
  http/handlers.ts                   one handler per route: (request, ctx) => Response
  context.ts                         getContext(): wiring by mode (singleton)
src/pages/api/booking/{config,slots,leads,bookings}.ts
src/pages/api/booking/manage/[token]/{cancel,reschedule}.ts
src/pages/api/{events,cron/run,video/[id]}.ts
src/pages/api/test/{calendar,outbox,events,reset}.ts      (404 unless fakes)
src/pages/booking/[token].astro
src/lib/booking/api-client.ts        + httpApi(); BookingApi updated
src/scripts/  attribution.ts  turnstile.ts  slot-picker.ts  manage-booking.ts  tracking.ts  (+ booking-ui.ts, lightbox.ts changes)
tests/contract/store.contract.ts     shared Store contract (memory + MySQL)
tests/unit/*.test.ts  tests/integration/*.test.ts  tests/e2e/*.spec.ts  tests/e2e/helpers.ts
HOW-TO-SETUP.md
```

## Shared types: `src/server/booking/types.ts` (Task 2 creates; every later task consumes)

```ts
import type { Interval, Slot } from '../../lib/booking/slots';
export type BuyerType = 'agency' | 'videographer' | 'agent' | 'other';
export type PageVersion = 'main' | 'agencies' | 'videographers' | 'agents';
export type LeadStatus = 'started' | 'booked' | 'requested' | 'cancelled';
export type BookingStatus = 'booked' | 'requested' | 'cancelled';
export interface Attribution { utm_source?: string; utm_medium?: string; utm_campaign?: string; utm_term?: string; utm_content?: string; fbclid?: string; gclid?: string }
export interface NewLead {
  publicId: string; name: string; email: string; phone?: string; buyerType: BuyerType; volume: string;
  footageUrl?: string; pageVersion: PageVersion; attribution: Attribution; fbp?: string; fbc?: string; clientIp?: string; userAgent?: string;
}
export interface Lead extends NewLead { id: number; createdAt: Date; status: LeadStatus; newLeadNotifiedAt?: Date }
export interface NewBooking { leadId: number; start: string; end: string; visitorTz: string; status: BookingStatus; manageToken: string }
export interface Booking extends NewBooking {
  id: number; googleEventId?: string; meetUrl?: string; reminder24hSentAt?: Date; reminder1hSentAt?: Date;
  visitorNotifiedAt?: Date; hassanNotifiedAt?: Date; createdAt: Date; updatedAt: Date;
}
export type BookingPatch = Partial<Pick<Booking, 'start' | 'end' | 'status' | 'visitorTz' | 'googleEventId' | 'meetUrl'
  | 'reminder24hSentAt' | 'reminder1hSentAt' | 'visitorNotifiedAt' | 'hassanNotifiedAt'>>;
export interface TrackingRecord { eventId: string; name: string; leadId?: number; payload: unknown; status: 'pending' | 'sent' | 'failed' | 'skipped'; attempts: number; error?: string }
export class SlotConflictError extends Error { constructor() { super('slot_conflict'); this.name = 'SlotConflictError'; } }
export class CalendarUnavailableError extends Error { constructor(msg = 'calendar_unavailable') { super(msg); this.name = 'CalendarUnavailableError'; } }

/** Active = booked or requested. The store keeps a unique slot key (= start) only for active bookings. */
export interface Store {
  createLead(l: NewLead, now: Date): Promise<Lead>;
  getLead(id: number): Promise<Lead | null>;
  getLeadByPublicId(publicId: string): Promise<Lead | null>;
  updateLead(id: number, patch: { status?: LeadStatus; newLeadNotifiedAt?: Date }, now: Date): Promise<void>;
  insertBooking(b: NewBooking, now: Date): Promise<Booking>;                 // SlotConflictError if an active booking has this start
  updateBooking(id: number, patch: BookingPatch, now: Date): Promise<Booking>; // SlotConflictError when moved/reactivated onto a taken start
  getActiveBookingForLead(leadId: number): Promise<Booking | null>;
  getBookingByToken(token: string): Promise<Booking | null>;
  bookingsStartingBetween(fromIso: string, toIso: string): Promise<Booking[]>; // every status, ordered by start
  bookingsCreatedSince(iso: string): Promise<Booking[]>;
  leadsCreatedBetween(fromIso: string, toIso: string): Promise<Lead[]>;
  recordTrackingEvent(r: TrackingRecord, now: Date): Promise<void>;          // ignores a duplicate eventId
  updateTrackingEvent(eventId: string, patch: Partial<Pick<TrackingRecord, 'status' | 'attempts' | 'error'>>, now: Date): Promise<void>;
  trackingEventsByStatus(status: TrackingRecord['status']): Promise<TrackingRecord[]>;
}
export interface CalendarEventInput { start: string; end: string; summary: string; description: string; attendee: { email: string; name: string }; privateProps: Record<string, string> }
export interface Calendar {
  busy(fromIso: string, toIso: string): Promise<Interval[]>;               // CalendarUnavailableError on any failure
  createEvent(e: CalendarEventInput): Promise<{ eventId: string; meetUrl?: string }>;
  moveEvent(eventId: string, start: string, end: string): Promise<void>;
  cancelEvent(eventId: string): Promise<void>;
}
export type EmailKind = 'booking-confirmed' | 'booking-requested' | 'reminder-24h' | 'reminder-1h' | 'booking-cancelled'
  | 'booking-rescheduled' | 'hassan-new-booking' | 'hassan-confirm-by-hand' | 'hassan-new-lead' | 'hassan-booking-changed';
export interface EmailData { lead: Lead; booking?: Booking; previousStart?: string; change?: 'cancelled' | 'rescheduled' }
export interface Notifier { send(kind: EmailKind, data: EmailData): Promise<void> }  // throws on transport failure
export interface ServerEvent {
  name: 'PageView' | 'Lead' | 'Schedule'; eventId: string; time: Date; sourceUrl: string; leadId?: number;
  user: { email?: string; phone?: string; externalId?: string; ip?: string; userAgent?: string; fbp?: string; fbc?: string };
}
export interface Tracker { send(e: ServerEvent): Promise<void> }                     // never throws
export interface Clock { now(): Date }
export type ErrorCode = 'invalid' | 'rate_limited' | 'bot_check_failed' | 'slot_taken' | 'not_found' | 'too_late' | 'not_connected' | 'server_error';
export type FieldCode = 'required' | 'invalid' | 'too_long';
export type Result<T> = { ok: true; value: T } | { ok: false; error: ErrorCode; fields?: Record<string, FieldCode> };
export type { Interval, Slot };
```

---

### Task 1: Server mode, Node adapter, config endpoint, test server

**Files:**
- Modify: `astro.config.mjs`, `package.json`, `.gitignore`, `playwright.config.ts`, `src/lib/content/schemas.ts` (site settings), `content/site.yaml`
- Create: `src/server/env.ts`, `src/server/config.ts`, `src/pages/api/booking/config.ts`, `.env.example`, `tests/unit/server-config.test.ts`, `tests/e2e/api.spec.ts`

**Interfaces:**
- Produces:
  - `loadDotEnv(file = '.env', env = process.env): void`. It fills in only the keys that are missing, using `util.parseEnv`.
  - `readServerConfig(env: Record<string, string | undefined>): ServerConfig` and `clientMode(c: ServerConfig): 'live' | 'demo' | 'off'`.
  - `LIVE_REQUIRED`: `['DATABASE_URL','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GOOGLE_REFRESH_TOKEN','TURNSTILE_SECRET','CRON_SECRET','PUBLIC_SITE_URL']`.
  - The `ServerConfig` type:
    ```ts
    { mode: 'live'|'fakes'|'not_connected'; production: boolean; missing: string[]; siteUrl: string;
      databaseUrl?: string; google?: { clientId; clientSecret; refreshToken; calendarId };
      smtp?: { host; port: number; user; pass; from }; turnstileSecret?: string;
      meta?: { capiToken: string; testEventCode?: string }; stream?: { keyId: string; jwkBase64: string }; cronSecret?: string }
    ```
  - `siteUrl` defaults to `http://localhost:4321`.
  - `smtp` is set only when all of `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `MAIL_FROM` are set.
  - **In production** (`NODE_ENV=production`), `live` also requires those five SMTP settings. When any is missing, `missing` names them (user, 2026-11-19: the live site waits for a sending mailbox).
  - The same all-or-nothing rule applies to `meta` (`META_CAPI_TOKEN`) and `stream` (`STREAM_SIGNING_KEY_ID` + `STREAM_SIGNING_KEY_JWK`).
- `GET /api/booking/config` returns `{ mode: clientMode, turnstileSiteKey }`. In fakes mode the site key is Cloudflare's always-pass test key `1x00000000000000000000AA`; otherwise it is `site.settings.turnstileSiteKey`.
- Site settings gain `turnstileSiteKey: string` (optional) and `streamSignedUrls: boolean` (default `false`).

- [ ] **Step 1: Write the failing unit tests** in `tests/unit/server-config.test.ts`:

```ts
const full = { DATABASE_URL: 'mysql://u:p@h:3306/db', GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 's', GOOGLE_REFRESH_TOKEN: 'r',
  TURNSTILE_SECRET: 't', CRON_SECRET: 'c', PUBLIC_SITE_URL: 'https://hivegen.co' };
it('every required setting → live; calendar defaults to primary; SMTP, Meta and Stream stay optional', () => {
  expect(readServerConfig(full)).toMatchObject({ mode: 'live', missing: [], google: { calendarId: 'primary' }, smtp: undefined, meta: undefined, stream: undefined });
});
it('missing settings → not_connected, naming each one', () => {
  const { DATABASE_URL, TURNSTILE_SECRET, ...rest } = full;
  expect(readServerConfig(rest)).toMatchObject({ mode: 'not_connected', missing: ['DATABASE_URL', 'TURNSTILE_SECRET'] });
});
it('fakes only outside production', () => {
  expect(readServerConfig({ HIVEGEN_FAKES: '1' }).mode).toBe('fakes');
  expect(readServerConfig({ HIVEGEN_FAKES: '1', NODE_ENV: 'production' }).mode).toBe('not_connected');
});
it('the browser gets live, demo (development) or off (production)', () => {
  expect(clientMode(readServerConfig(full))).toBe('live');
  expect(clientMode(readServerConfig({ HIVEGEN_FAKES: '1' }))).toBe('live');
  expect(clientMode(readServerConfig({}))).toBe('demo');
  expect(clientMode(readServerConfig({ NODE_ENV: 'production' }))).toBe('off');
});
it('in production, live also needs the five SMTP settings', () => {
  expect(readServerConfig({ ...full, NODE_ENV: 'production' })).toMatchObject({ mode: 'not_connected', missing: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM'] });
});
it('SMTP is used only when all five values are set', () => {
  expect(readServerConfig({ ...full, SMTP_HOST: 'h', SMTP_PORT: '465' }).smtp).toBeUndefined();
  expect(readServerConfig({ ...full, SMTP_HOST: 'h', SMTP_PORT: '465', SMTP_USER: 'u', SMTP_PASS: 'p', MAIL_FROM: 'HiveGen <connect@hivegen.co>' }).smtp)
    .toEqual({ host: 'h', port: 465, user: 'u', pass: 'p', from: 'HiveGen <connect@hivegen.co>' });
});
it('loadDotEnv fills only missing keys', () => { /* temp file "A=1\nB=2"; env {A:'0'} → {A:'0', B:'2'} */ });
```

- [ ] **Step 2: Run, expect failure.** Run `npx vitest run tests/unit/server-config.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement `src/server/env.ts` and `src/server/config.ts`.** Install `@astrojs/node@11.1.14`. Set `astro.config.mjs` `adapter: node({ mode: 'standalone' })` (keep the `manualChunks` setting). Add the two site settings to the schema, and to `content/site.yaml` with comments: `turnstileSiteKey: ""` and `streamSignedUrls: false`.

- [ ] **Step 4: Add the config route and `.env.example`.**
  - `src/pages/api/booking/config.ts` has `prerender = false`. It calls `loadDotEnv()` once, then `readServerConfig(process.env)`.
  - `.env.example` lists every variable from the design (§14) with a one-line comment each, plus `HIVEGEN_FAKES` and `NODE_ENV`.
  - `.gitignore` gains `!.env.example` and `.outbox/`.

- [ ] **Step 5: Switch the test server.** In `playwright.config.ts`, set `webServer.command` to:
  `npm run build && cross-env HOST=127.0.0.1 PORT=4322 NODE_ENV=test HIVEGEN_FAKES=1 node dist/server/entry.mjs`
  Write `tests/e2e/api.spec.ts`:

```ts
test('the booking server answers in test mode', async ({ request }) => {
  const r = await request.get('/api/booking/config');
  expect(r.status()).toBe(200);
  expect(await r.json()).toEqual({ mode: 'live', turnstileSiteKey: '1x00000000000000000000AA' });
});
test('pages are still prerendered files', () => {
  for (const f of ['index.html', 'agents/index.html', 'privacy/index.html']) expect(fs.existsSync(`dist/client/${f}`), f).toBe(true);
});
```

- [ ] **Step 6: Run everything.** Run `npm test`, `npm run check` and `npx playwright test`. Expected: all pass; `api.spec.ts` adds 2 passing tests on each device.

- [ ] **Step 7: Commit.** `git commit -m "feat(server): node adapter, server config and booking mode endpoint"`

---

### Task 2: Booking domain: types, memory store, fake calendar, slots and leads

**Files:**
- Create:
  - `src/server/booking/{types,validate,service,turnstile}.ts`, `src/server/store/memory.ts`, `src/server/calendar/fake.ts`;
  - tests `tests/unit/booking-leads.test.ts`, `tests/unit/memory-store.test.ts`, and the contract file `tests/contract/store.contract.ts`.
- Modify: `content/sections/booking.yaml` and its schema (adds `calendarEvent: { title, description }`).

**Interfaces:**
- Produces:
  - Everything in **Shared types** above.
  - `createMemoryStore(): Store`.
  - `createFakeCalendar(): Calendar & { setDown(down: boolean): void; setBusy(b: Interval[]): void; events: Map<string, CalendarEventInput & { cancelled?: boolean }> }`. Its Meet links have the form `https://meet.google.com/fake-<n>`.
  - `verifyTurnstile(token: string, ip: string | undefined, secret: string, fetchFn = fetch): Promise<boolean>`. It POSTs form data to `https://challenges.cloudflare.com/turnstile/v0/siteverify`; any failure means `false`.
  - The service:
    ```ts
    interface ServiceDeps { store: Store; calendar: Calendar; notifier: Notifier; tracker: Tracker; clock: Clock; rules: BookingRules;
      siteUrl: string; calendarCopy: { title: string; description: string }; verifyBot(token: string, ip?: string): Promise<boolean> }
    createBookingService(d: ServiceDeps): BookingService
    interface BookingService {
      getSlots(): Promise<{ slots: Slot[]; calendarChecked: boolean }>;
      createLead(raw: unknown, meta: { ip?: string; userAgent?: string; sourceUrl?: string }): Promise<Result<{ leadId: string; eventId: string }>>;
      book(raw: unknown, meta: { ip?: string; userAgent?: string; sourceUrl?: string }): Promise<Result<BookOutcome>>;           // Task 3
      getManaged(token: string): Promise<{ booking: Booking; lead: Lead; canCancel: boolean; canReschedule: boolean } | null>;    // Task 3
      cancel(token: string): Promise<Result<{ status: 'cancelled' }>>;                                                              // Task 3
      reschedule(token: string, raw: unknown): Promise<Result<{ status: BookingStatus; start: string; end: string }>>;             // Task 3
    }
    type BookOutcome = { status: 'booked' | 'requested'; start: string; end: string; meetUrl?: string; manageUrl: string; eventId: string };
    ```
  - In `validate.ts`: `leadInputSchema` and `bookingInputSchema`.
- Lead input:
  - `name` 1–100;
  - `email` valid, at most 254;
  - `phone` optional, 6–30 characters of `[0-9 +()-]`;
  - `buyerType`: one of the four values;
  - `volume`: one of `booking.yaml` volumeOptions;
  - `footageUrl` optional, http(s), at most 500;
  - `pageVersion`: one of the four page versions;
  - `attribution`: only the seven known keys, each at most 200;
  - `fbp` and `fbc` optional, at most 200 each;
  - `turnstileToken`: a string;
  - `website`: the honeypot, a string.
- Field codes are `required`, `invalid` and `too_long`.
- The lead's `publicId` is 16 random bytes in base64url (22 characters). The Lead event ID is `lead.<publicId>`.

- [ ] **Step 1: Write the store contract** in `tests/contract/store.contract.ts`, as `export function storeContract(make: () => Promise<{ store: Store; done(): Promise<void> }>)`. It holds these `it` blocks:
  - "round-trips a lead with non-ASCII text" (name `Zoë O’Brien`, email `zoe+ads@example.com`, attribution `{ utm_source: 'facebook', fbclid: 'abc' }`);
  - "a taken start throws SlotConflictError; cancelling frees it";
  - "two simultaneous inserts of one start: exactly one wins" (`Promise.allSettled`, one fulfilled, one rejected with `SlotConflictError`);
  - "moving onto a taken start throws and leaves the booking unchanged";
  - "finds a booking by token and the active booking for a lead";
  - "lists bookings starting in a range and leads created in a range";
  - "records tracking events once per eventId and updates them".

  `tests/unit/memory-store.test.ts` runs `storeContract` with the memory store.

- [ ] **Step 2: Write the failing service tests** in `tests/unit/booking-leads.test.ts`. The fixed clock is `2026-12-01T10:00:00Z`, which is Tuesday 15:00 in Pakistan. `setup()` wires the memory store and fake calendar, and records what the notifier and tracker receive.

```ts
const good = { name: 'Zoë O’Brien', email: 'zoe+ads@example.com', phone: '+1 (555) 010-2000', buyerType: 'agent', volume: '6–15',
  footageUrl: 'https://drive.google.com/x', pageVersion: 'agents', attribution: { utm_source: 'facebook', fbclid: 'abc' }, turnstileToken: 'ok', website: '' };
it('saves the lead and returns an unguessable id and the Lead event id', async () => {
  const { svc, store, tracked } = setup();
  const r = await svc.createLead(good, { ip: '203.0.113.9', userAgent: 'UA' });
  if (!r.ok) throw new Error(r.error);
  expect(r.value.leadId).toMatch(/^[A-Za-z0-9_-]{22}$/);
  expect(r.value.eventId).toBe(`lead.${r.value.leadId}`);
  expect(await store.getLeadByPublicId(r.value.leadId)).toMatchObject({ name: 'Zoë O’Brien', status: 'started', clientIp: '203.0.113.9', attribution: { utm_source: 'facebook', fbclid: 'abc' } });
  expect(tracked).toEqual([expect.objectContaining({ name: 'Lead', eventId: r.value.eventId, user: expect.objectContaining({ email: 'zoe+ads@example.com' }) })]);
});
it('names each invalid field', async () => {
  expect(await setup().svc.createLead({ ...good, name: '', email: 'nope', buyerType: '', volume: '7' }, {}))
    .toEqual({ ok: false, error: 'invalid', fields: { name: 'required', email: 'invalid', buyerType: 'required', volume: 'invalid' } });
});
it('a filled honeypot pretends success and stores nothing', async () => { /* ok:true with a leadId; store has 0 leads; tracker got nothing */ });
it('a failed bot check stores nothing', async () => { /* turnstileToken 'fail' → { ok:false, error:'bot_check_failed' }; 0 leads */ });
it('slots leave out Google busy times and active bookings', async () => { /* calendar.setBusy(first slot); insert a booking at the second slot → neither returned; calendarChecked true */ });
it('when Google is unreachable, slots still come from the rules minus the database', async () => { /* calendar.setDown(true) → calendarChecked false, slots non-empty */ });
```

- [ ] **Step 3: Run, expect failure.** Run `npx vitest run tests/unit/booking-leads.test.ts tests/unit/memory-store.test.ts`. Expected: FAIL (modules missing).

- [ ] **Step 4: Implement it.**
  - `getSlots`:
    1. Ask Google for busy times over [now, now + horizon]. On `CalendarUnavailableError`, set `calendarChecked=false` and use no Google busy times.
    2. Add the active bookings as busy intervals.
    3. Return `generateSlots(rules, now, busy)`.
  - `createLead`, in this order:
    1. Honeypot: a filled `website` means fake success.
    2. Validate.
    3. Bot check.
    4. Store the lead, with `fbc` built from fbclid when absent: `fb.1.<ms>.<fbclid>`.
    5. Send the tracker's `Lead` event (sourceUrl from meta).
  - Add `calendarEvent` to `booking.yaml`. Its description has `{manageUrl}` and must not include phone, volume or ad data:
    - title: `HiveGen call · {name}`
    - description: `Your 15-minute call with HiveGen. Join with the Google Meet link in this invite. To reschedule or cancel: {manageUrl}`

- [ ] **Step 5: Run, expect pass.** Run `npx vitest run tests/unit` and `npm run check`. Expected: PASS, 0 errors.

- [ ] **Step 6: Commit.** `git commit -m "feat(booking): domain types, memory store, fake calendar, slots and leads"`

---

### Task 3: Booking service: book, cancel, reschedule

**Files:** Modify `src/server/booking/service.ts`. Create `tests/unit/booking-book.test.ts`.

**Interfaces:**
- Consumes: the Task 2 types and deps.
- Booking input `{ leadId: string(22), start: ISO, visitorTz: string }`. An invalid IANA zone becomes `'UTC'`.
- Reschedule input `{ start: ISO }`.
- The manage token is 32 random bytes in base64url (43 characters).
- `manageUrl` is `${siteUrl}/booking/${token}`.
- The Schedule event ID is `schedule.<leadPublicId>`.

**`book` order** (the design's double-booking and fallback rules):
1. Validate the input.
2. Find the lead; if none, return `not_found`.
3. If the lead already has an active booking, return it unchanged (idempotent).
4. The start must be one of `generateSlots(rules, now)` and not overlap an active booking; otherwise `slot_taken`.
5. Re-check `calendar.busy(start, end)`. If busy, return `slot_taken`. If Google fails, mark the attempt `googleDown`.
6. `insertBooking(status: 'booked')` reserves the slot. On `SlotConflictError`, return `slot_taken`.
7. If not `googleDown`, call `createEvent`:
   - **Success:** `updateBooking` with `googleEventId` and `meetUrl`.
   - **Failure, or `googleDown`:** `updateBooking(status 'requested')`.
8. Set the lead's status to `booked` or `requested`.
9. Send the emails, each separately and best-effort (log a failure; leave its `*NotifiedAt` null so cron retries):
   - booked: `booking-confirmed` + `hassan-new-booking`;
   - requested: `booking-requested` + `hassan-confirm-by-hand`.

   On success, set `visitorNotifiedAt` and `hassanNotifiedAt`.
10. Send the tracker's `Schedule` event.

The event's `privateProps` are `{ leadId, phone?, volume, footageUrl?, pageVersion, utm_source?, utm_campaign? }`. The summary and description come from `calendarCopy` with `{name}` and `{manageUrl}` filled in as plain text.

- **`cancel`:** not found gives `not_found`. Already cancelled returns ok. `now >= start` gives `too_late`. Then `calendar.cancelEvent` (on failure: `server_error`, nothing changes), set the status to cancelled (frees the slot), set the lead to `cancelled`, and send `booking-cancelled` + `hassan-booking-changed` (`change: 'cancelled'`).
- **`reschedule`:**
  - `now > start - minNotice` gives `too_late`.
  - The new start must be an offered slot.
  - `updateBooking(start,end)` (on `SlotConflictError`: `slot_taken`), then `calendar.moveEvent`. If that fails, restore the old times and return `server_error`.
  - Reset both reminder timestamps.
  - Send `booking-rescheduled` + `hassan-booking-changed` (`change: 'rescheduled'`, `previousStart`).
- **`getManaged`:** `canCancel = status !== 'cancelled' && now < start`, and `canReschedule = status === 'booked' && now <= start - minNotice`.

- [ ] **Step 1: Write the failing tests** in `tests/unit/booking-book.test.ts`. Reuse Task 2's `setup` helper; move it to `tests/unit/helpers/booking.ts`.

```ts
it('books: Meet link, manage link, both emails, Schedule event, lead booked', async () => {
  const { svc, calendar, sent, tracked, leadId, slot } = await withLead();
  const r = await svc.book({ leadId, start: slot.start, visitorTz: 'America/New_York' }, {});
  expect(r).toEqual({ ok: true, value: { status: 'booked', start: slot.start, end: slot.end, meetUrl: 'https://meet.google.com/fake-1',
    manageUrl: expect.stringMatching(/^https:\/\/hivegen\.co\/booking\/[A-Za-z0-9_-]{43}$/), eventId: `schedule.${leadId}` } });
  expect(sent).toEqual(['booking-confirmed', 'hassan-new-booking']);
  const ev = [...calendar.events.values()][0];
  expect(ev.summary).toBe('HiveGen call · Zoë O’Brien');
  expect(ev.description).not.toMatch(/555|6–15|facebook/);
  expect(ev.privateProps).toMatchObject({ phone: '+1 (555) 010-2000', volume: '6–15', utm_source: 'facebook' });
});
it('a start that is not an offered slot is slot_taken', ...);                       // past time, and 12:00 UTC on a Saturday
it('Google busy at the re-check is slot_taken', ...);
it('a slot another lead holds is slot_taken', ...);
it('Google down while booking → requested, slot kept, the two "requested" emails', async () => { /* setDown(true) → status 'requested'; sent ['booking-requested','hassan-confirm-by-hand']; a second lead booking the same start → slot_taken */ });
it('confirming twice gives one booking and one calendar event', ...);               // Review Focus 4
it('a fresh service on the same store (process restarted) still books the lead', ...); // Review Focus 3
it('an unknown time zone is stored as UTC', ...);
it('an email failure does not fail the booking and leaves it for cron', ...);       // notifier throws → ok:true; visitorNotifiedAt undefined
it('cancel: frees the slot, cancels the event, sends both emails; twice is fine; after the start is too_late', ...);
it('a requested booking can be cancelled (no calendar call, Hassan told) but not rescheduled', ...);
it('reschedule: moves booking and event, resets reminders, sends both emails; within 60 minutes is too_late; onto a taken slot is slot_taken', ...);
it('Google failing during reschedule restores the old time (server_error)', ...);
```

- [ ] **Step 2: Run, expect failure.** Run `npx vitest run tests/unit/booking-book.test.ts`. Expected: FAIL (`book` not implemented).

- [ ] **Step 3: Implement it** in `service.ts`, as described above.

- [ ] **Step 4: Run, expect pass.** Run `npx vitest run tests/unit` and `npm run check`. Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -m "feat(booking): book, cancel and reschedule with fallbacks"`

---

### Task 4: MySQL store and migrations

**Files:**
- Create:
  - `db/migrations/001_init.sql`;
  - `src/server/store/{mysql,migrate}.ts`;
  - `scripts/db-migrate.ts`;
  - `tests/integration/mysql-store.test.ts`.
- Modify: `package.json` (scripts `test` → `vitest run tests/unit`, `test:db` → `vitest run tests/integration`, `db:migrate` → `tsx scripts/db-migrate.ts`; dev deps `tsx`, `mysql-memory-server@1.18.0`; dep `mysql2@3.24.6`) and `vitest.config.ts` (include `tests/unit/**` and `tests/integration/**`).

**Interfaces:**
- Produces:
  - `createMysqlStore(pool: mysql.Pool): Store`;
  - `runMigrations(pool: mysql.Pool, dir = 'db/migrations'): Promise<string[]>` (returns the files applied);
  - `createPool(url: string): mysql.Pool` with `timezone: 'Z'` and `charset: 'utf8mb4'`.

**Schema:**
- `leads`, `bookings` and `tracking_events` carry the Shared-types fields in snake_case. Keys and indexes:
  - `leads.public_id` is `CHAR(22)` UNIQUE.
  - `bookings.manage_token` is `CHAR(43)` UNIQUE.
  - `bookings.slot_key` is `VARCHAR(30)` NULL UNIQUE. It equals `start_utc` for active bookings and is NULL when cancelled.
  - `tracking_events.event_id` is UNIQUE.
- Times are `DATETIME(3)` in UTC.
- Text is `utf8mb4`.
- A duplicate `slot_key` (`ER_DUP_ENTRY` on that index) becomes `SlotConflictError`.
- `schema_migrations(name PRIMARY KEY, applied_at)`.

- [ ] **Step 1: Write the integration test.** It does `beforeAll(createDB from mysql-memory-server, 600_000 ms timeout)`, then `runMigrations`. A `beforeEach` truncates every table. Then `storeContract(async () => ({ store: createMysqlStore(pool), done: async () => {} }))`, plus:

```ts
it('migrations apply once and are skipped the second time', async () => {
  expect(await runMigrations(pool)).toEqual([]);   // already applied in beforeAll
});
```

- [ ] **Step 2: Run, expect failure.** Run `npm run test:db`. Expected: FAIL (module missing). The first run downloads MySQL, which takes several minutes.

- [ ] **Step 3: Implement the SQL, the store and the migrator.** `scripts/db-migrate.ts` does `loadDotEnv()`, then `runMigrations(createPool(DATABASE_URL))`, then prints the files applied.

- [ ] **Step 4: Run, expect pass.** Run `npm run test:db` and `npm test`. Expected: PASS, with the same contract passing for both stores.

- [ ] **Step 5: Commit.** `git commit -m "feat(store): MySQL store, migrations, shared store contract"`

---

### Task 5: Google Calendar adapter and one-time sign-in

**Files:** Create `src/server/calendar/google.ts`, `scripts/google-connect.ts`, `tests/unit/google-calendar.test.ts`. Modify `package.json` (adds the `google:connect` script).

**Interfaces:**
- Produces:
  - `createGoogleCalendar(cfg: { clientId; clientSecret; refreshToken; calendarId }, fetchFn = fetch, timeoutMs = 8000): Calendar`;
  - `upsertEnvLine(text: string, key: string, value: string): string` (in `src/server/env.ts`).
- REST calls:
  - **Token:** `POST https://oauth2.googleapis.com/token` (`grant_type=refresh_token`). The token is cached until 60 s before it expires.
  - **Busy times:** `POST https://www.googleapis.com/calendar/v3/freeBusy`.
  - **Create:** `POST /calendar/v3/calendars/{id}/events?conferenceDataVersion=1&sendUpdates=all`.
  - **Move:** `PATCH .../events/{eventId}?sendUpdates=all`.
  - **Cancel:** `DELETE .../events/{eventId}?sendUpdates=all`. A 404 or 410 counts as done.
- Any network error, timeout, non-2xx response, or `calendars[id].errors` becomes `CalendarUnavailableError`.
- `meetUrl` is `hangoutLink`, falling back to the video `entryPoints` URI.

- [ ] **Step 1: Write the failing tests** in `tests/unit/google-calendar.test.ts`, with a fake `fetchFn` that records requests:

```ts
it('refreshes the access token once and reuses it', ...);                 // two busy() calls → one token request
it('reads busy times for the calendar', ...);                             // body { timeMin, timeMax, items: [{ id: 'primary' }] } → Interval[]
it('creates the event with a Meet request, the visitor as guest, private details, and invites sent', async () => {
  /* url ends /calendars/primary/events?conferenceDataVersion=1&sendUpdates=all; body.attendees [{ email, displayName }];
     body.conferenceData.createRequest.conferenceSolutionKey.type 'hangoutsMeet'; body.extendedProperties.private equals privateProps;
     result { eventId: 'ev1', meetUrl: 'https://meet.google.com/abc-defg-hij' } */
});
it('Google errors, timeouts and per-calendar errors become CalendarUnavailableError', ...);
it('cancelling an event Google already removed counts as done', ...);    // 410 → resolves
it('upsertEnvLine replaces an existing key and appends a new one', ...);
```

- [ ] **Step 2: Run, expect failure.** Run `npx vitest run tests/unit/google-calendar.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement the adapter and the sign-in script.** `scripts/google-connect.ts`:
  1. Reads the client ID and secret from `.env`.
  2. Listens on `http://127.0.0.1:53682/callback`.
  3. Prints and opens the consent URL (`access_type=offline`, `prompt=consent`, both scopes).
  4. Exchanges the code.
  5. Writes `GOOGLE_REFRESH_TOKEN` into `.env` using `upsertEnvLine`, and prints the hPanel line.

- [ ] **Step 4: Run, expect pass.** Run `npx vitest run tests/unit` and `npm run check`. Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -m "feat(calendar): Google Calendar adapter and one-time sign-in script"`

---

### Task 6: Emails

**Files:**
- Create:
  - `content/emails/{booking-confirmed,booking-requested,reminder-24h,reminder-1h,booking-cancelled,booking-rescheduled,hassan-new-booking,hassan-confirm-by-hand,hassan-new-lead,hassan-booking-changed}.yaml`;
  - `src/server/mail/{render,mailer,notifier}.ts`;
  - `tests/unit/email.test.ts`.
- Modify:
  - `src/lib/content/{schemas,load}.ts`: `emailSchema { subject, body, button?: { label, link: 'meet' | 'manage' } }` and `loadEmail(kind)`;
  - `package.json`: `nodemailer@10.6.0`, `@types/nodemailer`.

**Interfaces:**
- Produces:
  - `renderEmail(kind: EmailKind, vars: Record<string, string>, siteUrl: string): { subject: string; html: string; text: string }`;
  - `Mailer { send(m: { to: string; subject: string; html: string; text: string; replyTo?: string; tag?: string }): Promise<void> }`. The notifier sets `tag` to the email kind.
  - `createSmtpMailer(smtp: NonNullable<ServerConfig['smtp']>): Mailer` sends `tag` as the header `X-HiveGen-Kind`.
  - `createOutboxMailer(dir = '.outbox'): Mailer & { sent: Array<{ to: string; subject: string; text: string; tag?: string }> }`;
  - `createNotifier(o: { mailer: Mailer; hassanEmail: string; siteUrl: string; hassanTz: string }): Notifier`.
- **Placeholders,** checked by a content test:
  - Visitor emails use `{name}` `{when}` `{timezone}` `{meetUrl}` `{manageUrl}` `{previousWhen}`, with `{when}` in the visitor's zone.
  - Hassan's emails add `{email}` `{phone}` `{buyerType}` `{volume}` `{footageUrl}` `{pageVersion}` `{source}` `{whenPakistan}`. `{source}` is the UTM summary, for example `facebook / agents-q1`, or "direct".
- **Escaping:** HTML escapes every value. Plain text keeps values as typed.
- **Layout:** the logo (`${siteUrl}/brand/logo.png`), off-white background, one blue button, system fonts.
- **Recipients:** visitor emails go to `lead.email`; Hassan's go to `hassanEmail`. Every email has Reply-To `connect@hivegen.co`.

- [ ] **Step 1: Write the failing tests** in `tests/unit/email.test.ts`:

```ts
it('every email file loads and uses only its allowed placeholders', ...);
it('fills values, escapes them in HTML, keeps them as typed in text', () => {
  const m = renderEmail('hassan-new-booking', { ...hassanVars, name: '<b>Bob</b>' }, 'https://hivegen.co');
  expect(m.html).toContain('&lt;b&gt;Bob&lt;/b&gt;'); expect(m.html).not.toContain('<b>Bob</b>'); expect(m.text).toContain('<b>Bob</b>');
});                                                                           // Review Focus 5
it('a placeholder without a value is a content error naming the email file', ...);
it("the visitor's confirmation shows the visitor's local time, the Meet link and the manage link, and no ad data", ...);
it("Hassan's booking email shows Pakistan time, phone, volume, footage link and ad source", ...);
it('the outbox mailer writes an .html and a .txt file per email', ...);
```

- [ ] **Step 2: Run, expect failure.** Run `npx vitest run tests/unit/email.test.ts`. Expected: FAIL.

- [ ] **Step 3: Write the email files, then implement.** Write the 10 email files in the voice of the copy deck: short, plain, one action each. Then implement the renderer, both mailers and the notifier. Format times with `formatSlotLong` (Phase 1) and add the zone name.

- [ ] **Step 4: Run, expect pass.** Run `npx vitest run tests/unit` and `npm run check`. Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -m "feat(email): email wording files, renderer, SMTP/outbox mailers, notifier"`

---

### Task 7: HTTP layer and wiring by mode

**Files:**
- Create:
  - `src/server/booking/rate-limit.ts`, `src/server/http/handlers.ts`, `src/server/context.ts`;
  - the route files `src/pages/api/booking/{slots,leads,bookings}.ts`, `src/pages/api/booking/manage/[token]/{cancel,reschedule}.ts`, `src/pages/api/test/{calendar,outbox,events,reset}.ts`;
  - tests `tests/unit/http.test.ts` and `tests/e2e/helpers.ts`.
- Modify: `src/pages/api/booking/config.ts` to use the context, and `tests/e2e/api.spec.ts`.

**Interfaces:**
- Produces:
  - `createRateLimiter({ limit, windowMs, now = Date.now }): { take(key: string): boolean }`;
  - `clientIp(request: Request, fallback?: string): string | undefined`, which prefers the `cf-connecting-ip` header.
  - `getContext(): Promise<ServerContext>` is a singleton. It runs `loadDotEnv` and `readServerConfig`, then wires by mode:
    - **live:** MySQL store (running migrations once per process), Google calendar, the SMTP mailer when configured (otherwise outbox), Turnstile, and a no-op tracker until Task 11.
    - **fakes:** memory store, fake calendar, outbox mailer, a bot check that passes unless the token is `fail`, and a recording tracker.
    - **not_connected:** `service: null`. In production it logs one loud `console.error` at startup naming `config.missing`.
  - `ServerContext = { config; service: BookingService | null; fakes?: { calendar; mailer; tracked: ServerEvent[]; reset(): void } }`. `reset()` clears the store, the fake calendar, the outbox, the tracked events and every rate limiter.
  - The service's `sourceUrl` (for tracking) is the request's `Referer` header, falling back to `siteUrl`.
  - Handlers have the shape `(request: Request, ctx: ServerContext, params?: Record<string, string>, socketIp?: string) => Promise<Response>`, one per route.
- **Responses:**
  - Success returns the design's JSON.
  - Errors return `{ error, fields? }` with these statuses:
    - 400 `invalid`, including bad JSON;
    - 403 `bot_check_failed`;
    - 404 `not_found`;
    - 409 `slot_taken` and `too_late`;
    - 429 `rate_limited`;
    - 503 `not_connected`;
    - 500 `server_error`.
  - Every API response has `cache-control: no-store`.
- **Test routes** (fakes only; 404 otherwise):
  - `POST /api/test/calendar` with body `{ down?: boolean, busy?: Interval[] }`;
  - `GET /api/test/outbox`, returning `[{ kind, to, subject, text }]` (from the outbox mailer's `sent`, with `kind` taken from `tag`);
  - `GET /api/test/events`, returning the tracked events;
  - `POST /api/test/reset`.

- [ ] **Step 1: Write the failing tests.** In `tests/unit/http.test.ts`:

```ts
it('POST leads → 200 { leadId, eventId }; bad JSON → 400 invalid; invalid fields → 400 with fields', ...);
it('the 11th lead from one IP within an hour → 429 rate_limited; another IP is fine', ...);
it('the client IP comes from CF-Connecting-IP when present', ...);
it('booking an unavailable slot → 409 slot_taken', ...);
it('not connected → booking routes answer 503 not_connected', ...);
it('test routes answer 404 outside fakes mode', ...);
it('every API response is no-store', ...);
```

  Create `tests/e2e/booking-flow.spec.ts`. It holds every browser test that changes server state:
  - `test.describe.configure({ mode: 'serial' })`;
  - `test.skip(isMobile)` (desktop only);
  - `beforeEach` → `POST /api/test/reset`.

  These tests share the fakes server's memory, so they must never run side by side. Tests in Tasks 8 and 9 that book or manage join this file.

```ts
test('a lead, then a booking, through the HTTP API; booking twice returns the same booking', async ({ request }) => { /* lead; slots; book; book again → same manageUrl */ });
```

- [ ] **Step 2: Run, expect failure.** Run `npx vitest run tests/unit/http.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement it.** Each route file is three lines: `prerender = false` and `POST`/`GET` calling its handler with `await getContext()` and `context.clientAddress`.

- [ ] **Step 4: Run, expect pass.** Run `npx vitest run tests/unit`, `npm run check` and `npx playwright test tests/e2e/api.spec.ts`. Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -m "feat(api): booking routes, rate limits, wiring by mode, test-only routes"`

---

### Task 8: Booking UI on the real API

**Files:**
- Modify:
  - `src/lib/booking/api-client.ts`, `src/scripts/booking-ui.ts`, `src/components/Booking.astro`;
  - `content/sections/booking.yaml` and its schema;
  - `content/site.yaml` (`booking.backupUrl` optional);
  - `tests/e2e/booking.spec.ts`.
- Create: `src/scripts/{attribution,turnstile,slot-picker}.ts`, `tests/unit/attribution.test.ts`, `tests/unit/booking-modes.test.ts`.

**Interfaces:**
- Consumes: the Task 7 routes.
- `BookingApi` becomes:
  ```ts
  createLead(i: LeadInput & { turnstileToken: string; website: string }): Promise<{ leadId: string; eventId: string }>;
  getSlots(): Promise<{ slots: Slot[]; calendarChecked: boolean }>;
  confirm(leadId: string, slot: Slot, visitorTz: string): Promise<{ status: 'booked' | 'requested'; start: string; end: string; meetUrl?: string; manageUrl: string; eventId: string }>;
  ```
- Errors are `SlotTakenError`, `FieldsError(fields)`, `BotCheckError`, `RateLimitedError` and `NetworkError`.
- `httpApi(fetchFn = fetch): BookingApi`. `demoApi` keeps its rules and matches the new shape: always booked, `calendarChecked: true`, `manageUrl: '#book'`.
- Attribution:
  - `captureAttribution(url: URL, storage: Storage | null, now: number): void` keeps the first touch for 30 days, under key `hg_attribution`.
  - `readAttribution(storage, now): Attribution`.
  - Both wrap every storage call in try/catch.
- `loadTurnstile(siteKey: string, container: HTMLElement): { getToken(): Promise<string> }` loads `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit` and renders `appearance: 'interaction-only'`. `getToken` waits for a token for at most 10 s, then rejects.
- `renderSlotPicker(days: HTMLElement, slotsBox: HTMLElement, slots: Slot[], tz: string, onPick: (s: Slot | null) => void, noSlotsText: string): void` is extracted from `booking-ui.ts` with today's behaviour.
- `initBooking(root, api, opts: { mode: 'live' | 'demo' | 'off'; getBotToken?: () => Promise<string>; onLead?(eventId: string): void; onSchedule?(eventId: string, email: string): void })`.
- `booking.yaml` additions:
  - `errors.buyer`, `errors.volume`, `errors.network`, `errors.botCheck`, `errors.rateLimited`;
  - `requested: { heading, text }`;
  - `calendarNote` (with `{backupLink}`) and `backupLabel`;
  - `offline: { heading, text }`;
  - `honeypotLabel`;
  - `confirmation.manageLabel`.

**Behaviour:**
- When the section comes within 600px, the page fetches `/api/booking/config`, then the mode decides:
  - **live:** the real API, plus Turnstile.
  - **demo:** `demoApi`, with the demo note shown. The note is rendered hidden and shown only in this mode.
  - **off:** the form is hidden. The offline card shows Instagram, plus the backup link when it is set.
- **"I am a…" and "videos per month"** are required: each has its own error, and the first invalid field gets focus.
- **`requested`** shows the requested panel instead of "You're booked".
- **`calendarChecked: false`** shows `calendarNote` with the backup link.
- **A network error on step 1** shows `errors.network` and stays on step 1.
- **The confirmation** includes the manage link and "Add to calendar".
- **Form safety:**
  - `<form method="post" action="#book">`.
  - The submit button is rendered `disabled` and enabled only by the script.
  - The honeypot input `name="website"` sits in a wrapper with `aria-hidden="true"` and is positioned off-screen, with `tabindex="-1"` and `autocomplete="off"`.
- **The JSON blobs** escape `<` as `\u003c`.
- **The visitor's time zone** falls back to `'UTC'` when the browser reports none.

- [ ] **Step 1: Write the failing tests.**
  - `tests/unit/attribution.test.ts`:
    - "first touch wins for 30 days, then a new landing replaces it";
    - "storage that throws is ignored".
  - `tests/unit/booking-modes.test.ts` (jsdom): "off mode hides the form and shows the offline card with Instagram"; "demo mode shows the demo note".
  - Browser tests use a `stubTurnstile(page)` helper in `helpers.ts`, which fulfils `api.js` with a stub that returns `test-token`. The tests split across two files:
    - **`tests/e2e/booking.spec.ts`** (both devices, parallel): only tests that change no server state, namely the required-field test and the no-JavaScript test.
    - **`tests/e2e/booking-flow.spec.ts`** (serial, desktop): the rest.

```ts
test('books a real call: confirmation, manage link, both emails sent', async ({ page, request }) => { /* fill; pick first slot; confirm → "You're booked."; outbox has booking-confirmed to the visitor and hassan-new-booking */ });
test('"I am a…" and videos per month are required', ...);
test('when Google is down the visitor sees the requested panel, never "You\'re booked."', async ({ page, request }) => { /* POST /api/test/calendar {down:true} after step 1 */ }); // Review Focus 2
test('a slot taken meanwhile shows the message and fresh times', ...);
test('a network failure on step 1 keeps the visitor on step 1 with a clear message', ...);   // page.route('**/api/booking/leads', r => r.abort())
test('without JavaScript the form cannot be submitted, so nothing lands in the URL', ...);    // javaScriptEnabled: false; button disabled
test('the visitor\'s ad tags reach the lead', ...);                                         // land on /agents?utm_source=facebook&fbclid=x; GET /api/test/outbox shows source "facebook" in Hassan's email
```

- [ ] **Step 2: Run, expect failure.** Run `npx vitest run tests/unit/attribution.test.ts tests/unit/booking-modes.test.ts` and `npx playwright test tests/e2e/booking.spec.ts`. Expected: FAIL.

- [ ] **Step 3: Implement it.**

- [ ] **Step 4: Run, expect pass.** Run `npm test`, `npm run check` and `npx playwright test`. Expected: all pass, and the phone budget test is unchanged.

- [ ] **Step 5: Commit.** `git commit -m "feat(booking-ui): real API, modes, Turnstile, honeypot, requested and offline states, attribution"`

---

### Task 9: Manage-booking page

**Files:**
- Create:
  - `content/sections/manage-booking.yaml` (+ schema);
  - `src/pages/booking/[token].astro`;
  - `src/scripts/manage-booking.ts`.
- Modify: `tests/e2e/booking-flow.spec.ts` and `tests/e2e/quality.spec.ts`.

**Interfaces:**
- Consumes: `service.getManaged/cancel/reschedule`, the Task 7 manage routes, and `renderSlotPicker`.
- Page:
  - Server-rendered (`prerender = false`) with `BaseLayout`, `noindex`, and `cache-control: no-store`.
  - It shows the call time (server-formatted in the booking's `visitorTz` with `formatSlotLong`), the Meet link, Reschedule (only when `canReschedule`) and Cancel (only when `canCancel`, with an inline "Are you sure?" step).
  - An unknown token returns status 404 with `notFoundText`.
- `manage-booking.yaml`:
  - `title`, `heading`, `whenLabel`, `meetLabel`;
  - `rescheduleLabel`, `rescheduleHeading`, `confirmRescheduleLabel`;
  - `cancelLabel`, `cancelConfirmText`, `cancelConfirmLabel`, `keepLabel`;
  - `cancelledText`, `rescheduledText`, `tooLateText`, `notFoundText`, `errorText`.

- [ ] **Step 1: Write the failing tests** in `tests/e2e/booking-flow.spec.ts` (serial, desktop; see Task 7), with each booking created through the HTTP API:

```ts
test('the manage page shows the call time and the Meet link', ...);
test('rescheduling moves the call and sends the "rescheduled" emails', ...);
test('cancelling asks first, then cancels and sends the "cancelled" emails', ...);
test('an unknown link shows the not-found text with status 404', ...);
test('the manage page is not indexed and not cached', ...);   // meta robots noindex; cache-control no-store
```

- [ ] **Step 2: Run, expect failure.** Run `npx playwright test tests/e2e/booking-flow.spec.ts`. Expected: the new manage tests FAIL.

- [ ] **Step 3: Implement it.**

- [ ] **Step 4: Run, expect pass.** Run `npx playwright test` and `npm run check`. Expected: PASS, and axe stays clean on `/booking/<token>` (add that path to the axe loop).

- [ ] **Step 5: Commit.** `git commit -m "feat(manage): reschedule and cancel page"`

---

### Task 10: Scheduled work

**Files:** Create `src/server/cron.ts`, `src/pages/api/cron/run.ts`, `scripts/cron.ts`, `tests/unit/cron.test.ts`. Modify `src/server/http/handlers.ts` and `package.json` (adds the `cron` script).

**Interfaces:**
- `runScheduledWork(d: { store: Store; notifier: Notifier; retryTracking(r: TrackingRecord): Promise<boolean>; clock: Clock }): Promise<{ reminders24h: number; reminders1h: number; newLeadEmails: number; emailRetries: number; trackingRetries: number }>`.
- **24-hour reminder:** status `booked`, `now >= start - 24h`, `now < start - 1h`, `createdAt <= start - 24h`, not yet sent.
- **1-hour reminder:** status `booked`, `now >= start - 60min`, `now < start`, not yet sent.
- **New lead:** status `started`, `createdAt <= now - 30min`, created within the last 7 days, no `newLeadNotifiedAt`, and no active booking.
- **Email retries:** bookings created in the last 2 days whose visitor or Hassan email is unsent. The kind is picked by status: booked → `booking-confirmed` / `hassan-new-booking`; requested → `booking-requested` / `hassan-confirm-by-hand`.
- **Tracking retries:** `failed` records with fewer than 3 attempts.
- `POST /api/cron/run` returns 401 unless `x-cron-secret` equals `CRON_SECRET`, 503 when not connected, and otherwise the summary.
- `npm run cron` POSTs to `${PUBLIC_SITE_URL}/api/cron/run` with the secret from `.env`.

- [ ] **Step 1: Write the failing tests** in `tests/unit/cron.test.ts`:

```ts
it('sends the 24-hour reminder once, and none for a call booked less than 24 hours ahead', ...);
it('sends the 1-hour reminder once', ...);
it('skips cancelled and requested bookings for reminders', ...);
it('emails Hassan about a lead without a time after 30 minutes, once, and not if they booked', ...);
it('retries unsent booking emails and stops once they go through', ...);
it('retries failed tracking events up to 3 attempts', ...);
it('the cron route refuses a missing or wrong secret', ...);
```

- [ ] **Step 2: Run, expect failure.** Run `npx vitest run tests/unit/cron.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement it.**

- [ ] **Step 4: Run, expect pass.** Run `npx vitest run tests/unit` and `npm run check`. Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -m "feat(cron): reminders, new-lead email, retries"`

---

### Task 11: Tracking (Meta Pixel + Conversions API, Google tag)

**Files:**
- Create:
  - `src/server/tracking/{hash,meta}.ts`;
  - `src/pages/api/events.ts`;
  - `src/scripts/tracking.ts`;
  - tests `tests/unit/{meta-tracking,browser-tracking}.test.ts` and `tests/e2e/tracking.spec.ts`.
- Modify:
  - `content/site.yaml` and the schema: a `tracking: { metaPixelId, googleTagId, googleAdsId, googleAdsScheduleLabel }` block, all optional strings, where empty means off;
  - `src/layouts/BaseLayout.astro`: a `<script type="application/json" data-tracking>` element holding only the public IDs, rendered only when one is set;
  - `src/server/context.ts`, `src/scripts/lightbox.ts`, `src/components/Booking.astro`.

**Interfaces:**
- Hashing:
  - `normalizeEmail(s)` trims and lowercases.
  - `normalizePhone(s)` keeps digits only; 10 digits get a `1` prefix (US).
  - `sha256Hex(s)`.
- `buildMetaEvent(e: ServerEvent, testEventCode?: string): object`. It sets `event_name`, `event_time` (seconds), `event_id`, `action_source: 'website'` and `event_source_url`. In `user_data`: `em` and `ph` hashed, `external_id` hashed, plus `client_ip_address`, `client_user_agent`, `fbp`, `fbc`.
- `createMetaTracker(o: { pixelId: string; token: string; testEventCode?: string; store: Store; fetchFn?: typeof fetch }): Tracker & { resend(r: TrackingRecord): Promise<boolean> }`:
  - It POSTs `https://graph.facebook.com/<META_GRAPH_VERSION>/<pixelId>/events`.
  - It records `tracking_events` as pending, then sent or failed, and never throws.
  - `META_GRAPH_VERSION` is a constant, set when implementing to the newest version listed in Meta's Graph API changelog.
- `POST /api/events` accepts body `{ name: 'PageView', eventId, url, fbp?, fbc? }` and answers 204. It is rate limited, and when Meta isn't configured the event is dropped.
- Browser, `initTracking(cfg)`. After the `load` event and idle time (`requestIdleCallback`, with a 2 s fallback), it injects `fbevents.js` (`fbq('init', id)`) and `gtag.js` (`config` for `googleTagId` and `googleAdsId`). It then sends PageView, using a `crypto.randomUUID()` event ID for both `fbq('track','PageView',{}, { eventID })` and `sendBeacon('/api/events')`. Further exports:
  - `trackViewContent(title)` sends Pixel `ViewContent` and the gtag `video_play` event;
  - `trackLead(eventId)` sends Pixel `Lead` (with that eventID) and gtag `generate_lead`;
  - `trackSchedule(eventId, email)` sends Pixel `Schedule` and gtag `set user_data {email}`, then the conversion `send_to: '<googleAdsId>/<label>'` and `book_call`.

  Calls made before the trackers load are queued. With no IDs set, every call does nothing.

- [ ] **Step 1: Write the failing tests.**
  - `tests/unit/meta-tracking.test.ts`:
    - "email and phone are normalised before hashing" (`' Zoe+Ads@Example.com '` hashes the same as `zoe+ads@example.com`; `(555) 010-2000` becomes `15550102000`);
    - "the Conversions API payload carries the shared event id and hashed user data, and no raw email";
    - "a failed send is recorded as failed, never thrown".
  - `tests/unit/browser-tracking.test.ts` (jsdom):
    - "nothing loads before the load event";
    - "after load: both scripts injected, PageView fired with an eventID and beaconed with the same id";
    - "with no IDs nothing is injected".
  - `tests/e2e/tracking.spec.ts`:
    - "no third-party script is requested before the load event";
    - "the site's real content has no tracking IDs yet, so no tracker loads at all" (watch requests to `connect.facebook.net` and `googletagmanager.com`).

- [ ] **Step 2: Run, expect failure.**

- [ ] **Step 3: Implement it.** Wire it in:
  - The lightbox open calls `trackViewContent`.
  - `initBooking`'s `onLead`/`onSchedule` hooks call `trackLead`/`trackSchedule`.
  - `context.ts` uses `createMetaTracker` when `config.meta` and `tracking.metaPixelId` are both set, otherwise a no-op tracker. Cron's `retryTracking` uses `resend`.

- [ ] **Step 4: Run, expect pass.** Run `npm test`, `npm run check` and `npx playwright test`. Expected: PASS, and the phone budget test is unchanged.

- [ ] **Step 5: Commit.** `git commit -m "feat(tracking): Meta Pixel and Conversions API, Google tag, de-duplicated events"`

---

### Task 12: Signed Stream links

**Files:**
- Create: `src/server/stream/sign.ts`, `src/pages/api/video/[id].ts`, `tests/unit/stream-sign.test.ts`.
- Modify:
  - `src/server/http/handlers.ts`, `src/lib/media.ts`, `src/scripts/lightbox.ts`;
  - every component that builds `data-lightbox`: `VideoCard`, `HeroStage`, `BeforeAfter`;
  - `scripts/prepare-media.mjs`, `src/lib/content/load.ts`, `content/sections/hero.yaml` (adds `videoErrorText`);
  - `tests/unit/media.test.ts`, `tests/e2e/edits.spec.ts`.

**Interfaces:**
- `signStreamToken(o: { uid: string; keyId: string; jwkBase64: string; now: Date; ttlSeconds?: number }): string`. It creates an RS256 JWT through `node:crypto` (`createPrivateKey({ key: JSON.parse(base64-decoded JWK), format: 'jwk' })` and `sign('RSA-SHA256')`) with claims `{ sub, kid, exp: now+ttl (default 3600), nbf: now-60 }`.
- `GET /api/video/[id]` returns `{ src }`:
  - an unknown id, or a video that isn't on Stream, gives 404;
  - with `streamSignedUrls` off, `src` is the plain iframe URL;
  - with it on and `config.stream` set, `src` is the signed URL from the Global Constraints;
  - with it on and no key, the answer is 503 `not_connected`.
- `data-lightbox` becomes `{ kind: 'stream', videoId, orientation, title }` or `{ kind: 'file', src, orientation, title }`. `openLightbox` fetches `/api/video/<videoId>` for stream videos and shows `videoErrorText` on failure.
- Card images:
  - `npm run media` downloads `https://customer-<code>.cloudflarestream.com/<uid>/thumbnails/thumbnail.jpg?time=<posterTime>s&height=640` to `public/media/posters/<id>.jpg` for every Stream video without `source:`. It signs the URL when a key is in `.env`.
  - `resolveVideo`'s poster rule becomes: use the local file (Cloudflare Images when it's listed in `images.yaml`) whenever it exists. Otherwise use Stream's thumbnail, except when `streamSignedUrls` is on; then a missing file is a content error that says to run `npm run media`.
  - The 5 `t-*.jpg` card images are generated and committed.

- [ ] **Step 1: Write the failing tests.**
  - `tests/unit/stream-sign.test.ts`: the test generates an RSA key pair, exports the JWK as base64, signs, and then:
    - "the token verifies with the public key and carries sub, kid, exp and nbf";
    - "the video route returns a signed URL when signing is on, the plain one when off, 404 for unknown ids, 503 without a key".
  - `tests/unit/media.test.ts` gains "a client video uses its local card image once the file exists" and "with signing on, a Stream-only video without a card image is a content error".
  - `tests/e2e/edits.spec.ts`: "tapping a card asks the server for the video link, then plays it" (wait for `/api/video/` response; iframe `src` contains the UID).

- [ ] **Step 2: Run, expect failure.**

- [ ] **Step 3: Implement it,** then run `npm run media` to create the five client card images.

- [ ] **Step 4: Run, expect pass.** Run `npm test`, `npm run check` and `npx playwright test`. Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -m "feat(video): signed Stream links ready to switch on; static client card images"`

---

### Task 13: Setup guide, service checks, owner docs

**Files:** Create `HOW-TO-SETUP.md`, `scripts/check-services.ts`, `tests/unit/check-services.test.ts`. Modify `HOW-TO-EDIT.md`, `.env.example` and `package.json` (adds the `check:services` script).

**Interfaces:**
- `checkServices(config, deps): Promise<Array<{ service: string; ok: boolean; detail: string; fix?: string }>>`. One check per configured service:
  - **MySQL:** connect, and list pending migrations.
  - **Google:** refresh the token, then read busy times for the next hour.
  - **SMTP:** `transporter.verify()`.
  - **Turnstile:** siteverify with a dummy token. The answer `invalid-input-response` means the secret is OK; `invalid-input-secret` means it is wrong.
  - **Meta:** send one test event when `META_TEST_EVENT_CODE` is set.
  - **Stream:** sign a token for one video and HEAD its iframe URL.
- The script prints ✓/✗ lines and exits 1 if any check fails. Not-configured services print "not set up yet" with a pointer to the right `HOW-TO-SETUP.md` section.
- `HOW-TO-SETUP.md`, one section per service, each ending with its exact `.env` line(s) and `npm run check:services`:
  1. Google Cloud project, consent screen "In production", OAuth client (desktop), `npm run google:connect` with Hassan;
  2. Hostinger MySQL database, plus remote access for development;
  3. the SMTP mailbox;
  4. Meta Pixel ID, Conversions API token, test event code;
  5. GA4 ID, Google Ads conversion ID and label;
  6. Turnstile (I can create it with approval);
  7. Stream signing key (I can create it with approval);
  8. the Hostinger cron job (the exact `curl` command, at most 255 characters, no `%`);
  9. `NODE_ENV=production` on Hostinger.
- `HOW-TO-EDIT.md` gains sections on the email wording files, the manage page, the calendar invite wording, the tracking IDs, the backup link and the booking states.

- [ ] **Step 1: Write the failing tests:** "Turnstile secret classification", and "the report shows not-set-up services with a pointer and fails only on broken ones".

- [ ] **Step 2: Run, expect failure.**

- [ ] **Step 3: Implement the checks, then write the docs.**

- [ ] **Step 4: Run, expect pass.** Run `npm test` and `npm run check`. Running `npm run check:services` with no `.env` prints every service as "not set up yet" and exits 0.

- [ ] **Step 5: Commit.** `git commit -m "docs: setup guide and service checks"`

---

### Task 14: Connect the real accounts (needs the user)

Not code. It stops for the user's input and approvals.

- [ ] **Step 1: Ask the user.** In one message, ask for whichever of these they have now:
  - the Google Cloud OAuth client, or their OK to walk them through creating one;
  - a time for Hassan's one-time sign-in;
  - Hostinger MySQL credentials, with remote access allowed for this computer's IP;
  - the SMTP mailbox, if it exists;
  - the Meta Pixel ID, Conversions API token and test event code;
  - the GA4 and Google Ads IDs.

  Ask separately for approval, one request each, for these Cloudflare changes:
  - creating the Turnstile widget (hostnames `hivegen.co` and `localhost`);
  - creating the Stream signing key;
  - uploading the five client card images (`public/media/posters/t-*.jpg`) to Cloudflare Images and listing them in `images.yaml`.
- [ ] **Step 2: Fill `.env`,** then run `npm run db:migrate` and `npm run check:services`. Expected: ✓ for every connected service.
- [ ] **Step 3: Live check on this computer.** Make one booking at `npm run dev`, then confirm:
  - it is in Hassan's calendar with a Meet link;
  - the invite and both emails arrived (or sit in `.outbox/` when there's no SMTP yet);
  - Meta Events Manager shows the test events;
  - GA4 DebugView shows events.

  Then cancel it through the manage link. Expected: the event is gone and the cancellation emails arrived.
- [ ] **Step 4: Record and commit.** Record in the ledger which services are live and which remain for the user. Commit the docs touched.
