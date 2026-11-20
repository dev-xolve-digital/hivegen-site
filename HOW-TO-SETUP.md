# How to connect the HiveGen site to its accounts

The site works on its own: you can edit it and see it on your computer without any account. This guide is for the moment you connect the real things: Hassan's Google Calendar, a database, a mailbox for the emails, the ad trackers, the bot check, protected videos, and the live server on Hostinger.

Each part is a numbered step. Every step ends with the exact lines to fill in and a command that tells you whether it worked. You can do the steps in any order, but this order is the easiest: **1, 2, 3, 6 and 8 make booking work. 4 and 5 add ad tracking. 7 protects the videos. 9 is the live server.**

Some steps need Hassan (the Google sign-in in step 1). Some need a change in your Cloudflare account. **Claude never changes your Cloudflare account on its own: it asks you first, one change at a time, and you say yes or no.** Where this guide says "ask Claude", that is what it means.

## Before you start

- **Two places for settings.** Secret settings (passwords, tokens, keys) go in a file called `.env` on your computer, and in hPanel on Hostinger. Public settings (the Pixel ID, the Turnstile site key, the backup link) go in `content/site.yaml`, which is safe to share. Never put a secret in a content file, and never send a `.env` line to anyone in a chat or an email.
- **Make your `.env` file once.** In the project folder, copy `.env.example` to a new file called `.env` (in PowerShell: `Copy-Item .env.example .env`). Open it in any text editor. Each line is `NAME=value`, with no spaces around the `=`. **If a value contains a `#` or a space, wrap the whole value in double quotes** (for example `SMTP_PASS="pa#ss word"`): without the quotes, everything from the `#` on is thrown away, so a password would be cut short and the login would fail. Any other value needs no quotes. In hPanel, type each value exactly as it is, **without** quotes. A line with nothing after the `=` means "not set up yet". The file is never saved to git.
- **Check your work.** Run `npm run check:services` in the project folder at the end of every step. It tries each service you have filled in and says, in plain words, what is wrong and what to do. See "Reading the check" below.
- **When booking is live.** Booking works for real only when these are all filled in: `DATABASE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `TURNSTILE_SECRET`, `CRON_SECRET` and `PUBLIC_SITE_URL`. On Hostinger (`NODE_ENV=production`), and on any computer whose `PUBLIC_SITE_URL` is a public address, the five mailbox settings of step 3 are needed too. Until then, your computer shows the demo booking (with its note), and the live site shows a card with Instagram and the backup link instead of the form, so a visitor is never told they are booked when they are not.
- **Careful when testing.** Once Google is connected, a booking made on your computer creates a real event in Hassan's calendar and sends a real invite. Book with an email address of your own. Without the mailbox settings, your computer does not send emails at all: it saves them as files in a folder called `.outbox`, so you can read them safely.

## Reading the check

`npm run check:services` prints one line for each service:

| Line | Meaning |
|---|---|
| `✓` | It works. |
| `✗` | It has settings, but it does not work. The lines under it say what is wrong and what to do. |
| `–` | Not set up yet. The line says which step in this guide to read. This is normal until you get to that step, and it does not count as a failure. |

The command stops with an error (exit code 1) only when a `✗` is shown. With no `.env` at all, every line is `–` and nothing is wrong. The check never prints a password, token or key. It cannot test the Google tag or the cron job: steps 5 and 8 say how to test those by hand.

---

## Step 1 · Google Calendar (Hassan's sign-in)

What this does: when someone books, the site finds Hassan's free times in his Google Calendar, adds the call to it, and creates the Google Meet link. You make a small "app" in Google Cloud for the site, then Hassan signs in once to allow it.

Any Google account can create the Google Cloud project. The sign-in at the end must be **Hassan's**, because it is his calendar.

**Make the project and turn on the calendar**

1. Open https://console.cloud.google.com and sign in. At the top, open the project list and choose **New project**. Name it `HiveGen`, then **Create**, and make sure it is the selected project.
2. In the menu, go to **APIs & Services > Library**. Search for **Google Calendar API**, open it and press **Enable**.

**Set up the consent screen, and set it to "In production"**

3. Go to **APIs & Services > OAuth consent screen** (Google may now call this area **Google Auth platform**). If it asks you to get started, fill in: App name `HiveGen`, your email as the support email, **Audience: External**, and your email again as the contact email. Agree and **Create**.
4. Open **Data access** (or **Scopes**) and add these two permissions, then save:
   - `https://www.googleapis.com/auth/calendar.events`
   - `https://www.googleapis.com/auth/calendar.freebusy`
