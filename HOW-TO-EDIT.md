# How to edit the HiveGen site

Every word, price, video and setting lives in a plain text file in the `content/` folder. You never need to touch the code to change what the site says, including the wording of the emails the booking sends.

Connecting accounts (Google Calendar, the database, the mailbox, the ad trackers) is a different job: it is explained step by step in `HOW-TO-SETUP.md`. Passwords, tokens and keys never go in a content file.

## Before you start

1. Open a terminal in this folder and run `npm run dev`.
2. Open the address it prints (usually http://localhost:4321) in your browser.
3. Edit a file, save it, and refresh the browser to see the change.

The files use YAML. Three rules keep them working:

- **Indent with two spaces, never tabs.** Indentation shows which value belongs to which heading.
- **Keep the part before the colon exactly as it is.** Change only the part after it.
- **Put quotes around text that starts with a symbol or contains `: ` or ` #`.** For example, `href: "#book"` or `note: "Everything in Basic, plus:"`.

Lines starting with `#` are notes for you. The site ignores them. Notes marked `[confirm]` are claims only you or Hassan can confirm: delete the note once the line is true, or change the line.

## What to change, and where

| You want to change… | File | Example |
|---|---|---|
| The headline, subline and chips of a page version | `content/pages/main.yaml`, `agencies.yaml`, `videographers.yaml`, `agents.yaml` | `subline: Send us raw footage from any listing…` |
| The words that get the lime marker in a headline | same page file, `highlight:` | `highlight: sell.` (must be words from the last headline line) |
| The search title and description of a version | same page file, `seo:` | `title: HiveGen · Real estate video editing in 24–48 hours` |
| Which buyer type is ticked in the booking form | same page file, `preselectBuyer:` | `preselectBuyer: agent` |
| Whether plans or the single-video bar come first | same page file, `pricingOrder:` | `pricingOrder: single-first` |
| The order of videos on a version | same page file, `videoOrder:` | move a line like `- v-rooftop-hook` up or down |
| Menu links and the menu button | `content/sections/nav.yaml` | `label: Book a call` |
| Hero button, Instagram link text, the floating "24–48h" card | `content/sections/hero.yaml` | `floatText: from footage to final cut` |
| "Recent edits" heading and row labels | `content/sections/recent-edits.yaml` | `heading: Recent edits` |
| The three "Who it's for" cards (main page only) | `content/sections/who-its-for.yaml` | `text: Hand us the editing…` |
| The three steps | `content/sections/how-it-works.yaml` | `title: Book a 15-minute call` |
| Section 05 (before/after) | `content/sections/before-after.yaml` | see "Section 05" below |
| Client video cards and the message rows | `content/testimonials.yaml` | `role: Kenneth` |
| Plan names, prices, minimums, revisions, features | `content/sections/plans.yaml` | `price: 60` / `minimumPerMonth: 30` |
| The line under each plan price | `content/sections/plans.yaml`, `termsLine:` | `termsLine: "{min}+ videos a month · {revisions} revision{s}"` |
| The single-video bar and the free-edit note | `content/sections/plans.yaml`, `single:` and `freeNote:` | `priceFrom: 90` |
| Every word in the booking form and its messages | `content/sections/booking.yaml` | `nextLabel: "Next: pick a time"` |
| The "Book a call / Send details" switch and every word of the Send details form | `content/sections/booking.yaml`, `switch:` and `inquiry:` | `submitLabel: Send my details` (see "The Send details form") |
| Questions and answers | `content/sections/faq.yaml` | add a `- q:` line and an `a:` line |
| The last call to action | `content/sections/final-cta.yaml` | `subline: Book a 15-minute call. Your first edit is free.` |
| Footer text and links | `content/sections/footer.yaml` | `href: https://www.instagram.com/hasan.drp` |
| The "page not found" text | `content/sections/not-found.yaml` | `heading: This page doesn't exist.` |
| Privacy policy and terms | `content/legal/privacy.md`, `terms.md` | plain text; `## ` starts a heading |
| Booking hours, days, call length, gap, notice, how far ahead | `content/site.yaml`, `booking:` | `windowStart: "19:00"` (Pakistan time) |
| Where Hassan's emails go (`notificationEmail`), where visitors' replies go (`replyTo`), the Instagram chat link | `content/site.yaml`, `contact:` | `instagramUrl: https://ig.me/m/hasan.drp` (see "Reply-to and notification addresses") |
| The wording of an email | `content/emails/*.yaml` | `subject: "You're booked: 15-minute call with HiveGen, {when}"` (see "Booking emails") |
| The reschedule and cancel page | `content/sections/manage-booking.yaml` | `heading: Your call with HiveGen` |
| The title and description of the calendar invite | `content/sections/booking.yaml`, `calendarEvent:` | `title: "HiveGen call · {name}"` |
| What the booking card says when booked, requested, offline or on an error | `content/sections/booking.yaml` | `requested:` (see "What the booking card says") |
| Hassan's own appointment page, the backup link | `content/site.yaml`, `booking:` | `backupUrl: https://calendar.example/hassan` |
| The ad tracking IDs (Meta Pixel, Google tag, Google Ads) | `content/site.yaml`, `tracking:` | `metaPixelId: "123456789012345"` |
| Live 3D on phones instead of still images | `content/site.yaml` | `live3dOnMobile: true` |
| Hide section 05 | `content/site.yaml` | `showBeforeAfter: false` |
| Which images load from Cloudflare Images | `content/images.yaml` | `media/posters/v-rooftop-hook.jpg: e1ba4a9f-…` |

Words in `{curly braces}` in `booking.yaml` and `plans.yaml`, such as `{email}`, `{when}` or `{min}`, are filled in by the site. Keep them as they are. In `termsLine`, `{s}` adds an "s" unless the plan has exactly 1 revision.

## Videos

All 31 portfolio videos play from Cloudflare Stream. Each one has an entry in `content/videos.yaml`:

```yaml
  - id: v-rooftop-hook              # short name used in the page files
    title: Rooftop stunt hook       # name read out by screen readers
    label: Rooftop stunt hook       # text on the card
    duration: "0:39"
    orientation: vertical           # vertical (9:16) or horizontal (16:9)
    source: final-videos/Potrait/potrait-video-10.mp4   # your original, under references/
    posterTime: 1.61                # second of the video used for the card image
    streamUid: d730b5e6db7b970da9329a6609336c34          # its ID in Cloudflare Stream
```

**To add a video:**

1. Upload it to Cloudflare Stream and copy its video ID.
2. Put the original file under `references/final-videos/`.
3. Add an entry like the one above to `videos.yaml`.
4. Run `npm run media` to make its card image. If you forget, the site stops and tells you which image is missing.
5. Upload the new card image (`public/media/posters/<id>.jpg`) to Cloudflare Images and add its line to `content/images.yaml` (see "Images" below). Until you do, the site serves the image itself, so nothing breaks.
6. Add its `id` to `videoOrder` in each page file where it should appear.

**To change a card image**, change `posterTime` and run `npm run media`. Then upload the new image to Cloudflare Images and replace its ID in `images.yaml`, or delete its line there so the site serves the new image itself.

**Client videos (section 06)** play from Stream too. Their entries in `videos.yaml` have ids starting with `t-` and no `source:`, because their card image is Stream's own frame at `posterTime`, saved as a file by `npm run media`. To add one:

1. Upload it to Cloudflare Stream and copy its video ID.
2. Add an entry to `videos.yaml` with `id`, `title`, `label`, `duration`, `orientation`, `posterTime` and `streamUid`.
3. Run `npm run media` to save its card image (`public/media/posters/<id>.jpg`). If you change `posterTime` later, run `npm run media -- --force`.
4. Add it under `videos:` in `content/testimonials.yaml`. `role:` is the name shown under the card.

**To remove a video**, delete its `id` from every page's `videoOrder`. You can also delete its entry in `videos.yaml`.

**The hero loop** is a short silent clip the site serves itself (never Stream). Its source video, start second and length are under `heroLoop:` in `content/site.yaml`. After changing them, run `npm run media`.

## Section 05 (before/after)

A drag slider compares the raw video with the finished edit. The raw video plays underneath, the edit plays on top, and the handle decides how much of each you see. Both play the whole minute (about 60 seconds), from `references/final-videos/Section-05/raw-section-5.mp4` and `edited-section-5.mp4`. The site serves them itself, not Stream, and there is no "Watch the full edit" button.

The edit is a re-cut, so it is not the raw video frame for frame: for much of the minute the two sides show different shots. The opening shot is the same on both sides, so the still image shown before the videos play is taken from it (`posterAt: 2.5`, in seconds).

To use different videos:

1. Put the files under `references/`.
2. In `content/sections/before-after.yaml`, change `source` under `slider:` for both. Keep the two videos the same length so they finish together. To use only part of a video, add `duration` (seconds) and change `start`.
3. Set `posterAt:` to the second whose frame should be the still image.
4. Change `ariaLabel:` so it describes the new videos (screen readers read it out). Leave `boomerang: false`: playing forward then backward suits only short clips.
5. Run `npm run media`. Until you do, the site stops and says which clip is missing.

## Message screenshots

The 18 client messages live in `public/media/screenshots/` and load from Cloudflare Images. All cards have the same width, so each card's height follows its screenshot.

- **To add one:**
  1. Save it in `public/media/screenshots/` with a lowercase name without spaces, for example `new-client.webp`.
  2. Upload the same file to Cloudflare Images and add `media/screenshots/new-client.webp: <its ID>` to `content/images.yaml`.
  3. List it under `screenshots:` in `content/testimonials.yaml`, with:
     - a `file`;
     - an `alt`: a short description of the message, for screen readers;
     - a `row`: `front` moves right; `back` moves left, behind the front row;
     - `sample: false`.
- **To remove one**, delete its four lines from `testimonials.yaml`.

## Images (Cloudflare Images)

These images load from Cloudflare Images, a fast image network, instead of from the site itself:

- the card images;
- the hero video's still;
- the phone images of the 3D objects;
- the message screenshots.

`content/images.yaml` lists each one: its path inside `public/`, then its image ID in Cloudflare. A file that is not listed there is served by the site itself, so a missing line never breaks a page.

When you change an image on this computer, upload the new version to Cloudflare Images and replace its ID in `images.yaml`. Until you do, the site keeps showing the old Cloudflare copy.

## Samples

Nothing on the site is a placeholder any more, so a production build (`SITE_MODE=production`) can finish. If you ever add a placeholder, mark it `sample: true`. It then shows a small "Sample" tag in the draft, and the production build refuses to finish until it is replaced.

**Real client videos go on Cloudflare Stream**, like the portfolio videos. Video files kept on this computer (`host: local`) are not saved with the site's code, so they would not reach the live site.

## Booking emails

Every email the booking sends has its own file in `content/emails/`. Each has a `subject:`, a `body:` and sometimes a button:

```yaml
subject: "You're booked: 15-minute call with HiveGen, {when}"
body: |
  Hi {name},

  You're booked for {when} ({timezone}). The Google Meet link is in your calendar invite.
button:
  label: Join the call
  link: meet   # meet = the Google Meet link (left out when there is none); manage = the reschedule/cancel page
```

- The text after `body: |` is the email. Keep every line indented by two spaces. A blank line starts a new paragraph.
- Delete the three `button:` lines to send the email with no button. `link: meet` is a button that opens the Google Meet link; the button is left out when Google has not given a link, so the words must read well without it. Do not put `{meetUrl}` in the subject or the body. `link: manage` opens the visitor's reschedule and cancel page.
- Emails to the visitor show the call time in the visitor's own time zone. The emails to Hassan show it in both: Pakistan time and the visitor's.
- **A detail the visitor left out shows as a dash** in Hassan's emails, so `Phone: {phone}` is never an empty line.

Words in `{curly braces}` are filled in when the email is sent. Each email may use only the ones in the last column. Keep them exactly as they are written:

| File | Who gets it, and when | You can use |
|---|---|---|
| `booking-confirmed.yaml` | The visitor, when the call is booked (Google sends its own invite as well) | `{name}` `{when}` `{timezone}` `{meetUrl}` `{manageUrl}` |
| `booking-requested.yaml` | The visitor, when Google could not make the event: the time is held and Hassan confirms by hand | `{name}` `{when}` `{timezone}` `{manageUrl}` |
| `booking-rescheduled.yaml` | The visitor, after they move their call | `{name}` `{when}` (the new time) `{previousWhen}` (the old time) `{timezone}` `{meetUrl}` `{manageUrl}` |
| `booking-cancelled.yaml` | The visitor, after they cancel | `{name}` `{when}` (the time that was cancelled) `{timezone}` `{manageUrl}` |
| `reminder-24h.yaml` | The visitor, 24 hours before a booked call | `{name}` `{when}` `{timezone}` `{meetUrl}` `{manageUrl}` |
| `reminder-1h.yaml` | The visitor, 1 hour before a booked call | `{name}` `{when}` `{timezone}` `{meetUrl}` `{manageUrl}` |
| `hassan-new-booking.yaml` | Hassan, when a call is booked | `{name}` `{email}` `{phone}` `{buyerType}` `{volume}` `{footageUrl}` `{pageVersion}` `{source}` `{whenPakistan}` `{when}` `{timezone}` |
| `hassan-confirm-by-hand.yaml` | Hassan, when a booking waits for him to confirm it | the same as the line above |
| `hassan-new-lead.yaml` | Hassan, about 30 minutes after someone filled in the form but picked no time | `{name}` `{email}` `{phone}` `{buyerType}` `{volume}` `{footageUrl}` `{pageVersion}` `{source}`. There is no call time yet, so do not use `{when}` or `{whenPakistan}` |
| `hassan-booking-changed.yaml` | Hassan, when a visitor cancels or moves their call | the same as the `hassan-new-booking` line, plus `{change}` (it says "cancelled" or "rescheduled") |
| `hassan-new-inquiry.yaml` | Hassan, at once, when someone sends the Send details form instead of booking a call. Its Reply-To is the visitor's address, so pressing "reply" answers the visitor | `{name}` `{email}` `{phone}` `{buyerType}` `{volume}` `{needs}` `{footageUrl}` `{message}` `{pageVersion}` `{source}`. There is no call time, so do not use `{when}` or `{whenPakistan}` |
| `inquiry-received.yaml` | The visitor, right after they send the Send details form | none, on purpose (see below) |

What they stand for: `{needs}` is what the visitor ticked under "What do you need?", separated by commas, and `{message}` is what they wrote; `{when}` is the call time in the visitor's own zone (for example "Monday, December 7, 9:00 AM EST") and `{timezone}` is the name of that zone (for example "America/New York"); `{whenPakistan}` is the same time in Hassan's zone; `{manageUrl}` is the visitor's private reschedule and cancel page; `{source}` is where the visitor came from (for example an ad).

**Every email to the visitor except the cancellation and the Send details confirmation carries the reschedule and cancel link** (`{manageUrl}`, or the button that goes to it), so a visitor can always move or cancel the call. Keep it when you change the wording. The cancellation leaves it out on purpose: the booking is gone. `inquiry-received.yaml` leaves it out too: someone who sent the Send details form has no booking to move or cancel.

**The visitor's confirmation for the Send details form (`inquiry-received.yaml`) cannot use any `{curly braces}` word.** Anyone can type any address into a public form, and this email goes from HiveGen's own address to the address that was typed. If it repeated the name, the link or the message, a stranger could make HiveGen send their words to someone else. So it says only what you write in the file, and it never repeats what the visitor typed. If you add a `{word}` to it, the site stops when it builds and names the file. Hassan's email (`hassan-new-inquiry.yaml`) has no such limit: it is the one place the visitor's words belong.

**A line that starts with `#` is a note for you.** Many email files have `# [confirm] ...` notes. A `[confirm]` note means: "this wording assumes something that only you or Hassan can check". For example, `connect@hivegen.co reaches Hassan, so "reply to this email" works`. Check it. When it is true, delete the note; when it is not, change the wording. A note such as `[confirm: how fast Hassan replies]` marks a line that promises something about timing: only keep it if you can keep it.

After editing an email, run `npm run build` (or just reload the site while `npm run dev` is running). The site renders every email with sample values, and if one has a mistake it stops and names the file and field (see "When something is wrong"). To see how an email really looks, book a test call on your own computer once the booking is set up (`HOW-TO-SETUP.md`). While no mailbox is set up, the emails are not sent: they are saved as files in the `.outbox` folder, and you can open the `.html` ones in a browser.

## The reschedule and cancel page

The page a visitor reaches from "Reschedule or cancel" (in their emails and on their booking confirmation) is `content/sections/manage-booking.yaml`. Every word on it is in that file: the headings, the button labels, the question before a cancel, and the messages for each result.

- `cancelledText` and `rescheduledText` get the call time in place of `{when}`. `rescheduledText` must keep `{when}`, so the visitor sees the new time.
- `tooLateText` is shown when a change is no longer possible online. Rescheduling closes 1 hour before the call and cancelling when the call starts.
- `notFoundText` is for an old or mistyped link, and `errorText` for a problem on our side.

The page is not listed in search engines, and it loads none of the ad trackers: its address is private to the visitor.

## The calendar invite

The invite that lands in the visitor's Google Calendar (and in Hassan's) takes its title and description from `calendarEvent:` in `content/sections/booking.yaml`:

```yaml
calendarEvent:
  title: "HiveGen call · {name}"
  description: "Your 15-minute call with HiveGen. Join with the Google Meet link in this invite. To reschedule or cancel: {manageUrl}"
```

Only `{name}` and `{manageUrl}` are filled in here. **Keep personal details out of the description** (the phone number, how many videos, where they came from): the visitor sees it in their own calendar. If you change the length of the call (`slotMinutes` in `site.yaml`), the words "15-minute" are in several places in the content (this description, the booking form and the emails), so search for them and change them too.

## What the booking card says

The booking section is one card with several faces. All of its words are in `content/sections/booking.yaml`:

| Face | When it shows | Where in the file |
|---|---|---|
| The form, and then the times | A visitor is booking | `fields:`, `steps:`, `timeHeading:`, `timeNote:` and the buttons |
| The Send details form, and its thank-you | A visitor chose "Send details" instead of a call | `switch:` and `inquiry:` (see "The Send details form") |
| **Booked** | Google made the event, and the invite is on its way | `confirmation:` |
| **Requested** | The time is held, but Google could not make the event, so Hassan confirms it by hand | `requested:` |
| **Offline** | Booking is not set up yet, or the server cannot be reached. The form is replaced by this card with the Instagram chat button, and the backup link if there is one | `offline:` |
| "We couldn't check the calendar" | Shown above the times when the calendar could not be read | `calendarNote:` and `backupLabel:` |
| No times | No time is open in the next two weeks | `noSlots:` |
| Errors | A field is wrong, a time was just taken, the bot check failed, there were too many tries, the connection failed | `errors:` |
| The demo note | Only on a copy of the site where booking is not connected (for example your computer before `HOW-TO-SETUP.md`) | `demoNote:` |

