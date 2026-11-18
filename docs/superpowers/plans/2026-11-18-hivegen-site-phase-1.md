# HiveGen Sales Website — Phase 1 Implementation Plan (editable draft site)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A complete draft of the HiveGen site running locally: all four page versions and all ten sections from the approved mockup. Every word, price, setting, video and image comes from editable files, and the booking flow can be clicked through as a demo.

**Architecture:** Astro (static output) builds the main page and the three buyer versions from one template. A small content layer reads YAML files from `/content`, checks them with Zod, and fails with the file name and field name when something is wrong. An ffmpeg script prepares posters (for every video) and the few short clips the site serves itself from `references/`. Portfolio videos play from Cloudflare Stream (`settings.videoSource: stream`, customer code `yph9uum1du6x869b`); the hero loop and the before/after clips are short silent MP4s served by the site (Hostinger), never Stream, and tapping the hero opens the full reel from Stream (user, 2026-11-18). Posters are always served by the site, so they keep working when Stream links become signed in Phase 2. 3D objects load only on desktop. The booking UI runs against a demo API that uses the real slot engine.

**Tech Stack:** Astro (latest stable) · TypeScript (strict) · Zod · js-yaml · marked · three.js · Vitest (+ jsdom, Astro Container API) · Playwright (installed Chrome, `channel: 'chrome'`) · @axe-core/playwright · cross-env · ffmpeg (local, media prep only) · Node 24

**Spec:** `docs/design/2026-11-18-hivegen-website-design.md`. Copy, verbatim: `docs/design/2026-11-18-hivegen-copy-deck.md`. Visual reference for every section: `docs/mockup/index.html`.

## Roadmap

| Phase | Plan | Delivers | Needs from you |
|---|---|---|---|
| 1 | this plan | Draft site, editable from files, demo booking, all 31 Stream videos, page-level download blocks | nothing (section 05 clips arrive 2026-11-19) |
| 2 | written after Phase 1 review | Real booking (Google Calendar, MySQL, emails, reminders, reschedule/cancel), Meta Pixel + Conversions API, Google tag, **signed Stream links** (a Stream signing key; the server signs a token per play that expires after about 1 hour; `requireSignedURLs` on every video) | Hassan's Google sign-in, a mailbox on your domain, Pixel ID + CAPI token, Google Ads conversion ID, Turnstile keys |
| 3 | written for launch | Hostinger deploy, domain, **Stream allowed origins set to the domain**, final legal pages, samples removed, launch checks | Cloudflare and Hostinger access, domain, business details, real testimonials |

## Global Constraints

- Every visible word comes from a file in `content/`, copied verbatim from the copy deck. Components hold no copy; accessible names come from content too.
- Colors: background `#FFF9EB`, text `#0E1233`, secondary `#4A4F6A`, muted `#6B6F88` (the lightest allowed for text), blue `#1C45F5`. Lime `#D3FF52` is only ever a fill behind dark text, never text.
- Fonts: Archivo variable (wdth 125, wght 800) for headlines; Montserrat 400–700 for everything else; self-hosted, Latin subset.
- Breakpoints: phone ≤ 640px, tablet ≤ 1060px. Desktop has the 80px grid background; phones don't.
- Phone budgets: initial JS < 50 KB gzipped; no three.js request; hero poster < 80 KB; fonts < 100 KB total; CLS < 0.05.
- Routes: `/`, `/agencies`, `/videographers`, `/agents` (the last three `noindex`), `/privacy`, `/terms`, `404`.
- Booking rules: time zone `Asia/Karachi`; windows start Mon–Fri; 19:00–02:00 (ending the next day); 15-minute calls; 5-minute buffer; 60-minute minimum notice; 14-day horizon.
- `prefers-reduced-motion: reduce`: no 3D animation, no marquee movement, no autoplaying hero or before/after video (posters only). Data saver (`navigator.connection.saveData`): no autoplaying video.
- Items with `sample: true` show a visible "Sample" tag. A build with `SITE_MODE=production` fails while any sample remains.
- WCAG AA contrast; visible focus; keyboard use for carousels, lightbox and the before/after slider; axe reports no serious or critical issues.
- Node 24, TypeScript strict, no CSS framework. Design tokens live in `src/styles/tokens.css`, with values taken from the mockup.
- Visual parity: each component matches its section in `docs/mockup/index.html` (glass, blobs, hover states, mobile layout). The mockup's dark section tags ("01 · Hero") and its phone frame and view switch are review aids, not site content. Content `note` fields (reviewer notes on samples) render only when `SITE_MODE` is not `production`.
- Video protection, Phase 1 part (user chose steps 1, 2 and 4 on 2026-11-18; 1 and 2 come in Phases 3 and 2): no download button or save menu anywhere. Every `<video>` has `controlslist="nodownload noplaybackrate"` and `disablepictureinpicture`. Video cards, the hero card, the lightbox and the before/after block cancel `contextmenu`, and their media have `-webkit-touch-callout: none` and `user-select: none`. Stream MP4 downloads stay off (verified on all 31, 2026-11-18). Portfolio videos are never served as files.
- Watermark: Hassan may add a logo to the client videos later, which means re-uploading them to Stream. Keeping `streamUid` editable in `videos.yaml` makes that a content change.
- One commit per task.

## Review Focus

1. **A content file with a mistake** (bad indentation, a tab, a missing field, an unknown video id): build and dev server stop with the file name and the line or field. Never a blank page. Tests: Task 2.
2. **US visitors around a daylight-saving change, or in Hawaii:** slot labels show the right local time, and no slot is in the past. Tests: Task 10.
3. **Names and emails beyond plain ASCII** (accents, apostrophes, plus-addresses): accepted and shown correctly. Test: Task 11.
4. **Phones that block autoplay or save data** (Facebook in-app browser): the poster stays, nothing breaks, tapping still opens the video. Test: Task 5.
5. **Lists of unexpected length** (2 videos, 20 screenshots): arrows hide when there is nothing to scroll, and marquees still loop without gaps. Tests: Tasks 6 and 8.

---

## File structure

```
content/                          ← everything the owner edits
  site.yaml                       brand, contact, booking rules, settings
  pages/  main.yaml agencies.yaml videographers.yaml agents.yaml
  sections/ nav.yaml hero.yaml recent-edits.yaml who-its-for.yaml how-it-works.yaml
            before-after.yaml plans.yaml booking.yaml faq.yaml final-cta.yaml footer.yaml
  videos.yaml                     every video: id, label, duration, source, poster time, Stream ID
  testimonials.yaml               section 06: headings, video testimonials, message screenshots
  legal/  privacy.md terms.md     drafts until Phase 3
public/
  brand/logo.png
  media/posters/*.jpg             generated by `npm run media`, committed
  media/clips/hero-loop.mp4 ba-*.mp4  generated, committed: short silent clips the site serves itself (Hostinger)
  media/videos/*.mp4              generated, NOT committed: only videos with `host: local` (the sample testimonial clips)
  media/screenshots/shot-01.jpg … shot-12.jpg
  media/3d/*.webp                 generated by `npm run stills`, committed
scripts/  prepare-media.mjs  render-3d-stills.mjs
src/
  lib/content/  schemas.ts load.ts errors.ts samples.ts
  lib/media.ts
  lib/booking/  slots.ts format.ts api-client.ts
  layouts/BaseLayout.astro
  components/   Nav Hero HeroStage RecentEdits VideoCarousel VideoCard WhoItsFor HowItWorks BeforeAfter
                ClientVideos MessageMarquee Plans Booking Faq FinalCta Footer MobileBar Lightbox SampleTag Three3D (.astro)
  scripts/      hero-video.ts lightbox.ts carousel.ts before-after.ts booking-ui.ts mobile-bar.ts
                three/objects.ts three/scene.ts three/loader.ts
  styles/       tokens.css global.css
  pages/        [...slug].astro privacy.astro terms.astro 404.astro
tests/
  unit/  content.test.ts samples.test.ts media.test.ts carousel.test.ts before-after.test.ts
         slots.test.ts format.test.ts components.test.ts
  e2e/   shell.spec.ts hero.spec.ts edits.spec.ts sections.spec.ts clients.spec.ts plans.spec.ts
         booking.spec.ts three.spec.ts quality.spec.ts
  fixtures/ content-broken-yaml/ content-missing-field/ content-unknown-video/
HOW-TO-EDIT.md
```

Test ids used across tasks: `hero-card`, `hero-video`, `lightbox`, `mobile-bar`, `vertical-track`, `vertical-card`, `horizontal-card`, `who-its-for`, `step`, `before-after`, `testimonial-card`, `marquee-front`, `marquee-back`, `shot`, `plan-card`, `single-bar`, `booking`, `slot`, `booking-done`, `three-canvas`, `three-still`.

---

### Task 1: Project setup

**Files:**
- Create: `package.json`, `astro.config.mjs`, `tsconfig.json`, `vitest.config.ts`, `playwright.config.ts`, `.gitignore`, `.nvmrc`, `src/styles/tokens.css`, `src/styles/global.css`, `src/pages/index.astro` (temporary; replaced in Task 4)
- Test: `tests/e2e/shell.spec.ts`