5. Open **Audience** (or **Publishing status**). It says **Testing**. Press **Publish app** and confirm, so that it says **In production**.

   **This matters.** While the app says "Testing", Google ends Hassan's sign-in after 7 days. After that every booking would quietly become a "request" that Hassan has to confirm by hand, and the check would say "Hassan's Google sign-in has expired or was revoked". "In production" does not publish anything for people to find: it only means Google stops ending the sign-in after 7 days. Do this **before** Hassan signs in (further down), not after.

**Make the sign-in key**

6. Go to **APIs & Services > Credentials** (or **Clients**) and choose **Create credentials > OAuth client ID** (or **Create client**).
7. For **Application type** choose **Desktop app**. Name it `HiveGen desktop`, then **Create**. Google shows a **Client ID** and a **Client secret**. Copy both. (Do not choose "Web application": the sign-in would not work.)
8. Put them in your `.env`:

   ```
   GOOGLE_CLIENT_ID=<the Client ID>
   GOOGLE_CLIENT_SECRET=<the Client secret>
   ```

**Hassan signs in (once)**

9. Hassan needs to be at this computer, or on a screen share with you, because the sign-in comes back to this computer. In the project folder, run:

   ```
   npm run google:connect
   ```

10. A browser page opens (if not, copy the address it prints into the browser). Hassan chooses **his** Google account. Google says **"Google hasn't verified this app"**. That is expected, because the app is private. He presses **Advanced**, then **Go to HiveGen (unsafe)**, ticks both calendar permissions, and presses **Continue**.
11. The page says you can close it. In the terminal you see "Connected". The command has saved the long-lived key in `.env` as `GOOGLE_REFRESH_TOKEN`, and printed the same line so you can copy it into hPanel later.

**Lines for this step**

```
GOOGLE_CLIENT_ID=<the Client ID>
GOOGLE_CLIENT_SECRET=<the Client secret>
GOOGLE_REFRESH_TOKEN=<saved for you by npm run google:connect>
GOOGLE_CALENDAR_ID=
```

`GOOGLE_CALENDAR_ID` can stay empty: bookings then go to Hassan's main calendar. To use another calendar, put its calendar ID there (Google Calendar > the calendar's settings > Integrate calendar).

**Check it:** `npm run check:services`. The Google Calendar line should say it signed in and read the calendar for the next hour.

**If it later says the sign-in has expired or was revoked** (`invalid_grant`): check that the consent screen says **In production** (step 5), then run `npm run google:connect` again with Hassan and update `GOOGLE_REFRESH_TOKEN` in `.env` and in hPanel.

---

## Step 2 · The booking database (Hostinger MySQL)

What this does: it keeps the leads and the bookings. It lives on Hostinger.

**Make the database**

1. Sign in to hPanel (Hostinger). Open the website, then **Databases > Management**.
2. Under "Create a new MySQL database and database user", choose a database name, a user name and a password. Hostinger adds a prefix such as `u123456789_` to both names: use the full names it shows. **Use a password made of letters and numbers only** (20 or more characters). A password with symbols works too, but you then have to write the symbols as codes in the address below. Press **Create**.

**Let your computer reach it (only while you are developing)**

3. Open **Databases > Remote MySQL**. Under "IP address" enter this computer's public IP address (search "what is my IP" in a browser), choose your database, and press **Create**. If your internet provider changes your address from time to time, you will have to add the new one when that happens. The live site does not need this: it talks to the database from inside Hostinger. When you no longer develop against the live database, remove your address from this list.
4. On the same page, hPanel shows the **host name** to connect to from outside. It is not `localhost`. Write it down.

**Fill in the address**