Two rules for the words: **never say "booked" or "confirmed" in `requested:`** (the visitor has no calendar invite yet), and keep the `{curly braces}` words (`{email}`, `{when}`, `{timezone}`, `{backupLink}`) in the lines that already have them. A note starting with `# [confirm: how fast Hassan replies]` marks a line that makes a promise about timing.

## The Send details form

Next to the 15-minute call, the card has a second way in for visitors who would rather not have a call: a short form that sends Hassan their details by email. A switch at the top of the card chooses between the two, and the card opens on "Book a call". Every word is in `content/sections/booking.yaml`, in two blocks.

**`switch:`** is the switch itself.

| Word | What it controls |
|---|---|
| `label:` | Read out by screen readers only; nobody sees it |
| `call:` | The button for the call (the one that is selected when the page opens) |
| `details:` | The lime button for the form |

Keep `call:` and `details:` short, about 14 characters each (the length of "Book a call" and "Send details"): both buttons sit side by side in the switch, and a longer word runs out of its button on a phone.

**`inquiry:`** is the form. Only the email is required; everything else helps Hassan reply with the right answer.

| Word | What it controls |
|---|---|
| `heading:` and `subline:` | Replace the card's heading and the line under it while the form is open |
| `note:` | The line at the top of the form ("Only your email is required…") |
| `fields:` | The label of each field: `email`, `name`, `phone`, `buyer`, `volume`, `needs`, `footage`, `message`, and `footageHint` (the small line under the link field) |
| `optionalTag:`, `needsTag:`, `footageTag:` | The small grey tags next to a label, such as "(optional)" and "(pick any)" |
| `messagePlaceholder:` | The faint example inside the message box |
| `needOptions:` | The choices of "What do you need?" (see below) |
| `submitLabel:` | The send button |
| `consentLine:` | The line under the button. It promises a reply time, so it has a `[confirm]` note: only keep "usually within a day" if you can keep it |
| `done:` | The thank-you after a send: `heading:` and `text:`. Keep `{email}` in `text:`: it becomes the address the visitor typed |
| `errors:` | The messages for a wrong email, name, phone number, link or too long a message |

