# HiveGen site · Phase 2 design: real booking, tracking, protected video

Date: 2026-11-19 · Status: approved by the user 2026-11-19 · Builds on `docs/design/2026-11-18-hivegen-website-design.md` (sections 9–11). That document stays the authority for everything this one does not change.

## 1. Intent

The site exists to turn paid ad clicks (Facebook/Instagram and Google, US only) into booked 15-minute calls with Hassan. Phase 1 built the pages, and its booking form is a demo that books nothing. Phase 2 makes booking real: the call lands in Hassan's Google Calendar with a Meet link, the visitor and Hassan both hear about it, and Meta and Google learn which ads produce calls so ad money goes to what works. It also makes the portfolio videos harder to copy, through expiring video links.

## 2. Goals, non-goals, anti-goals

**Goals**
- A visitor books a real call in under a minute, on a phone, inside the Facebook or Instagram in-app browser.
- Every lead reaches Hassan: as a booking in his calendar, as an email, or both. Leads and bookings are also stored in MySQL.
- No double bookings.
- Meta and Google receive PageView, Lead and Schedule with enough match data to optimise ads. Browser and server events are de-duplicated.
- Portfolio videos play through links that expire. The switch is ready to flip at launch.
- Hassan can keep editing every word from files, and `npm run dev` keeps working on any computer without secrets.

**Non-goals (this phase)**
- Putting the site live on Hostinger, connecting the domain, Stream allowed origins, and the final legal pages: all of these are Phase 3.
- An admin dashboard. Data is stored for one later.
- Payments, invoices, client accounts.
- A cookie-consent banner (ads target the US only, as already decided).

**Anti-goals**: it fails even if it "works" when any of these happen:
- A visitor sees "You're booked" while nothing reached Hassan.
- Two visitors get the same slot.
- The phone page gets heavier at first load. Trackers, Turnstile and the booking code must not load before the page has loaded.
- Personal data appears in a URL, in page source, or in the visitor's own calendar invite description.
- A secret ends up in the repository or in page source.
- A computer without secrets can no longer preview or edit the site.

## 3. Constraints

- **Hosting:** Hostinger Business Node.js web app (Node 18–24) with MySQL, behind Cloudflare (hivegen.co is proxied; SSL mode moves to Full (strict) in Phase 3). Hostinger's documentation adds these limits:
  - Node apps run on demand: the process is stopped after a period without traffic and restarted by the next request.
  - Always-running background workers are not supported.
  - Each request is cut off after 120 s.

  So in-memory caches and rate limits are best-effort, and anything scheduled runs through Hostinger cron (section 11).
- **Code:** the existing Astro 7.4 site. Pages stay prerendered (static HTML); only new server routes run on demand, through `@astrojs/node` (11.x supports Astro ^7.2), standalone mode.
- **Content:** every visible word comes from `content/` YAML, validated by Zod with errors that name the file and field (existing loader in `src/lib/content/`).
- **Phone budget:** the existing quality test requires initial first-party JavaScript under 50 KB gzipped and must keep passing.
- **Secrets:** they live in environment variables. Locally that is a git-ignored `.env`; on Hostinger it is the hPanel environment settings. A committed `.env.example` lists every variable.
- **Development machine:** Windows, so text files stay LF (`.gitattributes` already enforces it).
- **Email:** hivegen.co mail is received by Cloudflare Email Routing (`connect@hivegen.co` forwards to Gmail). The professional mailbox comes later, and its provider is not chosen yet.
- **Cloudflare changes** (Turnstile widget, Stream signing key, requiring signed links) are made only with explicit approval from the user, one request each.

## 4. Approaches considered