5. Put one line in your `.env`. It is the user, the password, the host, the port (3306) and the database name, in this shape:

   ```
   DATABASE_URL=mysql://<user>:<password>@<host>:3306/<database>
   ```

   If the password has symbols, write each one as a code: `@` is `%40`, `#` is `%23`, `/` is `%2F`, `:` is `%3A`, `?` is `%3F`, `%` is `%25`.

6. Make the tables:

   ```
   npm run db:migrate
   ```

   It says "Applied: 001_init.sql". It is safe to run again: it only applies what is new. (The live site also does this by itself when it starts.)

**On the live server** the same line goes in hPanel (step 9), with `localhost` as the host name unless hPanel's database page shows another one for connecting from the website itself.

**Check it:** `npm run check:services`. The Database line should say it connected and the database is up to date. If it says a database update is not applied yet, run `npm run db:migrate`.

**Before launch, test the database's SQL on Hostinger's own server.** Hostinger runs MySQL or MariaDB, and the site's SQL has to work on exactly that. This test runs the same checks the site's storage has to pass, in a temporary database that it creates and deletes again. It does not touch your bookings. In PowerShell:

```
$env:DATABASE_URL_TEST = "<the same address as DATABASE_URL>"
npm run test:db
```

(In Git Bash: `DATABASE_URL_TEST='<the same address as DATABASE_URL>' npm run test:db`.) All tests should pass. If it stops with "Access denied" at `CREATE DATABASE`, Hostinger does not let the database user make a second database. That is a limit of the test, not a problem with the site: tell Claude: it can change the test to use a spare empty database instead.

---

## Step 3 · The sending mailbox (SMTP)

What this does: it sends the emails: the confirmation, the reminders, the "your call moved" emails, and the notes to Hassan. The live site **needs** a mailbox that can send: until it is set up, the live booking form stays switched off and shows Instagram and the backup link.

**First, one choice to make with Claude.** Mail that arrives at `connect@hivegen.co` is today received by Cloudflare Email Routing, which forwards it to Gmail. A normal mailbox on the same domain at Hostinger (or Google Workspace, Zoho and so on) needs its own incoming-mail settings, which would replace that forwarding. There are two ways, and both work with this site:

- **A sending-only mail service** (an SMTP service that gives you a host, a port, a user name and a password). Cloudflare Email Routing keeps receiving mail as it does now. This is the simplest.
- **A full mailbox** on the domain. Then all the domain's incoming mail moves to that provider, and you forward it to Gmail from there.

Ask Claude which suits you. Whichever you pick, the provider tells you to add a few records to the domain (called SPF and DKIM) in Cloudflare's DNS page. Do that, or the emails will land in spam.

**One rule for the SPF record: a domain may have only one.** It is a TXT record whose text starts with `v=spf1`, and Cloudflare Email Routing may already have added one. If one exists, do **not** add a second: a second SPF record breaks SPF for the whole domain, and the booking emails land in spam. Instead, edit the existing record and add the provider's `include:` part (for example `include:spf.example-provider.com`) before its final `~all` or `-all`. Claude can look at the domain's DNS records for you, with your OK, and tell you exactly what to put. DKIM records are different: add the ones the provider gives you.

**Fill in the five settings**

1. Find your mailbox's **SMTP** settings in the provider's help pages. For a Hostinger mailbox they are usually host `smtp.hostinger.com`, port `465`, and the full mailbox address as the user name.
2. Put them in your `.env` (and in hPanel, step 9):

   ```
   SMTP_HOST=<the SMTP server, for example smtp.hostinger.com>
   SMTP_PORT=465
   SMTP_USER=<the mailbox's user name, usually its full address>
   SMTP_PASS=<the mailbox's password>
   MAIL_FROM=HiveGen <connect@hivegen.co>
   ```

   If the password contains a `#` or a space, put the whole value in double quotes in `.env` (`SMTP_PASS="pa#ss"`); in hPanel, type it without quotes.

   `MAIL_FROM` is the name and address people see on the emails. Its address should be on `hivegen.co` and be one the provider allows you to send from. Replies go to the address in `content/site.yaml` under `contact:` `replyTo`, which reaches Hassan.

**Check it:** `npm run check:services`. The Sending mailbox line should say it logged in to the mail server. **That check sends no email.** To see a real one, make a test booking (see "After you deploy").

