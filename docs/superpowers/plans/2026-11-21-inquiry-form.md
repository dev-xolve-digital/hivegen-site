# Inquiry form ("Send details") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a switch to the booking card. "Book a call" (the default) keeps today's flow. "Send details" (lime, with a gentle shake) opens a short form where only the email is required. Hassan gets each message by email at once; the visitor gets a confirmation; failed emails are retried.

**Architecture:**
- **Server:** an inquiry is a lead with the new status `inquiry`, sent to `POST /api/booking/inquiries` and handled by `service.sendInquiry`. It reuses the store, the bot check (its own Turnstile action `inquiry`), the rate limit, the Meta "Lead" event and the cron retry pass. It adds two emails: `hassan-new-inquiry` (Reply-To: the visitor) and `inquiry-received`.
- **Browser:**
  - `booking-switch.ts` runs the tabs and the nudge.
  - `inquiry-ui.ts` runs the form.
  - `booking-boot.ts` starts both. A `BookingSession` object is shared with the call flow so one visitor is one lead.

**Tech Stack:** Astro 7.4 with @astrojs/node, TypeScript strict, Zod 4, mysql2, nodemailer, Vitest 5 (jsdom for DOM tests), Playwright 1.65.

**Spec:** `docs/design/2026-11-20-inquiry-form-and-full-section-05-design.md`. Tasks 1–7 are the form. Task 8 is section 05; the owner chose the slider over the whole minute on 2026-11-21.

## Global Constraints