**`needOptions` is a list you can edit.** Each line is one tick box under "What do you need?": add a line, delete a line or reword one, and keep at least one. The visitor may tick any of them, and Hassan's email shows what they ticked next to "Needs". Write each choice once: a list that repeats a choice is reported as an error when the site is built. The server accepts only the choices in this list, so after changing it on a running server, redeploy and restart the app (see "On the live site"). The "I am a…" and "Videos per month" choices are the same lists as in the call form (`buyerOptions:` and `volumeOptions:`), so changing them there changes them here.

**The lime "Send details" button shakes now and then until the visitor uses the card.** It shakes for under a second, first just after the switch comes into view and then every few seconds, at most five times. It stops for good as soon as the visitor clicks a field or either button. A visitor whose device is set to reduce motion never sees it shake (the button stays lime).

The form is saved as a lead and sends two emails: Hassan gets `hassan-new-inquiry.yaml` and the visitor gets `inquiry-received.yaml` (see "Booking emails"). It is counted as one "Lead" in Meta. A visitor who first filled in the call form and then sent this one in the same tab is still one lead. Whichever form came first, and in whichever tab, Hassan gets no "no time picked" email about someone who also sent this form with the same email address (in another tab they can count as two leads in Meta). When booking is switched off (the offline card), the switch and the form are hidden.