If one of the five lines is empty, the check says which one is still missing.

---

## Step 4 · Meta Pixel and Conversions API

What this does: it tells Meta (Facebook and Instagram ads) when someone visits, leaves their details, and books a call. Two parts work together: the Pixel in the visitor's browser, and the Conversions API from the site's server, which still counts people whose browser blocks the Pixel. The site gives each event one ID, so Meta counts it once.

1. Open Meta **Events Manager** (in Meta Business Suite). Under **Connect data sources**, choose **Web**, then **Meta Pixel**, and give it a name. If the Pixel already exists, open it under **Data sources**.
2. Copy the **Pixel ID**: a number of 15 or 16 digits. Put it in `content/site.yaml`, under `tracking:` (public, safe to share):

   ```yaml
   tracking:
     metaPixelId: "123456789012345"
   ```

3. In Events Manager, open your Pixel, then **Settings**. In the **Conversions API** part, choose **Generate access token** and copy the token. It is a secret: it goes only in `.env` and hPanel.
4. To try it, open **Test events** in Events Manager. Meta shows a **test event code** (it looks like `TEST12345`). Put it in `.env` for now.

**Lines for this step**

```
META_CAPI_TOKEN=<the access token>
META_TEST_EVENT_CODE=<the test event code, only while testing>
```

and in `content/site.yaml`, `tracking:` `metaPixelId`.

**Check it:** `npm run check:services`. With a test event code set, the check sends **one** test event, so the Meta line says Meta took it. Open **Test events** in Events Manager: a "Lead" event from the website should appear within a minute. Then try the whole thing: with the Pixel ID in `site.yaml` and the test code in `.env`, run `npm run dev`, open the site, book a test call, and watch PageView, Lead and Schedule appear in Test events, each shown once from the browser and once from the server (Meta joins the two into one).

**When you are done testing, empty `META_TEST_EVENT_CODE` again, in `.env` and in hPanel.** While it is set, Meta treats every event as a test and does not use it for your ads.

If the Pixel ID is in `site.yaml` but there is no token, the check shows "not set up yet": the Pixel in the browser works, the server-side events wait for the token. A token with no Pixel ID is shown as a failure, because nothing would be sent.

---

## Step 5 · Google Analytics (GA4) and Google Ads

What this does: it counts visits in Google Analytics and tells Google Ads when someone books a call. All of these IDs are public, and they all go in `content/site.yaml`. There is no secret here.

1. **GA4 measurement ID.** In Google Analytics, open **Admin > Data streams**, choose your web stream, and copy the **Measurement ID** (it starts with `G-`).
2. **Google Ads conversion.** In Google Ads, open **Goals > Conversions > New conversion action**, choose **Website**, and make a conversion for "Booked call" (category: **Book appointment**) set up **manually** with the Google tag. In its **Tag setup**, you see a line like `send_to: 'AW-123456789/AbC-D_efG-h'`. The part before the `/` is the **Google Ads ID**, and the part after it is the **conversion label**.
3. Put them in `content/site.yaml`:

   ```yaml
   tracking:
     googleTagId: "G-ABC123XYZ4"
     googleAdsId: "AW-123456789"
     googleAdsScheduleLabel: "AbC-D_efG-h"
   ```

   Leave one empty to switch that tracker off. Without a label, the Ads conversion is never sent, even with the ID set.

**Lines for this step:** the three `tracking:` lines above. No `.env` line.

**Check it.** `npm run check:services` cannot test this one, so test it in the browser:

- In Google Analytics, open **Admin > DebugView**. In Chrome, add the "Google Analytics Debugger" extension and turn it on, then open the site: your visit appears in DebugView. (**Reports > Realtime** shows you too, without the extension.)
- To test the Ads conversion, open https://tagassistant.google.com, connect your site, make a test booking, and see the conversion tag fire. In Google Ads the conversion shows "Recording conversions" within a day.

The site loads these scripts only after the page has finished loading, so the page stays fast on a phone.

---

## Step 6 · The Turnstile bot check

What this does: a small check on the booking form that tells people from robots, without any puzzle. It has two keys: a **Site key** (public, goes in `content/site.yaml`) and a **Secret key** (goes in `.env` and hPanel).

