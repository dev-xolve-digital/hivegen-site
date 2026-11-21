# HiveGen site: handoff (2026-11-21)

Read this first. It is for whoever continues this project, human or AI (for example Cursor).

## What this is

A sales website for **HiveGen LLC** (owner: Hassan), an outsourced real-estate video-editing company. Paid ads (Meta and Google, US only) bring visitors, and the site turns them into **booked 15-minute calls**. Visitors who don't want a call can now **send their details** instead.

Stack:
- Astro 7.4 with @astrojs/node, running as a Node server, on Node 24.
- TypeScript strict and Zod 4.
- MySQL through mysql2, emails through nodemailer.
- Google Calendar (OAuth), Cloudflare Stream, Images and Turnstile.
- Meta Pixel with the Conversions API, and GA4 and Google Ads.
- Tests: Vitest 5 (unit, jsdom) and Playwright 1.65 (browser).

## Where things stand

| Branch / PR | What | State |
|---|---|---|
| `main` | Phase 1 site, real content, Phase 2 booking, and the Send details form (PR #1–#4). `main` is `55e836a` | merged |
| PR #3 `phase-2` → `main` | Real booking: Google Calendar, MySQL, emails, reminders, reschedule/cancel page, cron, Meta/Google tracking, signed Stream links, setup guide | **merged** (closed when #4 landed, because `inquiry-form` already contained `phase-2`) |
| PR #4 `inquiry-form` → `main` | The "Send details" form (email only required), and section 05 playing the whole 60 s raw and edited videos, plus everything in #3 | **merged** |

**Merge order:** done. #4 was opened against `main` and merged; #3 closed as merged in the same step.

**Tests at handover** (all on `inquiry-form`):
- `npm test`: 941 passed
- `npm run test:db`: 22 passed
- `npx playwright test`: 195 passed, 47 skipped, 0 failed
- `npm run check`: 0 errors

Nothing is deployed yet. **No real account is connected yet**, apart from the Turnstile widget and the mailbox (see "Next steps").

## Run it

```bash
npm install
npm run dev              # http://localhost:4321 (demo booking unless .env connects real services)
npm test                 # unit tests: run from the UPPERCASE path  cd "C:/Users/DC/Desktop/HivegenLLC"  (lowercase c:\ breaks Vitest)
npm run check            # TypeScript and Astro check
npm run test:db          # store tests on a throwaway MySQL (mysql-memory-server; ~1.2 GB download, cached in %TEMP%\mysqlmsn)
npx playwright test      # browser tests; port 4322 must be free
npm run check:services   # tests each real service in .env (Google, MySQL, SMTP, Turnstile, Meta, Stream)
npm run db:migrate       # applies db/migrations/*.sql (001_init, 002_inquiries)
npm run google:connect   # Hassan's one-time Google sign-in (writes GOOGLE_REFRESH_TOKEN into .env)
npm run media            # cuts clips and posters from references/ (git-ignored; see "Known issues")
```

## Where things are

- `content/`: **every word a visitor reads**, as YAML. It is checked by `src/lib/content/schemas.ts`, and the owner edits it. Copy is never hard-coded.
  - Sections are in `content/sections/*.yaml`.
  - Emails are in `content/emails/*.yaml`.
  - The site settings are in `content/site.yaml`.
- `src/components/`: Astro components. The booking card is `Booking.astro`; section 05 is `BeforeAfter.astro`.
- `src/scripts/`: browser code.
  - The booking card: `booking-boot.ts` (start-up), `booking-ui.ts` (the call flow), `inquiry-ui.ts` (the form) and `booking-switch.ts` (the switch and its shake).
  - The bot check: `turnstile.ts`.
  - Tracking: `tracking.ts`.
- `src/server/`: the server.
  - The booking service: `booking/service.ts`.
  - Input checks: `booking/validate.ts`.
  - The stores: `store/memory.ts` and `store/mysql.ts`.
  - Emails: `mail/`.
  - Google Calendar: `calendar/`.
  - Meta: `tracking/`.
  - The scheduled job: `cron.ts`.
  - Wiring: `context.ts`.
  - Live, demo, off and fakes modes: `config.ts`.
- `src/pages/api/`: the HTTP routes, `booking/*`, `cron/run`, `events` and `video/[id]`.
- `db/migrations/`: the SQL migrations, which run when a connected server starts or through `npm run db:migrate`.
- `tests/`: `unit/`, `integration/` (MySQL), `contract/` (shared store tests) and `e2e/` (Playwright).
- `HOW-TO-EDIT.md`: **the owner's guide** to changing words, videos and images.
- `HOW-TO-SETUP.md`: **step by step guide to connecting every account and deploying** (steps 1–9, "Before you launch", "After you deploy").
- `docs/design/`: the approved designs. `docs/superpowers/plans/`: the implementation plans, plus a **ledger** for each phase that lists every decision taken and the small issues left for later:
  - `…-phase-1-ledger.md`
  - `…-phase-2-ledger.md`
  - `2026-11-21-inquiry-form-ledger.md`

## Rules: follow these

1. **Never show, print, log or commit the contact Gmail.** It is `contact.notificationEmail` in `content/site.yaml`, and Hassan's emails go to it. Tests compare it as true/false only, and `tests/unit/test-privacy.test.ts` enforces this.
2. **Never paste secrets** (passwords, tokens, keys, `.env` values) into chat, commits or docs.
   - `.env` is git-ignored.
   - The owner types secrets into `.env` and into Hostinger's hPanel themselves.
3. **No changes in Cloudflare or Hostinger without the owner's explicit OK, one request at a time.** That covers DNS, SSL, Stream, Images, Turnstile and the Hostinger app.
   - The Hostinger account also holds other clients' sites. **Touch only hivegen.co.**
4. **Don't start building without the owner's go.** For any new screen or UI, **show a screenshot or mockup first** and build after approval.
5. **All copy lives in `content/`**, checked by the schemas. The owner keeps "[confirm]" notes as YAML comments.
6. **LF line endings** only (`.gitattributes`).
7. **Keep every test suite green.** Work test-first. The call-booking flow's behaviour must not change by accident.
8. **The C: drive is small and once filled to 0 bytes.** Check free space before `npm run media` or Playwright runs. The big caches are the npm cache (about 2.8 GB) and `%TEMP%\mysqlmsn` (1.2 GB). Ask before deleting anything.
9. **How the owner works:** short messages; they like a clear recommendation, and decide quickly when one is given.

## Next steps, in order

### 1. Merge the PRs
Done. PR #4 is on `main` (`55e836a`), and PR #3 closed with it.

### 2. Connect the real accounts
Follow HOW-TO-SETUP.md, steps 1–7. The owner types every secret into `.env`.

| Account | State | To do |
|---|---|---|
| **Google Calendar** | Not done | Create a Google Cloud project and a **Desktop** OAuth client, and set the consent screen **to "In production"** before signing in. Then Hassan signs in once with `npm run google:connect`. |
| **MySQL on Hostinger** | Not done | Create a database and user, allow remote access from this PC, and put `DATABASE_URL` in `.env`. Then run `npm run db:migrate` and `npm run test:db` with `DATABASE_URL_TEST`. |
| **Mailbox (SMTP)** | Done: the owner created a professional mailbox at Hostinger and set DNS on Cloudflare (MX and SPF to Hostinger, DKIM `hostingermail-a/b/c`, DMARC p=none). `.env` has the SMTP_* settings. | Check that `connect@hivegen.co` exists at Hostinger. The footer, the email Reply-To and the DMARC reports use it, and mail no longer goes through Cloudflare's forwarder. |
| **Turnstile** | Done: the widget exists (hosts hivegen.co, localhost, 127.0.0.1), the site key is in `site.yaml` and the secret is in `.env`. | Run `npm run check:services` to confirm. |
| **Meta** | Not done | Pixel ID into `site.yaml` `tracking.metaPixelId`; `META_CAPI_TOKEN` and `META_TEST_EVENT_CODE` into `.env`. |
| **Google Analytics and Ads** | Not done | GA4 ID, Ads ID and conversion label into `site.yaml` `tracking`. |
| **Cloudflare (needs the owner's OK each)** | Not done | 1. Create the Stream signing key. 2. Upload the five client card images (`public/media/posters/t-*.jpg`) to Cloudflare Images and list them in `content/images.yaml`. |

Then run `npm run check:services` (expect ✓ on every line), make one real test booking on `npm run dev`, and cancel it through the manage link.

### 3. The owner and Hassan review some wording
- **The two inquiry emails:** `content/emails/hassan-new-inquiry.yaml` and `inquiry-received.yaml`. Confirm "usually within a day".
- **The manage page:** `content/sections/manage-booking.yaml`, especially `tooLateText`.
- **The privacy page:** `content/legal/privacy.md` still says details are used "only to arrange your call". Reword it when the final policy is written.

### 4. Phase 3: deploy to Hostinger
The owner said to go ahead with Hostinger (2026-11-21). Follow HOW-TO-SETUP.md steps 8–9. Touch only hivegen.co. Cloudflare changes (SSL mode, Stream, Images) still need a separate OK.

**The Node.js app:** Node 24, build with `npm run build`, start with `node dist/server/entry.mjs` **from the repository folder** (it reads `content/`, `public/` and `db/migrations/`).

**hPanel environment variables:** every `.env` setting, plus `NODE_ENV=production` and `PUBLIC_SITE_URL=https://hivegen.co`.

**The cron job:** every 5 minutes, `POST /api/cron/run` with the `x-cron-secret` header (step 8).

**HTTPS:**
- Today hivegen.co over HTTPS gives Cloudflare error **525**.
- Put an origin certificate on Hostinger, then switch Cloudflare SSL to **Full (strict)**. That is a Cloudflare change and needs the owner's OK.
- The DNS A record points to 141.136.39.209. Check that this is really the site's IP on Hostinger.
- SSH access to the Hostinger account was set up on this PC (`Host hivegen` in `~/.ssh/config`).

**After you deploy**, in HOW-TO-SETUP.md:
1. Make a live test booking, then reschedule and cancel it.
2. Check that `client_ip` is the visitor's real IP behind Cloudflare.
3. Test Meta Test Events and GA4 Realtime.
4. Wait for the 1-hour reminder.

**At launch:** switch on the signed video links (step 7, in order). That needs the owner's OK for "require signed URLs".

### 5. Before real ad traffic: the hardening list
None of these is built yet. Each needs the owner's go. The ledgers have the details.
- **The cron job:** an "already running" guard, so two runs can't overlap and resend emails.
- **Meta:** don't make the visitor wait for the Conversions API call (it can take up to 5 s).
- **Google Ads:** add a `transaction_id` so a booking can't count twice.
- **Cancellation email:** retry it when sending fails.
- **"Requested" bookings:** a note on the manage page saying Hassan confirms by hand.
- **Duplicate leads:** de-duplicate a lead re-sent after a browser timeout, in the call flow.
- **Rescheduling:** a guard on the undo step (log the failure and answer an error).
- **Booking emails:** in `book()`, mark each email right after it goes out. The form already does this.
- **A live test:** one run against real MySQL, Google and SMTP.
- **Phone checks:** the manage page at phone width, autoplay on iPhone, and section 05 on a **slow, throttled connection**.

## Known issues and notes

- **The source videos are missing locally.** `references/final-videos/Portrait/` and `Landscape/` are empty on this PC; the copies on Cloudflare Stream are fine. A full `npm run media` stops at the first missing source. Restore the files before rebuilding card images or the hero loop. Section 05's sources are still there.
- **Section 05:** the edited video is a re-cut, so the two slider sides show different rooms for much of the minute. The owner chose this knowingly.
- **"One visitor, one lead"** holds for call-then-form in the same tab. Form-then-call counts two Meta leads, which was accepted.
- **Two rare test flakes:** "the visitor's ad tags reach the lead" (a timeout under 4 workers) and one `ECONNRESET` on `/api/test/outbox`. Both pass when run again.
- **The ledgers** list about 45 small deferred items for this work, plus Phase 2's. None blocks a merge.