## The backup appointment link

`backupUrl` under `booking:` in `content/site.yaml` is Hassan's own appointment page (for example a Google Calendar appointment page). Visitors are offered it when the calendar cannot be checked and when booking is offline, with the words of `backupLabel` in `booking.yaml`. It must start with `https://`. Leave it as `""` for none: the link is then left out everywhere.

```yaml
booking:
  backupUrl: https://calendar.example/hassan
```

## Reply-to and notification addresses

Under `contact:` in `content/site.yaml`:

- `notificationEmail` is where Hassan's emails go (a new booking, a lead with no time picked, a message from the Send details form, a change). It is never shown on the site.
- `replyTo` is the address that every booking email to a visitor asks for replies at, so when a visitor presses "reply" it reaches Hassan. It must be an address Hassan reads. The one email that works the other way round is Hassan's `hassan-new-inquiry.yaml`: its Reply-To is the visitor, so Hassan answers them by pressing "reply". The sender shown on the emails (`MAIL_FROM`) is a setting of the mailbox, not a content file: see `HOW-TO-SETUP.md`, step 3.

## Tracking IDs

Under `tracking:` in `content/site.yaml`:

```yaml
tracking:
  metaPixelId: "123456789012345"   # Meta Pixel ID, digits only
  googleTagId: "G-ABC123XYZ4"      # Google Analytics (GA4) measurement ID
  googleAdsId: "AW-123456789"      # Google Ads account ID
  googleAdsScheduleLabel: "AbC-D_efG-h"   # the label of the "booked call" conversion in Google Ads
```