**Tests and checks:**
- Run Vitest from the uppercase path: `cd "C:/Users/DC/Desktop/HivegenLLC"`. A lowercase `c:\` cwd breaks Vitest.
- Every task ends with `npm test` and `npm run check` green (0 errors). Tasks that touch the store also run `npm run test:db`. Task 7 also runs `npx playwright test`; port 4322 must be free first.

**Content:**
- Every word a visitor or Hassan reads lives in `content/`: `content/sections/booking.yaml` and `content/emails/*.yaml`. The schema in `src/lib/content/schemas.ts` validates it, and its schemas are strict.
- Copy in this plan is exact. Keep `[confirm]` notes as YAML comments.

**Privacy:**
- The contact Gmail (`contact.notificationEmail` in `content/site.yaml`) must never appear in a page, a log line or test output. Compare against the loaded value; never print it.

**Behaviour that must not change:**
- The modes keep today's meaning:
  - live
  - demo (local, not connected: pretend, nothing stored or sent)
  - off (not connected on a public address: the offline card, no form)
  - fakes (tests)
- Fakes stay impossible in production.
- The call flow's behaviour and its tests stay as they are. The page opens with "Book a call" selected.

**Code rules:**
- No new dependencies.
- LF line endings: Python writes need `newline=''`; prefer the Edit tool.
- Reduced motion: no shake at all, only the colour.
- Lime (`--lime`, #D3FF52) is only ever a background with ink text, never text on the off-white.
- Each commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A double click, or a retry after the 15 s browser timeout:** one inquiry, one email to Hassan. Covered in Task 3 (same `requestId`) and Task 6 (double click; a retry reuses the id).
2. **A visitor who starts the call flow, then sends the form:** no 30-minute "no time picked yet" email, and one Meta "Lead" for that visitor. Covered in Task 3 (server) and Task 6 (browser).
3. **A message with line breaks, `<script>`, emoji or a 2,000-character text:** shown as plain text in Hassan's email, with the line breaks kept. A 2,001-character message is refused. Covered in Tasks 1 and 2.
4. **The confirmation email:** it can never carry what the visitor typed (spam relay through someone else's address). Covered in Task 2.
5. **A 320 px phone, with the form open and while the button shakes:** no horizontal scroll, and the switch stays on one line. Covered in Task 7.

---

### Task 1: Inquiry leads in the data model, validation and both stores

**Files:**
- Modify: `src/server/booking/types.ts`, `src/server/booking/validate.ts`, `src/server/store/mysql.ts`, `src/server/store/memory.ts`, `tests/contract/store.contract.ts`
- Create: `db/migrations/002_inquiries.sql`, `tests/unit/inquiry-validate.test.ts`
- Modify only for types that become optional: `src/server/booking/service.ts:94-99`, `src/server/mail/notifier.ts:30-33`

**Interfaces:**
- Produces, in `types.ts`:
  - `LeadStatus` gains `'inquiry'`.
  - `NewLead`: `name?: string; buyerType?: BuyerType; volume?: string` become optional. New fields: `status?: 'started' | 'inquiry'` (default `'started'`), `needs?: string[]`, `message?: string`, `requestId?: string`.
  - `Lead` gains `hassanNotifiedAt?: Date; visitorNotifiedAt?: Date`.
  - `Store.updateLead` patch becomes `{ status?: LeadStatus; newLeadNotifiedAt?: Date; hassanNotifiedAt?: Date; visitorNotifiedAt?: Date }`.
  - New: `Store.getLeadByRequestId(requestId: string): Promise<Lead | null>`.
  - `Store.createLead` throws `DuplicateRequestError` when `l.requestId` is already stored.
  - `export class DuplicateRequestError extends Error`, with name `'DuplicateRequestError'` and message `'duplicate_request'`.
- Produces, in `validate.ts`: `inquiryInputSchema(volumeOptions: readonly string[], needOptions: readonly string[])` and `export type InquiryInput = z.output<ReturnType<typeof inquiryInputSchema>>`.

- [ ] **Step 1: Write the failing validation tests** in `tests/unit/inquiry-validate.test.ts`. Use `parseInput(inquiryInputSchema(['1–5','6–15','16–30','30+'], ['Listing videos','Reels for social','3D & AI hooks','Not sure yet']), raw)`. The minimal valid raw value is `{ email: 'a@b.co', pageVersion: 'main', turnstileToken: 't', requestId: '3f1c2b9a-0d4e-4f6a-9b1c-2d3e4f5a6b7c' }`.
  - `only the email is required`: the minimal raw value is ok. Output: `name`, `phone`, `buyerType`, `volume`, `footageUrl` and `message` are undefined, `needs` is undefined, and `attribution` is `{}`.
  - `a missing or bad email is named`: `{}` gives `fields.email === 'required'`; `'nope'` gives `'invalid'`.
  - `optional fields keep the booking form's rules`:
    - phone `'abc'` is `invalid`;
    - footageUrl `'ftp://x'` is `invalid`;
    - name with `'\n'` is `invalid`;
    - name of 101 characters is `too_long`;
    - volume `'50'` is `invalid`;
    - buyerType `'robot'` is `invalid`.
  - `needs: known options only, no repeats`:
    - `['Listing videos','Not sure yet']` is ok;
    - `['Other']` is `fields.needs === 'invalid'`;
    - `['Listing videos','Listing videos']` is `invalid`;
    - `'Listing videos'`, a string rather than an array, is `invalid`.
  - `the message keeps line breaks and refuses other control characters and over 2000 characters`:
    - `'Hi\nthere\r\n\tok'` is ok and stays unchanged;
    - `'a\u0007b'` is `invalid`;
    - 2000 × `'x'` is ok;
    - 2001 × `'x'` is `too_long`.
  - `requestId is required and short`:
    - missing is `required`;
    - `'x'` is `invalid`;
    - 65 characters is `invalid`.
  - `leadId, when given, is a 22-character public id`: `'L'.repeat(22)` is ok; `'short'` is `invalid`.
- [ ] **Step 2: Run and see it fail.** Run `npx vitest run tests/unit/inquiry-validate.test.ts`. Expected: FAIL, because `inquiryInputSchema` is not exported.
- [ ] **Step 3: Implement `inquiryInputSchema(volumeOptions, needOptions)`.** Reuse the helpers in `validate.ts` (`optional`, `wrongType`, `isHttpUrl`, `hasControlCharacter`, the attribution, fbp, fbc, turnstileToken and website fields).
  - `email`: as in `leadInputSchema`.
  - `name`: optional, trim, max 100, no control characters.
  - `phone`, `footageUrl`, `fbp`, `fbc`: as in the lead form.
  - `buyerType`: optional enum.
  - `volume`: optional; it must be one of `volumeOptions`.
  - `needs`: optional array of strings, each one of `needOptions`, with no repeats and at most `needOptions.length` items.
  - `message`: optional, trim, max 2000. Refuse `/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/`.
  - `pageVersion`: required enum.
  - `requestId`: required, `/^[A-Za-z0-9-]{8,64}$/`.
  - `leadId`: optional, `/^[A-Za-z0-9_-]{22}$/`.
- [ ] **Step 4: Run it and see it pass.**
- [ ] **Step 5: Write the failing store contract cases** in `tests/contract/store.contract.ts`, using the existing `withStore` and `lead()` helpers:
  - `an inquiry lead round-trips with only an email`: `createLead({ publicId, email, pageVersion: 'main', attribution: {}, status: 'inquiry', needs: ['Listing videos'], message: 'Hi\nthere', requestId: 'req-00000001' })`. Reading it back with `getLead` and with `getLeadByRequestId('req-00000001')` gives `status 'inquiry'`, the needs and the message unchanged, and `name`, `buyerType` and `volume` undefined.
  - `a repeated requestId throws DuplicateRequestError and stores nothing`. Leads without a requestId never collide: two of them are both stored.
  - `updateLead sets hassanNotifiedAt and visitorNotifiedAt; undefined keeps them`.
  - `getLeadByRequestId of an unknown id is null`.
- [ ] **Step 6: Write `db/migrations/002_inquiries.sql`.** It is one statement, MySQL 8 and MariaDB compatible:

```sql
-- Inquiries ("Send details"): a lead may come with only an email, plus what they need, a message and the browser's request id
-- (a repeated id is the same send). Hassan's email and the visitor's confirmation are marked when sent, for the cron retries.
ALTER TABLE leads
  MODIFY name VARCHAR(200) NULL,
  MODIFY buyer_type VARCHAR(20) NULL,
  MODIFY volume VARCHAR(100) NULL,
  ADD COLUMN needs TEXT NULL,
  ADD COLUMN message TEXT NULL,
  ADD COLUMN request_id VARCHAR(64) NULL,
  ADD COLUMN hassan_notified_at DATETIME(3) NULL,
  ADD COLUMN visitor_notified_at DATETIME(3) NULL,
  ADD UNIQUE KEY leads_request_id (request_id);
```

- [ ] **Step 7: Implement the store changes.**
  - **`mysql.ts`:**
    - Map the new columns. `needs` is stored as JSON text; `name`, `buyer_type` and `volume` may be NULL.
    - `createLead` inserts `status` (default `'started'`) and the new fields.
    - `updateLead` handles the two new marks.
    - Add `getLeadByRequestId`.
    - Map MySQL error 1062 on the `leads_request_id` key to `DuplicateRequestError`.
  - **`memory.ts`:** mirror all of it.
  - **The two fallout spots:**
    - `service.ts:94-99`: `lead.name ?? ''` for the invite; `volume` may be undefined inside `withoutUndefined`.
    - `notifier.ts:30-33`: `name: lead.name ?? DASH` for `hassan-*` emails, `lead.name ?? ''` otherwise; `buyerType` and `volume` fall back to `?? DASH`.
- [ ] **Step 8: Run the checks.** Run `npm test`, `npm run check` and `npm run test:db`. Expected: all pass; the contract runs on memory and on MySQL.
- [ ] **Step 9: Commit.** `feat(inquiry): leads can be inquiries: validation, migration 002, both stores`

### Task 2: The two inquiry emails

**Files:**
- Modify:
  - `src/server/booking/types.ts`: `EmailKind`.
  - `src/lib/content/placeholders.ts`.
  - `src/server/mail/notifier.ts`.
  - `src/server/mail/check.ts`: CASES.
  - `src/server/mail/render.ts`: only if line breaks inside a value need it.
- Create: `content/emails/hassan-new-inquiry.yaml`, `content/emails/inquiry-received.yaml`
- Test: `tests/unit/email.test.ts`, `tests/unit/email-check.test.ts`

**Interfaces:**
- Consumes (from Task 1): `Lead` with optional `name`, `buyerType`, `volume`, `needs` and `message`.
- Produces:
  - `EmailKind` gains `'hassan-new-inquiry' | 'inquiry-received'`.
  - `Notifier.send(kind, { lead })` works without a booking for `hassan-new-lead`, `hassan-new-inquiry` and `inquiry-received`.
  - `allowedPlaceholders('inquiry-received')` is `[]`.
  - `allowedPlaceholders('hassan-new-inquiry')` is the `hassan-` list plus `'needs'` and `'message'`.

- [ ] **Step 1: Write the failing tests** in `tests/unit/email.test.ts`. Use the notifier with an in-memory mailer, as the file already does, and an inquiry lead: `{ email: 'visitor@example.com', status: 'inquiry', needs: ['Listing videos','Reels for social'], message: 'Line one\nLine two <script>alert(1)</script> 🏠', pageVersion: 'agents', attribution: { utm_source: 'facebook', utm_campaign: 'nov' } }`.
  - `hassan-new-inquiry goes to Hassan with the visitor as Reply-To`:
    - `to` equals the loaded `hassanEmail` (compare; don't print it).
    - `replyTo === 'visitor@example.com'`.
    - The text holds `Listing videos, Reels for social` and `facebook / nov`.
    - The text has a dash for the name, phone and footage.
  - `the message stays plain text and keeps its line breaks`:
    - The HTML contains `&lt;script&gt;`, and never `<script>`.
    - The text contains `Line one\nLine two`.
    - The HTML keeps the break between the two lines (`<br>` or separate paragraphs).
  - `inquiry-received goes to the visitor and repeats nothing they typed`:
    - Use a lead whose name is `'<a href="https://evil.test">win</a>'`, whose message is `'buy now'`, and whose footageUrl is `'https://evil.test/x'`.
    - The mail goes to `visitor@example.com` with `replyTo` the site's `contact.replyTo`.
    - Neither the text nor the HTML contains `evil.test`, `buy now` or `win`.
  - `an inquiry with every detail fills each line`: the name, phone, type, volume, needs, footage and message appear.

  In `tests/unit/email-check.test.ts`:
  - `inquiry-received may use no placeholders`: a temp copy whose body adds `{name}` throws a ContentError that names `content/emails/inquiry-received.yaml`.
  - `hassan-new-inquiry may use {needs} and {message}`: it loads cleanly.
  - `assertEmailTemplatesRender still passes with the two new kinds in CASES`.
- [ ] **Step 2: Run and see them fail.** Run `npx vitest run tests/unit/email.test.ts tests/unit/email-check.test.ts`.
- [ ] **Step 3: Implement.**
  - **Types:** add the two kinds to `EmailKind`.
  - **`allowedPlaceholders`:** a `kind === 'inquiry-received'` branch returns `[]`; a `'hassan-new-inquiry'` branch returns the Hassan list plus `needs` and `message`.
  - **The notifier:**
    - The no-booking kinds are `hassan-new-lead`, `hassan-new-inquiry` and `inquiry-received`.
    - The Hassan values add `needs` (joined with `', '`, or the dash) and `message` (or the dash).
    - `replyTo` is `data.lead.email` for `hassan-new-inquiry`; every other kind keeps `loadEmailSite().replyTo`.
  - **`CASES`:** add one full inquiry and one email-only inquiry for each of the two kinds.
  - **Line breaks:** make line breaks inside a value survive in the HTML, by escaping first and then turning `\n` into `<br>`, within `render.ts`'s value formatter for HTML.
- [ ] **Step 4: Write the two email files, exactly:**

`content/emails/hassan-new-inquiry.yaml`
```yaml
# To Hassan, at once, when someone sends the "Send details" form instead of booking a call.
# Reply to this email to answer them: the reply goes straight to the visitor's address.
# Words in {curly braces} are filled in by the site; keep them as they are. You can use:
#   {name} {email} {phone} {buyerType} {volume} {needs} {footageUrl} {message} {pageVersion} {source}
# A detail the visitor left out shows as a dash.
subject: "New message from the website: {email}"
body: |
  Someone sent their details instead of booking a call. Reply to this email to answer them.

  Email: {email}
  Name: {name}
  Phone: {phone}
  Type: {buyerType}
  Videos per month: {volume}
  Needs: {needs}
  Footage link: {footageUrl}
  Page: {pageVersion}
  Came from: {source}

  Message:
  {message}
```

`content/emails/inquiry-received.yaml`
```yaml
# To the visitor, right after they send the "Send details" form.
# For safety it repeats nothing they typed (no name, link or message), so it has no {placeholders}.
# [confirm: "usually within a day" is how fast Hassan replies]
subject: We've got your details
body: |
  Thanks for getting in touch with HiveGen.

  We've got your details and we'll reply by email, usually within a day. If you sent a link to your raw footage, we can start your free edit from it.

  Questions in the meantime? Just reply to this email.
```

- [ ] **Step 5: Run the tests.** Run `npm test` and `npm run check`. Expected: all pass, including `assertEmailTemplatesRender`.
- [ ] **Step 6: Commit.** `feat(inquiry): Hassan's inquiry email (Reply-To the visitor) and the visitor's confirmation`

### Task 3: `sendInquiry` in the service, the bot check's action, and the cron retries

**Files:**
- Modify:
  - `src/server/booking/service.ts`
  - `src/server/booking/turnstile.ts`
  - `src/lib/booking/api-client.ts`: only the constants and the `TurnstileAction` type.
  - `src/server/context.ts`
  - `src/server/cron.ts`
- Test:
  - `tests/unit/booking-inquiry.test.ts` (new)
  - `tests/unit/turnstile.test.ts`
  - `tests/unit/cron.test.ts`
  - `tests/unit/booking-book.test.ts`
  - `tests/unit/context.test.ts`, if wiring tests need it

**Interfaces:**
- Consumes:
  - From Task 1: `inquiryInputSchema`, `DuplicateRequestError`, `Store.getLeadByRequestId` and the `updateLead` marks.
  - From Task 2: the two email kinds.
- Produces:
  - `api-client.ts`: `export type TurnstileAction = 'booking' | 'inquiry'` and `export const INQUIRY_TURNSTILE_ACTION = 'inquiry'`. `TURNSTILE_ACTION = 'booking'` stays.
  - Server `turnstile.ts`: `turnstileExpectation(siteUrl: string, action: TurnstileAction = TURNSTILE_ACTION): TurnstileExpected`.
  - `ServiceDeps.verifyBot(token: string, ip: string | undefined, action: TurnstileAction): Promise<boolean>`. `createLead` passes `'booking'` and `sendInquiry` passes `'inquiry'`.
  - `ServiceDeps.needOptions: string[]`, from `booking.yaml` `inquiry.needOptions`. Task 5 adds that key; until then, wire it in `context.ts` with a fallback of `[]` and a `// set by Task 5` comment, then remove the fallback in Task 5.
  - `BookingService.sendInquiry(raw: unknown, meta: RequestMeta): Promise<Result<{ status: 'received'; eventId: string }>>`.

- [ ] **Step 1: Write the failing service tests** in `tests/unit/booking-inquiry.test.ts`. Use the memory store, the existing fake notifier, tracker and clock patterns from `booking-leads.test.ts`, and a `verifyBot` spy. Valid raw: `{ email:'v@example.com', pageVersion:'main', turnstileToken:'ok', requestId:'req-00000001', website:'' }`.
  - `stores an inquiry and emails Hassan and the visitor`:
    - The result is `{ ok:true, value:{ status:'received', eventId: 'lead.<publicId>' } }`.
    - The store holds a lead with `status 'inquiry'`.
    - The notifier got `hassan-new-inquiry` and then `inquiry-received`.
    - The lead has `hassanNotifiedAt` and `visitorNotifiedAt` set.
    - The tracker got one `Lead` with that event id and `user.email`.
  - `the bot check is asked with the inquiry action`: `verifyBot` was called with `('ok', <ip>, 'inquiry')`. When it answers false, the result is `bot_check_failed` and nothing is stored.
  - `a filled honeypot says received and keeps nothing`.
  - `invalid input names the fields`.
  - `the same requestId again answers the same event id and sends nothing new`:
    - Two calls give one lead, two emails in total and one tracking event.
    - The same holds when the second call's `verifyBot` would fail.
    - The repeat check runs before the bot check.
  - `two simultaneous sends with one requestId store one inquiry`: `Promise.all` of two calls; the store's `DuplicateRequestError` is caught and the existing lead is answered.
  - `a failed email leaves its mark unset and the inquiry still counts`: the notifier throws for `hassan-new-inquiry`; the result is still ok, `hassanNotifiedAt` is undefined and `visitorNotifiedAt` is set.
  - `an earlier call-flow lead from this visit is told and not counted twice`:
    1. `createLead` a booking lead.
    2. `sendInquiry` with `leadId` set to its `publicId`.
    3. The earlier lead now has `newLeadNotifiedAt` set.
    4. The tracker got only the first `Lead`; the inquiry sent none.
  - `a leadId that is booked, unknown or itself an inquiry changes nothing`: the tracker sends the inquiry's Lead as usual.

  In `tests/unit/booking-book.test.ts`, add `an inquiry lead cannot book a call`: `book({ leadId: <inquiry's publicId>, … })` answers like an unknown lead and creates no booking.

  In `tests/unit/turnstile.test.ts`, add `turnstileExpectation takes the action`: `turnstileExpectation('https://hivegen.co','inquiry')` is `{ action:'inquiry', hostname:'hivegen.co' }`, and the default stays `'booking'`.

  In `tests/unit/cron.test.ts`, add:
  - `inquiry emails that failed are sent again after 2 minutes`: an inquiry 3 minutes old with no marks gets both emails; the marks are set; the summary counts `emailRetries: 2`. One that is 1 minute old is left; one older than 2 days is left.
  - `an inquiry never gets the 30-minute email`: an inquiry 31 minutes old produces no `hassan-new-lead`.
  - `a call-flow lead told by an inquiry gets no 30-minute email`.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement.**
  - **`sendInquiry`, in this order:**
    1. honeypot;
    2. parse;
    3. `getLeadByRequestId` (answer the existing one);
    4. `verifyBot(token, ip, 'inquiry')`;
    5. create the lead with `status:'inquiry'`, catching `DuplicateRequestError` and answering the existing lead;
    6. if `leadId` names a `started` lead without an active booking, `updateLead(earlier.id, { newLeadNotifiedAt: now })` and skip the tracker; otherwise send the `Lead` event (as in `createLead`, with the same fbc rule);
    7. send `hassan-new-inquiry` and then `inquiry-received` through `emailSender(d.notifier, 'booking')`, marking each one that went out.
  - **`book()`:** treat a lead with status `inquiry` like an unknown lead.
  - **`cron.ts`:** add a pass over `leadsCreatedBetween(now−EMAIL_RETRY_WINDOW, now−EMAIL_RETRY_AFTER)` for `status === 'inquiry'`. Send whichever mark is unset, then set it. Put the pass before the reminders, as the booking retries are.
  - **`context.ts`:** `verifyBot: (token, ip, action) => verifyTurnstile(token, ip, secret, turnstileExpectation(config.siteUrl, action))`; pass `needOptions`. The fakes context's verifier accepts the extra argument.
- [ ] **Step 4: Run** `npm test` and `npm run check`. Expected: all pass, with the existing lead and booking tests unchanged.
- [ ] **Step 5: Commit.** `feat(inquiry): sendInquiry (idempotent, one lead per visitor), its own bot-check action, cron retries`

### Task 4: The HTTP route and the browser API

**Files:**
- Create: `src/pages/api/booking/inquiries.ts`
- Modify: `src/server/http/handlers.ts`, `src/lib/booking/api-client.ts`
- Test: `tests/unit/http.test.ts`, `tests/unit/api-client.test.ts`

**Interfaces:**
- Consumes (from Task 3): `ctx.service.sendInquiry` and `ctx.limits.leads`. Inquiries share the leads budget of 10 an hour per address.
- Produces:
  - `export const inquiriesHandler: Handler`, at `POST /api/booking/inquiries` and built like `leadsHandler`.
  - In `api-client.ts`:

```ts
export interface InquiryInput {
  email: string; name?: string; phone?: string; buyerType?: BuyerType; volume?: string; needs?: string[];
  footageUrl?: string; message?: string; pageVersion: string; attribution: Attribution; fbp?: string; fbc?: string;
}
// added to BookingApi:
sendInquiry(i: InquiryInput & { turnstileToken: string; website: string; requestId: string; leadId?: string }): Promise<{ eventId: string }>;
```

`httpApi.sendInquiry` POSTs to `/api/booking/inquiries` and expects `{ status:'received', eventId: string }`; anything else is a `NetworkError`, and its errors are the same classes as `createLead`'s. `demoApi.sendInquiry` resolves `{ eventId: 'demo-inquiry-<n>' }` and stores nothing.

- [ ] **Step 1: Write the failing tests.**
  - `http.test.ts`, following the file's existing leads tests:
    - `POST /api/booking/inquiries stores an inquiry and answers 200 {status:'received', eventId}`.
    - `answers 400 with fields for a bad email`.
    - `answers 503 not_connected without a service`.
    - `the 11th lead-or-inquiry from one address in an hour is 429`: mixed leads and inquiries share the budget.
  - `api-client.test.ts`:
    - `sendInquiry posts the input to /api/booking/inquiries and returns the eventId`.
    - `a 400 is a FieldsError, 403 BotCheckError, 429 RateLimitedError, a bad body NetworkError`.
    - `demoApi.sendInquiry resolves a demo event id and makes no request`.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement** the handler, the route file (copy `leads.ts` with `inquiriesHandler`), `InquiryInput`, `sendInquiry` in `BookingApi`, and its two implementations. Every existing fake `BookingApi` in the tests gains `sendInquiry: vi.fn()`.
- [ ] **Step 4: Run** `npm test` and `npm run check`. Expected: all pass.
- [ ] **Step 5: Commit.** `feat(inquiry): POST /api/booking/inquiries and the browser's sendInquiry`

### Task 5: The switch, the nudge, the form's markup and its words

**Files:**
- Modify: `content/sections/booking.yaml`, `src/lib/content/schemas.ts` (the `booking` schema), `src/components/Booking.astro`, `src/styles/site.css`, `src/server/context.ts` (remove the Task 3 `needOptions` fallback)
- Create: `src/scripts/booking-switch.ts`, `tests/unit/booking-switch.test.ts`
- Test: `tests/unit/content.test.ts` or `content-files.test.ts` (the schema rules) and `tests/unit/components.test.ts` (the markup)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - **The markup hooks**, which Tasks 6 and 7 rely on:
    - `[data-switch]` is a `role="tablist"` with the buttons `[data-view="call"]` and `[data-view="details"]`. Both are `role="tab"` with `aria-controls`; the details button also has the class `nudge`.
    - The panels are `[data-flow]` (the call flow, unchanged, now also `role="tabpanel"`) and `[data-inquiry]` (`role="tabpanel"`, `hidden`).
    - The left column has `[data-heading="call"]` and `[data-heading="details"]`, both `h2.disp`, the details one `hidden`. Likewise `[data-subline="call"]` and `[data-subline="details"]`.
    - Inside `[data-inquiry]`:
      - `form[data-inquiry-form]` with the inputs `email`, `name`, `phone`, radios `buyer`, radios `volume`, checkboxes `needs`, `footage`, a textarea `message` (`maxlength="2000"`) and the honeypot `website`;
      - field wrappers `[data-inq-field="<f>"]` and errors `[data-inq-error="<f>"]` for f in `email phone footage message needs buyer volume name`;
      - `[data-inq-turnstile]` right above `button[data-inq-submit]`, then `p.err[data-inq-form-error]`;
      - `[data-inquiry-done]` (`hidden`, `tabindex="-1"`) holding `[data-inq-done-heading]`, `[data-inq-done-text]` and the Instagram link;
      - `<script type="application/json" data-inquiry-copy>` holding `{ errors: { email, phone, footage, message, network, botCheck, rateLimited }, done: { heading, text } }`. `network`, `botCheck` and `rateLimited` come from `booking.yaml` `errors`.
  - **`booking-switch.ts`:**
    - `export const NUDGE = { firstDelayMs: 600, everyMs: 6000, shakeMs: 700, maxShakes: 5 }`
    - `export function initSwitch(root: HTMLElement, opts: { reducedMotion?: boolean; onShow?(view: 'call' | 'details'): void } = {}): { show(view: 'call' | 'details'): void; hide(): void }`
    - `hide()` is used in "off" mode; it hides the switch and both panels' tab roles.

- [ ] **Step 1: Add the words to `booking.yaml` exactly** (after `steps:`):

```yaml
# The switch at the top of the form panel: the call (selected when the page opens) or the form below.
switch:
  label: How would you like to reach us?   # read out by screen readers only
  call: Book a call
  details: Send details
# The form for visitors who would rather not have a call. Only the email is required.
inquiry:
  heading: Send us your details
  subline: Rather not have a call? Tell us about your listings and we'll reply by email. Your first edit is still free.
  note: Only your email is required. The rest helps us reply with the right answer.
  fields:
    email: Email
    name: Name
    phone: Phone or WhatsApp
    buyer: I am a…
    volume: Videos per month
    needs: What do you need?
    footage: Raw footage link
    footageHint: A Google Drive, Dropbox or WeTransfer link is fine.
    message: Message
  optionalTag: (optional)
  needsTag: (pick any)
  footageTag: (optional, for your free edit)
  messagePlaceholder: Your listings, the style you like, deadlines, or any question.
  needOptions: ["Listing videos", "Reels for social", "3D & AI hooks", "Not sure yet"]
  submitLabel: Send my details
  consentLine: We'll reply by email, usually within a day. We only use your details to answer you and make your free edit.   # [confirm: "usually within a day"]
  done:
    heading: Thanks, we've got your details.
    text: We'll reply to {email}, usually within a day.   # {email} is the address they typed; keep it
  errors:
    email: Please enter a valid email.
    phone: Please check the phone number. Use digits, spaces, + ( ) or -.
    footage: Please paste the full link, starting with https://.
    message: Please keep your message under 2,000 characters.
```

The schema gains the strict `switch` and `inquiry` objects. `needOptions` is `.min(1)`; `done.text` must keep `{email}`, with the message style `must keep the {email} placeholder`, like `rescheduledText`.
- [ ] **Step 2: Write the failing tests.**
  - Content: `the inquiry words: done.text must keep {email}, and needOptions cannot be empty`, using `tempContent` as in `content-files.test.ts`.
  - `components.test.ts`, rendering the booking component with `renderBooking`:
    - `the switch opens on the call`: `[data-view="call"]` has `aria-selected="true"`, `[data-inquiry]` is `hidden`, and `[data-heading="details"]` is `hidden`.
    - `the form lists the needOptions as checkboxes and the volume options as radios`.
    - `the agents page preselects Agent in the form too`.
  - `tests/unit/booking-switch.test.ts`, with jsdom via `mount(await renderBooking())`, `vi.useFakeTimers()` and a hand-driven fake `IntersectionObserver` on the window:
    - `clicking Send details shows the form and its heading; Book a call brings the call back`. Check `aria-selected`, the `hidden` panels and headings, and that `onShow` was called with `'details'`.
    - `arrow keys move between the two tabs`.
    - `what was typed carries across`: email, name and phone, and the buyer and volume choices, from the call form to the form and back.
    - `the nudge`:
      - Shakes happen only after the card comes into view: no `shake` class before; at +600 ms `[data-view="details"]` has `shake`; at +1300 ms it doesn't.
      - It shakes again every 6000 ms, and not more than 5 times in total.
      - It never shakes while out of view.
      - It stops for good after a `focusin` on any field in the card, and after `Send details` is chosen.
    - `reduced motion: never a shake class`, with `initSwitch(root, { reducedMotion: true })`.
    - `hide() hides the switch for the offline card`.
- [ ] **Step 3: Run and see them fail.**
- [ ] **Step 4: Implement the markup, `booking-switch.ts` and the CSS.**
  - **Markup:**
    - Labels show `optionalTag`, `needsTag` and `footageTag` in a `<span>`, as the booking form does.
    - The form's buyer radios preselect `page.preselectBuyer`.
    - Put the `inquiry.note` paragraph at the top of the form.
  - **`initSwitch` wiring:** the `<script>` in `Booking.astro` must not call `initSwitch` yet; Task 6 starts it from `bootBooking`. Until then, test the module directly.
  - **CSS, exact values,** appended to `site.css`:

```css
.switch{display:flex;gap:4px;padding:4px;margin:0 0 18px;border-radius:999px;background:rgba(14,18,51,.06)}
.switch [role=tab]{flex:1;min-width:0;border:0;border-radius:999px;padding:10px 12px;font:600 13px/1.2 var(--font-body);background:transparent;color:var(--ink2);cursor:pointer;white-space:nowrap}
.switch [role=tab][aria-selected=true]{background:var(--ink);color:#FFF9EB}
.switch .nudge[aria-selected=false]{background:var(--lime);color:var(--ink);box-shadow:0 6px 18px rgba(160,200,20,.35)}
.switch [role=tab]:focus-visible{outline:2px solid var(--blue);outline-offset:2px}
.switch .shake{animation:switch-shake .7s ease-in-out}
@keyframes switch-shake{0%,100%{transform:none}20%{transform:translateX(-5px) rotate(-1.5deg)}35%{transform:translateX(5px) rotate(1.5deg)}50%{transform:translateX(-4px) rotate(-1deg)}65%{transform:translateX(4px) rotate(1deg)}80%{transform:translateX(-2px)}}
@media (prefers-reduced-motion:reduce){.switch .shake{animation:none}}
.inq textarea.inp{height:auto;min-height:104px;padding:12px 14px;display:block;width:100%;font:inherit;font-size:14px;resize:vertical}
```

`--blue` is the theme's blue; if the token has another name in `site.css`, use that. Apart from the textarea rule, the form reuses `.fld`, `.inp`, `.seg`, `.row2`, `.hint`, `.consent` and `.btn`.
- [ ] **Step 5: Run** `npm test` and `npm run check`. Expected: all pass. Also check that the booking-component render tests still pass (the call flow is unchanged).
- [ ] **Step 6: Commit.** `feat(inquiry): the Book a call / Send details switch with its nudge, and the form's markup and words`

### Task 6: The form's behaviour, a second bot-check widget, and start-up

**Files:**
- Create: `src/scripts/inquiry-ui.ts`, `tests/unit/inquiry-ui.test.ts`
- Modify:
  - `src/scripts/booking-boot.ts`
  - `src/scripts/booking-ui.ts` (the session hooks only)
  - `src/scripts/turnstile.ts`
  - `src/components/Booking.astro`: its `<script>` passes nothing new; the boot does it all.
- Test: `tests/unit/booking-boot.test.ts`, `tests/unit/turnstile-widget.test.ts`, `tests/unit/booking-ui.test.ts`

**Interfaces:**
- Consumes:
  - From Task 4: `BookingApi.sendInquiry` and `InquiryInput`.
  - From Task 5: the markup hooks and `initSwitch`.
  - From Task 3: `INQUIRY_TURNSTILE_ACTION`.
- Produces:
  - `booking-ui.ts`: `export interface BookingSession { leadId: string | null; leadTracked: boolean }`, and `BookingOptions.session?: BookingSession`. `initBooking` sets `session.leadId` when a lead is saved, and `session.leadTracked = true` when it calls `onLead`.
  - `inquiry-ui.ts`:
    - `export interface InquiryOptions { mode: 'live' | 'demo' | 'off'; getBotToken?: () => Promise<string>; onLead?(eventId: string): void; session: BookingSession; newRequestId?: () => string }`
    - `export function initInquiry(root: HTMLElement, api: BookingApi, opts: InquiryOptions): void`
  - `turnstile.ts`: `loadTurnstile(siteKey: string, container: HTMLElement, action: TurnstileAction = TURNSTILE_ACTION)`. Any number of widgets share one Cloudflare script: a second call while the script is loading waits for it, and never adds a second `<script>`.

- [ ] **Step 1: Write the failing tests.**

  `tests/unit/inquiry-ui.test.ts`, jsdom with a fake api in the style of `booking-ui.test.ts`, and `newRequestId` stubbed to give `req-1`, `req-2`, …:
  - `only the email is required`: submitting empty shows `copy.errors.email` under the email and makes no call; `'nope'` does the same.
  - `optional fields are checked`: phone `abc` gives the phone error; footage `ftp://x` gives the footage error. A message over 2000 characters can't occur in the page (maxlength); the server's `too_long` maps to the message error.
  - `sends what was given and nothing else`:
    - `sendInquiry` gets the email, the trimmed name, the checked needs as an array in page order, `pageVersion` from `root.dataset.page`, the attribution, the cookies, `website`, `turnstileToken` from `getBotToken` and `requestId: 'req-1'`.
    - Empty optional fields are left out.
    - There is no `leadId` when `session.leadId` is null.
  - `sends the call flow's lead id when there is one`: with `session.leadId = 'L'.repeat(22)`, the input has `leadId`.
  - `a second press while sending does nothing`: there is one call.
  - `a failed send keeps everything and tries again with the same request id`:
    1. A `NetworkError` shows `copy.errors.network`, and the values remain.
    2. Pressing again sends `requestId: 'req-1'`.
    3. After the email is changed, it is `'req-2'`.
  - `server field errors land on the right fields`: `FieldsError({ footageUrl:'invalid', buyerType:'invalid', needs:'invalid' })` marks footage, buyer and needs. `BotCheckError` shows `botCheck`; `RateLimitedError` shows `rateLimited`.
  - `success shows the thank-you`: the form is hidden; `[data-inquiry-done]` is shown and focused; the heading is `done.heading`; the text is `We'll reply to v@example.com, usually within a day.`
  - `the Lead is reported once per page, in live mode only`:
    - With `session.leadTracked` false, `onLead('lead.x')` is called once and `leadTracked` becomes true.
    - With `leadTracked` already true, it is not called.
    - In demo mode it is never called.
  - `off mode: nothing starts`.

  `booking-boot.test.ts`:
  - `a press of Send my details before start-up is held and sent once ready`.
  - `off mode hides the switch with the form`.
  - `live: the form's bot check is loaded only when Send details is first shown, with the inquiry action`: the `loadTurnstile` spy is called with `(siteKey, [data-inq-turnstile], 'inquiry')` once, after `show('details')`.
  - `the call flow and the form share one session`: a lead saved in the call flow makes the form send its `leadId`.

  `turnstile-widget.test.ts`:
  - `two widgets share one script and keep their own tokens and actions`: two `loadTurnstile` calls before the script loads give one `<script>`; after load, `render` runs twice, with actions `'booking'` and `'inquiry'`; each `getToken` gets its own widget's token.

  `booking-ui.test.ts`:
  - `a saved lead is written to the session, and onLead marks it tracked`.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement.**
  - **`initInquiry`:**
    - It mirrors `initBooking`'s error handling and copy loading (it reads `[data-inquiry-copy]`).
    - **The request id:** build the input and use `JSON.stringify(input)` as the key. While the key matches the last failed send, keep the request id; otherwise call `newRequestId()`. The default is `crypto.randomUUID`; without it, 16 bytes from `crypto.getRandomValues` as hex.
    - **The bot check:** get a token from `opts.getBotToken` when it is given; a failure is a `BotCheckError`.
  - **`bootBooking`:**
    - Create `const session: BookingSession = { leadId: null, leadTracked: false }`.
    - Call `initSwitch` at once, so the switch works before the config answers. Pass `onShow`, which in live mode with a site key creates the inquiry widget once, with `INQUIRY_TURNSTILE_ACTION`.
    - Hold submits on both forms.
    - After the config: `initBooking(root, api, { mode, getBotToken, session, ...env.hooks })`, then `initInquiry(root, api, { mode, getBotToken: inquiryToken, session, onLead: env.hooks?.onLead })`. `inquiryToken` waits for the widget to exist, created on demand if the form was sent before the view was shown.
    - Replay the held submit on whichever form was pressed.
    - In off mode, call `switchApi.hide()`.
  - **`loadTurnstile`:** a module-level script-loading promise per document, plus the `action` parameter.
- [ ] **Step 4: Run** `npm test` and `npm run check`. Expected: all pass. `booking-ui.test.ts` and `booking-boot.test.ts` keep their earlier cases green.
- [ ] **Step 5: Commit.** `feat(inquiry): the Send details form works: validation, one request id per send, its own bot check, one Lead per visitor`

### Task 7: Browser tests end to end, the phone layout, and the owner's guide

**Files:**
- Modify:
  - `tests/e2e/booking.spec.ts` (demo mode)
  - `tests/e2e/booking-flow.spec.ts` (fakes server, serial)
  - `tests/e2e/quality.spec.ts`
  - `tests/e2e/helpers.ts`: a `sendInquiry(request, over)` helper; the Turnstile stub supports two `render` calls with their own tokens.
  - `HOW-TO-EDIT.md`
- Test: the files above.

**Interfaces:**
- Consumes everything above.
- Produces no new names.

- [ ] **Step 1: Write the failing browser tests.**

  `booking.spec.ts` (demo, using the existing `openBooking` and `pretendMode('demo')`):
  - `the card opens on Book a call, with Send details in lime`:
    - `[data-view="call"]` has `aria-selected="true"`.
    - The computed background of `[data-view="details"]` is `rgb(211, 255, 82)`.
    - Its text colour is the ink colour.
  - `Send details shows the form and its heading; sending only an email thanks the visitor`:
    - The heading reads `Send us your details`.
    - Filling the email and pressing `Send my details` shows the thank-you with that email.
  - `with reduced motion the button never shakes`: emulate `reducedMotion:'reduce'`, scroll to the card and wait 2 s; `[data-view="details"].shake` never appears (poll it).
  - `without reduced motion it shakes once the card is in view`: `[data-view="details"].shake` appears within 2 s of scrolling to the card.

  `booking-flow.spec.ts` (fakes server; use `resetServer` and `outbox`; never print a Hassan address):
  - `an inquiry through the HTTP API: stored, both emails, and a repeat changes nothing`:
    1. POST only an email, with `requestId` `'e2e-req-0001'`; the answer is 200 `{status:'received'}`.
    2. The outbox kinds are `['hassan-new-inquiry','inquiry-received']`.
    3. The `inquiry-received` mail goes to the visitor's address, and its text contains none of the visitor's message.
    4. The same POST again gives 200, and the outbox still has 2 mails.
    5. `trackedEvents` has exactly one `Lead`.
  - `a bad email is 400 with fields.email`.
  - `sends from the page`: switch to Send details, fill the email and a message, send, then see the thank-you; the outbox has both kinds.
  - `a visitor who fills the call flow's step 1 and then sends the form counts as one Lead`: `trackedEvents` has one `Lead`, and the Pixel `Lead` calls (`trackerCalls`) number one.

  `quality.spec.ts`:
  - `axe: the booking card with Send details open has no violations` (desktop and phone).
  - `phone (320 px wide): the switch stays on one line and nothing scrolls sideways, also mid-shake`:
    - Set the viewport to 320×800.
    - Add the `shake` class by hand and wait 350 ms.
    - Expect `document.documentElement.scrollWidth <= 320`.
    - The two tabs' `getBoundingClientRect().top` values are equal.
- [ ] **Step 2: Run and see them fail.** Run `npx playwright test tests/e2e/booking.spec.ts tests/e2e/booking-flow.spec.ts tests/e2e/quality.spec.ts`. Expected: FAIL only where the stub or helper is not yet updated; the features exist since Task 6.
- [ ] **Step 3: Update the helpers and the Turnstile stub until they pass.** Change no product code unless a test finds a real bug; if it does, fix it test-first.
- [ ] **Step 4: Owner's guide.** In `HOW-TO-EDIT.md`, under the booking section, add:
  - the `switch:` and `inquiry:` blocks of `booking.yaml`, with what each word controls;
  - that `needOptions` is an editable list;
  - the two new emails, and that Hassan's has Reply-To set to the visitor;
  - that the visitor's confirmation can't use placeholders, and why;
  - one line saying the lime button shakes until the visitor uses the card, never for visitors with reduced motion.
- [ ] **Step 5: Run the full suite.** Run `npm test`, `npm run check`, `npm run test:db` and `npx playwright test`. Expected: all pass, with 0 failed.
- [ ] **Step 6: Commit.** `test(inquiry): browser tests for the switch, the form and the phone layout; HOW-TO-EDIT covers the form and its emails`

### Task 8: Section 05 plays the whole raw and edited videos

The owner's choice, 2026-11-21: the slider stays, on desktop and phone, but both sides now play the whole 60.5-second videos, served by the site. The "Watch the full edit" Stream button goes. The two videos are a re-cut, not frame-aligned, and the owner accepted that.

**Files:**
- Modify:
  - `content/sections/before-after.yaml`
  - `content/videos.yaml`: remove `v-before-after-edit` and its comment.
  - `src/lib/content/schemas.ts`: `clip.duration` becomes optional; `slider.posterAt` is new.
  - `scripts/prepare-media.mjs`
  - `HOW-TO-EDIT.md`: the section 05 paragraph.
- Regenerate with `npm run media`, and commit:
  - `public/media/clips/ba-before.mp4` and `ba-after.mp4`
  - `public/media/posters/ba-before.jpg` and `ba-after.jpg`
- Test:
  - `tests/e2e/sections.spec.ts`: replace the "Watch the full edit" test.
  - `tests/unit/components.test.ts:56-64` and `tests/unit/stream-sign.test.ts:174`: stop using `v-before-after-edit`.
  - The content rules in `tests/unit/content-files.test.ts`.

**Interfaces:** none shared with Tasks 1–7. The optional `fullVideoId` feature stays in the code, unused by the content.

- [ ] **Step 1: Write the failing tests.**
  - **Content** (`content-files.test.ts`, with `tempContent`):
    - `a slider clip without a duration is the whole video`: it loads with `duration` undefined.
    - `posterAt, when given, is 0 or more`: `-1` is refused with `(field slider.posterAt)`.
    - `a duration, when given, is still positive`.
  - **`sections.spec.ts`:** `section 05 plays both whole videos from the site, with no Stream`:
    - the two `video` elements in `#ba [data-ba-slider]` have a `src` under `/media/clips/`;
    - after `el.load()` and `loadedmetadata`, each `duration` is between 60 and 61;
    - `#ba` has no button and no `iframe`;
    - opening section 05 opens no lightbox.
    - Keep the existing slider drag tests unchanged.
  - **`components.test.ts`:** the hero-card half of the "pop-up video ids" test stays; the "Watch the full edit" half goes. `stream-sign.test.ts:174` uses another vertical Stream video id that exists in `videos.yaml`.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement.**
  - **Schema:** `clip.duration` is optional and stays `.positive()` when given. `slider.posterAt` is `z.number().min(0).optional()`.
  - **`prepare-media.mjs`:**
    - It leaves out `-t` when a clip has no duration.
    - Slider posters are taken at `posterAt`, or else at the middle of the clip when there is a duration, or else at 0.
    - With `boomerang: false` there is no reverse filter, as today.
  - **`content/sections/before-after.yaml`:** the slider block becomes, exactly:

```yaml
slider:
  before: { source: final-videos/Section-05/raw-section-5.mp4, start: 0 }
  after: { source: final-videos/Section-05/edited-section-5.mp4, start: 0 }
  boomerang: false
  posterAt: 2.5
```

    - The words: `subline: Drag the handle to compare the raw footage with our finished edit.` and `ariaLabel: Compare the raw footage with HiveGen's edit`. The heading is unchanged.
    - Rewrite the header comment so it says:
      - the clips are the whole videos unless `start` and `duration` cut them;
      - `posterAt` is the still's moment in seconds;
      - `boomerang` suits only short clips;
      - after changing anything under `slider:`, run `npm run media`.
    - Remove `fullVideoId` and `fullVideoLabel`.
- [ ] **Step 4: Regenerate the clips.** Run `npm run media`, which needs ffmpeg and the files under `references/`; both are on this computer. Expected:
  - `ba-before.mp4` and `ba-after.mp4` are each about 60.5 s, 540×960, with no audio stream. Check with `ffprobe`.
  - Together they are roughly 10–15 MB; note the sizes in the report.
  - The two posters show the opening shot.
- [ ] **Step 5: Update the owner's guide.** In `HOW-TO-EDIT.md`, the section 05 paragraph says:
  - the slider plays the whole raw video under the whole edit;
  - because the edit is a re-cut, the two sides sometimes show different shots;
  - how to swap in new videos (keep them the same length; set `posterAt`; run `npm run media`).
- [ ] **Step 6: Run the full suite.** Run `npm test`, `npm run check`, `npm run test:db` and `npx playwright test`. Expected: all pass, with 0 failed.
- [ ] **Step 7: Commit.** `feat(section-05): the slider plays the whole raw and edited videos from the site; no Stream button`
