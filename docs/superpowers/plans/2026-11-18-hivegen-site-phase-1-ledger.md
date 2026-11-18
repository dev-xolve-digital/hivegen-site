# SDD ledger — plan: c:/Users/DC/Desktop/HivegenLLC/docs/superpowers/plans/2026-11-18-hivegen-site-phase-1.md
Spec: docs/design/2026-11-18-hivegen-website-design.md (reachable)

Setup: Ruling: repo initialised on `main` holding only the docs (6f849b9); the build runs on branch `phase-1` — the folder was not a repo, so a fresh branch isolates the work — cost if wrong: none, a merge brings it to main.
Setup: Ruling: `.gitignore` adds `references/` and `.impeccable/` to the plan's list — references/ is 4.7 GB of source media and holds the private contact file; media prep reads it locally — cost if wrong: a fresh clone cannot run `npm run media` without the references folder.
Setup: Ruling (user, 2026-11-18): Stream playback from Phase 1, all 31 uploads shown, hero loop and section 05 clips served by the site under public/media/clips/ (committed), posters always served by the site — signed Stream links in Phase 2 would otherwise need tokens on every thumbnail — cost if wrong: posters must be regenerated with `npm run media` when a video changes.

Pre-flight:
| producer → consumer | produces | consumes | found |
|---|---|---|---|
| T2 → T3 | Video{host?, streamUid?}, Site.settings{videoSource, streamCustomerCode, heroLoop} | resolveVideo/heroLoopSrc | consistent after the 2026-11-18 revision |
| T2 → T4 | collectSamples (16) | build guard prints 16 items | consistent |
| T3 → T5 | heroLoopSrc(): '/media/clips/hero-loop.mp4', resolveVideo | hero data-src, lightbox | consistent (heroLoopSrc takes no args now) |
| T3 → T6/T8 | resolveVideo | cards, testimonial cards (t-* host local) | consistent |
| T3 → T7 | clips ba-reveal / ba-before / ba-after | BeforeAfter | consistent |
| T5 → T6/T8 | data-lightbox auto-binding | cards | consistent |
| T10 → T11 | generateSlots, groupByLocalDay, formatSlotTime, formatSlotLong | booking-ui, demoApi | consistent |
| T5/T7/T9/T11 → T12 | HeroStage, WhoItsFor, Plans, Booking, FinalCta | Three3D slots | consistent |
Task 1: Ruling: `npm audit` reports a high picomatch ReDoS reached through astro 7.4 build tooling; the only offered fix is a downgrade to astro 5.3 — kept astro 7.4, because the globs are our own config, not visitor input, and the output is static — cost if wrong: recheck before the Phase 3 deploy, which adds a Node server.
Task 1: complete (commits 6f849b9..6235e2b, tests: bash -c 'npx playwright test tests/e2e/shell.spec.ts --project=desktop && npm test' → exclude:  **/node_modules/**, **/.git/**)
Task 2: Ruling: content adds UI/accessible-name fields missing from the plan's schema table (hero.videoAriaLabel, before-after.ariaLabel, booking.backLabel/timeHeading/noSlots/confirmation.nextStepsHeading/confirmation.instagramLabel) — Global Constraints say accessible names come from content — cost if wrong: none.
Task 2: Ruling: booking confirmation step reads "Join the call on {when}." instead of "on {date} at {time}" — Task 11's test expects the whole long date-time string in one piece — cost if wrong: wording differs slightly from the copy deck.
Task 2: Ruling: `[confirm]` tags live as YAML comments beside their lines, not on the page — the copy deck says delete the tag once true, so the owner sees them where they edit — cost if wrong: none.
Task 2: Ruling: footer "Email" link is a public mailto: of the contact Gmail from references — the copy deck lists an Email link and the user named this Gmail for contact — cost if wrong: the Gmail is published; flagged to the user, swap in footer.yaml.
Task 2: Ruling: schemas are strict (unknown keys rejected) and page video lists are checked for orientation — catches misspelt optional keys like `badge` — cost if wrong: an owner adding an unsupported key sees an error instead of silence.
Task 2: complete (commits 6235e2b..e74ef7a, tests: npx vitest run tests/unit/content.test.ts tests/unit/samples.test.ts →    Duration  838ms (import 56%, tests 29%, transform 12%, worker 3%))
Task 3: Ruling: clips encode at CRF 30 (not 26) and clip posters at JPEG q 8 — at CRF 26 the hero loop was 2.6 MB and its poster 95 KB, over the 80 KB phone budget; CRF 30 gives 1.7 MB and a 68 KB poster with no visible loss at card size — cost if wrong: slightly softer hero loop; change two numbers in prepare-media.mjs.
Task 3: Ruling: prepare-media also rebuilds an output when its content file (videos.yaml, site.yaml, before-after.yaml) is newer, and accepts --force — the plan's "newer than its source" alone would miss a posterTime edit — cost if wrong: an edit to videos.yaml re-makes all posters (seconds).
Task 3: complete (commits e74ef7a..50384b1, tests: npx vitest run tests/unit/media.test.ts →    Duration  700ms (import 76%, transform 13%, tests 7%, worker 3%))
Task 4: Ruling: all mockup CSS is ported once into src/styles/site.css (container queries → media queries at 1060/640px; sections centred at 1128px content width) instead of per-component <style> blocks — visual parity with the mockup from one source — cost if wrong: less style encapsulation; later tasks reuse the same classes.
Task 4: Ruling: the footer sits outside every <section> so it is the page's contentinfo landmark; added content/sections/not-found.yaml for the 404 copy — Global Constraints: no copy in components — cost if wrong: none.
Task 4: Ruling: the "Sample" marker word stays in SampleTag.astro — it is a draft-only review aid that a production build can never ship — cost if wrong: none.
Task 4: complete (commits 50384b1..0b34a88, tests: bash -c 'npm test && npx playwright test tests/e2e/shell.spec.ts' →   15 passed (25.6s))
Task 5: Ruling: the lightbox makes the rest of the page `inert` while open instead of a hand-written Tab trap — focus inside a Stream iframe cannot be trapped by parent key handlers, and inert keeps keyboard users in the pop-up — cost if wrong: none on current browsers; very old browsers ignore inert.
Task 5: Ruling: video protection's contextmenu/dragstart block lives in src/scripts/protect.ts and applies to anything with data-protect (hero card, lightbox; later cards and before/after) — one place to change — cost if wrong: none.
Task 5: Ruling: added hero.closeVideoLabel to content for the pop-up close button's accessible name — no copy in components — cost if wrong: none.
Task 5: complete (commits 0b34a88..1db81ee, tests: npx playwright test tests/e2e/hero.spec.ts →   21 passed (34.7s))
Task 6: Ruling: video cards are <button>s holding a lazy <img> poster (not CSS background images as in the mockup) — the spec wants posters to load only near the screen, and buttons give keyboard access — cost if wrong: none.
Task 6: Ruling: arrow buttons are named "<prevLabel/nextLabel> (Vertical|Horizontal)" so the two rows' buttons have distinct names — the test matches by substring — cost if wrong: none.
Ops: Astro 7 runs only one preview server; screenshots use port 4323 and must run `npx astro preview stop` afterwards or Playwright's server cannot start.
Task 6: complete (commits 1db81ee..62345b3, tests: bash -c 'npx vitest run tests/unit/carousel.test.ts && npx playwright test tests/e2e/edits.spec.ts' →   13 passed (31.4s))
Task 7: Ruling: the reveal label check also runs on a 200 ms timer, not only on video events — a not-yet-loaded video (preload="none") fires no seek events, so labels would not follow currentTime — cost if wrong: a trivial timer per page.
Task 7: Ruling: the before/after <script> lives in BeforeAfterScript.astro rendered inside the enabled branch — a disabled section must render nothing (Container test), and Astro renders component scripts inline — cost if wrong: none.
Task 7: Ruling: slider mode stacks two site-served clips (ba-before/ba-after) with the after clip clipped at --pos; optional slider.fullVideoId + fullVideoLabel add a "watch the full edit" button that opens Stream — the user's 2026-11-18 instruction — cost if wrong: none until the clips arrive.
Task 7: complete (commits 62345b3..1e79633, tests: bash -c 'npx vitest run tests/unit/before-after.test.ts tests/unit/components.test.ts && npx playwright test tests/e2e/sections.spec.ts' →   6 passed (24.3s))
Task 8: Ruling: marquee duration scales with the number of screenshots (9 s per card via --dur) — a 2- or 20-shot row keeps the same speed — cost if wrong: none.
Task 8: Ruling: the reduced-motion rule also names `.mq.front .mq-track` and `.mq.back .mq-track` — the front row selector out-ranked the plain `.mq-track{animation:none}` — cost if wrong: none.
Task 8: complete (commits 1e79633..ca946c8, tests: bash -c 'npx vitest run tests/unit/components.test.ts && npx playwright test tests/e2e/clients.spec.ts' →   9 passed (40.8s))
Task 9: Ruling: the single-video bar is placed before or after the plan cards in the markup (SingleBar.astro), not reordered with CSS — the test checks DOM order and screen readers follow it — cost if wrong: none.
Task 9: Ruling: added plans.priceSuffix ("/ video") to content; the terms line template stays in the component exactly as the plan specifies — cost if wrong: owners cannot reword "videos a month · revisions" without code.
Task 9: Ruling: no FAQ item starts open (the mockup opened the first) — the test clicks the first question and expects its answer to show; a pre-opened item would close — cost if wrong: none.
Task 9: complete (commits ca946c8..950b350, tests: npx playwright test tests/e2e/plans.spec.ts →   7 passed (40.6s))
Task 10: complete (commits 950b350..e61f65f, tests: npx vitest run tests/unit/slots.test.ts tests/unit/format.test.ts →    Duration  628ms (tests 57%, import 19%, transform 17%, worker 7%))
Task 11: Ruling: booking copy and rules reach the browser as JSON blobs in the section markup; the client script runs demoApi on the real slot engine — the script cannot read YAML — cost if wrong: none; Phase 2 swaps demoApi for httpApi.
Task 11: Ruling: stepper labels read "Your details" / "Pick a time" (the copy deck says "Step 1: Your details") — the numbered circles already show the step, and the prefix wrapped badly on phones; matches the mockup — cost if wrong: one content edit.
Task 11: Ruling: added booking.confirmation.calendarTitle for the "Add to calendar" Google Calendar link, and booking-section min-width:0 fixes — the date strip widened the form past the phone screen — cost if wrong: none.
Task 11: complete (commits e61f65f..00ec766, tests: npx playwright test tests/e2e/booking.spec.ts →   10 passed (26.1s))
Task 12: Ruling: the 3D loader runs from BaseLayout's script, not from Three3D.astro — Astro names script chunks after their component, and a "Three3D…" chunk on phones would break the "no three on phones" rule and its test — cost if wrong: none.
Task 12: Ruling: reduced motion on desktop still loads the scene and renders one frame (data-animating=false) — the plan's test expects it; the plan's loader note said reduced motion skips the import — cost if wrong: desktop visitors with reduced motion download three.js (~584 KB raw).
Task 12: Ruling: stills are captured by hiding everything but the canvases with injected CSS and screenshotting each canvas with omitBackground at 2x — avoids a test-only hook in production code — cost if wrong: none.
Task 12: complete (commits 00ec766..3852f3c, tests: npx playwright test tests/e2e/three.spec.ts →   3 passed (17.3s))
Task 13: Ruling: fonts are self-hosted trimmed files made by `npm run fonts` (subset-font: Archivo width fixed at 125%, weights 800–900; Montserrat 400–700; Latin-1 plus punctuation) — the fontsource files cost 128 KB on phones against a 100 KB budget; now 50 KB — cost if wrong: characters outside Latin-1 (e.g. Ł) in a visitor-typed name fall back to a system font.
Task 13: Ruling: the hero card names itself through visible text plus an sr-only phrase instead of aria-label — axe label-content-name-mismatch — cost if wrong: none.
Task 13: Ruling: axe tests get a 90 s timeout — the first run timed out at 30 s on desktop with live 3D; later runs passed — cost if wrong: slower failure when it does fail.
Task 13: finding: moving @import below @font-face silently dropped tokens.css (all colours vanished) — caught by axe contrast; @import now first.
Task 13: complete (commits 3852f3c..43a37c9, tests: bash -c 'npm test && npx playwright test' →   95 passed (1.9m))
Final review: self-review (no subagent dispatched — the session rules allow agents only when the user asks).
Final: fixed before/after "mode needs its block" error read "Invalid input (field (top))" — test "slider mode without a slider block names the missing field" RED→GREEN, suite 33/33 unit + 95/95 e2e.
Final: fixed 16 TypeScript strict errors found by `astro check` (Node types, vitest config types, carousel resize fallback narrowing, deprecated THREE.Clock) — `npm run check` 0 errors; added typescript, @astrojs/check, @types/node as dev tools.
Final: Ruling: the hero loop also autoplays on phones (1.7 MB) unless data saver or reduced motion is on — the design asks for the loop on every device; the plan only exempts those two — cost if wrong: one setting to skip it on phones.
Final: Ruling: the Stream pop-up iframe leaves out picture-in-picture from the plan's allow list — in line with the video-protection choice — cost if wrong: none.
Final: minor (deferred): booking copy/rules JSON in <script type=application/json> does not escape "</script>" inside owner-written text.
Final: minor (deferred): booking setup assumes the browser reports a time-zone name; a browser that returns none would break step 2.
Final: minor (deferred): render-3d-stills runs `astro preview stop`, which also stops any preview server the user had running.
Final: minor (deferred): the reveal label timer (200 ms) keeps running while section 05 is off-screen.
Final: minor (deferred): tests use toThrowError, deprecated in Vitest 5 (still works).
Final review 2: fresh reviewer (opus subagent, after the user allowed agents on 2026-11-18). Verdict "with fixes": 0 Critical, 5 Important, 14 Minor. One fix pass:
Final: fixed dev server kept old page data and hid page-file errors (getStaticPaths props cached between refreshes) — [...slug].astro now returns only params and reads the page per request — test "the dev server shows page-file edits on refresh and reports page-file mistakes" RED→GREEN.
Final: fixed message rows left a blank stretch with few screenshots or on wide screens — rows repeat until one copy is ~2800px at desktop card height; imgs carry width/height (read at build with image-size 2.0.2) so space is held before load; repeats are aria-hidden — tests "a marquee with %i shots fills a 2560px screen…" and "desktop: each row loops without a gap on a 2560px screen…" RED→GREEN.
Final: fixed a misspelt screenshot, missing poster, wrong logo path or missing section 05 / hero clips built silently — the loaders now stop with the file, field and "run npm run media" — tests in content-files.test.ts RED→GREEN.
Final: fixed Back on a phone left the site instead of closing the video pop-up — the pop-up adds one history step; Back closes it, X/Escape/backdrop remove it — tests "Back closes the video pop-up…" and "closing the pop-up with its X leaves no extra Back step" RED→GREEN.
Final: Ruling (re-graded Minor → Important): the phone booking bar covered the bottom of the booking form — it now hides while the booking section is on screen — the form is the conversion point — test "phone: mobile bar hides while the booking form is on screen" RED→GREEN.
Final: Ruling (reverses Task 9 ruling): the plan terms line moves to plans.yaml `termsLine` with {min}/{revisions}/{s} — "every visible word from content" is the owner's core ask; also fixes "0 revision" — tests "plan terms fill in the numbers…" and "the plan terms line comes from plans.yaml" RED→GREEN.
Final: finding: the bigger marquee track (real widths from the start) slowed desktop pages under parallel tests (order tests 5 s → 26 s/timeouts) — rows now pause while off screen (IntersectionObserver, .mq.off) — test "the rows only move while they are on screen" RED→GREEN; A/B timing vs a1849eb back to parity (7–9 s vs 4–10 s).
Final: Ruling: the missing-file check skips `host: local` video MP4s — they are git-ignored samples that a build from GitHub can't regenerate; HOW-TO-EDIT now says real client videos go on Stream — cost if wrong: a local testimonial MP4 could go missing silently (samples only; the production build refuses samples anyway).
Final: Ruling: booking error handling (Important #5: step-1 failure says "details saved"; confirm can't express "requested") deferred to Phase 2 with httpApi — demoApi cannot fail that way in Phase 1 — cost if wrong: if Phase 2 forgets, leads are lost; carried into the Phase 2 requirements.
Final: Ruling: footer mailto of the contact Gmail (reviewer partly disagrees) waits on the user — connect@hivegen.co now forwards via Cloudflare Email Routing; asked the user whether the footer should show it.
Final: doc fixes alongside: HOW-TO-EDIT now covers termsLine, the new error messages, the dev-server error page, ariaLabel in the slider switch, where the client videos' sample flags live, and Stream for real testimonials.
Final: Ruling on declined-to-judge lines — mockup visual match: stands (checked by screenshots during Tasks 4–13); iOS Low Power play glyph, phone bar over the iOS keyboard, slow-4G screenshot loading, 7 WebGL contexts' GPU cost: real-device checks in Phase 3; Stream behaviour: Phase 2/3; copy word-for-word: stands (transcribed from the deck); legal: Phase 3; picomatch: recheck before Phase 3; punycode email domains: stands (still deliverable); og:image/canonical/sitemap: Phase 3 now that the domain is known.
Final: minor (deferred): unanswered "I am a…" / volume are stored as "other" / "" — decide required vs optional in Phase 2.
Final: minor (deferred): the booking <form> has no method/action; if its script fails, a native GET puts name/email/phone in the URL — fix before the Meta Pixel (Phase 2).
Final: minor (deferred): Escape stops closing the pop-up once the Stream iframe has focus (X still works).
Final: minor (deferred): "Privacy Policy" in the consent line is plain text, not a link — link it when the legal pages are final (Phase 3).
Final: minor (deferred): the sample guard runs inside getStaticPaths; move it to an astro:build:start hook if the route ever renders on demand.
Final: minor (deferred): the 3D import starts as the loader module runs, not after page load (spec §8).
Final: minor (deferred): the ba-reveal poster and the 3D stills load eagerly below the fold; desktop downloads 4 hidden stills.
Final: minor (deferred): the hero loop keeps playing after it scrolls off screen.
Final: minor (deferred): Vitest fails when the cwd's drive letter is lowercase (c:\); run tests from C:\.
Final: minor (deferred): 404.astro builds `/${href}`; a primaryCta.href of "/#book" would become "//#book".
Final: minor (deferred): review-focus tests still missing: blocked-autoplay path (play() rejects), arrows on a 2-video row in the page, and a build-time content-error test.
Final: carry-forward (Phase 2): pass the video id/Stream UID in data-lightbox so signed tokens can be fetched; save UTM/fbclid/gclid on first landing; confirm() returns { start, status: booked | requested }.
Final: carry-forward (Phase 3): add localhost to Stream allowed origins; check Hostinger serves byte ranges for /media/clips/*.mp4; set `site` in astro.config.mjs; Cloudflare SSL to Full (strict) after an origin certificate is on Hostinger.
Final: Ruling (user, 2026-11-18): footer Email link now mailto:connect@hivegen.co (Cloudflare Email Routing forwards it to Gmail); the contact Gmail stays only in site.yaml for Phase 2 notifications — test "the footer email is a hivegen.co address, and the private Gmail is on no page" RED→GREEN — cost if wrong: one content edit when the professional mailbox exists.