- **These IDs are public.** They are in every page's source anyway, so it is safe to edit and share them. **Secrets never go in a content file**: the Meta Conversions API token and test event code (`META_CAPI_TOKEN`, `META_TEST_EVENT_CODE`) live in `.env` and hPanel (`HOW-TO-SETUP.md`, step 4).
- **An empty ID (`""`) switches that tracker off.** With all four empty, the site loads no Meta or Google script at all. The Meta Pixel ID also switches on the server-side Conversions API, which needs the token as well.
- Where to find each ID is in `HOW-TO-SETUP.md`, steps 4 and 5.
- `googleAdsId` needs `googleAdsScheduleLabel` next to it: with the account ID alone, the Ads conversion is never sent.
- Paste only the ID, not a snippet. An ID of the wrong shape stops the site and names the field, for example `site.yaml: "tracking.metaPixelId" ... (field tracking.metaPixelId)`.
- The ad scripts load only after the page has finished loading, and never on a visitor's private reschedule page.

## On the live site

Changing a content file on your computer changes only your copy. For the live site, redeploy: the pages are built from the content files, so the new words appear once the site is rebuilt. The booking part of the server reads `site.yaml` and `booking.yaml` once, when it starts, so if you ever edit them on a running server, restart the app there as well (`HOW-TO-SETUP.md`, step 9).