**Interfaces:**
- Produces: npm scripts `dev`, `build`, `preview`, `test` (vitest run), `e2e` (playwright test), `media` (node scripts/prepare-media.mjs), `stills` (node scripts/render-3d-stills.mjs). Playwright projects `desktop` (1440×900) and `phone` (`devices['Pixel 7']`), both `channel: 'chrome'`, webServer `npm run build && npm run preview -- --port 4322`, `reuseExistingServer: true`.

- [ ] **Step 1: Initialise the repository.** Run `git init`. `.gitignore` lists: `node_modules/ dist/ .astro/ .env* .superpowers/ public/media/videos/ test-results/ playwright-report/`. `.nvmrc` contains `24`.
- [ ] **Step 2: Install Astro directly.** The folder already holds `references/` and `docs/`, so skip the create wizard. Run `npm init -y` and `npm install astro`. Set `"type": "module"`. Add `astro.config.mjs` (`export default defineConfig({})`) and `tsconfig.json` (`{ "extends": "astro/tsconfigs/strict" }`). Add dependencies `zod js-yaml marked three`. Add dev dependencies `vitest jsdom @playwright/test @axe-core/playwright cross-env @types/js-yaml @types/three @fontsource-variable/archivo @fontsource-variable/montserrat`. Set `"engines": { "node": ">=24 <25" }`. Vitest config: `passWithNoTests: true`, `include: ['tests/unit/**/*.test.ts']`.
- [ ] **Step 3: Write the failing smoke test**

```ts
// tests/e2e/shell.spec.ts
import { test, expect } from '@playwright/test';
test('home serves a page titled HiveGen', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/HiveGen/);
});
```

- [ ] **Step 4: Run it.** `npx playwright test tests/e2e/shell.spec.ts --project=desktop`. Expected: FAIL (no page).
- [ ] **Step 5: Add the temporary `src/pages/index.astro` and the styles.** The page has `<title>HiveGen</title>` and imports `global.css`. `tokens.css` defines the mockup's custom properties: `--bg --ink --ink2 --ink3 --blue --lime --glass --glass-border --shadow` plus radius and spacing tokens. `global.css` imports both fonts (the Archivo file that includes the `wdth` axis) and the tokens.
- [ ] **Step 6: Run it again.** Same command. Expected: PASS. `npm test` also exits 0.
- [ ] **Step 7: Commit.** `git add -A && git commit -m "chore: scaffold Astro project with test tooling"`

---

### Task 2: Content layer and all content files

**Files:**
- Create: `src/lib/content/schemas.ts`, `load.ts`, `errors.ts`, `samples.ts`; every file under `content/` (text verbatim from the copy deck)
- Test: `tests/unit/content.test.ts`, `tests/unit/samples.test.ts`, fixtures in `tests/fixtures/`

**Interfaces:**
- Produces (every loader reads `process.env.CONTENT_DIR ?? 'content'` on each call, with no caching):

```ts
// load.ts
export type PageSlug = '' | 'agencies' | 'videographers' | 'agents';
export function loadSite(): Site;
export function listPages(): Page[];                 // order: '', agencies, videographers, agents
export function loadPage(slug: PageSlug): Page;
export function loadSection<K extends keyof Sections>(name: K): Sections[K];
export function loadVideos(): Video[];
export function getVideo(id: string): Video;          // ContentError naming the id if unknown
export function loadTestimonials(): Testimonials;
export function loadLegal(name: 'privacy' | 'terms'): { title: string; markdown: string };
// errors.ts
export class ContentError extends Error { constructor(message: string, public file: string, public field?: string, public line?: number) }
// samples.ts
export function collectSamples(): string[];           // e.g. "testimonials.yaml › screenshots[0] (shot-01.jpg)"
export function assertNoSamplesInProduction(mode?: string): void; // mode defaults to process.env.SITE_MODE; throws ContentError("Sample content found: …")
```

- Types are inferred from the Zod schemas in `schemas.ts`. Field names (components rely on these):

| File | Fields |
|---|---|
| `site.yaml` | `brand{name, logo}` · `contact{notificationEmail, instagramHandle, instagramUrl}` · `booking{timeZone, days[mon..sun], windowStart "HH:mm", windowEnd "HH:mm", slotMinutes, bufferMinutes, minNoticeMinutes, horizonDays}` · `settings{videoSource: local\|stream, streamCustomerCode?, live3dOnMobile, showBeforeAfter, heroLoop{videoId, start, duration}}` (real values: `videoSource: stream`, `streamCustomerCode: yph9uum1du6x869b`) |
| `pages/*.yaml` | `slug` · `seo{title, description, noindex}` · `hero{eyebrow, headline[3], highlight, subline, chips[3]}` · `whyUs?` · `preselectBuyer?: agency\|videographer\|agent` · `videoOrder{vertical[], horizontal[]}` · `pricingOrder: plans-first\|single-first` · `showWhoItsFor` |
| `sections/nav.yaml` | `links[{label, href}]` · `cta{label, href}` |
| `sections/hero.yaml` | `primaryCta{label, href}` · `instagramCta{label}` · `videoLabel` · `videoDuration` · `floatTitle` · `floatText` |
| `sections/recent-edits.yaml` | `heading` · `subline` · `verticalLabel` · `horizontalLabel` · `prevLabel` · `nextLabel` |
| `sections/who-its-for.yaml` | `heading` · `cards[{title, text, linkLabel, href, icon: building\|camera\|person}]` |
| `sections/how-it-works.yaml` | `heading` · `steps[{number, title, text}]` |
| `sections/before-after.yaml` | `mode: reveal\|slider` · `heading` · `subline` · `labels{before, after}` · `reveal?{source, start, duration, slowdown, cutAt}` · `slider?{before{source, start, duration}, after{source, start, duration}, fullVideoId?}` · `sample` · `note`. Slider clips are prepared into `/media/clips/ba-before.mp4` and `ba-after.mp4` (+ posters), served by the site, not Stream; `fullVideoId` (optional) adds a "watch the full edit" button that opens that catalog video from Stream. **PENDING:** the user sends the raw clip and its edit on 2026-11-19; until then `mode: reveal` is the stand-in. |
| `sections/plans.yaml` | `heading` · `subline` · `planCtaLabel` · `plans[{name, badge?, price, minimumPerMonth, revisions, includesPrevious?, features[], featured?}]` · `single{lead, text, priceFrom, note, ctaLabel}` · `freeNote` |
| `sections/booking.yaml` | `heading` · `subline` · `bullets[]` · `instagramLine` · `steps{details, time}` · `fields{name, email, phone, buyer, volume, footage, footageHint}` · `buyerOptions[{value, label}]` · `volumeOptions[]` · `nextLabel` · `confirmLabel` · `consentLine` · `timeNote` · `confirmation{heading, text, nextSteps[], addToCalendar}` · `errors{name, email, slotTaken, unreachable}` · `demoNote` |
| `sections/faq.yaml` | `heading` · `items[{q, a}]` |
| `sections/final-cta.yaml` | `headingLines[]` · `highlight` · `subline` · `ctaLabel` · `instagramLabel` |
| `sections/footer.yaml` | `copyright` · `tagline` · `links[{label, href}]` |
| `videos.yaml` | `videos[{id, title, label, duration "m:ss", orientation: vertical\|horizontal, source (path under references/), posterTime, streamUid?, host?: stream\|local, sample?}]` (`host` defaults to `settings.videoSource`; the sample testimonial clips use `host: local`) |
| `testimonials.yaml` | `heading` · `subline` · `watchLabel` · `videos[{videoId, role}]` · `inbox{heading, subline, note}` · `screenshots[{file, alt, row: front\|back, sample}]` |

- Video catalog (sources under `references/`, times in seconds):

Stream account `3c20fd5ca972dbe9f904bcdfa93dc0c6`, customer code `yph9uum1du6x869b` (`settings.streamCustomerCode`). The local files and the Stream names match one to one; the mapping was checked frame by frame on 2026-11-18.

