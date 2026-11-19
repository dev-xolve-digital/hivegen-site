# How to edit the HiveGen site

Every word, price, video and setting lives in a plain text file in the `content/` folder. You never need to touch the code to change what the site says.

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
| Questions and answers | `content/sections/faq.yaml` | add a `- q:` line and an `a:` line |
| The last call to action | `content/sections/final-cta.yaml` | `subline: Book a 15-minute call. Your first edit is free.` |
| Footer text and links | `content/sections/footer.yaml` | `href: https://www.instagram.com/hasan.drp` |
| The "page not found" text | `content/sections/not-found.yaml` | `heading: This page doesn't exist.` |
| Privacy policy and terms | `content/legal/privacy.md`, `terms.md` | plain text; `## ` starts a heading |
| Booking hours, days, call length, gap, notice, how far ahead | `content/site.yaml`, `booking:` | `windowStart: "19:00"` (Pakistan time) |
| Where booking emails go, the Instagram chat link | `content/site.yaml`, `contact:` | `instagramUrl: https://ig.me/m/hasan.drp` |
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

**Client videos (section 06)** play from Stream too. Their entries in `videos.yaml` have ids starting with `t-` and no `source:`, because their card image is Stream's own frame at `posterTime`. To add one:

1. Upload it to Cloudflare Stream and copy its video ID.
2. Add an entry to `videos.yaml` with `id`, `title`, `label`, `duration`, `orientation`, `posterTime` and `streamUid`.
3. Add it under `videos:` in `content/testimonials.yaml`. `role:` is the name shown under the card.

**To remove a video**, delete its `id` from every page's `videoOrder`. You can also delete its entry in `videos.yaml`.

**The hero loop** is a short silent clip the site serves itself (never Stream). Its source video, start second and length are under `heroLoop:` in `content/site.yaml`. After changing them, run `npm run media`.

## Section 05 (before/after)

A drag slider compares the raw porch shot with the same shot from the finished edit. The two short clips come from `references/final-videos/Section-05/raw-section-5.mp4` and `edited-section-5.mp4`, from second 38.17 for 2.96 seconds. They play forward then backward (`boomerang: true`), so the loop has no jump. The site serves them itself, not Stream. "Watch the full edit" plays the full edited video (`v-before-after-edit` in `videos.yaml`) from Stream.

To use a different moment or different videos:

1. Put the files under `references/`.
2. In `content/sections/before-after.yaml`, change `source`, `start` and `duration` under `slider:`. Keep `start` and `duration` the same for both clips so the frames line up.
3. Change `ariaLabel:` so it describes the new clip (screen readers read it out).
4. Run `npm run media`. Until you do, the site stops and says which clip is missing.

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

## When something is wrong

If a content file has a mistake, the site stops and tells you the file and the line or field. For example:

```
content/pages/main.yaml: "hero.subline" is missing (field hero.subline)
content/site.yaml: tab characters must not be used in indentation (line 5)
content/pages/main.yaml: unknown video id "v-nope"; add it to videos.yaml or fix the spelling (field videoOrder.vertical.0)
content/testimonials.yaml: "img-401.webp" was not found in public/media/screenshots/; check the spelling or add the image (field screenshots.1.file)
content/videos.yaml: no card image for "v-new-tour" (public/media/posters/v-new-tour.jpg); run npm run media (field videos.31.id)
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
