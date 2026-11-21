# SDD ledger — plan: docs/superpowers/plans/2026-11-19-hivegen-site-phase-2.md
Spec: docs/design/2026-11-19-phase-2-design.md (approved 2026-11-19; user answers: live site waits for a sending mailbox; invite may show Hassan's Gmail).
Execution: subagent-driven (user chose it 2026-11-19). Workspace isolation: branch phase-2 in the main working tree (not main), same as Phase 1; no separate worktree (Windows, node_modules in place).
Environment notes for every dispatch: run Vitest from `C:\` (uppercase drive letter: cd "C:/Users/DC/Desktop/HivegenLLC"), Python edits with newline='', LF line endings (.gitattributes), never paste or print the contact Gmail.

## Pre-flight scan
| Pair / task | Produces vs consumes | Found |
|---|---|---|
| T1↔T7 | config route (T1) → T7 switches it to getContext | consistent |
| T1↔T8/T12 | settings.turnstileSiteKey, settings.streamSignedUrls | consistent |
| T1↔T13 | .env.example created / completed | consistent |
| T2↔T3 | service.ts; T3 moves test setup to tests/unit/helpers/booking.ts | consistent |
| T2↔T4 | Store interface + tests/contract/store.contract.ts | consistent |
| T2↔T5 | Calendar, CalendarUnavailableError | consistent |
| T2↔T6 | EmailKind, EmailData, Notifier | consistent |
| T2/T3↔T11 | Tracker/ServerEvent; Lead + Schedule sent by service | consistent |
| T3↔T9 | getManaged/cancel/reschedule | consistent |
| T3↔T10 | reminder + *NotifiedAt fields | consistent |
| T4↔T7 | createPool/runMigrations/createMysqlStore | consistent |
| T5↔T7, T5↔T13 | createGoogleCalendar; google-connect | consistent |
| T6↔T7 | outbox sent[] with tag → /api/test/outbox | consistent (after design-answer update) |
| T7↔T8/T9 | routes; tests/e2e/booking-flow.spec.ts (serial, desktop) | T7/T8 Files lists missed booking-flow.spec.ts → fixed in plan |
| T7↔T10/T11/T12 | handlers.ts gains cron/events/video handlers | T11 Files list missed handlers.ts → fixed in plan |
| T8↔T9 | renderSlotPicker | consistent |
| T8↔T11 | initBooking onLead/onSchedule hooks; Booking.astro | consistent |
| T11↔T12 | lightbox.ts (trackViewContent, then fetch) | consistent, sequential |
| T10↔T11 | retryTracking → meta tracker resend | consistent |
| T1 self | webServer reuseExistingServer: true would silently reuse a stale build | Ruling below |
| T2–T14 self | tests vs code vs files | consistent; test bodies marked "..." are for the implementer to write |
Pre-flight: Ruling: T1 sets playwright reuseExistingServer:false — a leftover node server on 4322 would otherwise serve an old build silently — cost if wrong: a stale server must be stopped by hand before e2e runs.
Pre-flight: Ruling: T7/T8 Files lists gain tests/e2e/booking-flow.spec.ts; T11 Files gains src/server/http/handlers.ts — the steps already used them — cost if wrong: none.
Task 1: dispatched (BASE f4477b4, implementer, model sonnet)
Task 1: implementer DONE (616a428). Concerns noted: (1) runtime routes read content/ and public/ from the working directory — the Hostinger app must run from the repo root (carry to T7 context + T13 HOW-TO-SETUP); (2) siteUrl used as typed — later link-building (T3 manageUrl, T6 emails) must strip a trailing slash (carry to T3/T6 dispatch); (3) extras (blank env = unset, SMTP_PORT 1–65535, BOM strip) left for the reviewer; (4) npm audit: image-size <=2.0.2 DoS advisory (JXL/HEIF/ICNS infinite loops), fix 2.1.0 non-major.
Ruling: bump image-size to 2.1.0 inside Task 4 (it already edits package.json deps) — build-time use on our own images only, so no urgency — cost if wrong: none.
Task 1: review dispatched (sonnet, package review-f4477b4..616a428.diff)
Ruling (amends the image-size ruling): bump to image-size 2.0.4, not 2.1.0 — 2.0.4 is outside the advisory range (<=2.0.2) and two months old (2026-09-14), while 2.1.0 is 13 days old — cost if wrong: npm audit may still flag it, in which case use 2.1.0.
Task 1: review: spec ✅; Important 1 (config route runs loadSite() per request; 500 in "off" mode if content/public missing) → fix round 1 sent to implementer.
Task 1: minor (deferred): NODE_ENV/HIVEGEN_FAKES compared raw (no trim/lowercase) in config.ts:853-854 — "production " would read as non-production.
Task 1: minor (deferred): env.ts BOM regex uses a literal invisible U+FEFF; write \uFEFF.
Task 1: minor (deferred): loadDotEnv's bare catch swallows EACCES/EISDIR, not just ENOENT.
Task 1: minor (deferred): ".env loaded once" lives in one route module — T7 must route all access through one shared accessor (getContext) that calls loadDotEnv. [carry to T7]
Task 1: minor (deferred): fakes mode still returns real credentials from .env — T7 context must branch on mode and never wire real services in fakes. [carry to T7]
Task 1: minor (deferred): siteUrl not trimmed of a trailing slash — link builders (T3 manageUrl, T6 emails) must join safely. [carry to T3/T6]
Task 1: minor (deferred): untested: route non-fakes branch, GOOGLE_CALENDAR_ID override, partial Google creds, clientMode for full production config.
Task 1: minor (deferred): adapter logs "Enabling sessions with filesystem storage" — confirm nothing is written at runtime or silence it.
Task 1: note: NODE_ENV unset counts as non-production (brief-mandated: readServerConfig({}) → demo) — T13 deploy checklist must set NODE_ENV=production; T7 should log a startup warning when PUBLIC_SITE_URL is a real host but NODE_ENV isn't production. [carry to T7/T13]
Task 1: fix round 1 implemented (606555b: bookingConfigResponse + loadTurnstileSiteKey, key read only in live) — scoped re-review dispatched (sonnet)
Task 1: fix round 1/5 (1 addressed, 0 open — config route no longer runs loadSite(); commits 616a428..606555b)
Task 1: minor (deferred): live-mode config route re-reads site.yaml per request (no memo) and logs on every request if unreadable — config.ts:68-76.
Task 1: complete (commits f4477b4..606555b, review clean after 1 fix round)
Task 2: Ruling: ServiceDeps gains `volumeOptions: string[]` (from booking.yaml at wiring time), like calendarCopy — the lead validator needs the content's volume choices and the brief's deps list has no source for them — cost if wrong: one extra field to remove.
Task 2: Ruling: verifyTurnstile gets its own small unit tests in Task 2 (fake fetch: success, failure, network error → false) — the brief defines it but lists no test — cost if wrong: none.
Task 2: dispatched (BASE 606555b, model sonnet)
Task 2: implementer (sonnet), BASE 606555b
Task 2: implementer DONE_WITH_CONCERNS (2f84682) — concerns are decisions, proceeding to review: leadInputSchema is a factory(volumeOptions); bookingInputSchema canonicalises start to UTC and maps unknown visitorTz → 'UTC'; unknown attribution keys are dropped (not rejected); turnstileToken capped at 2048; verifyTurnstile false on non-2xx, 5 s timeout; extra tests turnstile.test.ts + fake-calendar.test.ts.
Task 2: store contract semantics fixed for T4: range queries half-open [from,to); getActiveBookingForLead returns the newest active; updateLead/updateTrackingEvent on unknown id are no-ops. [carry to T4]
Task 2: test setup() lives in tests/unit/booking-leads.test.ts (sent is EmailKind[]) — T3 moves it to tests/unit/helpers/booking.ts. [carry to T3]
Task 2: review dispatched (sonnet, review-606555b..2f84682.diff)
Task 2: review: spec ✅, quality Approved, 0 Critical/Important.
Task 2: Ruling: attribution keeps only the seven known keys by stripping unknown ones (not rejecting) — the spec's "only the seven known keys" is met, and rejecting would lose a paid lead over a stray ad-tag — cost if wrong: one-word change to strict.
Task 2: minor (deferred → T3): bookingInputSchema accepts a start without Z/offset (server-local parse) — require Z or an offset.
Task 2: minor (deferred → T3): empty leadId/start give 'invalid' while lead fields give 'required' — pick one rule.
Task 2: minor (deferred → T3): service.ts:127-131 comment's reason is wrong (min notice makes the lookback moot); isActive logic duplicated service.ts vs memory.ts — share a small helper (not in types.ts).
Task 2: minor (deferred → T7/T11): missing sourceUrl becomes '' — T7 passes Referer or siteUrl so it is never empty.
Task 2: minor (deferred → T4): store contract doesn't pin newest-active-per-lead, updateBooking-unknown-id throws vs no-op elsewhere, undefined-in-patch ignored — add contract cases in T4.
Task 2: minor (deferred → T3): booking-leads.test.ts:872-880 asserts the "not implemented" stub — delete when book exists.
Task 2: minor (deferred): verifyTurnstile 5 s timeout untested.
Task 2: minor (deferred → T3): name accepts control characters (CR/LF) that later reach the invite title and email subjects — reject control characters in validation.
Task 2: complete (commits 606555b..2f84682, review clean)
Task 3: Ruling: T3 also takes the T2 carry-overs above (start must carry Z/offset; one empty-value rule; shared isActive helper + fixed comment; delete stub test; reject control characters in name) — they sit in the files T3 already changes — cost if wrong: small extra diff.
Task 3: dispatched (BASE 2f84682, implementer sonnet; reviewer will be opus)
Task 3: implementer (sonnet)
Task 3: implementer DONE_WITH_CONCERNS (4a1e1c0; 145 unit tests, 6 mutation checks) — concerns: (1) updateBooking: key present with undefined = clear (NULL), missing key = keep; pinned in the store contract — MySQL must match [carry to T4; reviewer to weigh vs a null-for-clear types change]; (2) rescheduling requested/cancelled → too_late; (3) reschedule re-checks Google busy on the new slot (busy → slot_taken; unreachable → server_error before any change); (4) createEvent error after the slot is saved → requested; (5) same lead, two simultaneous confirms for different starts could both pass.
Task 3: Ruling (concern 5): T4 adds "one active booking per lead" to both stores (MySQL unique key on an active-lead column; memory store mirrors it; contract case), raising SlotConflictError; the service, on SlotConflictError, returns the lead's active booking if one now exists, else slot_taken — closes the race without new error types — cost if wrong: a second click for a different time sees the first booking instead of an error.
Task 3: review dispatched (opus, review-2f84682..4a1e1c0.diff)
Task 3: review hit the account usage limit mid-run; resumed the same reviewer after the user said go on
Task 3: review (opus): spec ✅; Important 1 (store patch "undefined clears" rule is a trap; status:undefined frees a slot); Important 2 (same-lead concurrent confirms: second gets slot_taken for a held slot, or an in-flight "booked" without a Meet link — plan-mandated by brief steps 3 and 6).
Task 3: Ruling (Important 1): BookingPatch changes in types.ts — missing/undefined keeps (same as updateLead/updateTrackingEvent); explicit null clears, allowed only for googleEventId, meetUrl, reminder24hSentAt, reminder1hSentAt, visitorNotifiedAt, hassanNotifiedAt; documented on Store.updateBooking; shared-types.md and the plan's Shared types block updated to match — conventional, maps to SQL NULL, and the compiler stops accidental clears of status/start/end — cost if wrong: small rework in T3 code and the contract case.
Task 3: Ruling (Important 2, amends brief step 6): insert the booking as 'requested' (it holds the slot), create the event only when the re-check found the calendar free, and promote to 'booked' with googleEventId+meetUrl only after createEvent succeeds; on SlotConflictError re-read the lead's active booking and return it if present, else slot_taken; the concurrent test asserts both results (second: ok with the same manageUrl, never slot_taken, never 'booked' without a Meet link) — never shows "booked" before an event exists, and a crash mid-booking leaves a 'requested' row that cron's email retry turns into "please confirm by hand" — cost if wrong: a duplicate confirm landing mid-flight shows the requested panel although the booking completes.
Task 3: carry: T10 cron email retry skips bookings younger than 2 minutes (book may still be finishing). T8/T9 UI disables Confirm/Cancel/Reschedule while a request is in flight. T5 cancelEvent treats an already-gone event as success (already in T5 brief).
Task 3: minor (deferred): reschedule rollback (service.ts:275-277) unguarded — a throw leaves row and event out of step with no log; wrap, log, return server_error.
Task 3: minor (deferred): concurrent cancels/reschedules of one booking can double-send emails or race the rollback — UI guard (T8/T9) + possible compare-and-set later.
Task 3: minor (deferred): {name} is filled into the invite description too; only {manageUrl} should be (or guard {name} out of description in the content test).
Task 3: minor (deferred): three "not an offered slot" test cases are rejected by the window/day rule, not the rule they name (booking-book.test.ts:85-89).
Task 3: minor (deferred): duplicated logic — service overlaps() restates slots.ts busy rule; withoutUndefined duplicates memory.ts defined().
Task 3: minor (deferred): 4 pre-existing toThrowError hints in content.test.ts.
Task 3: fix round 1 sent to implementer (Important 1 + 2 with rulings); FIX_BASE for re-review = 4a1e1c0 (the plan-doc commit ed3b1cf sits on top)
Task 3: fix round 1 implemented (c08d7e3; 147 unit tests) — scoped re-review dispatched (sonnet, review-4a1e1c0..c08d7e3.diff)
Task 3: fix round 1/5 (2 addressed, 0 open — null-clears BookingPatch; requested-then-promote + conflict re-read; commits 4a1e1c0..c08d7e3)
Task 3: minor (deferred): promotion to 'booked' (service.ts:195) doesn't check the row is still 'requested' — a cancel inside the createEvent window could be revived; guard: promote only if still requested (compare-and-set) in a later hardening pass.
Task 3: complete (commits 2f84682..c08d7e3, review clean after 1 fix round)
Task 4: carry: image-size → 2.0.4 (ruling above) + npm audit; contract cases from T2 review (newest active per lead; updateBooking unknown id throws while updateLead/updateTrackingEvent no-op); one active booking per lead in both stores (T3 ruling) raising SlotConflictError; MySQL patch semantics (missing/undefined keeps, null clears clearable fields); half-open ranges.
Task 4: dispatched (BASE c08d7e3, implementer sonnet)
Task 4: implementer (sonnet)
Task 4: implementer DONE_WITH_CONCERNS (2a89d6c; unit 153, test:db 17 on real MySQL 8.4.9 via mysql-memory-server; DATABASE_URL_TEST path also works; npm audit 0; 9 mutations killed) — concerns: (1) types.ts/shared-types still describe insert/update conflicts as start-only — should say "or the lead already has an active booking" (doc comment); (2) only MySQL 8.4 tested; schema kept portable (no JSON type, generated columns or CHECK) — run DATABASE_URL_TEST=<Hostinger db> npm run test:db before launch [carry to T13/T14]; (3) client_ip is VARCHAR(64): T7 passes a validated IP; one pool per process; runMigrations once at start [carry to T7]; (4) added src/server/booking/patch.ts (shared patch application for both stores).
Task 4: review dispatched (sonnet, review-c08d7e3..2a89d6c.diff). Note: a pre-existing mysqld (PID 4892, started 2026-11-18 23:41, before this session) runs on this machine — likely the user's own MySQL service and possibly the 'second MySQL' the implementer used for DATABASE_URL_TEST; left untouched.
Task 4: review: spec ✅, quality Approved, 0 Critical/Important; npm audit verified 0.
Task 4: minor (deferred): mysql.ts:155 hard-codes active statuses (use active_lead_id = ?, drop ORDER BY/LIMIT).
Task 4: minor (deferred): mysql.ts:148 rollback().catch(()=>{}) then release — destroy the connection when rollback fails.
Task 4: minor (deferred): migrate.ts:48-50 RELEASE_LOCK in finally can mask the original migration error.
Task 4: minor (deferred): defined() duplicated in memory.ts and mysql.ts — move next to applyBookingPatch.
Task 4: minor (deferred): concurrency contract covers only two racing inserts — not two updateBooking moves onto one start, or move vs insert.
Task 4: minor (deferred): stores differ on duplicate publicId/manageToken and unknown lead (memory accepts; MySQL raw error) — no contract case; memory compares starts as strings, MySQL as instants (latent).
Task 4: minor (deferred → T7): types.ts:31-32 + shared-types say SlotConflictError is only for a taken start — add "or the lead already has an active booking".
Task 4: minor (deferred → T7/T13): runMigrations default dir 'db/migrations' is cwd-relative — T7 must run the server from the repo root or resolve the path; db:migrate needs tsx (dev dep) — production migrates at server start (T7) instead.
Task 4: minor (deferred): deadlock (1213) on simultaneous cross-swaps not retried (extremely rare).
Task 4: complete (commits c08d7e3..2a89d6c, review clean)
Task 5: dispatched (BASE 2a89d6c, implementer sonnet)
Task 5: implementer (sonnet)
Task 5: implementer DONE (a9308dd; 199 unit tests, 46 new; 7 mutations killed; script exercised with stubs). Deviation: consentUrl/exchangeAuthCode/GOOGLE_SCOPES/CONNECT_REDIRECT_URI live in google.ts (script runs on import); consentUrl takes optional state, checked on callback.
Task 5: carry → T13: consent screen must be "In production" (Testing → refresh token dies in 7 days → every booking "requested" with invalid_grant); OAuth client type Desktop app (or add http://127.0.0.1:53682/callback); T13 check:services should name invalid_grant clearly.
Task 5: concern for review: freeBusy response key for 'primary' unverified against live Google — busy() fails closed (all bookings requested) if Google keys by the email address instead.
Task 5: note: a timeout after Google created the event leaves an orphan event; the booking stays requested (Hassan sees both).
Task 5: review dispatched (sonnet, review-2a89d6c..a9308dd.diff)
Task 5: review: spec ✅, quality Approved, 0 Critical/Important.
Task 5: Ruling: Minor 1 (freeBusy key) and Minor 2 (non-object JSON → raw TypeError) are carried into T7 as small hardening in google.ts with tests — busy() falls back to the only calendar in the response when calendars[id] is absent (we sent exactly one id); readJson rejects non-objects as CalendarUnavailableError — a silent "every booking requested" in production is too costly to leave to the go-live check alone — cost if wrong: a few extra lines.
Task 5: minor (deferred → T6): Google may return no Meet link on insert (conference pending) — emails must read correctly without one (button omitted; text points to the calendar invite).
Task 5: minor (deferred): unconsumed response bodies on 401/non-ok (res.body?.cancel()).
Task 5: minor (deferred): worst-case latency per adapter call up to ~4 x 8 s (no overall deadline).
Task 5: minor (deferred): orphan event if the createEvent timeout fires after Google created it — idempotent client event id would fix (needs a plan decision).
Task 5: minor (deferred): upsertEnvLine misses `export KEY=`/`KEY = `/BOM forms (appends a duplicate; later wins); .env write not atomic.
Task 5: minor (deferred): sign-in helpers live in the production adapter module; error-word regex duplicated.
Task 5: minor (deferred → T13): consent screen "In production" note in the script output and HOW-TO-SETUP.
Task 5: complete (commits 2a89d6c..a9308dd, review clean)
Task 6: Ruling: Reply-To comes from content — site.yaml contact gains `replyTo: connect@hivegen.co` (schema-validated) — an address the owner may change when the professional mailbox exists — cost if wrong: none.
Task 6: dispatched (BASE a9308dd, implementer sonnet)
Task 6: implementer (sonnet)
Task 6: implementer DONE with concerns (6f3250e; 244 unit tests, 45 new; 11 mutations killed; npm audit 0). Concerns: (1) added {change} placeholder for Hassan's emails (hassan-booking-changed subject needs it); (2) allowed-but-valueless placeholders fail only at render time (all kinds rendered in tests); (3) button placed after the sign-off; (4) {buyerType} shows the stored value ('agent'), not the booking.yaml label; utm_campaign without utm_source reads "direct"; (5) mailers don't log the outbox path — T7 can log it [carry to T7]. Shared manageUrl() now in src/server/booking/links.ts (service uses it).
Task 6: Ruling: keep the {change} placeholder for Hassan's emails — the one "changed" email covers cancel and reschedule and its subject must say which — cost if wrong: none.
Task 6: review dispatched (sonnet, review-a9308dd..6f3250e.diff)
Task 6: review: spec ✅; Important 1 (hassan-booking-changed says "Your Google Calendar is already up to date" — false for a cancelled requested booking Hassan added by hand) → fix round 1 sent to implementer.
Task 6: minor (deferred → T7): an allowed-but-valueless placeholder throws only at send time — add a startup/build check rendering every kind with representative values (with/without Meet link).
Task 6: minor (deferred): many email tests assert the live copy (email.test.ts:172-181, 246-265, 306-343) — a copy edit by the owner fails the suite; use tempContent with fixed wording.
Task 6: minor (deferred): booking-requested.yaml:4 comment uses "# [confirm: …]" form; name the actual claim.
Task 6: minor (deferred): kind.startsWith('hassan-') in three places — one isHassanKind.
Task 6: minor (deferred): src/lib/content/load.ts imports a type from src/server (type-only).
Task 6: minor (deferred): button URL only HTML-escaped (not scheme-checked like inline links).
Task 6: minor (deferred): booking-confirmed has the button after the sign-off plus an inline manage link (three links).
Task 6: minor (deferred): Hassan's reschedule email doesn't show the old time ({previousWhen} unused).
Task 6: minor (deferred): content files read 2-3 times per send.
Task 6: minor (deferred): default-folder outbox test writes into the repo's real .outbox.
Task 6: note: outbox file names use dashes instead of colons in the ISO time (Windows) — T7/e2e must expect that pattern.
Task 6: fix round 1 implemented (f356795: wording only + test) — scoped re-review dispatching
Task 6: scoped re-review dispatched (sonnet, review-6f3250e..f356795.diff)
Task 6: fix round 1/5 (1 addressed, 0 open — hassan-booking-changed wording; commits 6f3250e..f356795)
Task 6: note for final review: re-reviewer says booking-rescheduled.yaml:12 promises "the Google Meet link is in your updated calendar invite" and claims a requested booking can be rescheduled (service.ts:272); Task 3 says rescheduling a requested booking returns too_late — verify; if refused, the wording is fine.
Task 6: complete (commits a9308dd..f356795, review clean after 1 fix round)
Task 7: carry list given to the implementer: one shared accessor (getContext → loadDotEnv once); fakes never wire real services; startup warning when PUBLIC_SITE_URL is a real host but NODE_ENV isn't production; validated client IP (≤64 chars); one pool per process + runMigrations once (cwd = repo root; resolve dir); sourceUrl = Referer or siteUrl; types.ts doc comment for SlotConflictError (taken start or lead already has an active booking); google.ts hardening (busy() single-calendar fallback; readJson rejects non-objects) with tests; log the outbox file path; build-time email-template check (render every kind with representative values; fails the build naming the file), called next to assertNoSamplesInProduction.
Task 7: dispatched (BASE f356795, implementer sonnet)
Task 7: implementer (sonnet)
Task 7: implementer hit the account 5-hour limit mid-run (resets 21:10 PKT); resumed the same agent after the user said go on
Task 7: implementer DONE_WITH_CONCERNS (8e40268 google.ts hardening + types.ts comments; 13add09 HTTP layer/wiring/routes/build-time email check; unit 333, Playwright 122 passed + 18 phone skips, 12 mutations killed). Concerns: (1) live success path untested automatically — go-live run (T14); (2) a live setup that fails at startup (DB down) stays not_connected until restart → config "off" in production (reviewer to weigh: retry after a cooldown?); (3) site.yaml/booking.yaml read once at startup — restart to see edits on a running live server [carry to T13 docs]; (4) extras: limits on context, loadBookingSite(), limiter maxKeys, reset() deletes .outbox/test; fakes Hassan address hassan@example.test.
Task 7: review dispatched (sonnet, review-f356795..13add09.diff)
Task 7: review: spec ❌ (a rejected getContext() escapes guarded(): bare 500, no JSON/no-store; /config taken down by a content error); Important 2 (DB blip at first start → not_connected cached forever; retry after ~60 s cooldown, single-flight, background rebuild); Important 3 (no request-body cap: ~32 KB, streamed byte cap, 400 invalid) → fix round 1 sent to implementer.
Task 7: minor (deferred → T13/T14): live success path (real MySQL/Google/SMTP) has no automated test — optional integration smoke test with mysql-memory-server + stubbed Google; explicit go-live checklist item.
Task 7: minor (deferred): five handlers repeat the service/rate-limit boilerplate — a serviceRoute() helper.
Task 7: minor (deferred → T11): Referer passed raw (no length cap) — cap ~2000 chars or fall back to siteUrl before it reaches Meta.
Task 7: minor (deferred → T14): no valid IP → every visitor shares one 'unknown' bucket; Astro's clientAddress throws when the adapter has no address — verify on Hostinger at deploy; CF-Connecting-IP is forgeable unless the origin is reachable only via Cloudflare.
Task 7: minor (deferred → T13 docs): "startup" logs fire on the first API request, not at process start.
Task 7: minor (deferred): reasonOf logs up to 300 chars of the mysql2 message (includes DB user/host on access-denied).
Task 7: minor (deferred → T9): fakes siteUrl defaults to :4321 while Playwright serves :4322 — set PUBLIC_SITE_URL in the webServer command before T9's manage-link tests.
Task 7: minor (deferred): non-object JSON body tested for leads only.
Task 7: minor (deferred): no content-type check (text/plain simple cross-origin POSTs accepted; bot check and manage token limit damage).
Task 7: fix round 1 implemented (0addd3d: withContext + catch-all createContext; 60 s background single-flight retry; 32 KB body cap) — scoped re-review dispatching
Task 7: scoped re-review dispatched (sonnet, review-13add09..0addd3d.diff)
Task 7: fix round 1/5 (3 addressed, 0 open — withContext + catch-all createContext; 60 s background single-flight retry; 32 KB body cap; commits 13add09..0addd3d)
Task 7: minor (deferred): context.ts:150 labels any live-startup failure "the database could not be used" (inner reason still logged).
Task 7: minor (deferred): an over-cap chunked body mid-read may get a dropped connection rather than the 400 (reader.cancel); declared-length case delivers 400.
Task 7: minor (deferred): JSON body reader no longer strips a UTF-8 BOM.
Task 7: minor (deferred): failedAt uses Date.now() rather than the provider's clock.
Task 7: complete (commits f356795..0addd3d, review clean after 1 fix round)
Task 8: carry: disable Confirm (and the step-1 submit) while a request is in flight [T3]; set PUBLIC_SITE_URL=http://127.0.0.1:4322 in the Playwright webServer command so manage links point at the test server [T7 minor].
Task 8: dispatched (BASE 0addd3d, implementer sonnet)
Task 8: implementer (sonnet)
Task 8: implementer DONE_WITH_CONCERNS (eb29a8c; unit 424, Playwright 137 passed + 25 phone skips; phone initial JS 6.1 KB gz; 4 mutations killed). Concerns: (1) added copy keys errors.phone and errors.footage; (2) extra file src/scripts/booking-boot.ts (lazy loading + early-submit hold, unit-tested); (3) Back→Next with unchanged details reuses the lead; _fbp/_fbc cookies sent with the lead; demoNote reworded; (4) no fetch timeouts — a hung server leaves the Next button disabled (reviewer to weigh); (5) a failed config fetch or unknown mode shows the offline card.
Task 8: review dispatched (sonnet, review-0addd3d..eb29a8c.diff)
Task 8: review: spec ❌ (ruling 4: three.spec.ts loads the real Cloudflare script; unreachable copy promises an email that isn't sent); Important 1 (no fetch timeouts → dead Next button); 2 (Turnstile load failure permanent while copy says retry); 3 (unreachable false promise); 4 (real Cloudflare calls in e2e) → fix round 1 sent to implementer.
Task 8: minor (deferred): a transient config failure shows the offline card for the page view (one retry on a thrown fetch is cheap) — partly addressed by Important 1's readConfig retry.
Task 8: minor (deferred → T13/T14): live with no turnstileSiteKey shows a form that always 403s — treat as off, or make check:services/go-live verify the site key is set.
Task 8: minor (deferred): failed slot reload after slot_taken swallowed (.catch(()=>{})) — stale list, disabled Confirm, no hint.
Task 8: minor (deferred): focus lost on Back (Back button hidden; focus not moved to step 1).
Task 8: minor (deferred): a too-long name shows "Please enter your name." (FIELD_OF_SERVER maps too_long to the required message).
Task 8: minor (deferred): honeypot value trimmed (whitespace-only reads empty).
Task 8: minor (deferred): noValidate/submit-enable set in both booking-boot.ts and booking-ui.ts.
Task 8: minor (deferred): e2e gaps — no deep-link (#book at load) lazy test, no full early-submit-through-hold test, fixed waitForTimeout(1500).
Task 8: minor (deferred, plan-mandated cosmetic): demo manageUrl '#book' shows a "Reschedule or cancel" link that goes nowhere.
Task 8: fix round 1 implemented (f8b5497: 15 s fetch timeouts + config 10 s x2 → off; Turnstile re-inject + Instagram in botCheck; errors.confirm + reworded unreachable; e2e fixtures.ts auto-stub + Cloudflare guard + unit check that specs import it) — scoped re-review dispatching. Concern: a lead POST that times out after reaching the server can be retried → duplicate lead (deferred).
Task 8: minor (deferred): duplicate leads possible when a lead POST times out after the server stored it and the visitor retries (server-side dedupe by email within minutes, later).
Task 8: scoped re-review dispatched (sonnet, review-eb29a8c..f8b5497.diff)
Task 8: fix round 1/5 (4 addressed, 0 open — timeouts; Turnstile reload + Instagram; honest failure copy; e2e Cloudflare guard; commits eb29a8c..f8b5497)
Task 8: minor (deferred): turnstile.ts:61 a script that "loads" without defining window.turnstile makes render() throw; later getToken calls append another script each (10 s wait each).
Task 8: minor (deferred): api-client test "15 second limit" doesn't pin the 15 s value.
Task 8: minor (deferred): duplicate lead on a timed-out-but-stored createLead retry can also draw a stray T10 new-lead email (dedupe later).
Task 8: minor (deferred): e2e-fixtures.test.ts only matches single-quoted '@playwright/test' imports.
Task 8: note: T10 must ship before go-live — the unreachable copy ("we'll be in touch by email") relies on the 30-minute new-lead email.
Task 8: complete (commits 0addd3d..f8b5497, review clean after 1 fix round)
Task 9: Ruling: the manage-page axe check goes in tests/e2e/booking-flow.spec.ts (serial, desktop) instead of quality.spec.ts — it needs a real booking, and only booking-flow.spec.ts may change server state — cost if wrong: none (phone axe for that page not covered).
Task 9: carry: disable Cancel/Reschedule while a request is in flight [T3]; reuse the api-client timeout pattern (15 s) for manage calls; specs import `test` from tests/e2e/fixtures.ts.
Task 9: dispatched (BASE f8b5497, implementer sonnet)
Task 9: implementer (sonnet)
Task 9: implementer committed cfb88e0 then hit the account 5-hour limit (resets 02:40 PKT); resumed to finish verification + report after the user said continue
Task 9: implementer DONE_WITH_CONCERNS (cfb88e0; unit 477, Playwright 154 passed + 38 skipped; 3 mutations killed). Concerns: (1) extra files src/components/ManageBooking.astro and src/server/booking/manage-view.ts (maps getManaged to page-safe data); (2) out-of-brief fixes: slot-picker day buttons axe label-content-name-mismatch (also on booking step 2) + slot-picker.test.ts; flaky fillDetails radio click in booking-flow.spec.ts now clicks the visible pill (30 runs pass); (3) BaseLayout loads site.yaml at request time on this on-demand page (needs content/ + public/ in cwd, as context.ts assumes); (4) manage-booking.yaml wording written by the implementer — Hassan may review [carry to final report].
Task 9: review dispatched (sonnet, review-f8b5497..cfb88e0.diff)
Task 9: review: spec ✅, quality Approved, 0 Critical/Important.
Task 9: minor (deferred): failed slot load leaves the panel open with stale picker; Reschedule toggles closed (two presses to retry); chosen not cleared on close/failure (old selection re-enables Confirm under the error).
Task 9: minor (deferred): focus falls to body after slot_taken (Confirm disabled) — focus the error or first day.
Task 9: minor (deferred): a reschedule whose reply was lost (timeout after the server moved it) retries into slot_taken while the page shows the old time.
Task 9: minor (deferred): no loading state (aria-busy) while slots load.
Task 9: minor (deferred): [token].astro imports kindOf from the HTTP handlers module — move logging helpers to server/log.ts.
Task 9: minor (deferred): axe only on the booked state; no phone-width check for the manage page; double-click e2e relies on a fixed 400 ms route delay.
Task 9: minor (deferred): unexplained `.manage [hidden]{display:none!important}` in site.css.
Task 9: note for final report: manage-booking.yaml wording (esp. tooLateText's Instagram promise) is the implementer's — Hassan to review.
Task 9: complete (commits f8b5497..cfb88e0, review clean)
Task 10: carry: email retry skips bookings younger than 2 minutes (book may still be finishing) [T3]; requested bookings get no reminders; cron route via withContext, no-store, 401 wrong/missing secret (constant-time compare), 503 not connected; retryTracking wired as a no-op returning false until T11.
Task 10: dispatched (BASE cfb88e0, implementer sonnet)
Task 10: implementer (sonnet)
Task 10: implementer DONE (c261d6c; cron.test 27, unit 504, 11 mutations killed; built server checked: 401 no-store on bad secret; npm run cron OK). Playwright 153 passed / 1 failed: clients.spec.ts "the rows only move while they are on screen" (marquee timing; passes alone 8/8) — flaky, unrelated.
Task 10: carry → T11: cron records tracking attempts itself (attempts+1, 'sent' on success) — the Meta tracker's resend(r) must only send and return a boolean, never update the record.
Task 10: notes: 1h reminder has no createdAt condition (brief) — a call booked ~60–65 min ahead gets it within 5 min of confirming; a store failure between a send and its mark can duplicate that email on the next pass; ServerContext gained runScheduled (null without service); fakes has no CRON_SECRET → cron route 503 in e2e.
Task 10: minor (deferred → final review): flaky e2e clients.spec.ts "the rows only move while they are on screen" (marquee timing) failed once in a full run.
Task 10: review dispatched (sonnet, review-cfb88e0..c261d6c.diff)
Task 10: review: spec ✅; Important (trySend/logFailure/status→email-kind duplicated between cron.ts and service.ts) → fix round 1 sent to implementer.
Task 10: Ruling (plan-mandated minor vs spec): reschedule to a start < 24 h away sets reminder24hSentAt = now (suppressed) instead of null — otherwise a "24 hours" reminder arrives right after the reschedule email, contradicting "reminders 24 hours before" — included in fix round 1 with tests (+ the exact start−1h edge test) — cost if wrong: none.
Task 10: minor (deferred): no test makes a reminder send fail (unset mark, retry, loop continues); no single booking run through 24h then 1h across passes.
Task 10: minor (deferred): scripts/cron.ts reading CRON_SECRET from .env not tested (empty cwd).
Task 10: minor (deferred): per-send isolation only — a throw from a mark write aborts the pass; a persistently failing mark resends every pass (poison pill) — wrap each mark.
Task 10: minor (deferred → final review): no overlap guard — a pass slowed by a hanging mailbox can overlap the next and resend unmarked emails; add an in-process "already running" flag.
Task 10: minor (deferred): trackingEventsByStatus('failed') reads all failed records every pass, growing forever (exhausted ones stay failed) — cap/age filter later.
Task 10: minor (deferred): if/else-if over disjoint reminder windows hides the invariant; runScheduledWork is one 85-line function.
Task 10: minor (deferred): scripts/cron.ts follows redirects (http→https turns POST into GET) — use an https PUBLIC_SITE_URL.
Task 10: fix round 1 implemented (6241d02: src/server/booking/emails.ts shared by service + cron; reschedule <24h marks reminder24hSentAt; edge tests; unit 512, Playwright 154/0 failed) — scoped re-review dispatching
Task 10: scoped re-review dispatched (sonnet, review-c261d6c..6241d02.diff)
Task 10: fix round 1/5 (2 addressed, 0 open — shared emails.ts helpers; reschedule <24h suppresses the 24h reminder; commits c261d6c..6241d02)
Task 10: minor (deferred): the reschedule-rollback test's 24h mark equals `now`, so it no longer tells restored from never-restored — give it a distinct earlier mark.
Task 10: note: reminder24hSentAt now means "sent or deliberately skipped" after a reschedule to < 24 h (anyone reading the column later should know).
Task 10: complete (commits cfb88e0..6241d02, review clean after 1 fix round)
Task 11: carry: Meta tracker send() records the first attempt (pending→sent/failed, attempts=1); resend(r) only sends and returns a boolean — cron records retries [T10]; cap event_source_url (Referer) at 2000 chars or fall back to siteUrl [T7 minor]; Graph API version is one constant.
Task 11: dispatched (BASE 6241d02, implementer sonnet)
Task 11: implementer (sonnet)
Task 11: implementer DONE (4b3e231; unit 576, Playwright 168 passed + 40 skipped, 0 failed in the final run; phone scripts before load 9,141 B gz; META_GRAPH_VERSION v27.0 verified from Meta's changelog). Notes: fbq autoConfig false (Pixel never reads form fields); the manage page loads no trackers (token in its URL); not-connected drops PageView; each PageView = one tracking_events row + one Graph call (/api/events waits up to 5 s; browser uses sendBeacon).
Task 11: Ruling (pre-existing T8 defect, must fix before Phase 2 ends): booking.spec.ts demo-mode tests "demo mode: international details…" and "the demo note shows only in demo mode" are flaky (14/24 fail at --repeat-each=12, also on the untouched baseline 6241d02) and one asserts the literal date "Monday, November 23", which goes stale on 2026-11-23 — carried into Task 13's dispatch as a required fix (stable waits + a date computed from the test clock) — cost if wrong: none.
Task 11: review dispatched (sonnet, review-6241d02..4b3e231.diff)
Task 11: review: spec ✅; Important 1 (manage-page token reaches Meta/Google via the referrer of the next page); Important 2 (a tracking_events row per PageView, no pruning; cron reads every failed row, no cap) → fix round 1 sent to implementer.
Task 11: Ruling (I1): meta referrer no-referrer on tracking={false} pages + Referrer-Policy: no-referrer header on every /booking/[token] answer — the token must never leave the page — cost if wrong: none.
Task 11: Ruling (I2): PageView sent without a row (no retry; failures logged by kind); exhausted Lead/Schedule retries set status 'skipped'; at most 20 tracking retries per cron pass; no Store changes — bounds growth and pass time while keeping retries for the valuable events — cost if wrong: a lost PageView is never retried.
Task 11: Ruling (⚠️ rate limit): the separate 120/hour `events` limiter is correct — each of slots, video and events gets its own budget.
Task 11: minor (deferred): handlers.ts:176-179 comment says "204 whatever becomes of it" but the handler returns 400/429/500.
Task 11: minor (deferred): hash.ts phone normalisation doesn't strip leading zeros; prefixes 1 to any 10-digit number.
Task 11: minor (deferred): tracking.ts start-up block (122-141) outside the try/catch — a throw loses queued calls.
Task 11: minor (deferred → final review): Lead and Schedule await the Meta send (up to 5 s on a stall) before answering the visitor — consider not blocking the visitor on tracking.
Task 11: minor (deferred → T13 required): unit tests pin "real site.yaml has no tracking IDs" (content.test.ts:41, context.test.ts:399, tracking-page.test.ts:25) and e2e tracking.spec.ts:21 — they go red at go-live; switch them to fixture/temp content and give the e2e server a no-IDs content override.
Task 11: minor (deferred): Tracker & { resend } type written three times — export one name.
Task 11: minor (deferred): googleAdsId without googleAdsScheduleLabel silently disables the Ads conversion — build-time warning.
Task 11: note: Pixel pushState hook may fire a browser-only PageView when the lightbox pushes history (unverifiable with stubs).
Task 11: fix round 1 implemented (6eb7af1: no-referrer meta + Referrer-Policy header on manage answers, real-browser test; PageView without a row; exhausted retries → skipped; ≤20 retries per pass; unit 584) — scoped re-review dispatching
Task 11: scoped re-review dispatched (sonnet, review-4b3e231..6eb7af1.diff)
Task 11: fix round 1/5 (2 addressed, 0 open — referrer no-referrer meta + header; PageView without a row; skipped on exhaustion; ≤20 retries/pass; commits 4b3e231..6eb7af1)
Task 11: note: rows already 'failed' with ≥3 attempts (only possible if 4b3e231 was ever deployed with IDs) stay in the failed scan — not migrated; /api/events still awaits the Meta post (≤5 s) — handler latency only.
Task 11: complete (commits 6241d02..6eb7af1, review clean after 1 fix round)
Task 12: carry: /api/video/[id] through withContext with its own 120/hour per-IP limiter (separate budget ruling); the lightbox fetch uses the api-client timeout helper (15 s) and shows hero.yaml videoErrorText on failure; keep the lightbox's ViewContent + Back-button history behaviour; specs import from tests/e2e/fixtures.ts.
Task 12: dispatched (BASE 6eb7af1, implementer sonnet)
Task 12: implementer (sonnet)
Task 12: implementer hit the account 5-hour limit mid-run (resets 07:40 PKT; work uncommitted in the tree); resumed the same agent after the user said continue
Task 12: implementer DONE (c0c6d86; unit 627, Playwright 173 passed + 41 skipped; five t-*.jpg card images downloaded and committed; a throwaway-key signed download resolved the token's sub; no Cloudflare API called). Launch switch-over still needs the user's approval: signing key in env, requireSignedURLs on the videos, streamSignedUrls: true, upload the five card images + images.yaml [carry to T14/Phase 3]. Flaky booking.spec demo test reproduced on the previous commit (already ruled into T13).
Task 12: review dispatched (sonnet, review-6eb7af1..c0c6d86.diff)
Task 12: review: spec ✅, quality Approved, 0 Critical/Important.
Task 12: minor (deferred): a bad signing key gives an opaque 500 / log "(Error)" — give it its own error name (StreamKeyError).
Task 12: minor (deferred): prepare-media: res.arrayBuffer() outside try/catch (stalled body → uncaught TimeoutError); *.part not git-ignored.
Task 12: minor (deferred): no automated test of the thumbnail download path (skip/--force/signed/non-JPEG/network/no key).
Task 12: minor (deferred): ResolvedVideo.play.src still carries the plain Stream address for stream videos (unused by pages; latent signing bypass) — drop src from the stream variant.
Task 12: minor (deferred): empty black pop-up while the video link loads (up to 15 s) — a loading cue.
Task 12: minor (deferred): per-request re-parse of videos.yaml/site.yaml and JWK import (negligible).
Task 12: minor (deferred): e2e runs only with streamSignedUrls false.
Task 12: note → T14/Phase 3 device check: on iOS Safari the iframe is created after an async fetch, outside the tap gesture — autoplay may need a second tap.
Task 12: complete (commits 6eb7af1..c0c6d86, review clean)
Task 13: required carry: (a) fix the flaky booking.spec.ts demo tests and the stale literal date "Monday, November 23" (computed from the test clock); (b) tests that pin "real site.yaml has no tracking IDs" (content.test.ts:41, context.test.ts:399, tracking-page.test.ts:25, e2e tracking.spec.ts:21) switched to temp/fixture content, and the e2e server built and run from a copy of content with tracking IDs removed, so go-live IDs can't break the suite; (c) HOW-TO-SETUP covers: consent screen In production + Desktop OAuth client; Hostinger cron curl (≤255 chars, UTC, no env); NODE_ENV=production; run from the repo root (content/ + public/); restart after editing site.yaml/booking.yaml on a running server; "startup" logs come on the first request; run `DATABASE_URL_TEST=<Hostinger DB> npm run test:db` before launch (MariaDB check); origin reachable only through Cloudflare (CF-Connecting-IP trust) + clientAddress check on Hostinger; Turnstile site key must be set when live; tracking IDs; signed-links switch-over steps; (d) check:services names google invalid_grant clearly and reports a missing turnstileSiteKey in live mode.
Task 13: dispatched (BASE c0c6d86, implementer sonnet)
Task 13: implementer (sonnet)
Task 13: implementer DONE with concerns (83b872f test fixes; 4d8dc32 setup guide + check:services; unit 694 with real and fake go-live content; Playwright 173 passed; booking.spec --repeat-each=12 216/216 (was 9/24 failing); fake-IDs proof done and restored; check:services with no .env → 7 "not set up yet", exit 0). Flaky cause: /#book smooth scroll + lazy section → 5 s expects timed out; fixed by waiting for the config response and reduced motion in booking.spec. Concerns: (1) test:db on Hostinger needs CREATE DATABASE rights (guide says ask Claude to switch to a spare empty DB); (2) Cloudflare Email Routing owns MX — mailbox choice (sending-only SMTP vs full mailbox, SPF/DKIM) is the user's [final report]; (3) unverified: Stream accepting HEAD on a signed iframe URL and signed links for not-yet-protected videos (launch order); hedged menu names; (4) booking.spec no longer covers the smooth scroll.
Task 13: review dispatched (sonnet, review-c0c6d86..4d8dc32.diff)
Task 13: review: spec ✅; Important (two booking.spec tests click Next before the form's handler is attached — use openBooking) → fix round 1 sent to implementer, together with two re-graded doc items.
Task 13: Ruling (re-grade Minor → Important, broken-setup risk): HOW-TO-SETUP .env "no quotes" (a # in a value is cut → SMTP EAUTH) and Step 3 SPF "add a record" (a second SPF record breaks SPF → mail to spam) — included in fix round 1; also keep one full-motion booking-buttons test — cost if wrong: small doc diff.
Task 13: minor (deferred): /#book smooth-scrolls ~6000 px (~4 s) for real visitors before the form starts — consider scroll-behavior auto for the initial hash.
Task 13: minor (deferred): check-services wraps site.yaml + videos.yaml in one try/catch — a videos.yaml mistake prints the wrong file, doubled path, three times.
Task 13: minor (deferred): HOW-TO-SETUP PowerShell DATABASE_URL_TEST stays set for the window — add Remove-Item Env:DATABASE_URL_TEST.
Task 13: minor (deferred): HOW-TO-EDIT {meetUrl} listed as usable vs "never in subject/body" (it's only a link: meet target); {previousWhen} table vs error example; "1 hour" is minNoticeMinutes.
Task 13: minor (deferred): http.test.ts 120-request loops raised to 30 s (slow per-request content reads under load).
Task 13: minor (deferred): backupUrl schema accepts http:// while docs say https://.
Task 13: fix round 1 implemented (6e4a3b4: openBooking in the two racing tests + one full-motion buttons test; .env # quoting in docs + check:services fix text; SPF merge advice; booking.spec --repeat-each=12 216/216, unit 694) — scoped re-review dispatching
Task 13: scoped re-review dispatched (sonnet, review-4d8dc32..6e4a3b4.diff)
Task 13: fix round 1/5 (3 addressed, 0 open — openBooking in the racing tests + full-motion buttons test; .env # quoting; one SPF record; commits 4d8dc32..6e4a3b4)
Task 13: minor (deferred): docs say quote values with "# or a space" while MAIL_FROM with spaces is shown unquoted (works; only # matters).
Task 13: minor (deferred): full-motion buttons test has a 20 s expect inside the 30 s test timeout (24/24 passed).
Task 13: minor (deferred): HOW-TO-SETUP:147 says "do that" before the one-SPF rule at :149 (rule follows immediately, bold).
Task 13: minor (deferred): booking-flow.spec.ts form tests goto('/#book') without openBooking (serial; the hold handler covers early clicks).
Task 13: complete (commits c0c6d86..6e4a3b4, review clean after 1 fix round)
Task 14: not code — needs the user's credentials and Cloudflare approvals; final whole-branch review runs first on the code-complete branch.
Final review: dispatched (opus, review-cc762bf..6e4a3b4.diff; asked to triage the deferred minors and weigh the rulings)
Final review: reviewer hit the account 5-hour limit mid-run (resets 12:40 PKT); resumed the same agent after the user said continue
Final review (opus): Ready to merge — with fixes. 0 Critical; Important 1 (NODE_ENV is the only safeguard: raw compare; unset/typo → demo "You're booked" on the public site or outbox mailer live); Important 2 (live + empty turnstileSiteKey → every lead 403, silent). npm test 694, check 0 errors. Must-fix promoted minors: L38 (= I1), L179 (= I2). Rulings: none reversed (L79, L74 sound with residual costs noted). 20 deferred minors already resolved; 87 can wait; before Phase 3 go-live: L155 live smoke test, L158 IP check, L210 manage page at phone width, L120 confirm-by-hand wording, L81 rollback guard.
Final: Ruling: the single fix wave = Important 1 + Important 2 + Minor 5 (HOW-TO-SETUP: PUBLIC_SITE_URL local in .env vs https in hPanel; content/sections/booking.yaml path) + Minor 4 (spec §5 "every email carries the reschedule/cancel link": add {manageUrl} to reminder-1h and any other visitor email missing it) — I1/I2 can silently fake or refuse bookings at go-live, Minor 5 misleads Task 14, Minor 4 is a spec requirement; the other recommended hardening (cron overlap flag, non-blocking tracker send, Ads transaction_id, cancel-email retry, requested note on the manage page, second-lead dedupe, rollback guard, live test:db smoke test, test:db in an existing empty DB) goes to the user as a pre-launch list — cost if wrong: those wait for a later pass.
Final: fix wave dispatched (FIX_BASE 6e4a3b4, sonnet)
Final: fix-wave implementer (sonnet); report → final-fix-report.md
Final: fix wave implemented (9d79f1e; unit 739, Playwright 173 passed 0 failed; built server checked by hand: NODE_ENV unset → off, "production " → off, test → demo).
Final: Ruling: accept clientMode answering `off` for any not-connected config on a public siteUrl (not only in production) — otherwise the refused-outbox case would show the demo on a public site — cost if wrong: a developer pointing PUBLIC_SITE_URL at a public host locally sees the offline card instead of the demo.
Final: minor (deferred): the build-time email check doesn't enforce {manageUrl} in visitor emails (only a unit test does).
Final: scoped re-review of the fix wave dispatching (FIX_BASE 6e4a3b4)
Final: scoped re-review (sonnet): all 4 findings ADDRESSED; no new Critical/Important breakage — final review clean.
Final: minor (deferred): a built server with a misspelt non-empty NODE_ENV (e.g. "prod") AND no PUBLIC_SITE_URL AND no settings answers demo (any public PUBLIC_SITE_URL gives off; the demo note would be visible on the live page).
Final: minor (deferred): `npm run preview` with NODE_ENV unset now counts as production (offline card / needs SMTP) — undocumented developer flow, follows the decided rule.
Final: complete — finishing run on 9d79f1e (2026-11-20): npm test 42 files / 739 passed; npm run check 0 errors, 4 hints; npm run test:db 17 passed; Playwright 173 passed, 41 skipped, 0 failed (4.2 min). Plan workspace deleted; this file is its copy (agent ids removed).
Task 14: waiting for the user — credentials (Google OAuth client + Hassan's sign-in, Hostinger MySQL, SMTP mailbox, Meta, GA4/Ads) and one-by-one Cloudflare approvals (Turnstile widget, Stream signing key, client card images).