**The widget has to be made in your Cloudflare account. That is a change to your account, so ask Claude: it can create it with your OK.** Claude asks first, then makes a widget named `HiveGen booking` for `hivegen.co` and `localhost` (so it also works on your computer), and gives you both keys. If you prefer to do it yourself: Cloudflare dashboard > **Turnstile** > **Add widget**, add the hostnames `hivegen.co` and `localhost`, choose **Managed**, and copy both keys.

**Lines for this step**

```
TURNSTILE_SECRET=<the Secret key>
```

and in `content/site.yaml`:

```yaml
settings:
  turnstileSiteKey: "<the Site key>"
```

**The site key must be filled in before the site goes live.** Without it the bot check cannot load, and every visitor's booking is refused. When booking would be live, the check marks this as a failure.

If you change `turnstileSiteKey` on a running server, restart the app (see step 9).

**The check only counts on the site's own address.** The server accepts a passed check only if Cloudflare says it was made by the booking form on the host in `PUBLIC_SITE_URL`: `hivegen.co` on the live site, `localhost` on your computer. The widget also allows `localhost`, so without this, a check passed on a copy of the site on someone's computer would also be accepted by the live site. Keep `PUBLIC_SITE_URL` exactly the address visitors use (`https://hivegen.co`, without `www`). If it is not, every booking is refused and the app log says `bot check refused` along with both addresses.

**Check it:** `npm run check:services`. Two lines: "Turnstile bot check (secret)" asks Cloudflare whether the secret is right, and "(site key)" checks that the key is filled in. If the secret line says Cloudflare accepted a made-up token, you are using one of Cloudflare's test secrets. Their answers name `example.com`, so the booking form refuses every booking. Use the real widget's Secret key, which also works on `localhost`.

---

## Step 7 · Signed video links (Cloudflare Stream)

What this does: the portfolio videos play from Cloudflare Stream. Today anyone who finds a video's link can copy it. With signed links, the site gives each visitor a link that stops working after an hour, and Stream refuses the plain link. This is switched on **at launch**, not before. Until then the site works as it does now.

**Make the signing key.** This is a change in your Cloudflare account, so **ask Claude: it can create it with your OK.** Claude asks first, makes the key, and gives you two values (shown only once, so keep them safe):

```
STREAM_SIGNING_KEY_ID=<the key's ID>
STREAM_SIGNING_KEY_JWK=<the key, a long base64 text>
```

Put them in `.env` and in hPanel. Then run `npm run check:services`. The Stream line signs a link for one video and asks Stream whether it accepts it. It should say it did. At this point nothing on the site has changed yet.

**At launch, in this order** (the order matters, so no visitor ever meets a video that does not play):

1. Make sure the two key lines are in hPanel and the check is happy.
2. In `content/site.yaml`, set `streamSignedUrls: true` under `settings:`, and put the site live (step 9). Stream accepts a signed link for any video, protected or not, so the videos keep playing.
3. Run `npm run media`. With the key in `.env`, it downloads any client card image that is still missing, with a signed address. (Nothing happens if all five are there, which they are today.)
4. The five client card images (`public/media/posters/t-chris.jpg`, `t-christine.jpg`, `t-deangelo.jpg`, `t-julz.jpg` and `t-kenneth.jpg`) should be served from Cloudflare Images, like the other card images (until they are, the site serves them itself, so nothing breaks). **Uploading to Cloudflare Images is a change to your account: ask Claude, it can do it with your OK.** Then add each image's ID to `content/images.yaml`, as `media/posters/t-chris.jpg: <image ID>` and so on (see "Images" in `HOW-TO-EDIT.md`).
5. Now protect the videos: **ask Claude to turn on "require signed URLs" on each video in Stream** (a change to your account: it needs your OK). From then on, only the site's signed links play.
6. Test it: play a video on the live site, then in a private browser window open `https://customer-<your customer code>.cloudflarestream.com/<the video's streamUid>/iframe`. The customer code is `streamCustomerCode` in `site.yaml` and the `streamUid` is in `content/videos.yaml`. Stream should refuse it.

**Lines for this step:** the two `STREAM_` lines in `.env` and hPanel, and `streamSignedUrls: true` in `content/site.yaml` at launch.