| | Approach | Trade-off | Verdict |
|---|---|---|---|
| A | **Server routes inside this Astro site**, running as a Node.js app on Hostinger with MySQL | One codebase and one deploy; reuses the slot engine and content loader; needs Hostinger's Node process to stay up | **Picked.** It matches the hosting the user chose (Hostinger + MySQL) and the custom booking flow already designed. |
| B | API on Cloudflare Workers with D1, static pages anywhere | Very fast, and Stream signing is native; but it splits the stack, drops the chosen MySQL, and adds a second deploy target | Rejected: it undoes the hosting decision. |
| C | A ready-made scheduler (Cal.com or Calendly) embedded in the page | Least code; but it looks foreign, adds heavy scripts, and gives weaker ad tracking | Rejected: the user chose a fully custom flow on 2026-11-18. |

The user approved approach A on 2026-11-19 ("ok go on"), together with the summary in the chat. That summary covered:
- SMTP email;
- expiring links built now and switched on at launch;
- live bookings on the website only after Phase 3;
- the new-lead email after 30 minutes.

## 5. Decided (by the user, earlier or now)

- **Booking flow** (from the Phase 1 design, section 10):
  - Step 1 saves the lead. Step 2 picks a 15-minute slot shown in the visitor's own time zone. Step 3 confirms, with a Google Meet link.
  - Slots = booking rules in `site.yaml`, minus Hassan's Google Calendar free/busy, minus slots already booked.
  - On booking: the server re-checks the slot, creates the event with a Meet link and the visitor as guest (Google sends the invite), stores the booking, emails the visitor and Hassan, and reports the conversion.
  - Double bookings are blocked by a live re-check plus a unique key in MySQL.
  - If Google is unreachable, the request is saved as "requested", Hassan confirms it by hand, and the visitor sees "We'll confirm your time by email shortly."
  - Reminders go out 24 hours and 1 hour before the call. Every email carries a private reschedule/cancel link (`/booking/<token>`).
  - Spam is handled by a honeypot, a rate limit per IP, and Cloudflare Turnstile.
  - Hassan's existing Google appointment page is the backup link when Google can't be reached.
- **Data:** tables `leads`, `bookings` and `tracking_events` with the fields listed in the Phase 1 design (refined in section 9 below).
- **Tracking** (Phase 1 design, section 11):
  - PageView: Pixel and CAPI, plus the Google tag.
  - ViewContent (a video is played): Pixel and a GA4 event.
  - Lead (step 1): Pixel, CAPI and a GA4 event.
  - Schedule (booking confirmed): Pixel, CAPI, and a Google Ads enhanced conversion.
  - Browser and server send the same event ID. UTM, fbclid and gclid are stored with the lead.
- **Google access:** a Google Cloud project with the Calendar API and an OAuth client. Hassan signs in once, and the server stores a refresh token. No password is shared.
- **Video protection:** page-level blocks are done (Phase 1). Signed (expiring) Stream links are built in Phase 2 and switched on at launch. Allowed origins are set at launch. A watermark is up to Hassan, later.
- **New (2026-11-19):**
  - Email goes out over standard SMTP, so any mailbox can be plugged in later.
  - If a visitor submits step 1 and doesn't pick a time within 30 minutes, Hassan gets a "new lead, no time picked" email.

## 6. Architecture

```
Browser (prerendered pages)
  ├─ booking UI ──── /api/booking/*  ─┐
  ├─ video pop-up ── /api/video/:id   ├─ Astro server routes (Node, Hostinger)
  ├─ tracking ────── /api/events     ─┤     ├─ booking service ── MySQL
  ├─ Meta Pixel, Google tag (after load)    ├─ Google Calendar (OAuth refresh token)
  └─ Turnstile (when booking is near)       ├─ SMTP mailer (or .outbox/ in dev)
                                            ├─ Meta Conversions API
Hostinger cron, every 5 min ─ /api/cron/run ┘  └─ Stream token signer
```

