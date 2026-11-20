# Inquiry form and full-length section 05: design

Date: 2026-11-20 · Status: written for approval · Branch: `inquiry-form`, made from `phase-2` (PR #3 is not merged yet, and both changes build on Phase 2)

## Why

The owner asked for two changes after Phase 2:

1. **Section 05 shows the whole before/after video.** Today the slider loops a 2.96-second moment (from 38.17 s, played forward then backward). The owner wants visitors to see the full 60.5-second raw video beside the full edit. The videos autoplay on the page, so the site serves them itself (Hostinger), never Cloudflare Stream.
2. **A way to reach HiveGen without a call.** The booking card offers only a 15-minute call. A visitor who doesn't want a call can only leave or message on Instagram. The owner wants a form instead, with relevant questions, the email required and the phone optional. The site exists to turn paid-ad clicks into conversations with Hassan, so a visitor who won't book a call should still become a lead he can answer.

The owner chose where the form goes (option A below) from screenshots. They also asked for the "Send details" option to stand out: the theme's colour, and a shake in place.

The mockups are in `.superpowers/mockups/2026-11-20-inquiry-form/`, a git-ignored folder on the owner's computer:

| File | Shows |
|---|---|
| `A1-desktop-call-tab.png` | Placement A with "Book a call" selected |
| `A2-desktop-form-tab.png` | Placement A with "Send details" selected |
| `A3-phone-form-tab.png` | Placement A on a phone |
| `N1-desktop-send-details-shake.gif` | The shake |
| `N2-desktop-call-tab.png`, `N3-phone-switch.png` | The lime option at rest |

## Goals

- Section 05 plays both videos in full, in step with each other, from the site's own files.
- Visitors who don't want a call can send their details and a message from the booking card.
- Hassan gets each message by email at once, and the visitor gets a confirmation email.
- The "Send details" option is easy to notice, but the call stays the main path.

## Non-goals

- File uploads. Footage stays a link.
- Any change to the call flow itself: its steps, times, emails and reminders.
- An admin screen. Hassan answers by email, and can see the database in phpMyAdmin.
- Any Cloudflare or Hostinger change.
- A Google Ads conversion for the form. The existing Ads conversion counts booked calls; a second one needs its own label in Google Ads, which the owner can add later.

## Anti-goals

Any of these makes the work a failure, even if it technically runs:

- **A lost message.** The visitor is told "sent", but the message was never stored, or never reaches Hassan. If an email fails, it is sent again later.
- **Duplicate emails to Hassan.**
  - He gets two emails for one inquiry.
  - He gets the 30-minute "no time picked yet" email for someone who used the form. That email is for people who left the call flow halfway.
- **The call loses its place.** The page must open with "Book a call" selected.
- **An annoying shake.**
  - It never stops.
  - It shakes for people who have asked their device for reduced motion.
  - It moves the layout.
- **A heavier page for everyone.** Phone visitors who never reach section 05 must not download its videos.
- **The contact Gmail on a page.** The address Hassan's emails go to (`contact.notificationEmail` in `content/site.yaml`) must not appear on any page. A test already checks this.

## Constraints

**The existing stack and patterns:**
- Astro 7.4 with the Node adapter.
- The booking API under `src/pages/api/booking/`.
- The booking service in `src/server/booking/`.
- MySQL and memory stores that share one contract test.
- Emails as `content/emails/*.yaml`.
- The bot check: Turnstile plus a honeypot field, and per-visitor rate limits.
- Meta Pixel plus Conversions API, sharing one event id per event.
- The cron pass that retries failed emails.

**Other constraints:**
- Every word a visitor reads lives in `content/`, where the owner edits it, and is checked at build time.
- The booking modes stay as they are:
  - live
  - demo (not connected, on your own computer)
  - off (not connected, on the live address)
  - fakes (tests)
- LF line endings.
- The whole test suite stays green: `npm test`, `npm run test:db`, Playwright and `npm run check`.

## Approaches considered

### The form's data path (Claude's call; the owner left the how to Claude)

- **A. Reuse the lead path. Picked.**
  - The form becomes a lead of a new kind in the existing `leads` table, sent to a new endpoint beside `POST /api/booking/leads`.
  - It reuses the bot check, rate limit, ad attribution, Meta "Lead" event and email retries.
  - It needs two new emails.
  - All leads stay in one place, and nothing that already works is duplicated.
  - Cost: one database migration, because `name`, `buyer_type` and `volume` are required today.
- **B. A separate `inquiries` table and pipeline.** A cleaner split, but it duplicates the storage, the email retries, the tracking and the bot check.
- **C. A third-party form service.** The least code, but:
  - the messages leave the site;
  - there is no server-side Meta event;
  - it is harder to match the design;
  - it adds another account.

### Where the form sits (the owner's choice)

- **A. Inside the booking card. Picked by the owner.** A two-option switch at the top of the card's form panel.
- B. Its own block under the booking card. Easier to spot, but it competes with the call and makes the page longer.

## Section 05: the whole videos

**The source files:**
- The clips are the full source videos, `references/final-videos/Section-05/raw-section-5.mp4` and `edited-section-5.mp4`.
- Each is 60.5 s, 1080×1920 at 30 fps, and both are exactly the same length.
- `npm run media` cuts them as it does today, and the site serves them as `public/media/clips/ba-before.mp4` and `ba-after.mp4`.

**Encoding:**
- Same as the current clips: 540×960, CRF 30, no sound, faststart.
- Expect roughly 10–15 MB for the pair; the browser loads it as it plays.

**Playback:**
- A plain loop instead of the forward-then-backward boomerang.
- Unchanged:
  - preload none;
  - plays only while section 05 is on screen and pauses off screen;
  - the existing drift check keeps the two videos in step;
  - visitors who prefer reduced motion see the still images.
- The still images stay the middle frame. With full-length videos that is the 30-second mark.

**Removing Stream from section 05:**
- The "Watch the full edit" button goes from section 05, with its Stream video (`fullVideoId: v-before-after-edit`).
- Whether `v-before-after-edit` also leaves `content/videos.yaml` depends on whether anything else uses it.

**Docs:**
- `content/sections/before-after.yaml` says "the whole video" for both clips.
- `HOW-TO-EDIT.md` explains how to swap the two videos.

## The form

### The switch

**Layout:**
- Two options at the top of the booking card's form panel: "Book a call" and "Send details". "Book a call" is selected when the page opens.
- Choosing "Send details" replaces the call flow (the stepper, the details step and the time step) with the form.
- The heading and subline on the card's left change to the form's words. From the mockup: "Send us your details" and "Rather not have a call? Tell us about your listings and we'll reply by email. Your first edit is still free."
- "Book a call" puts the call flow back.

**Carrying answers across (Claude's call):** what the visitor typed into email, name and phone moves across in both directions, and so do their choices for "I am a…" and videos per month.

**Accessibility:**
- It works with the keyboard and a screen reader, as a pair of tabs or radio options.
- Focus goes somewhere sensible after a switch.

**Modes:**
- "off" (the offline card): the switch is hidden along with the rest of the form, as today.
- demo: the form behaves as a demo, like the call does. Sending shows the thank-you with a demo note; nothing is stored or emailed.

**Copy:** all labels and words go in `content/sections/booking.yaml`.

### The attention nudge (the owner's request)

**Look at rest:** while "Send details" is not selected, it shows in the theme's lime (`--lime`, #D3FF52), with dark text and a soft lime glow. Lime is never used as text on the off-white.

**The shake:**
- About 0.7 s, in place: a few small side-to-side moves with a slight tilt.
- It never changes the layout; it uses transform only.
- It happens when the booking card first comes into view, then about every 6 seconds.

**When it stops (Claude's call, so it never becomes annoying):**
- It stops for good once the visitor uses the card: they focus a field, pick an option, or press either switch option.
- Otherwise it stops after 5 shakes, whichever comes first.
- It also never runs while the card is off screen.

**Reduced motion:** visitors who prefer reduced motion get the colour without the shake.

**Reference:** see N1 for the shake (the mockup repeats it every 4 s so the GIF shows a whole cycle) and N2/N3 for the option at rest.

### The questions

All are optional except the email. Fields the booking form also has use the same validation.

1. **Email.** Required.
2. **Name**
3. **Phone or WhatsApp**
4. **I am a…:** Media agency / Videographer / Agent / Other. Preselected by the page version, as in the booking form.
5. **Videos per month:** 1–5 / 6–15 / 16–30 / 30+
6. **What do you need?** Pick any of: Listing videos / Reels for social / 3D & AI hooks / Not sure yet.
7. **Raw footage link,** for the free edit. An https link, with the same hint as the booking form.
8. **Message:** free text, with a sensible length limit.

**Also:**
- The same honeypot field and Turnstile bot check as the booking form.
- The question wording, options and hints live in `booking.yaml`; the "What do you need?" options are an editable list there.
- Under the text that says "Only your email is required" sits the button "Send my details". Under that is a consent line, worded like the booking form's: "We'll reply by email, usually within a day. We only use your details to answer you and make your free edit."
- "usually within a day" is for Hassan to confirm.

### When the visitor sends it

**What the server does:**
- It checks the answers, the bot check and the rate limit.
- It stores the inquiry as a lead of the kind "inquiry", with:
  - the answers;
  - the page version and the ad attribution;
  - the visitor's IP and user agent;
  - the Meta browser cookies.
- That is what a booking lead stores today.

**The two emails:**
- **Hassan** gets an email straight away, at the contact address in `site.yaml`.
  - It has every answer, the page version and where the visitor came from (the ad attribution).
  - Its Reply-To is the visitor's email, so Hassan can answer with one click.
- **The visitor** gets a short confirmation email.
  - It says HiveGen has their details and will reply by email.
  - If they sent a footage link, it says the free edit can start from it.
  - Its Reply-To is `contact.replyTo`, as for the other visitor emails.
- **Retries:** if either email fails, the cron pass sends it again, the way booking emails are retried. Each email is sent at most once successfully.
- **No 30-minute email:** an inquiry never triggers the "no time picked yet" email.

**Tracking:** the same as the booking form's details step. A Meta "Lead" (Pixel and Conversions API, one event id) and a Google Analytics `generate_lead`.

**What the visitor sees:**
- **Success:** the card shows "Thanks, we've got your details." and "We'll reply to {email}, usually within a day.", with the Instagram link. The words are in `booking.yaml`.
- **Field errors:** shown under each field, as in the booking form.
- **A network or server failure:** keeps what the visitor typed, shows the error text and lets them try again.
- **Once stored, it counts as sent.** The visitor sees success even if an email still has to be retried.

### The database

Migration `002` changes the `leads` table:
- `name`, `buyer_type` and `volume` become optional.
- New columns hold:
  - the kind;
  - the "What do you need?" answers;
  - the message;
  - whatever records that each of the two emails was sent, for the retries.
- Existing rows stay valid.
- The memory store mirrors the change, and the store contract test covers it.

## Left to the builder

- The endpoint's path and request shape, and whether it shares the leads handler.
- The exact columns and how the kind is stored. For example, a new lead status, or a separate column.
- The email wording, within the decisions above. Claude writes all site copy; Hassan should read the two new emails.
- How `before-after.yaml` says "the whole video", for example by leaving out start and duration.
- Whether the form uses the booking form's Turnstile action or its own.
- Test coverage, following the project's existing patterns:
  - unit, store contract and MySQL tests;
  - Playwright on desktop and phone;
  - reduced motion;
  - the accessibility (axe) check;
  - "no Stream in section 05".