If `streamSignedUrls` is true but the key is missing, no video can play, and the check marks it as a failure.

---

## Step 8 · The Hostinger cron job

What this does: some work has to happen even when nobody is on the site: the reminders 24 hours and 1 hour before a call, the "no time picked yet" email to Hassan 30 minutes after a lead, and sending again any email or tracking event that failed. Hostinger starts a small job every 5 minutes, and the job asks the site to do that work.

**Make a secret.** It is any long text of letters and numbers. This command makes one (it prints 48 characters):

```
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

Put it in `.env` (on this computer) and in hPanel (the live site). The two places differ in one line, the site's address:

- **In `.env`**, the address is your own computer's, because until the site is deployed there is nothing at `https://hivegen.co` to answer, and the links in test emails and `npm run cron` must stay on your computer:

  ```
  CRON_SECRET=<the secret>
  PUBLIC_SITE_URL=http://localhost:4321
  ```

- **In hPanel**, the address is the real site:

  ```
  CRON_SECRET=<the secret>
  PUBLIC_SITE_URL=https://hivegen.co
  ```

Do not put `https://hivegen.co` in `.env`: manage links in your test emails would point at the live site, and `npm run cron` would call it. (A public address in `.env` also needs the five mailbox settings of step 3, as on the live site.)

**Make the job.** In hPanel, open **Advanced > Cron Jobs**, choose a custom job, and fill in:

- **Command:**

  ```
  curl -s -X POST https://hivegen.co/api/cron/run -H "x-cron-secret: <the secret>"
  ```

- **Schedule:** every 5 minutes (choose "Every 5 minutes" if hPanel offers it, or `*/5` in Minutes and `*` in all the other boxes).

Hostinger's rules for this command, which this one follows: it is **one line of at most 255 characters** (this one is about 116), it has **no `%` sign** (that is why the secret is letters and numbers only), and it runs on **UTC** time, which does not matter for "every 5 minutes". The job does **not** get the site's other settings, which is why it asks the site (which has them) to do the work, with the secret in the command. Anyone who can open your hPanel can read that command, so keep hPanel access to yourself.

**Check it by hand.** The job's own result is not shown anywhere handy, so run the same call yourself once. In PowerShell (note `curl.exe`, not `curl`):

```
curl.exe -s -X POST https://hivegen.co/api/cron/run -H "x-cron-secret: <the secret>"
```

You should see a short line such as `{"reminders24h":0,"reminders1h":0,"newLeadEmails":0,"emailRetries":0,"trackingRetries":0}`. `{"error":"unauthorized"}` means the secret in the command is not the same as `CRON_SECRET` in hPanel. `{"error":"not_connected"}` means booking is not connected on that server yet, or `CRON_SECRET` is not set there (see step 9: the app's logs say what is missing). On your own computer, `npm run cron` makes the same call against `PUBLIC_SITE_URL` using the secret in `.env`.

**Check it:** `npm run check:services` does not test the job. The by-hand call above does. An hour after a test booking, the 1-hour reminder email shows the job is running.

---

## Step 9 · The Hostinger app settings

What this does: it makes the live site behave like a live site.

Set these in hPanel, in the Node.js app's **Environment variables** (the menu names can differ a little from what is written here; Hostinger's help pages show the current screens). They are the same names as in `.env`:

```
NODE_ENV=production
PUBLIC_SITE_URL=https://hivegen.co
DATABASE_URL=<the address from step 2, with localhost as the host if that is what hPanel shows>
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REFRESH_TOKEN=...
SMTP_HOST=...
SMTP_PORT=...
SMTP_USER=...
SMTP_PASS=...
MAIL_FROM=...
TURNSTILE_SECRET=...
CRON_SECRET=...
META_CAPI_TOKEN=...
STREAM_SIGNING_KEY_ID=...
STREAM_SIGNING_KEY_JWK=...
```