- **Ports and adapters.** The booking service is plain TypeScript that receives its dependencies (store, calendar, mailer, tracker, clock, config) as arguments, so every rule is unit-tested with fakes. Each external system has one small adapter.
- **Shared rules.** The slot engine (`src/lib/booking/slots.ts`) and the content loader already run in Node, and the server reuses them unchanged.
- **Runtime mode.** At startup the server decides **live** (all booking secrets present) or **not connected** (anything missing). **In production, live also requires a sending mailbox (all SMTP settings)** (user, 2026-11-19: "wait for the mailbox"). Until one is connected, the live website shows the offline booking card, so no lead is lost silently. On this computer, emails go to `.outbox/` instead. `GET /api/booking/config` tells the page which, along with the Turnstile site key.
  - In development, "not connected" keeps today's demo booking (in-browser, with the demo note).
  - In production (`NODE_ENV=production`), "not connected" never runs the demo. The booking card shows the Instagram button and the backup appointment link instead, and the server logs a loud error at startup. This prevents the anti-goal of a fake "You're booked".

## 7. Booking API

All routes are JSON and `prerender = false`. Errors use `{ error: code, fields?: { field: code } }` with these codes: `invalid`, `rate_limited`, `bot_check_failed`, `slot_taken`, `not_found`, `not_connected`, `server_error`.

| Route | Request | Success | Notes |
|---|---|---|---|
| `GET /api/booking/config` | — | `{ mode: 'live' \| 'not_connected', turnstileSiteKey? }` | |
| `GET /api/booking/slots` | — | `{ slots: [{ start, end }], calendarChecked }` | Busy times come from Google free/busy, cached about 60 s. If Google fails: `calendarChecked: false`, with slots from rules minus the database. |
| `POST /api/booking/leads` | name, email, phone?, buyerType, volume, footageUrl?, pageVersion, attribution (utm_*, fbclid, gclid), fbp?, fbc?, turnstileToken, `website` (honeypot) | `{ leadId, eventId }` | `leadId` is an unguessable public ID. `eventId` is used for the Pixel Lead event. A filled honeypot returns a fake success and stores nothing. |
| `POST /api/booking/bookings` | leadId, start, visitorTz | `{ status: 'booked' \| 'requested', start, end, meetUrl?, manageUrl, eventId }` | Re-checks rules, the database and free/busy. Returns 409 `slot_taken` if the slot is gone. One active booking per lead: a second request returns the existing one. |
| `GET /booking/[token]` (page) | — | Booking details; cancel; reschedule | Server-rendered, `noindex`. |
| `POST /api/booking/manage/[token]/cancel` | — | `{ status: 'cancelled' }` | Allowed until the call starts. Google event cancelled, with notifications sent. |
| `POST /api/booking/manage/[token]/reschedule` | start | `{ status, start, end }` | Allowed up to the minimum notice (1 hour) before the call. Same checks as booking. The Google event is moved and notifications sent. |
| `GET /api/video/[id]` | — | `{ src }` | Stream iframe URL: signed when `streamSignedUrls` is on, plain otherwise. Unknown id returns 404. |
| `POST /api/events` | name (`PageView`), eventId, url, fbp?, fbc? | 204 | Server side of PageView for the Conversions API. |
| `POST /api/cron/run` | header `x-cron-secret` | summary of the work done | Called by Hostinger cron every 5 minutes; `npm run cron` runs it locally. |

**After a "requested" booking** (the Phase 1 design: Hassan confirms by hand). It stays "requested" in the database:
- Hassan creates the calendar event and emails the visitor himself.
- The system doesn't retry Google on its own, because that could clash with what Hassan does by hand.
- Requested bookings get no reminders.
- The visitor's manage link can cancel a requested booking, which frees the slot and tells Hassan, but cannot reschedule it.