## When something is wrong

If a content file has a mistake, the site stops and tells you the file and the line or field. For example:

```
content/pages/main.yaml: "hero.subline" is missing (field hero.subline)
content/site.yaml: tab characters must not be used in indentation (line 5)
content/pages/main.yaml: unknown video id "v-nope"; add it to videos.yaml or fix the spelling (field videoOrder.vertical.0)
content/testimonials.yaml: "img-401.webp" was not found in public/media/screenshots/; check the spelling or add the image (field screenshots.1.file)
content/videos.yaml: no card image for "v-new-tour" (public/media/posters/v-new-tour.jpg); run npm run media (field videos.31.id)
content/emails/reminder-1h.yaml: {phone} can't be used in this email; use only {name} {when} {timezone} {meetUrl} {manageUrl} {previousWhen} (field body)
content/site.yaml: "tracking.metaPixelId" must look like 1234567890123456, or be empty to switch it off (field tracking.metaPixelId)
```

While `npm run dev` is running, the terminal shows the message and the browser shows an error page. Fix the file, save, and refresh.

Field paths read left to right. For example, `videoOrder.vertical.0` means the first line under `vertical:` inside `videoOrder:` (counting starts at 0). Fix that spot, save, and refresh.

## Other commands

| Command | What it does |
|---|---|
| `npm run dev` | Runs the site on your computer while you edit |
| `npm run build` | Builds the finished site into `dist/` |
| `npm run media` | Makes card images and the short clips from `references/` (skips anything already up to date; add `-- --force` to redo all) |
| `npm run stills` | Re-renders the phone images of the 3D objects (run `npm run build` first) |
| `npm run fonts` | Rebuilds the two trimmed font files |
| `npm test` and `npx playwright test` | Run the automatic checks |
| `npm run check:services` | Tries each connected account (database, Google, mailbox, bot check, Meta, video links) and says what to fix. Not-yet-connected ones just say so. See `HOW-TO-SETUP.md` |
| `npm run google:connect` | Hassan's one-time Google sign-in (`HOW-TO-SETUP.md`, step 1) |
| `npm run db:migrate` | Creates or updates the booking tables in the database (step 2) |
| `npm run test:db` | Runs the database tests; with `DATABASE_URL_TEST` set, on the Hostinger database (step 2) |
| `npm run cron` | Runs the scheduled work (reminders and so on) once, the way Hostinger's cron job does (step 8) |
