# HiveGen sales website: design

**Date:** 2026-11-18 · **Status:** draft, waiting for your approval
**Mockup:** `docs/mockup/index.html` (open it in a browser; the 3D shapes and fonts need internet)
**All site text:** `docs/design/2026-11-18-hivegen-copy-deck.md` (edit it freely; it is the source for the site's words)
**Placeholder screenshot prompts:** `docs/design/meshy-message-prompts.md`

Items marked **[you]** need an answer from you or Hassan. Items marked **[my call]** are decisions I made; change any of them.

---

## 1. What this is and why

HiveGen LLC sells outsourced, white-label video editing for real estate. Buyers shoot raw footage; HiveGen returns a polished, hook-first listing video in 24–48 hours.

The site exists to turn paid traffic (Facebook and Instagram ads, Google ads including Gmail placements) into **booked 15-minute calls**. The reason to book: **the first edit is free** (it comes watermarked; the buyer pays the normal price to use it).

Success means booked calls, recorded as a conversion in Meta and Google, at a falling cost per booked call.

## 2. Who it's for

| Buyer | What they buy | What they must believe before booking |
|---|---|---|
| Real estate media agencies | Ongoing, high-volume editing they resell to realtors under their own brand | Quality holds at volume, deadlines are met, white-label is real |
| Independent real estate videographers | Editing of the shoots they film, so they can shoot more | It saves them time, the style matches theirs, the price leaves them margin |
| Agents building a personal brand | Branded listing videos to post | It makes them look good, it's easy, it fits a small budget |

## 3. Goals, non-goals, anti-goals

**Goals**
- One action everywhere: book a call. Second path: chat on Instagram (@hasan.drp).
- Each ad lands on a page version that repeats the ad's promise.
- Fast on phones inside the Facebook/Instagram in-app browser.
- Booking feels like part of the site, and every booking is reported to Meta and Google.
- Every word, price, video and image can be changed by editing files, without touching code.

**Non-goals for version 1:** blog, CMS, client portal, uploading raw footage on the site (buyers share a link), payments, other languages, an admin dashboard.

**Anti-goals (failure even if it "works")**
- A heavy page that loads slowly on a phone.
- Sending visitors to a third-party booking page.
- Unverifiable claims, and **sample testimonials going live**: fake reviews break FTC rules and Meta/Google ad policies. The build refuses a production release while any testimonial is marked `sample`.

## 4. Decisions so far

| Area | Decision | Who |
|---|---|---|
| Look | Off-white `#FFF9EB` background, blue `#1C45F5` and lemon-green `#D3FF52` used sparingly, light glassmorphism, minimal | you |
| Fonts | Archivo (headlines, extra-wide) and Montserrat (body) | you |
| Desktop extras | Light grid behind the page; video-themed 3D objects (play, pause, camera, film reel) that float gently | you |
| Mobile 3D | Still images of the same objects; one setting turns live 3D on | you |
| Structure | One design: a main version plus three tailored versions (agencies, videographers, agents) | you |
| Pricing on page | Plans: Basic $60/video (30+/month, 1 revision), Premium $100 (15+, 2), Advanced AI $150 (10+, 2). Single videos from $90, priced by complexity | you |
| Offer | First edit free with watermark; 24–48h delivery; white-label | you |
| Booking | Fully custom flow, connected to Hassan's Google Calendar | you |
| Booking rules | 15-minute calls, 5-minute gap, 7:00 PM–2:00 AM Pakistan time (UTC+5), at least 1 hour's notice | you |
| Ad market | United States only | you |
| Booking days | Monday–Friday US time (evening windows that start Monday–Friday in Pakistan) | you |
| Section 05 | **PENDING (2026-11-18):** you'll send a raw clip and its edited version on 2026-11-19, which switches the section to slider mode. The day-to-dusk loop from `potrait-video-1.mp4` stays as a stand-in until they arrive. Both clips are short MP4s on Hostinger, not Stream | you |
| Hosting | Hostinger Business (Node.js web app) with MySQL | you |
| Video hosting | Cloudflare Stream from Phase 1 for every portfolio video (all 31 uploads). Two exceptions are short silent MP4s served from Hostinger: the hero loop and the section 05 clips. Tapping either one plays the full video from Stream (2026-11-18) | you |
| Testimonials | Placeholders for now, with general role labels instead of names; real ones later | you |
| Framework | Astro with the Node adapter | my call |

## 5. Approaches considered

**Booking (you picked 1).**
1. *Custom flow on Google Calendar:* our form and time picker; times read from Hassan's calendar; Google event with Meet link; leads in MySQL; full tracking. Most build work.
2. *Cal.com embedded:* faster; the calendar step looks close but not identical; one more outside service.
3. *Google's own booking page embedded:* quickest; looks like Google and cannot report bookings to the ad platforms.

**Structure (you picked 2).** 1: one page for all buyers (general message). 2: one design with three tailored versions (message match, small extra work). 3: three fully separate pages (only worth it if each buyer were sold differently).

**Framework (my call: Astro).** Next.js would work but ships React to every visitor, which is slower in in-app browsers. Plain HTML would make four versions and a booking backend hard to maintain. Astro sends almost no JavaScript by default, builds all versions from one template, reads content from files, and runs the booking API on the same Node server. Hostinger lists Astro as supported.

**Video hosting (you picked Cloudflare Stream).** Self-hosting on Hostinger would spend the server's bandwidth on video and has no adaptive streaming. Stream encodes, stores and delivers video from Cloudflare's network.

## 6. Pages and URLs

| URL | What | Indexed by Google |
|---|---|---|
| `/` | Main version (all three buyers) | yes |
| `/agencies`, `/videographers`, `/agents` | Tailored versions for ads | no **[my call]**: ad pages stay out of search results |
| `/booking/<token>` | Reschedule or cancel a booking (link in emails) | no |
| `/privacy`, `/terms` | Legal pages (needed for ads and data collection) | yes |
| `404` | Short page with the booking button | no |

Ads link to the matching version with UTM tags, e.g. `/agents?utm_source=facebook&utm_campaign=agents-q1`.

## 7. Page sections

Same ten sections on every version (numbers match the mockup). Sections marked "tailored" change per version.

| # | Section | Notes |
|---|---|---|
| 01 | Hero | **Tailored** eyebrow, headline, subline and chips. Portfolio reel plays as a 14 s silent loop in a glass frame; tap opens the full 58 s reel with sound. 3D: play button, camera, pause bars. |
| 02 | Recent edits | Vertical carousel (9:16, all 23 portrait uploads) and horizontal carousel (16:9, all 8 landscape uploads); the user wants every client video shown as the portfolio (2026-11-18). Cards load only a small poster when near the screen; nothing plays until tapped. **Tailored** order: each version leads with its best-matching videos. Arrows on desktop, swipe on mobile. Cards show a poster; tap opens the video. |
| 03 | Who it's for | **Main version only**: three cards linking to the tailored versions. |
| 04 | How it works | Three steps: book, send footage, get the video in 24–48h. |
| 05 | Before / after | **PENDING: you send a raw clip and its edit on 2026-11-19; then switch to slider mode and drop the stand-in below.** Two modes, chosen in `content/sections/before-after.yaml`. **Reveal (stand-in):** a 4-second silent loop of the real daylight-to-dusk cut in `potrait-video-1.mp4` (31.62–34.45 s, slowed 1.4×); "Before · daylight" and "After · dusk" labels switch at the cut (1.5 s). **Slider (later):** drag to compare a raw clip with its edit, once you supply a pair. Marked `sample` until you confirm the dusk shot was created in editing. `showBeforeAfter` can hide the section. |
| 06 | Client videos + messages | Video testimonials (cards labelled by role) plus two marquee rows of message screenshots: front row moves right, back row moves left and sits slightly behind; both pause on hover. Placeholders now. |
| 07 | Plans | Three plan cards; single-video bar; free-first-edit note. **Tailored** order: agencies see plans first; videographers and agents see the single-video bar first. Mobile: plans stacked in full (no swiping). |
| 08 | Book a call | The booking flow (section 10 below). Every booking button on the page scrolls here. **Tailored**: "I am a…" is preselected. |
| 09 | FAQ | Six to eight questions (copy deck). |
| 10 | Final call to action + footer | Booking button, Instagram link, legal links. |
| — | Mobile bar | Pinned "Book a call · first edit free" + Instagram button; appears after the visitor scrolls past the hero button. |

## 8. Visual system

- **Colors:** background `#FFF9EB`; text navy-black `#0E1233`; secondary text `#4A4F6A`; muted text `#6B6F88` (4.7:1 on the background, the lightest allowed for text); blue `#1C45F5` for links, key words and buttons (6.2:1); lemon-green `#D3FF52` **only as a fill behind dark text** (button hover, highlighter under links and key words, check marks, small badges). Never lemon-green text.
- **Type:** Archivo at extra-wide width (125) and weight 800 for headlines; Montserrat 400–700 for everything else. Self-hosted, Latin subset, the headline font preloaded.
- **Glass:** white at 50% over the background, 18px blur, white hairline border, soft navy shadow. Glass needs something behind it: soft blue/green blurred blobs, the desktop grid (80px, 6% navy), and 3D objects placed partly behind cards.
- **Hover:** buttons turn lemon-green with navy text; links get a lemon-green highlighter that wipes in; video cards lift and get a blue ring; play buttons fill lemon-green.
- **3D (desktop):** play button, pause bars, camera, film reel; chrome, glossy blue and glossy lemon-green materials; slow float plus a slight lean toward the mouse. Loaded only on desktop, after the page is ready, paused when off screen.
- **3D (mobile):** pre-rendered stills of the same objects (rendered once from the same scenes), with a gentle CSS float. Setting `live3dOnMobile: true` switches phones to the live version.
- **Motion and access:** respects "reduce motion" (stops 3D, marquees and the hero loop; shows the poster). Visible focus rings. Carousels and the video lightbox work with the keyboard.
- **Breakpoints:** phone ≤ 640px, tablet ≤ 1060px, desktop above. Phone: one column, no grid, swipe rows for videos and client clips, stacked plans, pinned bottom bar.

## 9. Video: Cloudflare Stream

- **Catalog:** every video is one entry in `content/videos.yaml` (title, label, duration, orientation, Stream ID, poster time, local file for draft mode).
- **Hero loop:** a separate 14 s clip of the portfolio reel, uploaded as its own Stream video with MP4 download turned on, played in a muted, looping `<video>` that starts only after the page has loaded. The poster image is served by the site so the first view appears instantly. **[my call]** If the MP4 approach behaves badly in testing, fall back to HLS playback with the hls.js library.
- **Cards:** show a still poster (Stream thumbnail URL, or a local poster file if set). Nothing streams until a tap.
- **Lightbox:** a tap loads the Stream Player (`customer-<CODE>.cloudflarestream.com/<UID>/iframe?autoplay=true&primaryColor=%231C45F5`) in a full-screen overlay with sound. Vertical videos open tall, horizontal ones wide.
- **Testimonials:** same lightbox; captions added in Stream.
- **Draft mode:** until the Cloudflare account is set up, the same entries point to compressed local files. One setting (`videoSource: local | stream`) switches.
- **Cost (Cloudflare's published prices):** storage is $5 per month per 1,000 minutes (the whole library is about 40 minutes); delivery is $1 per 1,000 minutes watched. Example: 10,000 visitors watching the 14 s loop plus 1,000 full plays costs about $3–4 in delivery.
- **Setup (production phase):** account ID, customer code and an API token with Stream edit rights; upload via dashboard or "upload from URL".

## 10. Booking system

**Flow**
1. **Your details:** name, email, phone/WhatsApp (optional), "I am a…" (agency / videographer / agent / other), videos per month (1–5 / 6–15 / 16–30 / 30+), raw footage link (optional, for the free edit). Submitting saves the lead, even if the visitor never picks a time.
2. **Pick a time:** next available days and 15-minute slots, shown in the visitor's own time zone (detected automatically).
3. **Confirmation:** "You're booked", the time in both zones, Google Meet link, what to prepare, add-to-calendar.

**How times are worked out:** booking rules in `content/site.yaml` (days, hours, Hassan's time zone, call length, buffer, minimum notice, how far ahead) **minus** busy times read live from Hassan's Google Calendar (free/busy check) **minus** slots already booked.

**Rules (from you):** calls run 7:00 PM–2:00 AM Pakistan time (UTC+5, no daylight saving). That is 9 AM–4 PM US Eastern in winter and 10 AM–5 PM in summer. A 15-minute call plus a 5-minute gap means a new slot every 20 minutes: 21 slots per evening, the last starting at 1:40 AM. Minimum notice is 1 hour. The window crosses midnight in Pakistan, so the slot engine works in absolute time (UTC), never in calendar days. Bookable days: Monday–Friday US time, i.e. windows that start Monday through Friday evening in Pakistan (Friday's window ends 2:00 AM Saturday). How far ahead: 14 days **[my call]**.

**Backup link:** Hassan's existing Google appointment page stays as a fallback only, shown if our booking step can't reach Google. Bookings made there land in the same calendar, so our free/busy check sees them. Its embed codes are not used on the site.

**On booking:** the server re-checks the slot, then creates the Google Calendar event with a Meet link and the visitor as a guest (Google sends the invite), stores the booking, emails a branded confirmation to the visitor and a notification to Hassan's Gmail, and reports the conversion to Meta and Google.

**Double bookings** are blocked twice: the live calendar re-check, and a unique key on the slot in MySQL.

**Reminders [my call]:** emails 24 hours and 1 hour before the call. **Reschedule/cancel [my call]:** a private link in every email opens `/booking/<token>`; cancelling or moving updates the Google event too.

**Spam [my call]:** a hidden honeypot field, a rate limit per IP, and Cloudflare Turnstile (free, usually invisible).

**If Google is unreachable:** the request is saved as "requested", Hassan is emailed to confirm by hand, and the visitor sees "We'll confirm your time by email shortly."

**Data (MySQL)**

| Table | Main fields |
|---|---|
| `leads` | id, created_at, name, email, phone, buyer_type, videos_per_month, footage_url, page_version, UTM fields, fbclid, gclid, Meta browser IDs, status (started / booked / requested / cancelled) |
| `bookings` | id, lead_id, start_utc, end_utc, visitor_tz, google_event_id, meet_url, status, manage_token, slot_key (unique while confirmed), reminder timestamps |
| `tracking_events` | event_id, type, lead_id, sent to Meta, sent to Google, created_at (for checking duplicates and failures) |

**Google setup (production phase):** a Google Cloud project with the Calendar API, an OAuth client, and a one-time sign-in by Hassan that stores a refresh token on the server. Works with a personal Gmail or Google Workspace. I'll write the steps.

## 11. Tracking

| Event | When | Meta | Google |
|---|---|---|---|
| PageView | every page | Pixel + Conversions API | Google tag |
| ViewContent | a video is played | Pixel | GA4 event |
| Lead | step 1 submitted | Pixel + Conversions API | GA4 event |
| Schedule (main conversion) | booking confirmed | Pixel + Conversions API | Google Ads conversion (enhanced, hashed email) |

Browser and server events share one event ID so Meta counts each once. UTM tags, fbclid and gclid are saved with the lead, so each booking can be traced to its ad.

## 12. Editing everything from files

All words, prices, settings and media links live in plain text files; code reads them. A typo in a file shows a clear error when the site is built, instead of breaking the page.

```
content/
  site.yaml            brand, contact email, Instagram handle, booking rules, 3D and video settings
  pages/
    main.yaml          hero text and section order for each version
    agencies.yaml
    videographers.yaml
    agents.yaml
  sections/
    how-it-works.yaml  plans.yaml  faq.yaml  booking.yaml  footer.yaml
  videos.yaml          every video: title, label, duration, Stream ID, poster time, local file
  testimonials.yaml    video testimonials and message screenshots (each can be marked sample)
  emails/              confirmation, reminder and notification email text
public/
  brand/               logo (SVG and PNG)
  media/posters/       poster images
  media/screenshots/   message screenshots
  media/3d/            still images of the 3D objects for phones
.env                   passwords and keys only (never in content files)
```

Example (`content/sections/plans.yaml`):

```yaml
plans:
  - name: Basic
    price: 60
    minimumPerMonth: 30
    revisions: 1
    features: [Tight cuts and pacing, Color correction, Music and clean titles, Your logo or your client's]
single:
  priceFrom: 90
  note: Priced by complexity. No minimum.
```

To change the site: edit a file, then publish (push to GitHub; Hostinger rebuilds and redeploys). A short `HOW-TO-EDIT.md` will list every file and what it controls.

## 13. Tech stack and hosting

- **Astro** (current stable) with `@astrojs/node`; pages built ahead of time; the booking and tracking API runs on demand on the same server.
- **Node.js 24** (matches your computer; Hostinger supports it) on Hostinger Business; deployed from a GitHub repository.
- **MySQL** on Hostinger (`mysql2` driver).
- **Email:** SMTP through a mailbox on your domain (Hostinger email), so confirmations come from your own address and avoid spam folders; notifications go to Hassan's Gmail.
- **Google Calendar API** (`googleapis`), **Meta Conversions API**, **Google Ads / GA4** tag, **Cloudflare Turnstile**.
- **three.js**, desktop only, loaded after the page.
- Plain CSS with design tokens (no CSS framework), matching the mockup.

## 14. Performance budget (phone, 4G, mid-range Android)

- Largest content visible in under 2.5 s; layout shift under 0.05.
- JavaScript on first load under 50 KB compressed on phones (no 3D library).
- Hero poster under 80 KB; two font files under 100 KB; the hero loop (about 2.5 MB) starts only after the page is ready.
- Every video and poster below the first screen loads lazily.

## 15. Legal and compliance

- Privacy Policy and Terms pages (needed by Meta and Google ad review and for collecting contact details); short consent line under the booking button.
- Ads target the US only, so no cookie-consent banner; the privacy policy explains the Meta Pixel and Google tag.
- FAQ line on AI-enhanced shots and MLS labelling rules.
- Testimonials must be real and permitted by the client before ads run; `sample` items block a production build.

## 16. Assets

| Asset | Status |
|---|---|
| Logo | `references/website-logo/logo_hvgn.png` (black "HVGN." with blue dot). I'll trace a sharp SVG version; send an original vector file if you have one. |
| Hero reel | `references/final-videos/Potrait/potrait-video-20.mp4` (Stream name `potrait-video-20`). The 14 s silent loop is an MP4 served from Hostinger; the full reel plays from Stream |
| Vertical videos | All 23 from `references/final-videos/Potrait` (`potrait-video-1` to `-23`), played from Stream |
| Horizontal videos | All 8 from `references/final-videos/Landscape` (`landscape-cinematic-1` to `-8`), played from Stream; the yacht edit (`-6`) goes last |
| Video testimonials | 3 placeholder clips from `references/instagram-videos`; labelled by role |
| Message screenshots | 12 samples generated with Meshy nano-banana-pro (108 credits): originals in `docs/samples/message-screenshots/`, resized copies in its `web/` folder. Private details covered; four touched up (a stray placeholder word blurred, three cropped to the conversation). All marked `sample` |
| Before/after | **PENDING: you send a raw clip and its edited version on 2026-11-19** (same shot, same length, ideally 3–6 s, so the slider lines up). Until then the day-to-dusk loop from `potrait-video-1.mp4` stands in. |
| 3D stills for phones | Rendered from the 3D scenes during the build |

## 17. Open questions

1. **[you, 2026-11-19] Section 05:** the raw clip and its edited version for the slider (they replace the day-to-dusk stand-in).
2. **[you] Video protection:** which protection steps to add (see the chat of 2026-11-18: allowed origins, signed links, watermark).
3. **[you, production phase]** domain name; Hassan's one-time Google sign-in that gives the site calendar access (no password shared); Hostinger and Cloudflare access (you'll connect both); Meta Pixel and Google Ads IDs; legal business details for the privacy policy.

Answered on 2026-11-18: booking hours, rules and days (section 10), US-only ads (section 15), Meshy screenshots approved and generated (section 16), section 05 video (section 7). Design approved for planning on 2026-11-18; Phase 1 plan: `docs/superpowers/plans/2026-11-18-hivegen-site-phase-1.md`.

## 18. My calls to check

Booking horizon of 14 days · ad versions hidden from Google · phone field optional · reminder emails at 24h and 1h · reschedule/cancel links · Cloudflare Turnstile · hero loop as a short MP4 from Stream · prices shown in US dollars · no admin dashboard in version 1 (every lead and booking reaches Hassan by email and calendar, and all of them are stored in MySQL for a dashboard later) · plain CSS, no framework.

## 19. Left to the builder

Component structure, exact animation timings, schema validation details, test plan, email HTML templates, the 3D still-rendering script, and the deployment pipeline.