**Who visitors see and reach:**
- Replies to every email go to `connect@hivegen.co`, the public address the user chose on 2026-11-18. Where that forwards is set in Cloudflare Email Routing; today it forwards to the developer's Gmail.
- Google's invite shows the calendar owner's address (Hassan's Gmail) to the person booking. The user accepted this on 2026-11-19. It never appears on the website.

**Validation** (server, Zod):
- name: 1–100 characters.
- email: valid.
- phone: optional, 6–30 characters of digits, spaces and `+()-`.
- buyerType: one of the four.
- volume: one of `booking.yaml` volumeOptions.
- footageUrl: optional http(s) URL.
- pageVersion: one of the four page slugs.
- attribution values: at most 200 characters each.
- **[my call]** buyerType and volume are **required**: each is one tap, and both qualify the lead. buyerType is pre-selected on the three tailored versions.

**Browser changes:**
- The form gets `method="post"` with submission blocked until the script runs, so personal data never goes into a URL. Copy for the network-error message goes in `booking.yaml`.
- Booked shows today's confirmation. Requested shows the "we'll confirm by email" panel.
- `slot_taken` reloads slots with the existing message.
- `calendarChecked: false` shows a short note and the backup appointment link (`site.yaml` `booking.backupUrl`; optional, from Hassan).

## 8. Google Calendar

- **Scopes:** `calendar.events` and `calendar.freebusy`, on Hassan's `primary` calendar (configurable as `GOOGLE_CALENDAR_ID`).
- **Consent screen:** must be set to "In production". "Testing" mode makes refresh tokens expire after 7 days. Hassan will see an "unverified app" notice once, which is expected for a private app.
- **One-time sign-in:** `npm run google:connect` starts a local page, opens Google's sign-in, receives the code on `localhost`, and writes the refresh token to `.env` (and prints it for hPanel).
- **Event:**
  - Title: "HiveGen call · {name}".
  - The visitor is an attendee. `sendUpdates=all` (Google emails the invite). A Meet link is created with `conferenceDataVersion=1`.
  - **[my call]** The description shows only what the visitor needs: what to prepare, and the reschedule/cancel link. Lead details (phone, volume, footage link, ad source) go to Hassan's email and to the event's private extended properties, never to the description, which the guest can see.
- **Failures:** a timeout or 5xx from Google during booking leads to "requested". A 409-style conflict found by the re-check returns `slot_taken`.
- **Client choice:** the builder picks the small `@googleapis/calendar` package (about 0.85 MB) or plain REST with token refresh. Avoid the full `googleapis` bundle (about 246 MB installed).

## 9. Data (MySQL, `mysql2`)

- **`leads`**
  - Columns:
    - id (PK) and public_id (unique, random);
    - created_at;
    - the visitor's details: name, email, phone, buyer_type, videos_per_month, footage_url;
    - where they came from: page_version, utm_source/medium/campaign/term/content, fbclid, gclid, fbp, fbc;
    - request details: client_ip, user_agent;
    - status (started / booked / requested / cancelled) and new_lead_notified_at.
- **`bookings`**
  - Columns:
    - id, lead_id (FK), start_utc, end_utc, visitor_tz;
    - google_event_id and meet_url;
    - status (booked / requested / cancelled);
    - manage_token (unique, 32 random bytes, base64url);
    - slot_key;
    - reminder_24h_sent_at, reminder_1h_sent_at, created_at, updated_at.
  - slot_key has a UNIQUE index. It is set to the slot's UTC start while the booking is booked or requested, and to NULL when cancelled (MySQL allows many NULLs). That is the second double-booking guard.
- **`tracking_events`**
  - Columns: id, event_id (unique), event_name, lead_id, payload (JSON), meta_status (pending / sent / failed / skipped), attempts, last_error, created_at, sent_at.
- **Migrations:** numbered SQL files in `db/migrations/`, applied by `npm run db:migrate`, which records them in a `schema_migrations` table.
- **Development and tests:**
  - The store's SQL must be exercised against a real MySQL in the test suite before launch.
  - The builder chooses how, for example a throwaway MySQL started by the tests, or a `DATABASE_URL_TEST`.
  - The in-memory store is for unit tests and the not-connected development mode only.

## 10. Email

**Mailer**
- `nodemailer` over SMTP, configured by `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `MAIL_FROM` (for example "HiveGen <connect@hivegen.co>"). Reply-To is `connect@hivegen.co`.
- When SMTP isn't configured, each email is written to `.outbox/` (git-ignored) as `.html` plus `.txt`, and the path is logged.
- Hassan's address is `site.yaml` `contact.notificationEmail`. It is never rendered on a page.

**Wording**
- The words for every email live in `content/emails/*.yaml`: a subject and a body with `{placeholders}`, validated like other content.
- One simple branded HTML layout (logo, off-white, blue button) plus a plain-text version.

| Email | To | When |
|---|---|---|
| Booking confirmed | visitor | booked (Google also sends its invite) |
| Booking requested | visitor | Google unreachable at booking |
| New booking | Hassan | booked, with all lead details and the ad source |
| Please confirm by hand | Hassan | requested |
| New lead, no time picked | Hassan | the lead is 30 minutes old with no booking, sent once (cron) |
| Reminder | visitor | 24 hours and 1 hour before, booked only (cron) |
| Cancelled or rescheduled | visitor and Hassan | after a manage action |

All times are shown in the visitor's stored time zone. Hassan's emails also show Pakistan time.

## 11. Scheduled work

`POST /api/cron/run`, called every 5 minutes by a Hostinger cron job (`curl` with the secret header), runs these tasks. Each is idempotent: a timestamp column marks the work done.
1. **Reminders:** booked bookings starting in 24 hours or 1 hour (within the 5-minute window) whose reminder isn't sent yet.
2. **New-lead emails:** leads in "started" for 30 minutes or more, with no booking and no notification sent yet.
3. **Retries:** failed Conversions API sends, up to 3 attempts.

**[my call]** I use Hostinger cron rather than a timer inside the Node process, because Hostinger stops idle Node apps and does not allow background workers.

Hostinger cron supports Node.js sites (hPanel → Advanced → Cron Jobs). Its limits:
- jobs run in UTC;
- each job is a single command of at most 255 characters, with no `%`;
- jobs do not receive the app's environment variables.

The job therefore calls the site itself, for example `curl -s -X POST https://hivegen.co/api/cron/run -H "x-cron-secret: <secret>"`. That also wakes the app, which already has its own settings.

## 12. Tracking

**Settings**
- In `site.yaml`, under a new `tracking:` block. These values are public, and leaving one empty switches that tracker off:
  - `metaPixelId`;
  - `googleTagId` (the GA4 `G-…` ID);
  - `googleAdsId` (`AW-…`);
  - `googleAdsScheduleLabel`.
- Secrets, kept in the environment:
  - `META_CAPI_TOKEN`;
  - `META_TEST_EVENT_CODE`, optional, for testing in Events Manager.

**Loading** [my call]
- `fbevents.js`, `gtag.js` and Turnstile load only after the page's load event, when the browser is idle. Turnstile loads only when the booking section comes near the screen.
- First load on phones stays inside the budget.
- Cost: a visitor who leaves within the first second or two isn't counted as a PageView.

**Events**
- **PageView:** the browser creates an event ID, fires the Pixel with it, and sends `/api/events` with `sendBeacon`. The server sends the same event to the Conversions API with IP, user agent, fbp and fbc.
- **ViewContent:** sent when the video pop-up opens: the Pixel, plus a GA4 `video_play` event with the video's title.
- **Lead:** after the lead is saved, using the server-returned `eventId`. The browser sends the Pixel Lead event and a GA4 `generate_lead` event. The server sends the Conversions API Lead, with the email and phone normalised and SHA-256 hashed, `external_id` set to the hashed lead ID, and fbp, fbc, IP and user agent.
- **Schedule:** after a booked or requested result.
  - [my call] "Requested" counts too: the visitor did everything a booker does.
  - The Pixel and the Conversions API share the event ID.
  - The Google Ads conversion goes to `googleAdsId/googleAdsScheduleLabel`, with enhanced-conversion user data (the email).
  - GA4 gets a `book_call` event.

**Attribution**
- utm_*, fbclid and gclid are captured on first landing.
- [my call] They are kept in the visitor's browser for 30 days, first touch wins, and sent with step 1.
- `fbc` comes from the `_fbc` cookie, or is built from fbclid.

## 13. Protected video (signed Stream links)

**The switch**
- A new setting in `site.yaml`: `settings.streamSignedUrls` (default `false` until launch).
- Signing key, kept in the environment: `STREAM_SIGNING_KEY_ID` and `STREAM_SIGNING_KEY_JWK`.
- The key is created in the user's Cloudflare account with their approval.

**Signing**
- `/api/video/[id]` returns `https://customer-<code>.cloudflarestream.com/<token>/iframe?...`.
- The token is an RS256 JWT with `sub` set to the video UID, the key ID, and an expiry 1 hour ahead [my call: long enough to watch, short enough that a copied link dies].
- It is signed locally, with no API call per view.

**Page changes**
- The video pop-up's `data-lightbox` carries only `{ videoId, orientation, title }`. On click, the pop-up fetches `/api/video/[id]` and then sets the iframe source.
- This covers portfolio cards, client videos, the hero reel and "Watch the full edit".
- Local `host: local` videos keep their file path.

**Card images**
- With signing on, Stream thumbnails need tokens too. The five client-video card images therefore become static files: `npm run media` downloads each frame at `posterTime` into `public/media/posters/t-*.jpg`.
- With approval, they are also uploaded to Cloudflare Images and listed in `images.yaml`.
- Once static files exist, nothing on a page loads an unsigned Stream thumbnail.

**At launch (Phase 3)**
- Set `requireSignedURLs` on every Stream video (a Cloudflare change, with approval) and turn `streamSignedUrls` on in the same deploy.

## 14. Configuration summary

- **`site.yaml` additions:**
  - `booking.backupUrl` (optional).
  - `tracking:` block (section 12).
  - `settings.streamSignedUrls`.
  - `turnstileSiteKey` (public).
- **New content files:**
  - `content/emails/*.yaml`.
  - `content/sections/manage-booking.yaml`: the wording on the reschedule/cancel page.
  - Additions to `booking.yaml`: network error, requested panel, backup-link note.
- **Environment** (`.env.example` lists them all, each commented):
  - Database: `DATABASE_URL`.
  - Google: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `GOOGLE_CALENDAR_ID`.
  - Email: `SMTP_*`, `MAIL_FROM`.
  - Bot check: `TURNSTILE_SECRET`.
  - Meta: `META_CAPI_TOKEN`, `META_TEST_EVENT_CODE`.
  - Video: `STREAM_SIGNING_KEY_ID`, `STREAM_SIGNING_KEY_JWK`.
  - Scheduled jobs: `CRON_SECRET`.
  - Site address: `PUBLIC_SITE_URL`, used for links in emails.

## 15. Owner workflow

- `npm run dev` with no `.env`: the site works as today, and booking shows the demo with its note.
- `HOW-TO-EDIT.md` gains short sections on the email wording files, the manage page, the tracking IDs, and the backup link.
- A separate `HOW-TO-SETUP.md` takes a non-developer through each account step:
  - Google Cloud project and Hassan's sign-in;
  - Hostinger MySQL database (and remote access for development);
  - the SMTP mailbox;
  - Meta Pixel and Conversions API token;
  - GA4 and Google Ads conversion;
  - Turnstile;
  - the Stream signing key;
  - the Hostinger cron job.

  Each step ends with the exact `.env` line to fill in and a command that checks it works (for example `npm run check:services`).

## 16. Testing

**Unit tests (fakes)**
- **Booking service:**
  - the happy path;
  - honeypot and validation;
  - Turnstile failure;
  - rate limits;
  - `slot_taken` from both the live re-check and the database's unique key;
  - Google down leading to "requested";
  - one booking per lead;
  - cancel and reschedule, including their time limits.
- **Slots:** the engine combined with busy intervals.
- **Signing:** the JWT verifies against the public key.
- **Conversions API:** payload building and hashing normalisation.
- **Email:** rendering with placeholders, and missing-placeholder errors.
- **Scheduled work:** cron selection windows, idempotency, and the 30-minute new-lead rule.

**Integration**
- The MySQL store against a real MySQL: migrations, the unique slot key under concurrent inserts, and status changes.

**Browser (Playwright)**
- **Setup:** the server runs with fake external services (calendar, mailer, Conversions API, Turnstile always passes) behind an environment flag that cannot be on in production.
- **Booking:** the full booking flow; `slot_taken`; the requested path; the manage page (cancel and reschedule).
- **Video and loading:** the video pop-up fetches its source from `/api/video`; no third-party script loads before the page's load event.
- **Budget:** the phone budget test still passes.

**Live check**
- With real accounts connected on this computer: a test booking lands in Hassan's calendar with a Meet link; the invite and both emails arrive; Meta Events Manager shows test events; GA4 DebugView shows events. Then the test booking is cancelled.

## 17. Done means (Phase 2)

- Everything above is built, the whole suite passes, and `astro check` is clean.
- A fresh reviewer agent has reviewed the branch, and its fixes are in.
- `HOW-TO-SETUP.md` is written.
- Every account the user has provided by then is connected and live-checked on this computer. Accounts not yet provided are listed as the remaining steps.
- Production stays safe without accounts: the "not connected" state never shows a fake booking.
- Moved to Phase 3:
  - the Hostinger deploy;
  - DNS and SSL Full (strict);
  - switching on signed links and allowed origins;
  - the final privacy policy and terms;
  - the production tracking IDs;
  - Cloudflare cache rules for static files, so the first visitor after Hostinger idles the app doesn't wait for a cold start.

## 18. Left to the builder

- Libraries:
  - the Google client (small package or REST);
  - the JWT signer (Node `crypto` or a small library);
  - the Turnstile widget mode;
  - how MySQL runs in tests.
- How it's put together:
  - file layout under `src/server/` (or similar);
  - the rate-limit implementation (in-memory per process is acceptable for a single Node process);
  - how the manage page reuses the slot picker.
- The visual design of the emails, within the site's brand (off-white, blue, lime accents, Archivo and Montserrat, with system-font fallbacks in email).
- Exact rate-limit numbers. Starting points: 10 leads per hour per IP, 10 bookings per hour per IP, 120 slot or video requests per hour per IP.
- The free/busy cache length (about 60 s).
- Whether `/api/events` and the Conversions API retry run inline or through the queue table.

## 19. My calls for the user to check

1. Email goes out through any SMTP mailbox. Until the professional mailbox exists, emails on this computer are saved to a folder. The live site waits for the mailbox (your answer).
2. Hassan gets a "new lead, no time picked" email 30 minutes after an unfinished step 1.
3. "I am a…" and "videos per month" become required.
4. Trackers and Turnstile load after the page; a visitor who leaves in the first second isn't counted.
5. Video links expire after 1 hour.
6. Reminders and the new-lead email run through a Hostinger cron job every 5 minutes.
7. The calendar invite shows the visitor only what to prepare. Lead details go to Hassan's email.
8. A "requested" booking also counts as a Schedule conversion.
9. Ad tags are remembered in the visitor's browser for 30 days (first touch).
10. On the live site, if booking isn't connected, the booking card shows Instagram and the backup link, never the demo.
11. Cancel works until the call starts. Reschedule works up to 1 hour before.
