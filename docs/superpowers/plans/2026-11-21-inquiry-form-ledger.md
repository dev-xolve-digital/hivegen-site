# SDD ledger — plan: C:/Users/DC/Desktop/HivegenLLC/docs/superpowers/plans/2026-11-21-inquiry-form.md
Spec: docs/design/2026-11-20-inquiry-form-and-full-section-05-design.md (reachable). The form part is approved by the owner (2026-11-21); section 05 waits for the owner and is NOT in this plan.
Branch: inquiry-form (from phase-2 at 9d193f7; PR #3 open). Plan commit b478b80.
Environment notes for every dispatch: run Vitest from `C:\` (uppercase: cd "C:/Users/DC/Desktop/HivegenLLC"); LF line endings (.gitattributes; Python writes need newline=''); never print the contact Gmail from content/site.yaml; Playwright needs port 4322 free (reuseExistingServer:false); commits end with Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>.

Pre-flight:
| producer → consumer | produces | consumes | found |
|---|---|---|---|
| T1 → T2 | Lead with optional name/buyerType/volume + needs/message | notifier values (T1 makes minimal fallout edits, T2 extends notifier.ts) | consistent, sequential edits of notifier.ts |
| T1 → T3 | inquiryInputSchema, DuplicateRequestError, getLeadByRequestId, updateLead marks, status 'inquiry' | sendInquiry, cron | consistent |
| T2 → T3 | EmailKind hassan-new-inquiry / inquiry-received | sendInquiry, cron retries | consistent |
| T3 → T4 | sendInquiry → {status:'received', eventId}; ctx.limits.leads | inquiriesHandler, httpApi | consistent |
| T3 → T5 | context.ts needOptions fallback [] | T5 removes it | consistent |
| T3 → T6 | TurnstileAction, INQUIRY_TURNSTILE_ACTION (api-client.ts) | loadTurnstile(…, action) | consistent |
| T4 → T6 | BookingApi.sendInquiry, InquiryInput, demoApi | initInquiry | consistent |
| T5 → T6 | markup hooks, initSwitch(root,{reducedMotion,onShow}) → {show,hide} | bootBooking | consistent |
| T5/T6 → T7 | markup, CSS (.nudge lime, .shake), behaviour | e2e; T7 updates the Turnstile stub for two renders | consistent |
| T1 self | tests vs migration/stores | — | agrees |
| T2 self | tests (Reply-To, escaping, no visitor text) vs notifier/placeholders/render | — | agrees |
| T3 self | concurrency test vs pre-check + DuplicateRequestError catch | — | agrees |
| T4 self | route + api tests | — | agrees |
| T5 self | switch/nudge tests vs NUDGE constants and markup | — | agrees; T5 does not wire initSwitch (T6 does) |
| T6 self | inquiry/boot/turnstile tests vs interfaces | — | agrees |
| T7 self | e2e vs features of T5/T6 | — | agrees |
Pre-flight: Ruling: Tasks 5 and 6 also run `npx playwright test tests/e2e/booking.spec.ts tests/e2e/booking-flow.spec.ts` (port 4322 free first) before committing, as a regression check of the call flow — both change the booking card's page and boot, and Task 7 alone would find a break late — cost if wrong: a few extra minutes per task.
Models: implementers sonnet (T1–T7); reviewers sonnet, opus for T3 and T6 (idempotency/concurrency and boot integration); final review opus.
Task 1: dispatched (BASE b478b80, sonnet)
Task 1: implementer (sonnet); report → task-1-report.md
Task 1: implementer DONE_WITH_CONCERNS (65778e9; npm test 759/760, the 1 failure pre-existing; test:db 21/21; check 0 errors).
Task 1: Ruling: request_id gets CHARACTER SET utf8mb4 COLLATE utf8mb4_bin (like public_id) plus a contract case for exact-case matching — the contract already says ids match exactly and the memory store compares exactly — cost if wrong: none.
Task 1: Ruling (pre-existing, fixed now): tests/unit/context.test.ts depends on the developer's real .env (SMTP_* and TURNSTILE_SECRET are now filled) — "NODE_ENV forgotten with the live settings but no mailbox" fails on any machine with a filled mailbox; fixed in Task 1's pre-review round so every later task starts from a green suite — cost if wrong: a test-only diff inside Task 1's range.
Task 1: Ruling: HOW-TO-SETUP.md:121 (migrate's "Applied: 001_init.sql") is updated for 002 in the same round — the doc follows the migration — cost if wrong: none.
Task 1: Ruling: subagent commits keep the Co-Authored-By trailer their own environment gives (accurate attribution); the plan's "Opus 5.5" line meant the controller's own commits — cost if wrong: cosmetic.
Task 1: pre-review fix round sent to implementer (collation + contract case, .env-independent context tests, HOW-TO-SETUP:121)
Task 1: pre-review round done (2f1ced4, 07c0a39, 8dc8fd0; npm test 762/762, test:db 22/22, check 0 errors); review dispatching (sonnet, b478b80..8dc8fd0)
Task 1: review dispatched (sonnet, review-b478b80..8dc8fd0.diff)
Task 1: review: spec ✅, quality Approved; 0 Critical/Important. ⚠️ resolved by controller: the 4 `npm run check` hints pre-exist (same 4 at 9d79f1e's finishing run).
Task 1: minor (deferred): Review Focus 3 only partly pinned at the data layer — no <script>/4-byte emoji message through validation or a store round trip (utf8mb4 guard).
Task 1: minor (deferred): the report's claim that `needs: []` round-trips as [] on both stores has no test.
Task 1: minor (deferred): 002 is a bare ALTER (plan-mandated); a crash between the ALTER and its schema_migrations row would fail every later start with "Duplicate column" (tiny window, GET_LOCK serialises).
Task 1: minor (deferred): context.test.ts reads .env.example by a relative path at import (works from the repo root; new URL(..., import.meta.url) would be robust).
Task 1: minor (deferred): validate.ts module-level constants named email/phone/website/attribution/cookie could be shadowed silently later.
Task 1: complete (commits b478b80..8dc8fd0, review clean)
Task 2: dispatched (BASE 8dc8fd0, sonnet)
Task 2: implementer (sonnet); report → task-2-report.md (BASE 8dc8fd0)
Task 2: implementer DONE (afcd45d; npm test 775/775; check 0 errors). Outside the file list: load.ts no-placeholder message (3 lines). render.ts unchanged (line breaks already survive). Carry to Task 7: HOW-TO-EDIT says every visitor email except the cancellation carries the manage link — inquiry-received is a second exception; the email table needs the two new files and their placeholders.
Task 2: review dispatched (sonnet, review-8dc8fd0..afcd45d.diff)
Task 2: review: spec ✅, quality Approved; 0 Critical/Important. ⚠️ resolved by controller: loadBookingSite().hassanEmail is contact.notificationEmail (load.ts:166); test numbers taken from the report.
Task 2: minor (deferred): email.test.ts:495 `expect(m.to).toBe(hassanEmail)` would print the contact address if it ever failed — compare as a boolean (privacy constraint).
Task 2: minor (deferred): render.ts:48 a lone \r in a message becomes whitespace in the HTML, not <br> (validator allows CR; browsers send \n).
Task 2: minor (deferred): email.test.ts:547 `not.toContain('win')` is a fragile substring (brief-mandated).
Task 2: minor (deferred): hassan-new-inquiry may use {when}/{whenPakistan}/{manageUrl}/{change}, which an inquiry never fills (plan-mandated list; the build check catches misuse).
Task 2: minor (deferred): no test that the emoji in a message survives in the HTML.
Task 2: complete (commits 8dc8fd0..afcd45d, review clean)
Task 3: dispatched (BASE afcd45d, sonnet)
Task 3: implementer (sonnet); report → task-3-report.md (BASE afcd45d)
Task 3: implementer DONE (4a430b9; npm test 800/800; check 0 errors). Concerns: needOptions [] fallback until Task 5 (planned); tests/unit/helpers/booking.ts default deps gain needOptions: []; createLead refactor (fbcFor, leadEventId; behaviour unchanged); both inquiry email marks written in one updateLead after both sends (a crash between the sends lets cron resend Hassan's email once).
Task 3: review dispatched (opus, review-afcd45d..4a430b9.diff)
Task 3: review (opus): spec ✅, quality Approved; 0 Critical/Important. ⚠️ resolved by controller: trailer per ruling; test numbers from the report; the MySQL race relies on Task 1's reviewed 1062 mapping.
Task 3: Ruling (⚠️ plan-level gap): BookingSession lives only in the page, so a reload between the call flow and the form loses "one visitor, one lead" — carry into Task 6: persist the session (leadId + leadTracked) in sessionStorage per tab, every read/write in try/catch, working without it — cost if wrong: a visitor who switches to a new tab is counted twice and Hassan may get the 30-minute email for the earlier lead.
Task 3: minor (deferred) — FINAL REVIEW: recommend must-fix: sendInquiry writes hassanNotifiedAt only after both sends (service.ts:218-223); a stop in the ~1 s window makes cron resend Hassan's email — the spec's anti-goal "two emails for one inquiry"; fix: mark Hassan's right after it goes out, as cron.ts:72-79 does.
Task 3: minor (deferred): the Lead event payload and the honeypot test are copied between createLead and sendInquiry (service.ts:164-167 vs :211-214; :145-146 vs :173-174) — a sendLeadEvent helper.
Task 3: minor (deferred): "a call-flow lead still waiting" is defined twice (service.ts:110-113, cron.ts:105-107) — one shared predicate in status.ts, or constraint 2 can break silently.
Task 3: minor (deferred): the live verifier (context.ts:186) is untested — dropping the action would refuse every live inquiry and no test would notice; a turnstileVerifier(secret, siteUrl, fetchFn) factory with a test.
Task 3: minor (deferred): untested branches service.ts:197 (non-duplicate store error propagates, nothing sent) and :200 (duplicate whose winner isn't found rethrows).
Task 3: complete (commits afcd45d..4a430b9, review clean)
Task 4: dispatched (BASE 4a430b9, sonnet)
Task 4: implementer (sonnet); report → task-4-report.md (BASE 4a430b9)
Task 4: implementer DONE (1835652; npm test 816/816; check 0 errors). Note: demoApi shares one counter for createLead and sendInquiry (ids unique). context.ts comment edited (RateLimits doc).
Task 4: review dispatched (sonnet, review-4a430b9..1835652.diff)
Task 4: review: spec ✅, quality Approved (verdict line requested separately, then given); 0 Critical/Important. ⚠️ test numbers taken from the report.
Task 4: minor (deferred): demoApi shares one counter between createLead and sendInquiry (demo-inquiry-2 after a booking) — carried as a note to Task 6.
Task 4: minor (deferred): api-client.test.ts:247-300 restores the fetch spy with a plain mockRestore() (leaks if an assertion fails) — try/finally or afterEach(vi.restoreAllMocks).
Task 4: minor (deferred): api-client.test.ts never sends a leadId through sendInquiry (Task 6 relies on that passthrough).
Task 4: minor (deferred): http.test.ts:428 asserts the exact email tags (couples the HTTP test to Task 2/3 names).
Task 4: minor (deferred): inquiriesHandler repeats leadsHandler's shape (brief-mandated; existing handlers already repeat it).
Task 4: complete (commits 4a430b9..1835652, review clean)
Task 5: dispatched (BASE 1835652, sonnet)
Task 5: implementer (sonnet); report → task-5-report.md (BASE 1835652)
Task 5: implementer DONE (94977e2; npm test 846/846; check 0 errors; Playwright booking/booking-flow/shell 64 passed 32 skipped 0 failed). Notes: callPanel(page) e2e helper for now-ambiguous Name/Email labels; 4 CSS lines beyond the brief (textarea colour, focus ring, invalid border, .inq legend span); note reuses .calnote; nudge observes [data-switch]; carry to Task 6: own widget in [data-inq-turnstile], enable [data-inq-submit] (starts disabled), set novalidate on [data-inquiry-form].
Task 5: review dispatched (sonnet, review-1835652..94977e2.diff)
Task 5: review: spec ✅, quality Approved; 0 Critical/Important. ⚠️ visual result, one-line switch at 320 px and mid-shake overflow → Task 7 (Review Focus 5, with the real words); real-browser IntersectionObserver → Tasks 6/7; test numbers from the report.
Task 5: minor (deferred): booking.spec.ts off-mode test narrowed to the call panel — carry to Task 6/7: assert [data-inquiry] (and the switch) hidden in off mode.
Task 5: minor (deferred): booking-switch.ts:389-393 ArrowUp/ArrowDown also switch tabs (horizontal tablist: Left/Right + Home/End only); Up/Down no longer scroll.
Task 5: minor (deferred): the production reduced-motion path (matchMedia) has no unit test (Task 7's reduced-motion e2e covers it in a real browser).
Task 5: minor (deferred): no test asserts the nudge cleanup (observer disconnected, listeners removed) after a stop or the 5th shake.
Task 5: minor (deferred): cosmetic — the note reuses .calnote; textarea 14px vs inputs 15px/500; switch and nudge in one closure.
Task 5: complete (commits 1835652..94977e2, review clean)
Task 6: dispatched (BASE 94977e2, sonnet)
Task 6: implementer (sonnet); report → task-6-report.md (BASE 94977e2); carried: sessionStorage session (ruling), enable [data-inq-submit], noValidate, off mode hides [data-inquiry], demoApi shared counter
Task 6: implementer BLOCKED — C: drive full (0 bytes free); nothing committed; one untracked file left (tests/unit/inquiry-ui.test.ts, unfinished, one known racy assertion). Asked the owner; they freed space themselves (6.45 GB free).
Owner (2026-11-21): the shake as in the mockup GIF (N1) — matches the Task 5 build (lime, glow, shake ~0.7 s in place); section 05: the slider over the whole minute (mockup M1), desktop and phone.
Plan amended (c41e89d): design records the section 05 decision; plan gains Task 8 (section 05). Pre-flight row: T8 shares no interfaces with T1–T7; it touches HOW-TO-EDIT.md after Task 7 (sequential) — consistent.
Ruling: section 05 still image at 2.5 s (the opening shot, where both sides are the same shot and playback starts) — cost if wrong: a one-number change in before-after.yaml plus `npm run media`.
Ruling: section 05 words stop claiming "the same shot": subline "Drag the handle to compare the raw footage with our finished edit.", ariaLabel "Compare the raw footage with HiveGen's edit"; heading unchanged — cost if wrong: copy edit.
Ruling: the optional fullVideoId feature stays in code (unused by content); v-before-after-edit leaves videos.yaml with its two tests updated — cost if wrong: none.
Task 6: BASE re-recorded as c41e89d (the docs commit landed before any Task 6 code); implementer resumed after the disk was freed.
Task 6: implementer hit the account usage limit mid-task (tests only written); resumed the same agent after the reset when the owner said continue
Task 6: implementer DONE (084fcb3; npm test 893/893; check 0 errors; Playwright booking/booking-flow 47 passed 29 skipped 0 failed; real page driven in Chromium). Concerns: turnstile per-document waiter set (accepted); name/buyer/volume/needs server errors show the network text; form-then-call order can report a second Lead; EMAIL and safely copied into inquiry-ui.ts.
Task 6: review dispatched (opus, review-c41e89d..084fcb3.diff)
Task 6: review (opus): spec ✅ (all six rulings), quality Approved; 0 Critical/Important. ⚠️ resolved by controller: CRLF claim false (git ls-files --eol: i/lf w/lf; 0 CR bytes); trailer present (own model, per ruling); e2e skip baseline to be confirmed by Task 7's full run.
Task 6: minor (deferred) — FINAL REVIEW: turnstile.ts:74-75/:34 — a script that "loads" without defining window.turnstile (or a render that throws) leaves `rendered` true and stops later waiters; both widgets then wait 10 s per press until a reload (was L191-style in Phase 2; now shared by two widgets). Fix: treat a missing turnstile as a failure, set rendered after render returns, guard each waiter.
Task 6: minor (deferred) — FINAL REVIEW (design-level): "one visitor, one lead" has two holes: (a) the form sent while the call flow's createLead is still pending carries no leadId; (b) form first, then the call flow, reports a second Lead (the call flow is unchanged by design and createLead sends its own CAPI Lead).
Task 6: minor (deferred) — FINAL REVIEW: #iq-name has no maxlength; a name over 100 characters is refused by the server and shows the network error under the name (inquiry-ui.ts:88-89 comment is wrong); add maxlength="100".
Task 6: minor (deferred): test gaps — a token failure after a failed send keeps req-1; booking-boot.test.ts:239 doesn't assert exactly one POST.
Task 6: minor (deferred): EMAIL and safely copied into inquiry-ui.ts (brief limited booking-ui.ts edits); persistentSession could live in its own booking-session.ts.
Task 6: complete (commits c41e89d..084fcb3, review clean)
Task 7: dispatched (BASE 084fcb3, sonnet)
Task 7: implementer (sonnet); report → task-7-report.md (BASE 084fcb3); carried: callPanel/scoping, off mode hides switch + [data-inquiry], HOW-TO-EDIT exceptions + email table, 320 px with real words
Task 7: implementer DONE (535433b; npm test 893; check 0 errors; test:db 22; full Playwright 193 passed 47 skipped 0 failed). Deviations: mid-shake compares offsetTop (bounding tops differ by ~0.8 px from the rotation), bounding tops compared with the shake off; the 320 px test focuses a field first to end the nudge. Note: one 30 s timeout under 4 workers on two heavy desktop pages (the shake test now has 60 s); later runs green.
Task 7: review dispatched (sonnet, review-084fcb3..535433b.diff)
Task 7: review: spec ✅, quality Needs fixes — Important 1: the 320 px sideways/mid-shake checks (quality.spec.ts:47-79) can very likely not fail (partly plan-mandated). ⚠️ resolved by controller: LF (git ls-files --eol i/lf w/lf), trailer present; test numbers re-confirmed by later full runs.
Task 7: Ruling (plan-mandated Important 1): the plan's 320 px method (scrollWidth + wait 350 ms + equal bounding tops) cannot detect what Review Focus 5 names — .page{overflow-x:clip} hides overflow from documentElement.scrollWidth, 350 ms is the leftward keyframe, and the read is not atomic; replace it with one in-page measurement on the paused animation at currentTime 245, 350 and 455 ms asserting the details tab's rect stays within 0..320 and the tabs share a line (tops within a small tolerance), and, with Send details open, every input/textarea and the submit button within 0..320; keep scrollWidth as an extra; show the new check can fail once (a scratch push of the tab 400 px right, reverted) — the spec's focus item binds over the plan's method — cost if wrong: a few more lines of test.
Task 7: Ruling (Global Constraint, enters the round): `expect(mails[1].to).toBe(INQUIRER)` (booking-flow.spec.ts:161 and ~371) would print Hassan's address in a failure message if the visitor's mail were misrouted — "never print it" binds every task; use boolean comparisons, and prove Hassan's mail goes to the loaded contact address with a boolean (never printed) — cost if wrong: none.
Task 7: minor (deferred): the demo happy-path test (booking.spec.ts ~123-139) doesn't assert that nothing is posted (the wrong-email test records `sent`).
Task 7: minor (deferred): the reduced-motion negative window (booking.spec.ts ~166-173) starts late; an addInitScript MutationObserver from page start would remove the timing dependency.
Task 7: minor (deferred): the positive shake test's 2 s clock (booking.spec.ts ~179-186) includes the card's lazy start; wait for the config response first.
Task 7: minor (deferred): raw selectors and duplicated tab selectors across files (quality.spec.ts:61 etc.) — export switchTab/inquiryDone helpers.
Task 7: minor (deferred): the "none of" loop (booking-flow.spec.ts ~180-181) uses need-option words that the owner may legitimately write into inquiry-received.yaml — use test-only values.
Task 7: minor (deferred): nit — `shakesWithin(window_)` names a duration.
Task 7: minor (deferred) — FINAL REVIEW: the older e2e test "the visitor's ad tags reach the lead" timed out once under 4 parallel workers (passed in later runs) — an intermittent flake in the suite.
Task 7: fix round 1 sent to implementer (Important 1 + the Gmail failure-path ruling; FIX_BASE 535433b)
Task 7: fix round 1 implemented (bf29e00; Playwright quality+booking-flow 50 passed 36 skipped 0 failed; check 0 errors; RED proof: pushed tab right=665, 2 px-inside tab right=323.45 at 245 ms, pushed field reported). Finding 2: fakes mail Hassan at FAKE_HASSAN_EMAIL, so booleans assert the fake address, never contact.notificationEmail, never the visitor. Note: one ECONNRESET on GET /api/test/outbox in the untouched 'a network failure on step 1' test (did not recur).
Task 7: scoped re-review dispatched (sonnet, review-535433b..bf29e00.diff)
Task 7: fix round 1/5 (2 addressed, 0 open — paused-animation box-edge check at 0/140/245/350/455/560 ms with a non-vacuous guard and RED proof; addresses compared as booleans; commits 535433b..bf29e00)
Task 7: minor (deferred): booking-flow.spec.ts:44 repeats FAKE_HASSAN_EMAIL as a literal (context.ts doesn't export it); quality.spec.ts:194 2 px tolerance vs ~1.4 px rotation effect (deterministic while paused).
Task 7: minor (deferred) — FINAL REVIEW (privacy, pre-existing): tests/unit/email.test.ts:445-447 `expect(m.to).toBe(hassanEmail)` and tests/e2e/shell.spec.ts:45-47 `expect(pageText).not.toContain(privateEmail)` would print the contact Gmail in a failure message — boolean comparisons.
Task 7: minor (deferred) — FINAL REVIEW: one ECONNRESET on GET /api/test/outbox in the untouched serial test "a network failure on step 1" (did not recur) — a one-retry in the helper.
Task 7: complete (commits 084fcb3..bf29e00, 1 fix round, review clean)
Task 8: dispatched (BASE bf29e00, sonnet)
Task 8: implementer (sonnet); report → task-8-report.md (BASE bf29e00)
Task 8: implementer DONE_WITH_CONCERNS (9799f44; npm test 897; check 0 errors; test:db 22; full Playwright 193 passed 47 skipped 0 failed; ba-before 60.43 s 3.26 MB, ba-after 60.43 s 5.38 MB, 540x960, no audio; posters = opening shot). Concerns: references/final-videos/Landscape and Potrait are empty on this computer, so a full npm run media stops at the first missing source — section 05 jobs were run through a temporary copy of the script (deleted); removed the unreferenced poster v-before-after-edit.jpg; added a shipped-section render test.
Task 8: review dispatched (sonnet, review-bf29e00..9799f44.diff)
Task 8: review: spec ✅, quality Approved; 0 Critical/Important. ⚠️ resolved: the temporary script's encode matches clipVideo (crf 30, preset slow, faststart, moov first — verified with ffprobe); 60 s playback over a slow connection → pre-launch manual check.
Task 8: minor (deferred): the kept fullVideoId render path is now untested (plan-mandated) — one unit test with an existing id, one for the unknown-id error.
Task 8: minor (deferred): posterAt is seconds from the clip's start (schemas.ts:147) but the YAML header and HOW-TO-EDIT read as source seconds — say "seconds from the start of the clip".
Task 8: minor (deferred): posterAt beyond the clip fails with a cryptic ffmpeg error; boomerang: true with no duration would reverse ~1800 frames — a fail() in prepare-media and one HOW-TO line.
Task 8: minor (deferred) — FINAL REVIEW / pre-launch: before-after.ts drift correction (snap video 0 to video 1 at >0.2 s) was written for a 3–6 s loop; with 60 s clips of different bitrates under preload=none, a slow phone connection may stall — a manual throttled-network check before launch.
Task 8: minor (deferred): prepare-media.mjs job building (no -t rule, poster moment) has no unit test.
Task 8: environment note for the owner: references/final-videos/Landscape and Potrait are empty on this computer, so a full `npm run media` stops at the first missing source until they are restored (the Stream copies are unaffected).
Task 8: complete (commits bf29e00..9799f44, review clean)
All tasks complete. Final review next.
Final review: dispatched (opus, review-9d193f7..9799f44.diff; asked to triage the deferred minors and weigh the rulings)
Final review (opus): Ready to merge — with fixes. 0 Critical; Important 1 (sendInquiry marks both emails after both sends → cron can resend Hassan's); Important 2 (email.test.ts:447 introduced on this branch prints the contact Gmail on failure; + pre-existing shell.spec.ts:47, context.test.ts:458). Minors #3–#10. Deferred-minor triage: must-fix = Task 3 FINAL REVIEW (= I1), Task 2/Task 7 privacy (= I2); 42 can wait; Task 5's off-mode note already resolved by Task 7. Rulings: none reversed.
Final: Ruling: the single fix wave = I1 + I2 (with the shell.spec.ts:47 and context.test.ts:458 fold-ins) + M3 (name maxlength, cleaned name/message, right wording) + M4 (nudge needs intersectionRatio ≥ 0.6) + M5 (Turnstile recovers from a broken script) + M6 (no drift correction while seeking/not ready; 0.5 s tolerance) + M7 ("Book a call" links switch the card back to the call) + M8 (privacy.md sentence) + M9 (cron: no 30-minute email for a started lead whose email matches an inquiry in its window; HOW-TO-EDIT "in the same tab") + M10 (needOptions unique, switch-word length line, merged CSS rule) — I1/I2 are must-fix; M7 and M9 touch the spec's own goals (booked calls are the measure; the anti-goal names the 30-minute email for a form user); M3/M5/M6 change what real visitors get on rare-but-real paths and are small; M4/M8/M10 are one-liners — cost if wrong: a larger fix diff, checked by one scoped re-review and full suites.
Final: Ruling: "form first, then the call flow" still reports two Meta Leads — the spec keeps the call flow unchanged, and someone who sends details and then books is two conversions to Meta — cost if wrong: Meta's Lead count slightly high on that rare path.
Final: Ruling (declined: honeypot): a password manager filling the hidden `website` field drops the inquiry silently — stands: the spec requires the booking form's honeypot as it is (hidden, autocomplete off, tabindex -1) — cost if wrong: a rare lost message.
Final: Ruling (declined: Reply-To is the visitor): stands, the spec requires it; Hassan sees the address in the email — cost if wrong: a reply sent to a forged address.
Final: Ruling (declined: the fixed confirmation can go to any typed address): stands — it carries no visitor text, and the bot check and rate limit cap it — cost if wrong: a few unwanted generic emails.
Final: Ruling (declined: a failing visitor email retried every 5 min for 2 days): stands — the same rule as the booking emails (spec) — cost if wrong: log noise.
Final: Ruling (declined: book() has the same mark-after-both window): stands on this branch — it predates it; it joins the Phase 2 pre-launch list — cost if wrong: a rare duplicate booking email to Hassan.
Final: Ruling (declined: GA4/Meta can't tell a form lead from a call lead): stands — the spec says the same tracking as the call form's first step — cost if wrong: less granular ad reports (a parameter can be added later).
Final: Ruling (declined: "If you sent a link…" goes to everyone): stands — the confirmation has no placeholders by design — cost if wrong: one slightly generic sentence.
Final: Ruling (declined: section 05 compares different rooms under "Same footage."): stands — the owner's decision — cost if wrong: none.
Final: Ruling (declined: the unused fullVideoId code stays): stands — earlier ruling — cost if wrong: a little dead code.
Final: Ruling (declined: leads and inquiries share 10 an hour per address): stands — plan decision — cost if wrong: an office behind one address could hit the limit after 10 sends in an hour.
Final: Ruling (declined: the phone rule refuses dots): stands — the spec says the same validation as the call form — cost if wrong: a visitor removes the dots after the error.
Final: Ruling (declined: migration 002 is not re-runnable after a crash between the ALTER and its record): stands — plan-mandated; GET_LOCK serialises; MySQL 8 has no ADD COLUMN IF NOT EXISTS — cost if wrong: a manual fix in a millisecond-wide crash window.
Final: Ruling (declined: a phone that watches section 05 can download about 8.6 MB): stands — within the spec's estimate, and only when watched — cost if wrong: data use for visitors who watch the whole minute.
Final: Ruling (declined: the clips' tmcd data track): stands — harmless and predates the branch — cost if wrong: none.
Final: fix wave dispatching (FIX_BASE 9799f44, sonnet; findings → final-review-findings.md)
Final: fix-wave implementer (sonnet); report → final-fix-report.md (FIX_BASE 9799f44)
Final: fix-wave implementer hit the account usage limit after 6 commits (I1, I2, M3+M10a, M4, M5, M6; M7 in progress); resumed the same agent after the reset when the owner said go
Final: fix wave implemented (b46ae00..b12686a, 10 commits; npm test 941; check 0 errors; test:db 22; full Playwright 195 passed 47 skipped 0 failed). Notes: I2 guard test tests/unit/test-privacy.test.ts; M7 switches back only when Send details is open (keeps the nudge for others); M8 leaves 'only to arrange your call' for the owner's final policy; M9 one extra 14-day leads query per pass when a started lead waits.
Final: scoped re-review (opus): all 10 findings ADDRESSED (I1, I2, M3–M10); no new Critical/Important breakage — final review clean.
Final: parked — booking-boot.ts:128-132 also switches the card back to the call on Back/Forward to a #book history entry and on a Ctrl/Cmd-click of "Book a call" — Ruling: stands; a return to #book almost always follows a "Book a call" jump, and nothing typed in the form is lost (one tap returns to Send details) — cost if wrong: a visitor who browsed back sees the call view again.
Final: parked — HOW-TO-EDIT.md:266 implies one tab is always one Meta Lead, but "form first, then the call form" in one tab gives two (the ruled-in second Lead) — Ruling: real but minor doc imprecision; the PR description and the owner summary state the exact behaviour; fix with the next guide edit — cost if wrong: the owner reads the guide's line as exact.
Final: complete — finishing run on b12686a: npm test 47 files / 941 passed; npm run check 0 errors, 4 hints; npm run test:db 22 passed; Playwright 195 passed, 47 skipped, 0 failed. Plan workspace deleted; this file is its copy (agent ids removed).