| id | source | streamUid | posterTime | duration | label |
|---|---|---|---|---|---|
| v-portfolio-reel | final-videos/Potrait/potrait-video-20.mp4 | 69f417a2079e8572ca2ec41802f03bc2 | 13 | 0:58 | Portfolio reel |
| v-agent-spotlight | final-videos/Potrait/potrait-video-11.mp4 | 5246383ab493548e7b2a18b6e1f24296 | 13.95 | 1:09 | Agent spotlight |
| v-twilight-exterior | final-videos/Potrait/potrait-video-1.mp4 | 2283b20b0a152c818ac016666e4f2a89 | 33.87 | 1:07 | Twilight exterior |
| v-client-reveal | final-videos/Potrait/potrait-video-4.mp4 | d1b342b3232de8f27e62fe5bddcf908a | 37.39 | 1:14 | Client reveal |
| v-night-sky | final-videos/Potrait/potrait-video-21.mp4 | 8c1c70b2a3c83ba443ddf2fb316ba899 | 12.82 | 1:04 | Night-sky intro |
| v-street-hook | final-videos/Potrait/potrait-video-2.mp4 | b6d856ec280af1edec812d77c803d88a | 5.49 | 0:27 | Street hook |
| v-lifestyle-story | final-videos/Potrait/potrait-video-6.mp4 | 3fa8a30c4ff7472bf44368120f00343e | 29.27 | 0:58 | Lifestyle story |
| v-luxury-kitchen | final-videos/Potrait/potrait-video-12.mp4 | 0be0f29024983c4edb94d1e6b831df82 | 17.59 | 1:27 | Luxury kitchen |
| v-creative-hook | final-videos/Potrait/potrait-video-17.mp4 | c58cfb12587e6ea5f7f407a577d569f0 | 16.51 | 1:22 | Creative hook |
| v-investor-angle | final-videos/Potrait/potrait-video-15.mp4 | b8dec2810e55128e3d170815ef7e3ca8 | 69.79 | 1:27 | Investor angle |
| v-community-tour | final-videos/Potrait/potrait-video-23.mp4 | 2275e797a89fbde9a96e9667627ff073 | 12.83 | 1:04 | Community tour |
| v-autumn-cottage | final-videos/Potrait/potrait-video-3.mp4 | 068ae6b8764b0976090e9aab184006a4 | 25.95 | 0:42 | Autumn cottage story |
| v-ranch-acreage | final-videos/Potrait/potrait-video-5.mp4 | 4dd8f6e69d3bc098e9df61ee4c6776f6 | 5.01 | 0:40 | Ranch on acreage |
| v-still-not-sold | final-videos/Potrait/potrait-video-7.mp4 | f2300c46a44bf0f49ef5e3e4b730ef19 | 16.83 | 1:21 | Still-not-sold hook |
| v-new-build-host | final-videos/Potrait/potrait-video-8.mp4 | 34087c13e9ccc5b511ecd502757ff076 | 29.12 | 2:20 | Hosted new-build tour |
| v-pool-home-hook | final-videos/Potrait/potrait-video-9.mp4 | 95c87a2ad2c2809235d7d8ae4df5603f | 5.37 | 0:43 | Pool home hook |
| v-rooftop-hook | final-videos/Potrait/potrait-video-10.mp4 | d730b5e6db7b970da9329a6609336c34 | 1.61 | 0:39 | Rooftop stunt hook |
| v-agent-hosted | final-videos/Potrait/potrait-video-13.mp4 | 68b4864a40042a3612b1c72887a69aec | 19.92 | 1:36 | Agent-hosted home tour |
| v-buyer-story | final-videos/Potrait/potrait-video-14.mp4 | aa6def0e1f19a58beb4bd635b15a66f7 | 22.24 | 0:59 | First-home buyer story |
| v-lifestyle-couple | final-videos/Potrait/potrait-video-16.mp4 | a4f03ba0bc80c06cb9cd22e4401608b1 | 10.39 | 0:50 | Lifestyle couple tour |
| v-golf-cart-tour | final-videos/Potrait/potrait-video-18.mp4 | e70c952972d1424998733815c68cd3f9 | 18.71 | 1:30 | Golf-cart community tour |
| v-lakefront | final-videos/Potrait/potrait-video-19.mp4 | 54b4b8fab04f40caf2c3e48d6b7af76e | 31.96 | 0:59 | Lakefront retreat |
| v-miami-story | final-videos/Potrait/potrait-video-22.mp4 | 34af88d7cd5cd2a19e88bebccf9f609a | 2.48 | 1:00 | Miami lifestyle story |
| h-modern-villa | final-videos/Landscape/landscape-cinematic-5.mp4 | 12dcd6bc6b4f6184b5370463743bb748 | 25.10 | 2:05 | Modern villa · cinematic |
| h-country-barn | final-videos/Landscape/landscape-cinematic-7.mp4 | 7be89f38681f7b8faf9d9c7695c8e612 | 8.47 | 0:42 | Country barn at golden hour |
| h-estate-aerial | final-videos/Landscape/landscape-cinematic-1.mp4 | 40caf04f0c3295104a672e56a729bc92 | 63.05 | 2:06 | Estate aerial tour |
| h-agent-led | final-videos/Landscape/landscape-cinematic-2.mp4 | a1c00368cf4fc02cfa7ee73d06a7c3c5 | 49.60 | 1:39 | Agent-led tour |
| h-family-home | final-videos/Landscape/landscape-cinematic-4.mp4 | 1ed6c0e68eaffb9313e4e5aab353eae7 | 25.96 | 2:09 | Family home walkthrough |
| h-new-build | final-videos/Landscape/landscape-cinematic-8.mp4 | 7f4a0fcad11ce90f6b8eeec61390e323 | 13.05 | 1:05 | New build |
| h-bright-modern | final-videos/Landscape/landscape-cinematic-3.mp4 | e55b9477611ebd90d9d3422b68560757 | 19.58 | 1:07 | Bright modern home |
| h-yacht | final-videos/Landscape/landscape-cinematic-6.mp4 | 2945693f201eae65b4d796ff48e36618 | 2.28 | 0:55 | Luxury yacht · cinematic |
| t-listing-agent | the "Another happy client…" file in instagram-videos/ | — (`host: local`) | 0.3 | 1:09 | Listing agent (`sample: true`) |
| t-creator | the "Real feedback from a real client…" file | — (`host: local`) | 3.3 | 0:13 | Real estate creator (`sample: true`) |
| t-agency-owner | the "This is why I do what I do…" file | — (`host: local`) | 58.4 | 1:56 | Media agency owner (`sample: true`) |

The 31 portfolio rows (23 vertical, 8 horizontal) are every Stream upload; the user asked for all of them (2026-11-18). Labels for the 14 added rows were written from contact sheets and are editable.

- Other fixed values: `settings.heroLoop = {videoId: v-portfolio-reel, start: 13, duration: 14}`. `before-after.yaml`: `mode: reveal`, `reveal = {source: final-videos/Potrait/potrait-video-1.mp4, start: 31.62, duration: 2.83, slowdown: 1.4, cutAt: 1.5}`, `sample: true`. Screenshots `shot-01…06` are row `front`, `shot-07…12` row `back`, all `sample: true`. Highlight words: main `sell.`, agencies `brand.`, videographers `book more.`, agents `stand out.`. The legal drafts say that the final policy is added before launch. Video order: every version lists all 23 vertical and all 8 horizontal videos. Main uses the table order, except that `v-portfolio-reel` (also the hero) goes last of the vertical list and `h-yacht` goes last of the horizontal list. Agencies lead with v-agent-spotlight and h-agent-led, videographers with v-night-sky and h-modern-villa, agents with v-agent-spotlight and v-client-reveal; after the leads, each follows main's order. A page whose `videoOrder` repeats an id or leaves a catalog video out is allowed; the loader only checks that ids exist.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/content.test.ts
import { it, expect, beforeEach } from 'vitest';
import { loadSite, listPages, loadPage, loadSection } from '../../src/lib/content/load';
beforeEach(() => { delete process.env.CONTENT_DIR; });