- **`NODE_ENV=production` is what makes the live site safe.** The built site also treats a missing `NODE_ENV` as production, but set it anyway so nothing depends on that. In production, missing settings keep the booking switched off and show Instagram and the backup link instead of the demo booking. The same happens if the bot check's public key (`turnstileSiteKey` in `content/site.yaml`, step 6) is empty: the log says so, and the form stays off. Leave `META_TEST_EVENT_CODE` out.
- **Build and start.** The build command is `npm run build` and the start command is `node dist/server/entry.mjs`. Choose Node.js 24 (the site needs version 24). **Start the app from the repository's main folder:** the site reads `content/`, `public/` and `db/migrations/` from the folder it starts in, so it must not be started from inside `dist/`.
- **Settings are read when the app starts.** After you change a setting in hPanel, restart the app (or redeploy).
- **After editing `content/site.yaml` or `content/sections/booking.yaml` on a running server, restart the app.** The booking part of the site reads them once, when it starts. (Normally you edit on your computer and redeploy, which rebuilds the pages and restarts the app by itself.)
- **The startup messages appear on the first visit.** The site wakes up when the first visit arrives (Hostinger stops an idle app). Open the site once, then read the app's logs in hPanel. Lines that start with `booking:` say whether booking is connected. "NOT CONNECTED in production. Missing settings: ..." lists exactly what to fill in.
- **The site must be reachable only through Cloudflare.** To count visits per person (so nobody can fill the form again and again), the site trusts the visitor address that Cloudflare adds (the `CF-Connecting-IP` header). Keep the orange cloud on for `hivegen.co` in Cloudflare, and do not share the server's own address or Hostinger's temporary web address. Ask Claude if you want to also restrict the server to Cloudflare's addresses.

**Check it after you deploy**, as below.

---

## Before you launch

1. `npm run check:services` shows `✓` on every line you rely on and no `✗`.
2. The consent screen says **In production** (step 1), and Hassan has signed in **after** that.
3. `npm run db:migrate` has run, and the SQL test of step 2 (`npm run test:db` with `DATABASE_URL_TEST`) passed.
4. `turnstileSiteKey` is filled in `content/site.yaml` (step 6).
5. `META_TEST_EVENT_CODE` is empty (step 4).
6. The cron job exists and your by-hand call answered with numbers (step 8).
7. `NODE_ENV=production` and all the settings above are in hPanel (step 9).
8. If you are switching on signed video links: step 7, in its order.
9. Your `.env` is saved somewhere safe (a password manager). It is not in git, so if this computer is lost, so are these secrets.

## After you deploy

1. **Open the site once**, then read the app's logs in hPanel. You want to see no "NOT CONNECTED" line.
2. **Make a test booking** on the live site with an email address of your own. You should get the confirmation email, the call should appear in Hassan's Google Calendar with a Meet link, and Hassan should get his email.
3. **Reschedule and cancel** it with the link in the email.
4. **Check that the server sees the visitor's address.** In hPanel, open **Databases > phpMyAdmin**, open the table `leads` and look at the `client_ip` of your test booking. It should be your own public address (search "what is my IP"). If it is empty, `127.0.0.1`, or a Cloudflare address, tell Claude: the site is not seeing the real visitor, and the per-person limits would not work.
5. **Test the ad trackers** with Meta's **Test events** (put the code back temporarily, then remove it) and with GA4 Realtime or DebugView.
6. **Wait for the cron job** (step 8): an hour after a test booking, the 1-hour reminder arrives.

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| The live booking card shows Instagram, not the form | Booking is not connected on the server | Read the app's logs for "Missing settings" and fill those in (step 9) |
| Every booking becomes "We've got your request" and Hassan gets "Confirm by hand" emails | Google could not make the event, usually an expired sign-in (`invalid_grant`) | Step 1, "If it later says the sign-in has expired" |
| The form says it could not check you are a person | The Turnstile site key is missing or wrong, the secret is wrong, or `PUBLIC_SITE_URL` is not the address visitors use (the log says `bot check refused`) | Step 6, then `npm run check:services` |
| No emails arrive | The mailbox settings are wrong (a password with a `#` needs double quotes in `.env`), or the mail is in spam | Step 3; also check that the domain has exactly one SPF record, and DKIM |
| No reminders arrive | The cron job is not running | Step 8: run the call by hand |
| Videos do not play after switching on signed links | The key is not in hPanel, or the site was not redeployed | Step 7, steps 1 and 2 |