it('loads every real content file', () => {
  expect(listPages().map((p) => p.slug)).toEqual(['', 'agencies', 'videographers', 'agents']);
  for (const s of ['nav', 'hero', 'recent-edits', 'who-its-for', 'how-it-works', 'before-after',
    'plans', 'booking', 'faq', 'final-cta', 'footer'] as const) expect(() => loadSection(s)).not.toThrow();
});
it('headlines match the copy deck', () => {
  expect(loadPage('').hero.headline).toEqual(['You shoot.', 'We edit.', 'Homes sell.']);
  expect(loadPage('agents').hero.headline).toEqual(['You list.', 'We edit.', 'You stand out.']);
});
it('booking rules match the spec', () => {
  expect(loadSite().booking).toEqual({ timeZone: 'Asia/Karachi', days: ['mon', 'tue', 'wed', 'thu', 'fri'],
    windowStart: '19:00', windowEnd: '02:00', slotMinutes: 15, bufferMinutes: 5, minNoticeMinutes: 60, horizonDays: 14 });
});
it('broken YAML names the file and line', () => {
  process.env.CONTENT_DIR = 'tests/fixtures/content-broken-yaml';
  expect(() => loadSite()).toThrowError(/site\.yaml.*line \d+/);
});
it('a missing field names the file and field', () => {
  process.env.CONTENT_DIR = 'tests/fixtures/content-missing-field';
  expect(() => loadPage('')).toThrowError(/pages\/main\.yaml.*hero\.subline/);
});
it('an unknown video id is named', () => {
  process.env.CONTENT_DIR = 'tests/fixtures/content-unknown-video';
  expect(() => listPages()).toThrowError(/v-nope/);
});
```

```ts
// tests/unit/samples.test.ts
import { it, expect } from 'vitest';
import { collectSamples, assertNoSamplesInProduction } from '../../src/lib/content/samples';
it('lists every sample item', () => {
  const s = collectSamples();
  expect(s).toHaveLength(16); // 3 testimonial videos + 12 screenshots + before/after
  expect(s.some((x) => x.includes('shot-01.jpg'))).toBe(true);
});
it('production mode refuses samples', () => {
  expect(() => assertNoSamplesInProduction('production')).toThrowError(/Sample content found[\s\S]*shot-01\.jpg/);
});
it('draft mode allows samples', () => { expect(() => assertNoSamplesInProduction('draft')).not.toThrow(); });
```

Fixtures hold only the files their test reads: `content-broken-yaml/site.yaml` (a tab-indented line); `content-missing-field/pages/main.yaml` (no `hero.subline`) and `videos.yaml`; `content-unknown-video/pages/*.yaml` (main's `videoOrder.vertical` includes `v-nope`) and `videos.yaml`.

- [ ] **Step 2: Run them.** `npx vitest run tests/unit/content.test.ts tests/unit/samples.test.ts`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement the schemas, loaders, errors and samples, and write all content files.** Approach: `js-yaml` `load(text, { filename })`. Turn a `YAMLException` into `ContentError` with `mark.line + 1`. Turn Zod issues into `ContentError` using the issue path joined with dots, e.g. `hero.subline`. Check cross-references (page `videoOrder`, testimonial `videoId`, `heroLoop.videoId`) against `videos.yaml`. Messages read `<relative file>: <problem> (field <path>)` or `(line <n>)`.
- [ ] **Step 4: Run them again.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat: content layer with validated, editable YAML files"`

---

### Task 3: Media preparation and video URLs

**Files:**
- Create: `scripts/prepare-media.mjs`, `src/lib/media.ts`, `public/brand/logo.png` (copy `.superpowers/brainstorm/849-1794948267/content/logo.png`), `public/media/screenshots/shot-01.jpg … shot-12.jpg` (copy `docs/samples/message-screenshots/web/`)
- Test: `tests/unit/media.test.ts`

**Interfaces:**
- Consumes: `Video`, `Site`, `getVideo`, `loadSite` (Task 2)
- Produces:

```ts
export interface ResolvedVideo { poster: string; play: { kind: 'file' | 'stream'; src: string } }
export function resolveVideo(video: Video, settings: Site['settings']): ResolvedVideo;
export function heroLoopSrc(): string;   // always '/media/clips/hero-loop.mp4' (served by the site, never Stream)
```

- Rules: posters are always `/media/posters/<id>.jpg`, served by the site in both modes. A video plays from Stream when its `host` (default `settings.videoSource`) is `stream`, and then it must have a `streamUid`. Otherwise it plays `/media/videos/<id>.mp4`.

- Generated file names: `public/media/posters/<id>.jpg` for every catalog video (360×640 vertical, 640×360 horizontal); `public/media/videos/<id>.mp4` only for videos that play locally (720×1280 or 1280×720, H.264 CRF 28, AAC 96k, `+faststart`); `public/media/clips/hero-loop.mp4` + `public/media/posters/hero-loop.jpg` (540×960, no audio, `+faststart`); in reveal mode `public/media/clips/ba-reveal.mp4` + `public/media/posters/ba-reveal.jpg` (540×960, `setpts=<slowdown>*PTS`, 30 fps, no audio); in slider mode `ba-before.mp4` / `ba-after.mp4` + their posters (540×960, no audio).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/media.test.ts
import { it, expect } from 'vitest';
import { resolveVideo, heroLoopSrc } from '../../src/lib/media';
import { getVideo, loadSite } from '../../src/lib/content/load';
const base = loadSite().settings;
const stream = { ...base, videoSource: 'stream' as const, streamCustomerCode: 'abc123' };

it('local mode serves prepared files', () => {
  expect(resolveVideo(getVideo('v-twilight-exterior'), { ...base, videoSource: 'local' })).toEqual({
    poster: '/media/posters/v-twilight-exterior.jpg',
    play: { kind: 'file', src: '/media/videos/v-twilight-exterior.mp4' } });
});
it('stream mode plays from Cloudflare; the poster stays on the site', () => {
  expect(resolveVideo({ ...getVideo('v-twilight-exterior'), streamUid: 'uid1' }, stream)).toEqual({
    poster: '/media/posters/v-twilight-exterior.jpg',
    play: { kind: 'stream', src: 'https://customer-abc123.cloudflarestream.com/uid1/iframe?autoplay=true&primaryColor=%231C45F5' } });
});
it('stream mode without a Stream ID names the video', () => {
  expect(() => resolveVideo({ ...getVideo('v-street-hook'), streamUid: undefined }, stream)).toThrowError(/v-street-hook/);
});
it('a video with host: local plays its file even in stream mode', () => {
  expect(resolveVideo(getVideo('t-creator'), stream).play).toEqual({ kind: 'file', src: '/media/videos/t-creator.mp4' });
});
it('the real content plays every portfolio video from Stream', () => {
  expect(base.videoSource).toBe('stream');
  expect(base.streamCustomerCode).toBe('yph9uum1du6x869b');
  expect(resolveVideo(getVideo('v-portfolio-reel'), base).play.src).toContain('/69f417a2079e8572ca2ec41802f03bc2/iframe');
});
it('the hero loop is always served by the site', () => {
  expect(heroLoopSrc()).toBe('/media/clips/hero-loop.mp4');
});
```

- [ ] **Step 2: Run them.** `npx vitest run tests/unit/media.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `resolveVideo` and `heroLoopSrc` in `src/lib/media.ts`.**
- [ ] **Step 4: Run them again.** Expected: PASS.
- [ ] **Step 5: Implement `scripts/prepare-media.mjs`.** It reads `content/videos.yaml`, `content/site.yaml` and `content/sections/before-after.yaml` with js-yaml and calls ffmpeg through `child_process.spawnSync`. Input seeking goes before `-i`. It skips any output newer than its source. It exits 1 with a clear message if ffmpeg or a source file is missing, and prints a summary line.
- [ ] **Step 6: Verify.** `npm run media` prints `posters: 36, videos: 3, clips: 2`: 34 catalog posters plus `hero-loop` and `ba-reveal`; the three local testimonial samples; the hero loop and the reveal clip. `ffprobe -v error -show_entries stream=width,height -of csv=p=0 public/media/posters/v-twilight-exterior.jpg` prints `360,640`. A second run prints `skipped` for every item.
- [ ] **Step 7: Commit.** `git add -A && git commit -m "feat: media preparation script and video URL resolver"` (`public/media/videos/` stays ignored; `public/media/clips/` is committed, because the site serves those clips itself).

---

### Task 4: Page shell: layout, nav, footer, mobile bar, versions, legal pages, 404, sample guard

**Files:**
- Create: `src/layouts/BaseLayout.astro`, `src/components/Nav.astro`, `Footer.astro`, `MobileBar.astro`, `SampleTag.astro`, `src/scripts/mobile-bar.ts`, `src/pages/[...slug].astro`, `src/pages/privacy.astro`, `terms.astro`, `404.astro`
- Delete: `src/pages/index.astro`
- Test: `tests/e2e/shell.spec.ts` (extend)

**Interfaces:**
- Consumes: the loaders from Task 2; `assertNoSamplesInProduction`
- Produces: `BaseLayout` props `{ seo: Page['seo'] }` with a default slot. `<html data-live3d-mobile>` is set from `settings.live3dOnMobile`. `[...slug].astro` `getStaticPaths()` returns one path per `listPages()` entry (`slug: undefined` for main) and calls `assertNoSamplesInProduction()`. The page body renders sections in mockup order; sections are added by later tasks. `SampleTag` props `{ show: boolean }`. `initMobileBar(): void` shows `[data-testid=mobile-bar]` once the hero CTA leaves the viewport (IntersectionObserver).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/e2e/shell.spec.ts (add)
import { listPages, loadSection, loadSite } from '../../src/lib/content/load';
for (const p of listPages()) {
  test(`"/${p.slug}" has its own title and robots rule`, async ({ page }) => {
    await page.goto('/' + p.slug);
    await expect(page).toHaveTitle(p.seo.title);
    const robots = page.locator('meta[name="robots"]');
    if (p.seo.noindex) await expect(robots).toHaveAttribute('content', /noindex/);
    else await expect(robots).toHaveCount(0);
  });
}
test('nav shows the logo and a booking button to #book', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('img', { name: loadSite().brand.name }).first()).toBeVisible();
  await expect(page.getByRole('navigation').getByRole('link', { name: loadSection('nav').cta.label }))
    .toHaveAttribute('href', '#book');
});
test('legal pages and the 404 page', async ({ page }) => {
  for (const path of ['/privacy', '/terms']) expect((await page.goto(path))?.status()).toBe(200);
  expect((await page.goto('/no-such-page'))?.status()).toBe(404);
  await expect(page.getByRole('link', { name: loadSection('hero').primaryCta.label })).toBeVisible();
});
test('phone: mobile bar appears after scrolling past the hero button', async ({ page, isMobile }) => {
  test.skip(!isMobile);
  await page.goto('/');
  await expect(page.getByTestId('mobile-bar')).toBeHidden();
  await page.getByRole('contentinfo').scrollIntoViewIfNeeded();
  await expect(page.getByTestId('mobile-bar')).toBeVisible();
});
```

- [ ] **Step 2: Run them.** `npx playwright test tests/e2e/shell.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the layout, components, routes and mobile-bar script.** Legal pages render `loadLegal()` Markdown with `marked`. A minimal hero CTA placeholder exists so the mobile bar has something to watch; Task 5 replaces it.
- [ ] **Step 4: Run them again.** Expected: PASS on both projects.
- [ ] **Step 5: Verify the sample guard.** `npx cross-env SITE_MODE=production npm run build` exits 1 and prints `Sample content found` followed by 16 items. `npm run build` (draft) succeeds.
- [ ] **Step 6: Commit.** `git add -A && git commit -m "feat: page shell, version routes, legal pages and sample guard"`

---

### Task 5: Hero and lightbox

**Files:**
- Create: `src/components/Hero.astro`, `HeroStage.astro`, `Lightbox.astro`, `src/scripts/hero-video.ts`, `src/scripts/lightbox.ts`
- Test: `tests/e2e/hero.spec.ts`

**Interfaces:**
- Consumes: `Page['hero']`, `loadSection('hero')`, `resolveVideo`, `heroLoopSrc`
- Produces:

```ts
// lightbox.ts — also auto-binds any element with data-lightbox='{"kind","src","orientation","title"}'
export function openLightbox(opts: { kind: 'file' | 'stream'; src: string; orientation: 'vertical' | 'horizontal'; title: string }): void;
export function closeLightbox(): void;   // pauses/clears media and restores focus to the opener
// hero-video.ts
export function initHeroVideo(): void;   // after window 'load': set src and play, unless reduced motion or saveData
```

- `HeroStage` renders `<button data-testid="hero-card" data-lightbox=…>` containing `<video data-testid="hero-video" muted loop playsinline preload="none" poster=… data-src=… controlslist="nodownload noplaybackrate" disablepictureinpicture>` with no `src` attribute in the HTML; `initHeroVideo` copies `data-src` into `src`. The headline's last line wraps `highlight` in `<span class="hl">`. When the page has `whyUs`, it renders as one line under the chips (`data-testid="why-us"`).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/e2e/hero.spec.ts
import { test, expect } from '@playwright/test';
import { listPages, loadSection, loadSite, getVideo } from '../../src/lib/content/load';
for (const p of listPages()) {
  test(`"/${p.slug}" shows its headline and highlight`, async ({ page }) => {
    await page.goto('/' + p.slug);
    const h1 = page.getByRole('heading', { level: 1 });
    for (const line of p.hero.headline) await expect(h1).toContainText(line);
    await expect(h1.locator('.hl')).toHaveText(p.hero.highlight);
  });
}
test('tailored versions show their why-us line; main has none', async ({ page }) => {
  for (const p of listPages()) {
    await page.goto('/' + p.slug);
    if (p.whyUs) await expect(page.getByTestId('why-us')).toHaveText(p.whyUs);
    else await expect(page.getByTestId('why-us')).toHaveCount(0);
  }
});
test('Instagram link uses the DM link from site.yaml', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: loadSection('hero').instagramCta.label }).first())
    .toHaveAttribute('href', loadSite().contact.instagramUrl);
});
test('desktop: the hero loop starts after load', async ({ page, isMobile }) => {
  test.skip(!!isMobile);
  await page.goto('/');
  await expect.poll(() => page.getByTestId('hero-video').evaluate((v: HTMLVideoElement) => !!v.currentSrc && !v.paused)).toBe(true);
});
test('reduced motion keeps the poster', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.waitForLoadState('load');
  await expect(page.getByTestId('hero-video')).not.toHaveAttribute('src', /.+/);
});
test('data saver keeps the poster, and the reel still opens', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'connection', { value: { saveData: true } }));
  await page.goto('/');
  await page.waitForLoadState('load');
  await expect(page.getByTestId('hero-video')).not.toHaveAttribute('src', /.+/);
  await page.getByTestId('hero-card').click();
  await expect(page.getByTestId('lightbox')).toBeVisible();
});
test('the hero opens the full reel from Stream; Escape closes and restores focus', async ({ page }) => {
  await page.goto('/');
  const card = page.getByTestId('hero-card');
  await card.click();
  await expect(page.getByTestId('lightbox').locator('iframe')).toHaveAttribute('src', new RegExp(getVideo('v-portfolio-reel').streamUid!));
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('lightbox')).toBeHidden();
  await expect(card).toBeFocused();
});
test('the hero loop is served by the site and offers no download or save menu', async ({ page }) => {
  await page.goto('/');
  const v = page.getByTestId('hero-video');
  await expect(v).toHaveAttribute('data-src', '/media/clips/hero-loop.mp4');
  await expect(v).toHaveAttribute('controlslist', /nodownload/);
  await expect(v).toHaveAttribute('disablepictureinpicture', '');
  expect(await page.getByTestId('hero-card').evaluate((el) =>
    !el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))).toBe(true);
});
```

- [ ] **Step 2: Run them.** `npx playwright test tests/e2e/hero.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the hero, stage, lightbox and scripts.** Match mockup section 01: glass plate, float card, chips, and the CTA to `#book`. Stream items open an `<iframe allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen>`; file items open a `<video controls autoplay playsinline>`. Vertical items open tall, horizontal ones wide.
- [ ] **Step 4: Run them again.** Expected: PASS on both projects.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat: hero with lazy loop video and accessible lightbox"`

---

### Task 6: Recent edits: vertical and horizontal carousels

**Files:**
- Create: `src/components/RecentEdits.astro`, `VideoCarousel.astro`, `VideoCard.astro`, `src/scripts/carousel.ts`
- Test: `tests/e2e/edits.spec.ts`, `tests/unit/carousel.test.ts`

**Interfaces:**
- Consumes: `Page['videoOrder']`, `getVideo`, `resolveVideo`, `loadSection('recent-edits')`, the lightbox's `data-lightbox` binding
- Produces:

```ts
export function shouldShowArrows(scrollWidth: number, clientWidth: number): boolean; // scrollWidth > clientWidth + 1
export function initCarousels(): void; // binds [data-carousel]; prev/next scroll by two card widths; hides arrows per shouldShowArrows on resize
```

- `VideoCarousel` props `{ orientation: 'vertical' | 'horizontal'; videos: Video[]; prevLabel: string; nextLabel: string }`. The track has `data-testid="vertical-track"` for the vertical one, and cards have `data-testid="vertical-card" | "horizontal-card"`. Arrows are hidden by CSS on phones.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/carousel.test.ts
import { it, expect } from 'vitest';
import { shouldShowArrows } from '../../src/scripts/carousel';
it('shows arrows only when the row overflows', () => {
  expect(shouldShowArrows(360, 390)).toBe(false);
  expect(shouldShowArrows(391, 390)).toBe(false);
  expect(shouldShowArrows(2000, 1128)).toBe(true);
});
```

```ts
// tests/e2e/edits.spec.ts
import { test, expect } from '@playwright/test';
import { listPages, getVideo, loadSection } from '../../src/lib/content/load';
const labels = (ids: string[]) => ids.map((id) => new RegExp(getVideo(id).label));
for (const p of listPages()) {
  test(`"/${p.slug}" lists its videos in its own order`, async ({ page }) => {
    await page.goto('/' + p.slug);
    await expect(page.getByTestId('vertical-card')).toHaveText(labels(p.videoOrder.vertical));
    await expect(page.getByTestId('horizontal-card')).toHaveText(labels(p.videoOrder.horizontal));
  });
}
test('desktop: the next arrow scrolls the vertical row', async ({ page, isMobile }) => {
  test.skip(!!isMobile);
  await page.goto('/');
  await page.getByRole('button', { name: loadSection('recent-edits').nextLabel }).first().click();
  await expect.poll(() => page.getByTestId('vertical-track').evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
});
test('tapping a card opens that video from Stream', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('vertical-card').first().click();
  await expect(page.getByTestId('lightbox').locator('iframe'))
    .toHaveAttribute('src', new RegExp(getVideo(listPages()[0].videoOrder.vertical[0]).streamUid!));
});
test('all 31 portfolio videos are listed, posters load lazily, and cards block the save menu', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('vertical-card')).toHaveCount(23);
  await expect(page.getByTestId('horizontal-card')).toHaveCount(8);
  await expect(page.getByTestId('vertical-card').nth(10).locator('img')).toHaveAttribute('loading', 'lazy');
  expect(await page.getByTestId('vertical-card').first().evaluate((el) =>
    !el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))).toBe(true);
});
```

- [ ] **Step 2: Run them.** `npx vitest run tests/unit/carousel.test.ts && npx playwright test tests/e2e/edits.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the components and `carousel.ts`.** Match mockup section 02: desktop shows 6 vertical cards (`(100% − 80px)/6`) and 2.35 horizontal cards, with a scroll-snap row and a right-edge fade; phones show 56% and 86% card widths and swipe. Labels show `label · duration`.
- [ ] **Step 4: Run them again.** Expected: PASS.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat: vertical and horizontal video carousels"`

---

### Task 7: Who it's for, How it works, Before/after

**Files:**
- Create: `src/components/WhoItsFor.astro`, `HowItWorks.astro`, `BeforeAfter.astro`, `src/scripts/before-after.ts`
- Test: `tests/e2e/sections.spec.ts`, `tests/unit/before-after.test.ts` (jsdom), `tests/unit/components.test.ts` (Astro Container API)

**Interfaces:**
- Consumes: `loadSection('who-its-for' | 'how-it-works' | 'before-after')`, `Page['showWhoItsFor']`, `settings.showBeforeAfter`, `SampleTag`
- Produces:

```ts
export function initReveal(el: HTMLElement): void;  // el contains <video> and [data-label=before|after]; toggles class "on" at data-cut-at seconds (rAF)
export function initSlider(el: HTMLElement): void;  // role="slider"; pointer drag + ArrowLeft/ArrowRight ±5, clamped 0–100; sets --pos and aria-valuenow
```

- `BeforeAfter` props `{ enabled: boolean; section: Sections['before-after'] }`; renders nothing when `enabled` is false. Reveal mode uses `/media/clips/ba-reveal.mp4` and `data-cut-at` = `reveal.cutAt`. Slider mode stacks `/media/clips/ba-before.mp4` and `ba-after.mp4` (muted, looped, started together); the after clip is clipped to `--pos`; `fullVideoId`, when set, adds a button that opens that video in the lightbox. Both modes follow the video protection rules.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/before-after.test.ts
// @vitest-environment jsdom
import { it, expect } from 'vitest';
import { initSlider } from '../../src/scripts/before-after';
it('arrow keys move the slider by 5 and clamp', () => {
  document.body.innerHTML = '<div role="slider" aria-valuenow="50" tabindex="0"></div>';
  const el = document.querySelector<HTMLElement>('[role=slider]')!;
  initSlider(el);
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
  expect(el.getAttribute('aria-valuenow')).toBe('55');
  expect(el.style.getPropertyValue('--pos')).toBe('55%');
  for (let i = 0; i < 30; i++) el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
  expect(el.getAttribute('aria-valuenow')).toBe('0');
});
```

```ts
// tests/unit/components.test.ts
import { it, expect } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import BeforeAfter from '../../src/components/BeforeAfter.astro';
import { loadSection } from '../../src/lib/content/load';
it('before/after renders nothing when disabled', async () => {
  const c = await AstroContainer.create();
  expect((await c.renderToString(BeforeAfter, { props: { enabled: false, section: loadSection('before-after') } })).trim()).toBe('');
});
it('slider mode renders an accessible slider', async () => {
  const c = await AstroContainer.create();
  const section = { ...loadSection('before-after'), mode: 'slider' as const,
    slider: { before: { source: 'a.mp4', start: 0, duration: 4 }, after: { source: 'b.mp4', start: 0, duration: 4 } } };
  expect(await c.renderToString(BeforeAfter, { props: { enabled: true, section } })).toMatch(/role="slider"[^>]*aria-valuenow="50"/);
});
```

```ts
// tests/e2e/sections.spec.ts
import { test, expect } from '@playwright/test';
import { loadSection } from '../../src/lib/content/load';
test('who-it\'s-for appears on the main version only and links to the three versions', async ({ page }) => {
  await page.goto('/');
  const hrefs = await page.getByTestId('who-its-for').getByRole('link').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  expect(hrefs).toEqual(['/agencies', '/videographers', '/agents']);
  for (const s of ['agencies', 'videographers', 'agents']) {
    await page.goto('/' + s);
    await expect(page.getByTestId('who-its-for')).toHaveCount(0);
  }
});
test('how it works shows the three steps', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('step')).toHaveText(loadSection('how-it-works').steps.map((s) => new RegExp(s.title)));
});
test('the reveal labels switch at the cut', async ({ page }) => {
  await page.goto('/');
  const ba = page.getByTestId('before-after'), { labels } = loadSection('before-after');
  const video = ba.locator('video');
  await video.evaluate((v: HTMLVideoElement) => { v.pause(); v.currentTime = 2.0; });
  await expect(ba.getByText(labels.after)).toHaveClass(/\bon\b/);
  await video.evaluate((v: HTMLVideoElement) => { v.currentTime = 0.5; });
  await expect(ba.getByText(labels.before)).toHaveClass(/\bon\b/);
});
```

- [ ] **Step 2: Run them.** `npx vitest run tests/unit/before-after.test.ts tests/unit/components.test.ts && npx playwright test tests/e2e/sections.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the three components and `before-after.ts`.** Match mockup sections 03–05: inline icons (no tile boxes), numbers with the lime marker, the sample note and the Sample tag.
- [ ] **Step 4: Run them again.** Expected: PASS.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat: who-it's-for, how-it-works and before/after sections"`

---

### Task 8: Client videos and message marquees

**Files:**
- Create: `src/components/ClientVideos.astro`, `MessageMarquee.astro`
- Test: `tests/e2e/clients.spec.ts`, `tests/unit/components.test.ts` (extend)

**Interfaces:**
- Consumes: `loadTestimonials`, `getVideo`, `resolveVideo`, `SampleTag`, the lightbox binding
- Produces: `MessageMarquee` props `{ shots: Testimonials['screenshots']; direction: 'right' | 'left'; layer: 'front' | 'back' }`. It renders a `[data-track]` holding every shot twice; the second copy is `aria-hidden="true"` with empty `alt`. The CSS animations are named `marquee-right` and `marquee-left` and translate by `calc(-50% - gap/2)`. Hover sets `animation-play-state: paused`; reduced motion sets `animation: none`. The back row tucks 34px (24px on phones) under the front row, with shorter cards and a softer card background. Do not lower its opacity, because a semi-transparent moving row renders blurry on phones.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/components.test.ts (add)
import MessageMarquee from '../../src/components/MessageMarquee.astro';
const shot = (n: number) => ({ file: `shot-${n}.jpg`, alt: 'x', row: 'front' as const, sample: true });
it.each([2, 20])('a marquee with %i shots renders a doubled track', async (n) => {
  const c = await AstroContainer.create();
  const html = await c.renderToString(MessageMarquee, { props: { shots: Array.from({ length: n }, (_, i) => shot(i)), direction: 'right', layer: 'front' } });
  expect(html.match(/data-testid="shot"/g)).toHaveLength(n * 2);
});
```

```ts
// tests/e2e/clients.spec.ts
import { test, expect } from '@playwright/test';
import { loadTestimonials } from '../../src/lib/content/load';
const t = loadTestimonials();
test('three testimonial cards with role labels and Sample tags', async ({ page }) => {
  await page.goto('/');
  const cards = page.getByTestId('testimonial-card');
  await expect(cards).toHaveCount(3);
  await expect(cards).toContainText(t.videos.map((v) => v.role));
  await expect(cards.getByText('Sample', { exact: true })).toHaveCount(3);
});
test('front row moves right, back row moves left', async ({ page }) => {
  await page.goto('/');
  const anim = (row: string) => page.getByTestId(`marquee-${row}`).locator('[data-track]').evaluate((el) => getComputedStyle(el).animationName);
  expect(await anim('front')).toBe('marquee-right');
  expect(await anim('back')).toBe('marquee-left');
});
test('each row shows its screenshots twice', async ({ page }) => {
  await page.goto('/');
  for (const row of ['front', 'back'] as const) {
    const n = t.screenshots.filter((s) => s.row === row).length;
    await expect(page.getByTestId(`marquee-${row}`).getByTestId('shot')).toHaveCount(n * 2);
    await expect(page.getByTestId(`marquee-${row}`).locator('[data-testid="shot"][aria-hidden="true"]')).toHaveCount(n);
  }
});
test('reduced motion stops the marquees', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  expect(await page.getByTestId('marquee-front').locator('[data-track]').evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
});
test('desktop: hovering a row pauses it', async ({ page, isMobile }) => {
  test.skip(!!isMobile);
  await page.goto('/');
  const row = page.getByTestId('marquee-front');
  await row.hover();
  expect(await row.locator('[data-track]').evaluate((el) => getComputedStyle(el).animationPlayState)).toBe('paused');
});
```

- [ ] **Step 2: Run them.** `npx vitest run tests/unit/components.test.ts && npx playwright test tests/e2e/clients.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement both components.** Match mockup section 06: card heights 270/236px on desktop and 184/160px on phones, a tight shadow and no hairline border, the Sample tag top-left, and the inline 06b note.
- [ ] **Step 4: Run them again.** Expected: PASS.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat: client video cards and two-row message marquee"`

---

### Task 9: Plans, FAQ, final call to action

**Files:**
- Create: `src/components/Plans.astro`, `Faq.astro`, `FinalCta.astro`
- Test: `tests/e2e/plans.spec.ts`

**Interfaces:**
- Consumes: `loadSection('plans' | 'faq' | 'final-cta')`, `Page['pricingOrder']`
- Produces: `Plans` props `{ order: 'plans-first' | 'single-first' }`. The terms line is built as ``${minimumPerMonth}+ videos a month · ${revisions} revision${revisions > 1 ? 's' : ''}``. FAQ items are `<details><summary>`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/e2e/plans.spec.ts
import { test, expect } from '@playwright/test';
import { listPages, loadSection } from '../../src/lib/content/load';
test('plans show prices and terms from content', async ({ page }) => {
  await page.goto('/');
  const cards = page.getByTestId('plan-card'), { plans } = loadSection('plans');
  await expect(cards).toHaveCount(plans.length);
  for (const [i, p] of plans.entries()) {
    await expect(cards.nth(i)).toContainText(`$${p.price}`);
    await expect(cards.nth(i)).toContainText(`${p.minimumPerMonth}+ videos a month · ${p.revisions} revision${p.revisions > 1 ? 's' : ''}`);
  }
});
test('pricing order follows each version', async ({ page }) => {
  for (const p of listPages()) {
    await page.goto('/' + p.slug);
    const singleFirst = await page.getByTestId('single-bar').evaluate((s) =>
      !!(s.compareDocumentPosition(document.querySelector('[data-testid="plan-card"]')!) & Node.DOCUMENT_POSITION_FOLLOWING));
    expect(singleFirst).toBe(p.pricingOrder === 'single-first');
  }
});
test('phone: plans are stacked in full, no sideways scrolling', async ({ page, isMobile }) => {
  test.skip(!isMobile);
  await page.goto('/');
  const vw = page.viewportSize()!.width;
  for (const w of await page.getByTestId('plan-card').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width))) expect(w).toBeGreaterThan(vw * 0.8);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
test('FAQ opens an answer', async ({ page }) => {
  await page.goto('/');
  const first = loadSection('faq').items[0];
  await page.getByText(first.q).click();
  await expect(page.getByText(first.a)).toBeVisible();
});
```

- [ ] **Step 2: Run them.** `npx playwright test tests/e2e/plans.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the three components.** Match mockup sections 07, 09 and 10: the featured Advanced AI card with its badge, plan names aligned (`min-height` on the name row), the single-video bar, the free-edit note, and the final CTA with the highlight.
- [ ] **Step 4: Run them again.** Expected: PASS.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat: plans, FAQ and final call to action"`

---

### Task 10: Slot engine

**Files:**
- Create: `src/lib/booking/slots.ts`, `src/lib/booking/format.ts`
- Test: `tests/unit/slots.test.ts`, `tests/unit/format.test.ts`

**Interfaces:**
- Consumes: `Site['booking']` (type `BookingRules`)
- Produces:

```ts
export interface Slot { start: string; end: string }       // ISO 8601 UTC, e.g. '2026-11-23T14:00:00.000Z'
export interface Interval { start: string; end: string }
export function generateSlots(rules: BookingRules, now: Date, busy?: Interval[]): Slot[];
export function groupByLocalDay(slots: Slot[], timeZone: string, locale?: string): Array<{ day: string; label: string; slots: Slot[] }>; // day 'YYYY-MM-DD', label 'Mon, Nov 23'
export function formatSlotTime(slot: Slot, timeZone: string, locale?: string): string; // '9:00 AM'
export function formatSlotLong(slot: Slot, timeZone: string, locale?: string): string; // 'Monday, November 23, 9:00 AM EST'
```

- Algorithm (no date library): for each calendar date D in `rules.timeZone`, from yesterday to `horizonDays` ahead, where D's weekday is in `days`:
  1. The window starts at D + `windowStart`. It ends at D + `windowEnd`, or the next day when `windowEnd` ≤ `windowStart`.
  2. Convert local time to UTC by reading the zone's offset for that instant with `Intl.DateTimeFormat(…, { timeZone, timeZoneName: 'longOffset' })`.
  3. Step by `slotMinutes + bufferMinutes`. Emit `[t, t + slotMinutes]` while `t + slotMinutes` ≤ window end.
  4. Keep slots with `t ≥ now + minNoticeMinutes` and `t < now + horizonDays`.
  5. Drop slots that overlap a `busy` interval.

  Formatters build the date part and the time part with separate `Intl` calls and join them with `", "`. They replace U+202F (narrow no-break space) with a normal space.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/slots.test.ts
import { it, expect } from 'vitest';
import { generateSlots } from '../../src/lib/booking/slots';
const rules = { timeZone: 'Asia/Karachi', days: ['mon', 'tue', 'wed', 'thu', 'fri'] as const, windowStart: '19:00', windowEnd: '02:00',
  slotMinutes: 15, bufferMinutes: 5, minNoticeMinutes: 60, horizonDays: 14 };
const at = (iso: string) => new Date(iso);
const starts = (now: string, busy?: { start: string; end: string }[]) => generateSlots({ ...rules, days: [...rules.days] }, at(now), busy).map((s) => s.start);

it('a Monday window has 21 slots from 7:00 PM to 1:40 AM Pakistan time', () => {
  const mon = starts('2026-11-23T05:00:00Z').filter((s) => s < '2026-11-23T21:00:00.000Z');
  expect(mon).toHaveLength(21);
  expect(mon[0]).toBe('2026-11-23T14:00:00.000Z');
  expect(mon[20]).toBe('2026-11-23T20:40:00.000Z');
});
it('slots are 15 minutes long and 20 minutes apart', () => {
  const s = generateSlots({ ...rules, days: [...rules.days] }, at('2026-11-23T05:00:00Z'));
  expect(Date.parse(s[0].end) - Date.parse(s[0].start)).toBe(15 * 60_000);
  expect(Date.parse(s[1].start) - Date.parse(s[0].start)).toBe(20 * 60_000);
});
it('respects the 60-minute minimum notice', () => {
  expect(starts('2026-11-23T13:30:00Z')[0]).toBe('2026-11-23T14:40:00.000Z');
});
it("Friday's window runs past midnight into Saturday, Pakistan time", () => {
  expect(starts('2026-11-27T10:00:00Z')).toContain('2026-11-27T20:40:00.000Z');
});
it('no windows start on Saturday or Sunday', () => {
  expect(starts('2026-11-28T00:00:00Z')[0]).toBe('2026-11-30T14:00:00.000Z');
});
it('nothing beyond the 14-day horizon', () => {
  const now = '2026-11-23T05:00:00Z';
  expect(starts(now).every((s) => Date.parse(s) < Date.parse(now) + 14 * 86_400_000)).toBe(true);
});
it('busy time removes overlapping slots', () => {
  const s = starts('2026-11-23T05:00:00Z', [{ start: '2026-11-23T14:05:00.000Z', end: '2026-11-23T14:25:00.000Z' }]);
  expect(s).not.toContain('2026-11-23T14:00:00.000Z');
  expect(s).not.toContain('2026-11-23T14:20:00.000Z');
  expect(s).toContain('2026-11-23T14:40:00.000Z');
});
```

```ts
// tests/unit/format.test.ts
import { it, expect } from 'vitest';
import { formatSlotTime, formatSlotLong, groupByLocalDay } from '../../src/lib/booking/format';
const slot = (start: string) => ({ start, end: new Date(Date.parse(start) + 15 * 60_000).toISOString() });
it('9:00 AM in New York in November', () => {
  expect(formatSlotTime(slot('2026-11-23T14:00:00.000Z'), 'America/New_York', 'en-US')).toBe('9:00 AM');
  expect(formatSlotLong(slot('2026-11-23T14:00:00.000Z'), 'America/New_York', 'en-US')).toBe('Monday, November 23, 9:00 AM EST');
});
it('10:00 AM after US daylight saving starts', () => {
  expect(formatSlotTime(slot('2027-03-15T14:00:00.000Z'), 'America/New_York', 'en-US')).toBe('10:00 AM');
});
it('Hawaii sees 4:00 AM', () => {
  expect(formatSlotTime(slot('2026-11-23T14:00:00.000Z'), 'Pacific/Honolulu', 'en-US')).toBe('4:00 AM');
});
it('groups by the visitor\'s local day', () => {
  const g = groupByLocalDay([slot('2026-11-23T14:00:00.000Z'), slot('2026-11-24T14:00:00.000Z')], 'America/New_York', 'en-US');
  expect(g.map((d) => d.label)).toEqual(['Mon, Nov 23', 'Tue, Nov 24']);
});
```

- [ ] **Step 2: Run them.** `npx vitest run tests/unit/slots.test.ts tests/unit/format.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `slots.ts` and `format.ts`** as described above.
- [ ] **Step 4: Run them again.** Expected: PASS.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat: booking slot engine and visitor-time formatting"`

---

### Task 11: Booking section (demo mode)

**Files:**
- Create: `src/components/Booking.astro`, `src/scripts/booking-ui.ts`, `src/lib/booking/api-client.ts`
- Test: `tests/e2e/booking.spec.ts`

**Interfaces:**
- Consumes: `generateSlots`, `groupByLocalDay`, `formatSlotTime`, `formatSlotLong` (Task 10); `loadSection('booking')`; `Page['preselectBuyer']`
- Produces (Phase 2 adds `httpApi()` with the same shape):

```ts
export type BuyerType = 'agency' | 'videographer' | 'agent' | 'other';
export interface LeadInput { name: string; email: string; phone?: string; buyerType: BuyerType; volume: string; footageUrl?: string; pageVersion: string; utm: Record<string, string> }
export interface BookingApi {
  createLead(input: LeadInput): Promise<{ leadId: string }>;
  getSlots(): Promise<Slot[]>;
  confirm(leadId: string, slot: Slot): Promise<{ start: string }>;
}
export function demoApi(rules: BookingRules, now?: () => Date): BookingApi;
export function initBooking(root: HTMLElement, api: BookingApi): void;  // in booking-ui.ts
```

- Steps are details → time → done. Buyer and volume choices are radio inputs styled as pills. Validation: the name must be non-empty after trimming; the email must match `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`. The visitor's zone comes from `Intl.DateTimeFormat().resolvedOptions().timeZone`. UTM parameters are read from `location.search`. The demo note is visible while `SITE_MODE` is not `production`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/e2e/booking.spec.ts
import { test, expect } from '@playwright/test';
import { loadSection } from '../../src/lib/content/load';
const b = loadSection('booking');
test.use({ timezoneId: 'America/New_York' });
test.beforeEach(async ({ page }) => { await page.clock.setFixedTime(new Date('2026-11-23T13:00:00Z')); });

test('an empty submit shows the messages from content', async ({ page }) => {
  await page.goto('/#book');
  await page.getByRole('button', { name: b.nextLabel }).click();
  await expect(page.getByText(b.errors.name)).toBeVisible();
  await expect(page.getByText(b.errors.email)).toBeVisible();
});
test('versions preselect the buyer type', async ({ page }) => {
  await page.goto('/agents#book');
  await expect(page.getByRole('radio', { name: 'Agent', exact: true })).toBeChecked();
  await page.goto('/agencies#book');
  await expect(page.getByRole('radio', { name: 'Media agency' })).toBeChecked();
});
test('international details, first slot at 9:00 AM New York time, confirmation', async ({ page }) => {
  await page.goto('/#book');
  await page.getByLabel(b.fields.name).fill("José María O'Brien-Núñez");
  await page.getByLabel(b.fields.email).fill('jose+listing@example.co.uk');
  await page.getByRole('button', { name: b.nextLabel }).click();
  const first = page.getByTestId('slot').first();
  await expect(first).toHaveText('9:00 AM');
  await first.click();
  await page.getByRole('button', { name: b.confirmLabel }).click();
  await expect(page.getByTestId('booking-done')).toContainText('Monday, November 23, 9:00 AM EST');
  await expect(page.getByTestId('booking-done')).toContainText('jose+listing@example.co.uk');
});
test('the demo note is visible in draft mode', async ({ page }) => {
  await page.goto('/#book');
  await expect(page.getByText(b.demoNote)).toBeVisible();
});
test('booking buttons scroll to the booking section', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: loadSection('hero').primaryCta.label }).first().click();
  await expect(page.getByTestId('booking')).toBeInViewport();
});
```

- [ ] **Step 2: Run them.** `npx playwright test tests/e2e/booking.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `Booking.astro`, `booking-ui.ts` and `api-client.ts`.** Match mockup section 08: two columns, the stepper, a step-2 date strip with slot buttons (`data-testid="slot"`), and the confirmation panel (`data-testid="booking-done"`). On phones it's one column and the date strip scrolls sideways.
- [ ] **Step 4: Run them again.** Expected: PASS on both projects.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat: booking flow UI on a demo API"`

---

### Task 12: 3D objects (live on desktop, stills on phones)

**Files:**
- Create: `src/scripts/three/objects.ts`, `src/scripts/three/scene.ts`, `src/scripts/three/loader.ts`, `src/components/Three3D.astro`, `scripts/render-3d-stills.mjs`, `public/media/3d/hero-play.webp`, `hero-camera.webp`, `hero-pause.webp`, `booking-pause.webp`
- Modify: `astro.config.mjs` (Vite `manualChunks`: put `three` and `src/scripts/three/scene.ts` in a chunk named `three`); place `Three3D` slots in `HeroStage`, `WhoItsFor`, `Plans`, `Booking`, `FinalCta`
- Test: `tests/e2e/three.spec.ts`

**Interfaces:**
- Produces:

```ts
export type ObjectKind = 'play' | 'pause' | 'camera' | 'reel';
export type Finish = 'blue' | 'lime' | 'chrome' | 'navy';
export function createObject(kind: ObjectKind, finish: Finish): THREE.Group;                      // objects.ts
export function mountScene(canvases: HTMLCanvasElement[], opts: { animate: boolean }): () => void;  // scene.ts; sets data-ready="true" after the first render, data-animating
export function initThree(): void;  // loader.ts (main bundle, tiny): live if (min-width:1061px) or <html data-live3d-mobile="true">, and not reduced motion → import('./scene')
```

- Seven slots (`Three3D` props `{ slot: string; kind: ObjectKind; finish: Finish; behind?: boolean }`), placed as in the mockup:

| slot | kind/finish |
|---|---|
| hero-play | play/blue |
| hero-camera | camera/navy |
| hero-pause | pause/lime, behind the glass |
| who-reel | reel/chrome |
| plans-play | play/chrome (lime glyph) |
| booking-pause | pause/blue, behind |
| final-camera | camera/navy |

  Phones show only the four stills (hero-play, hero-camera, hero-pause, booking-pause) with a CSS float. Materials, lights, float and pointer-lean values come from the mockup's script.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/e2e/three.spec.ts
import { test, expect } from '@playwright/test';
test('desktop: seven 3D objects render', async ({ page, isMobile }) => {
  test.skip(!!isMobile);
  await page.goto('/');
  const canvases = page.getByTestId('three-canvas');
  await expect(canvases).toHaveCount(7);
  for (const c of await canvases.all()) { await c.scrollIntoViewIfNeeded(); await expect(c).toHaveAttribute('data-ready', 'true'); }
});
test('desktop with reduced motion renders once and does not animate', async ({ page, isMobile }) => {
  test.skip(!!isMobile);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByTestId('three-canvas').first()).toHaveAttribute('data-animating', 'false');
});
test('phone: still images only, three.js never downloaded', async ({ page, isMobile }) => {
  test.skip(!isMobile);
  const scripts: string[] = [];
  page.on('request', (r) => { if (r.resourceType() === 'script') scripts.push(r.url()); });
  await page.goto('/');
  await page.mouse.wheel(0, 20000);
  await page.waitForLoadState('networkidle');
  expect(scripts.filter((u) => /three/i.test(u))).toEqual([]);
  await expect(page.getByTestId('three-still').first()).toBeVisible();
  await expect(page.getByTestId('three-still')).toHaveCount(4);
});
```

- [ ] **Step 2: Run them.** `npx playwright test tests/e2e/three.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the objects, scene, loader and component.** Port the four builders from the mockup's script. Each canvas pauses when off screen (IntersectionObserver) and resizes with a ResizeObserver.
- [ ] **Step 4: Implement `scripts/render-3d-stills.mjs`.** It opens the built site at 1440×900 in Playwright with system Chrome and `reducedMotion: 'reduce'`. It screenshots the four canvases with `omitBackground: true` and converts the PNGs to WebP with ffmpeg (`-c:v libwebp -q:v 80`, alpha kept), writing to `public/media/3d/<slot>.webp`.
- [ ] **Step 5: Verify the stills.** Run `npm run build && npm run stills`. Expected: four files are written. `ffprobe -v error -show_entries stream=pix_fmt -of csv=p=0 public/media/3d/hero-play.webp` prints `yuva420p`, meaning transparency was kept.
- [ ] **Step 6: Run the tests again.** Expected: PASS.
- [ ] **Step 7: Commit.** `git add -A && git commit -m "feat: video-themed 3D objects with phone stills"`

---

### Task 13: Quality pass and the editing guide

**Files:**
- Create: `tests/e2e/quality.spec.ts`, `HOW-TO-EDIT.md`
- Modify: whichever components the new tests show need fixing

**Interfaces:**
- Consumes: everything above

- [ ] **Step 1: Write the failing tests**

```ts
// tests/e2e/quality.spec.ts
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { gzipSync } from 'node:zlib';
import { listPages } from '../../src/lib/content/load';

test('phone: initial JavaScript under 50 KB gzipped, poster under 80 KB, fonts under 100 KB', async ({ page, isMobile }) => {
  test.skip(!isMobile);
  const bodies: Promise<{ type: string; url: string; size: number }>[] = [];
  page.on('response', (r) => bodies.push(r.body().then((b) => ({ type: r.request().resourceType(), url: r.url(), size: gzipSync(b).length })).catch(() => ({ type: '', url: '', size: 0 }))));
  await page.goto('/', { waitUntil: 'load' });
  const all = await Promise.all(bodies);
  expect(all.filter((x) => x.type === 'script').reduce((n, x) => n + x.size, 0)).toBeLessThan(50 * 1024);
  expect(all.find((x) => /hero-loop\.jpg$/.test(x.url))!.size).toBeLessThan(80 * 1024);
  expect(all.filter((x) => x.type === 'font').reduce((n, x) => n + x.size, 0)).toBeLessThan(100 * 1024);
});
test('layout shift stays under 0.05', async ({ page }) => {
  await page.goto('/');
  const cls = await page.evaluate(() => new Promise<number>((res) => {
    let s = 0;
    new PerformanceObserver((l) => { for (const e of l.getEntries() as any[]) if (!e.hadRecentInput) s += e.value; })
      .observe({ type: 'layout-shift', buffered: true });
    setTimeout(() => res(s), 1500);
  }));
  expect(cls).toBeLessThan(0.05);
});
for (const p of listPages()) {
  test(`axe: "/${p.slug}" has no serious or critical issues`, async ({ page }) => {
    await page.goto('/' + p.slug);
    const r = await new AxeBuilder({ page }).analyze();
    expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
  });
}
```

- [ ] **Step 2: Run them.** `npx playwright test tests/e2e/quality.spec.ts`. Expected: FAIL or PASS. Fix whatever fails (budgets, contrast, missing names) until it passes.
- [ ] **Step 3: Write `HOW-TO-EDIT.md`.** It has a table of "what you want to change → file → example" covering:
  - every content file
  - replacing screenshots (same file names in `public/media/screenshots/`, or new names listed in `testimonials.yaml`)
  - adding or reordering videos: upload to Cloudflare Stream, paste its ID into `videos.yaml` with the local source file, run `npm run media` for the poster, and add the id to each page's `videoOrder`
  - replacing the section 05 clips (`before-after.yaml` + `npm run media`) and the hero loop (`site.yaml` `heroLoop`)
  - booking hours (`site.yaml`)
  - removing samples (`sample: false` once real content is in)
  - seeing changes (`npm run dev`, then refresh)
  - what an error message looks like and how to read it
- [ ] **Step 4: Run the full suite.** `npm test && npx playwright test`. Expected: everything passes on both projects.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "test: budgets and accessibility; docs: how to edit the site"`
