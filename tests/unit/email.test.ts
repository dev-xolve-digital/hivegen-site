import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTransport } from 'nodemailer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContentError } from '../../src/lib/content/errors';
import { loadEmail, loadSite } from '../../src/lib/content/load';
import { manageUrl } from '../../src/server/booking/links';
import type { Booking, EmailData, EmailKind, Lead } from '../../src/server/booking/types';
import { createOutboxMailer, createSmtpMailer, smtpTransportOptions, type MailMessage, type Mailer } from '../../src/server/mail/mailer';
import { createNotifier } from '../../src/server/mail/notifier';
import { renderEmail } from '../../src/server/mail/render';
import { removeTempContent, tempContent } from '../helpers/temp-content';
import { setup } from './helpers/booking';

const KINDS: EmailKind[] = ['booking-confirmed', 'booking-requested', 'reminder-24h', 'reminder-1h', 'booking-cancelled',
  'booking-rescheduled', 'hassan-new-booking', 'hassan-confirm-by-hand', 'hassan-new-lead', 'hassan-booking-changed'];
const SITE = 'https://hivegen.co';
const HASSAN = 'hassan@example.test';
const MEET = 'https://meet.google.com/abc-defg-hij';

const lead: Lead = {
  id: 1, publicId: 'pub-1', name: 'Zoë O’Brien', email: 'zoe+ads@example.com', phone: '+1 (555) 010-2000', buyerType: 'agent', volume: '6–15',
  footageUrl: 'https://drive.google.com/drive/folders/x1', pageVersion: 'agents',
  attribution: { utm_source: 'facebook', utm_campaign: 'agents-q1', fbclid: 'abc' }, createdAt: new Date('2026-12-01T10:00:00Z'), status: 'booked',
};
const booking: Booking = {
  id: 1, leadId: 1, start: '2026-12-02T14:00:00.000Z', end: '2026-12-02T14:15:00.000Z', visitorTz: 'America/New_York', status: 'booked',
  manageToken: 'tok-123', googleEventId: 'ev-1', meetUrl: MEET, createdAt: new Date('2026-12-01T10:05:00Z'), updatedAt: new Date('2026-12-01T10:05:00Z'),
};
const { meetUrl: _meet, ...bookingWithoutMeet } = booking;
const NEW_YORK_TIME = 'Wednesday, December 2, 9:00 AM EST';
const PAKISTAN_TIME = 'Wednesday, December 2, 7:00 PM GMT+5';
const PREVIOUS_START = '2026-12-01T15:00:00.000Z'; // Tuesday 10:00 AM in New York

/** Every value an email can use, for the tests that call the renderer directly. */
const allVars: Record<string, string> = {
  name: 'Zoë O’Brien', when: NEW_YORK_TIME, timezone: 'America/New York', meetUrl: MEET, manageUrl: `${SITE}/booking/tok-123`,
  previousWhen: 'Tuesday, December 1, 10:00 AM EST', email: 'zoe+ads@example.com', phone: '+1 (555) 010-2000', buyerType: 'agent', volume: '6–15',
  footageUrl: 'https://drive.google.com/drive/folders/x1', pageVersion: 'agents', source: 'facebook / agents-q1', whenPakistan: PAKISTAN_TIME,
  change: 'rescheduled',
};
const { meetUrl: _meetVar, ...allVarsWithoutMeet } = allVars;

const tempDirs: string[] = [];
const tempDir = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hg-mail-')); tempDirs.push(d); return d; };
afterEach(() => {
  delete process.env.CONTENT_DIR;
  removeTempContent();
  vi.useRealTimers();
  for (const d of tempDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** The HTML without its <title>, which repeats the subject: what is left is the page the reader sees. */
const inPage = (html: string) => html.replace(/<title>[\s\S]*?<\/title>/, '');

/** A mailer that keeps what it is given. */
function recorder(): Mailer & { sent: MailMessage[] } {
  const sent: MailMessage[] = [];
  return { sent, send: async (m) => { sent.push(m); } };
}
const notifierWith = (mailer: Mailer) => createNotifier({ mailer, hassanEmail: HASSAN, siteUrl: SITE, hassanTz: 'Asia/Karachi' });
/** What the booking service sends with each kind of email. */
const dataFor = (kind: EmailKind, over: Partial<EmailData> = {}, b: Booking = booking): EmailData => {
  if (kind === 'hassan-new-lead') return { lead, ...over };
  if (kind === 'booking-rescheduled') return { lead, booking: b, previousStart: PREVIOUS_START, ...over };
  if (kind === 'hassan-booking-changed') return { lead, booking: b, previousStart: PREVIOUS_START, change: 'rescheduled', ...over };
  return { lead, booking: b, ...over };
};
const sendOne = async (kind: EmailKind, over: Partial<EmailData> = {}, b: Booking = booking) => {
  const mailer = recorder();
  await notifierWith(mailer).send(kind, dataFor(kind, over, b));
  return mailer.sent[0];
};

describe('email wording files', () => {
  it('there is one file per kind of email, and nothing else', () => {
    expect(fs.readdirSync('content/emails').sort()).toEqual(KINDS.map((k) => `${k}.yaml`).sort());
  });

  it('every email file loads and uses only its allowed placeholders', () => {
    for (const kind of KINDS) expect(() => loadEmail(kind), kind).not.toThrow();
    // A visitor email may not use Hassan's details.
    process.env.CONTENT_DIR = tempContent({ 'emails/booking-confirmed.yaml': (s) => s.replace('Hi {name},', 'Hi {name}, {phone}') });
    expect(() => loadEmail('booking-confirmed')).toThrow(/emails\/booking-confirmed\.yaml: \{phone\} can't be used in this email.*\(field body\)/);
    // A misspelt one is named too.
    process.env.CONTENT_DIR = tempContent({ 'emails/hassan-new-booking.yaml': (s) => s.replace(/^(subject:.*)\{whenPakistan\}/m, '$1{whenPakistn}') });
    expect(() => loadEmail('hassan-new-booking')).toThrow(/emails\/hassan-new-booking\.yaml: \{whenPakistn\} can't be used in this email/);
  });

  it('a placeholder in the subject or the button label is checked too', () => {
    process.env.CONTENT_DIR = tempContent({ 'emails/reminder-1h.yaml': (s) => s.replace(/^subject: .*$/m, 'subject: "Hi {volume}"') });
    expect(() => loadEmail('reminder-1h')).toThrow(/reminder-1h\.yaml: \{volume\} can't be used in this email.*\(field subject\)/);
    process.env.CONTENT_DIR = tempContent({ 'emails/reminder-1h.yaml': (s) => s.replace(/label: .*/, 'label: "Join {email}"') });
    expect(() => loadEmail('reminder-1h')).toThrow(/reminder-1h\.yaml: \{email\} can't be used in this email.*\(field button\.label\)/);
  });

  it('a missing field or a wrong button link names the file and field', () => {
    process.env.CONTENT_DIR = tempContent({ 'emails/reminder-1h.yaml': (s) => s.replace(/^subject: .*$/m, '') });
    expect(() => loadEmail('reminder-1h')).toThrow(/emails\/reminder-1h\.yaml: "subject" is missing \(field subject\)/);
    process.env.CONTENT_DIR = tempContent({ 'emails/reminder-1h.yaml': (s) => s.replace('link: meet', 'link: elsewhere') });
    expect(() => loadEmail('reminder-1h')).toThrow(/emails\/reminder-1h\.yaml: "button\.link"/);
  });

  it('Reply-To is a content setting', () => {
    expect(loadSite().contact.replyTo).toBe('connect@hivegen.co');
    process.env.CONTENT_DIR = tempContent({ 'site.yaml': (s) => s.replace(/^\s*replyTo:.*\n/m, '') });
    expect(() => loadSite()).toThrow(/site\.yaml: "contact\.replyTo" is missing \(field contact\.replyTo\)/);
    process.env.CONTENT_DIR = tempContent({ 'site.yaml': (s) => s.replace('replyTo: connect@hivegen.co', 'replyTo: not-an-address') });
    expect(() => loadSite()).toThrow(/site\.yaml: "contact\.replyTo"/);
  });
});

describe('renderEmail', () => {
  it('fills values, escapes them in HTML, keeps them as typed in text', () => {
    const m = renderEmail('hassan-new-booking', { ...allVars, name: '<b>Bob</b>' }, SITE);
    expect(inPage(m.html)).toContain('&lt;b&gt;Bob&lt;/b&gt;'); expect(m.html).not.toContain('<b>Bob</b>'); expect(m.text).toContain('<b>Bob</b>');
    expect(m.subject).toContain('<b>Bob</b>'); // a subject is plain text
    expect(m.html).toMatch(/<title>[^<]*&lt;b&gt;Bob&lt;\/b&gt;/); // and its copy in the page title is escaped like any other value
  });

  it('keeps an ampersand, quotes and a placeholder-like value as typed', () => {
    const m = renderEmail('hassan-new-booking', { ...allVars, name: 'A&B "C" {phone}', volume: "it's" }, SITE);
    expect(m.text).toContain('A&B "C" {phone}'); // a value is never read as a placeholder
    expect(inPage(m.html)).toContain('A&amp;B &quot;C&quot; {phone}');
    expect(inPage(m.html)).toContain('it&#39;s');
  });

  it('takes line breaks out of every value in the subject', () => {
    const m = renderEmail('hassan-new-booking', { ...allVars, name: 'Bob\r\nBcc: spy@example.test\nX: y' }, SITE);
    expect(m.subject).not.toMatch(/[\r\n]/);
    expect(m.subject).toContain('Bob Bcc: spy@example.test X: y');
    expect(m.subject).toBe(m.subject.trim());
  });

  it('a placeholder without a value is a content error naming the email file', () => {
    const { phone: _phone, ...withoutPhone } = allVars;
    expect(() => renderEmail('hassan-new-booking', withoutPhone, SITE)).toThrow(ContentError);
    expect(() => renderEmail('hassan-new-booking', withoutPhone, SITE)).toThrow(/emails\/hassan-new-booking\.yaml: \{phone\} has no value in this email \(field body\)/);
    // An empty value counts as no value.
    expect(() => renderEmail('hassan-new-booking', { ...allVars, phone: '' }, SITE)).toThrow(/hassan-new-booking\.yaml: \{phone\} has no value/);
  });

  it('a subject placeholder without a value is named with the subject field', () => {
    process.env.CONTENT_DIR = tempContent({ 'emails/reminder-1h.yaml': (s) => s.replace(/^subject: .*$/m, 'subject: "In 1 hour: {previousWhen}"') });
    const { previousWhen: _previous, ...vars } = allVars;
    expect(() => renderEmail('reminder-1h', vars, SITE)).toThrow(/emails\/reminder-1h\.yaml: \{previousWhen\} has no value in this email \(field subject\)/);
  });

  it('turns blank lines into paragraphs and single line breaks into <br>', () => {
    process.env.CONTENT_DIR = tempContent({ 'emails/reminder-1h.yaml': () => 'subject: "Hi {name}"\nbody: |\n  One {name}\n  two\n\n\n\n  Three\n' });
    const m = renderEmail('reminder-1h', allVars, SITE);
    expect(m.text).toBe('One Zoë O’Brien\ntwo\n\nThree');
    expect(m.html.match(/<p /g)).toHaveLength(2);
    expect(m.html).toContain('One Zoë O’Brien<br>two</p>');
    expect(m.html).not.toMatch(/<p [^>]*><br>/);
  });

  it('wraps the words in the brand layout: logo, off-white page, one blue button, system fonts', () => {
    const m = renderEmail('booking-confirmed', allVars, `${SITE}/`);
    expect(m.html).toMatch(/^<!doctype html>/i);
    expect(m.html).toContain('<img src="https://hivegen.co/brand/logo.png"'); // one slash between the site address and the path
    expect(m.html).toContain('alt="HiveGen"');
    expect(m.html).toMatch(/background:#FFF9EB/i);
    expect(m.html.match(/background:#1C45F5/gi)).toHaveLength(1);
    expect(m.html).toMatch(/font-family:[^;"]*(-apple-system|Segoe UI|Helvetica|Arial)/);
    expect(m.html).not.toMatch(/fonts\.googleapis|@import|@font-face|<script/);
  });

  it('puts the Meet link in the button, and the same link in plain text', () => {
    const m = renderEmail('booking-confirmed', allVars, SITE);
    expect(m.html).toMatch(new RegExp(`<a href="${MEET}"[^>]*>Join the call</a>`));
    expect(m.text).toContain(`Join the call: ${MEET}`);
  });

  it('leaves the button out when there is no Meet link, and still reads well', () => {
    const m = renderEmail('booking-confirmed', allVarsWithoutMeet, SITE);
    expect(m.html).not.toContain('Join the call');
    expect(m.html).not.toMatch(/background:#1C45F5/i);
    expect(m.text).not.toContain('Join the call');
    expect(m.text).toContain('calendar invite');
    expect(m.text).not.toMatch(/[{}]|undefined/);
  });

  it('escapes a link in the button and makes the links in the words clickable', () => {
    const meetUrl = 'https://meet.google.com/a?b=1&c="x"';
    const m = renderEmail('booking-confirmed', { ...allVars, meetUrl }, SITE);
    expect(m.html).toContain('href="https://meet.google.com/a?b=1&amp;c=&quot;x&quot;"');
    expect(m.html).not.toContain('c="x"');
    expect(m.html).toContain(`<a href="${SITE}/booking/tok-123"`); // the manage link in a sentence
    expect(m.text).toContain(`${SITE}/booking/tok-123`);
  });

  it('does not turn a name that looks like a link into one', () => {
    const m = renderEmail('hassan-new-booking', { ...allVars, name: 'https://evil.example/x' }, SITE);
    expect(m.html).not.toContain('href="https://evil.example/x"');
    expect(m.html).toContain('https://evil.example/x');
  });

  it('a button that goes to the manage page needs a manage link', () => {
    const { manageUrl: _manage, ...vars } = allVars;
    expect(() => renderEmail('booking-requested', vars, SITE)).toThrow(/emails\/booking-requested\.yaml: .*\{manageUrl\}.* \(field button\.link\)/);
  });

  it('every email renders, with and without a Meet link, and nothing is left in braces', () => {
    for (const kind of KINDS) {
      for (const vars of [allVars, allVarsWithoutMeet]) {
        const m = renderEmail(kind, vars, SITE);
        for (const part of [m.subject, m.html, m.text]) expect(part, kind).not.toMatch(/[{}]|undefined/);
      }
    }
  });
});

describe('createNotifier', () => {
  it("the visitor's confirmation shows the visitor's local time, the Meet link and the manage link, and no ad data", async () => {
    const m = await sendOne('booking-confirmed');
    expect(m).toMatchObject({ to: 'zoe+ads@example.com', replyTo: 'connect@hivegen.co', tag: 'booking-confirmed' });
    expect(m.subject).toContain(NEW_YORK_TIME);
    for (const body of [m.text, m.html]) {
      expect(body).toContain(NEW_YORK_TIME);
      expect(body).toContain('America/New York');
      expect(body).toContain(MEET);
      expect(body).toContain(`${SITE}/booking/tok-123`);
      expect(body).not.toContain(PAKISTAN_TIME);
      expect(body).not.toMatch(/facebook|agents-q1|fbclid|555|6–15|drive\.google\.com|utm_/i);
      expect(body).not.toContain(HASSAN);
    }
    expect(m.text).toContain('Zoë O’Brien');
  });

  it("Hassan's booking email shows Pakistan time, phone, volume, footage link and ad source", async () => {
    const m = await sendOne('hassan-new-booking');
    expect(m).toMatchObject({ to: HASSAN, replyTo: 'connect@hivegen.co', tag: 'hassan-new-booking' });
    expect(m.subject).toContain('Zoë O’Brien');
    expect(m.subject).toContain(PAKISTAN_TIME);
    for (const body of [m.text, m.html]) {
      expect(body).toContain(PAKISTAN_TIME);
      expect(body).toContain(NEW_YORK_TIME); // the visitor's own time too, so he can say it back to them
      expect(body).toContain('+1 (555) 010-2000');
      expect(body).toContain('6–15');
      expect(body).toContain('https://drive.google.com/drive/folders/x1');
      expect(body).toContain('facebook / agents-q1');
      expect(body).toContain('zoe+ads@example.com');
    }
    expect(m.text).toMatch(/Page: agents/);
    expect(m.html).toContain('<a href="https://drive.google.com/drive/folders/x1"');
    expect(m.text).not.toContain('/booking/tok-123'); // the visitor's private link is not Hassan's
  });

  it('shows a dash for details the visitor left out, and "direct" without ad tags', async () => {
    const bare: Lead = { ...lead, phone: undefined, footageUrl: undefined, attribution: {} };
    const mailer = recorder();
    await notifierWith(mailer).send('hassan-new-booking', { lead: bare, booking });
    expect(mailer.sent[0].text).toMatch(/Phone: —/);
    expect(mailer.sent[0].text).toMatch(/Footage link: —/);
    expect(mailer.sent[0].text).toMatch(/Came from: direct/);
    expect(mailer.sent[0].html).toMatch(/Phone:[^—]*—/);
  });

  it('names the ad source from the tags, or from a click id when there are no tags', async () => {
    const sourceOf = async (attribution: Lead['attribution']) => {
      const mailer = recorder();
      await notifierWith(mailer).send('hassan-new-lead', { lead: { ...lead, attribution } });
      return mailer.sent[0].text.match(/Came from: (.*)/)?.[1];
    };
    expect(await sourceOf({ utm_source: 'facebook', utm_campaign: 'agents-q1', fbclid: 'x' })).toBe('facebook / agents-q1');
    expect(await sourceOf({ utm_source: 'google', utm_medium: 'cpc', gclid: 'x' })).toBe('google');
    expect(await sourceOf({ fbclid: 'x' })).toBe('facebook ad');
    expect(await sourceOf({ gclid: 'x' })).toBe('google ad');
    expect(await sourceOf({ fbclid: 'x', gclid: 'y' })).toBe('facebook ad');
    expect(await sourceOf({})).toBe('direct');
  });

  it('a new lead without a booking has no times', async () => {
    const m = await sendOne('hassan-new-lead');
    expect(m).toMatchObject({ to: HASSAN, tag: 'hassan-new-lead' });
    expect(m.text).toContain('Zoë O’Brien');
    expect(m.text).toContain('+1 (555) 010-2000');
    expect(m.text).not.toMatch(/GMT|EST/);
  });

  it("visitor emails go to the lead, Hassan's go to Hassan, and each is tagged with its kind", async () => {
    for (const kind of KINDS) {
      const m = await sendOne(kind);
      expect(m.to, kind).toBe(kind.startsWith('hassan-') ? HASSAN : 'zoe+ads@example.com');
      expect(m.tag, kind).toBe(kind);
      expect(m.replyTo, kind).toBe('connect@hivegen.co');
      if (!kind.startsWith('hassan-')) expect(`${m.subject}${m.html}${m.text}`, kind).not.toContain(HASSAN);
    }
  });

  it('Reply-To comes from the content file', async () => {
    process.env.CONTENT_DIR = tempContent({ 'site.yaml': (s) => s.replace('replyTo: connect@hivegen.co', 'replyTo: help@example.test') });
    expect((await sendOne('reminder-1h')).replyTo).toBe('help@example.test');
    expect((await sendOne('hassan-new-lead')).replyTo).toBe('help@example.test');
  });

  it('every kind of email goes out without a Meet link, and the button is the only place that needs it', async () => {
    for (const kind of KINDS) {
      const requested = kind === 'booking-requested' || kind === 'hassan-confirm-by-hand';
      const m = await sendOne(kind, {}, { ...bookingWithoutMeet, status: requested ? 'requested' : 'booked' });
      for (const part of [m.subject, m.html, m.text]) expect(part, kind).not.toMatch(/[{}]|undefined|meet\.google/);
    }
    expect((await sendOne('booking-confirmed')).html).toContain(`href="${MEET}"`);
    expect((await sendOne('booking-confirmed', {}, bookingWithoutMeet)).html).not.toContain('Join the call');
    expect((await sendOne('reminder-1h', {}, bookingWithoutMeet)).text).toContain('calendar invite');
  });

  it('a requested booking promises a confirmation, not a Meet link', async () => {
    const m = await sendOne('booking-requested', {}, { ...bookingWithoutMeet, status: 'requested' });
    expect(m.text).toContain(NEW_YORK_TIME);
    expect(m.text).toContain(`${SITE}/booking/tok-123`);
    expect(m.text).not.toContain('Join the call');
    const h = await sendOne('hassan-confirm-by-hand', {}, { ...bookingWithoutMeet, status: 'requested' });
    expect(h.to).toBe(HASSAN);
    expect(h.text).toContain('zoe+ads@example.com');
    expect(h.text).toContain(PAKISTAN_TIME);
  });

  it("a reminder shows the call in the visitor's zone and the way to move it", async () => {
    const day = await sendOne('reminder-24h');
    expect(day.subject).toContain(NEW_YORK_TIME);
    expect(day.text).toContain(`${SITE}/booking/tok-123`);
    expect(day.text).toContain(MEET);
    const hour = await sendOne('reminder-1h');
    expect(hour.text).toContain(NEW_YORK_TIME);
    expect(hour.text).toContain(MEET);
  });

  it('a rescheduled call shows the new and the old time in the same zone', async () => {
    const m = await sendOne('booking-rescheduled');
    expect(m.text).toContain(NEW_YORK_TIME);
    expect(m.text).toContain('Tuesday, December 1, 10:00 AM EST');
    expect(m.text).not.toContain('GMT+5');
    expect(m.text).toContain(MEET);
  });

  it('a cancelled call says which time was cancelled', async () => {
    const m = await sendOne('booking-cancelled', { change: 'cancelled' }, { ...booking, status: 'cancelled' });
    expect(m.text).toContain(NEW_YORK_TIME);
    expect(m.text).toContain('Zoë O’Brien');
    expect(m.html).not.toContain('Join the call');
  });

  it('Hassan hears what changed: cancelled or rescheduled', async () => {
    const cancelled = await sendOne('hassan-booking-changed', { change: 'cancelled', previousStart: undefined }, { ...booking, status: 'cancelled' });
    expect(cancelled.to).toBe(HASSAN);
    expect(cancelled.subject).toMatch(/cancelled/i);
    expect(cancelled.subject).toContain('Zoë O’Brien');
    expect(cancelled.text).toContain(PAKISTAN_TIME);
    const moved = await sendOne('hassan-booking-changed');
    expect(moved.subject).toMatch(/rescheduled/i);
    expect(moved.subject).not.toMatch(/cancelled/i);
    expect(moved.text).toContain(PAKISTAN_TIME);
  });

  it('a cancelled request never tells Hassan his calendar is up to date: it had no event, and one he added by hand stays', async () => {
    // A requested booking has no Google event (no googleEventId, no Meet link), yet its cancellation still sends this email.
    const { googleEventId: _event, ...requestedWithoutEvent } = bookingWithoutMeet;
    const m = await sendOne('hassan-booking-changed', { change: 'cancelled', previousStart: undefined }, { ...requestedWithoutEvent, status: 'cancelled' });
    expect(m.to).toBe(HASSAN);
    expect(m.subject).toMatch(/cancelled/i);
    expect(m.text).toContain(PAKISTAN_TIME);
    // Only the false claim is pinned, so any other wording the owner writes still passes.
    const claim = /(up[- ]to[- ]date|already (updated|removed|moved|current)|calendar (is|has been) (current|updated))/i;
    expect(m.text).not.toMatch(claim);
    expect(m.html).not.toMatch(claim);
    const { body } = loadEmail('hassan-booking-changed');
    expect(body).not.toMatch(claim);
  });

  it("shows each time in its own zone: the visitor's in theirs, Hassan's in his", async () => {
    const m = await sendOne('hassan-new-booking', {}, { ...booking, visitorTz: 'Europe/London' });
    expect(m.text).toContain('Wednesday, December 2, 2:00 PM GMT');
    expect(m.text).toContain(PAKISTAN_TIME);
    expect(m.text).toContain('Europe/London');
  });

  it('an email that cannot be made fails loudly and sends nothing', async () => {
    const mailer = recorder();
    const n = notifierWith(mailer);
    await expect(n.send('booking-confirmed', { lead })).rejects.toThrow(/booking-confirmed/); // a visitor email needs its booking
    await expect(n.send('hassan-booking-changed', { lead, booking })).rejects.toThrow(/hassan-booking-changed/); // and a changed one needs to say what changed
    expect(mailer.sent).toEqual([]);
  });

  it('a mailer failure reaches the caller, so the booking keeps the email as unsent', async () => {
    const failing: Mailer = { send: async () => { throw new Error('smtp down'); } };
    await expect(notifierWith(failing).send('reminder-1h', dataFor('reminder-1h'))).rejects.toThrow('smtp down');
  });

  it('the manage link in the email is the link the booking service gives the visitor', async () => {
    const mailer = recorder();
    const t = setup({ notifier: notifierWith(mailer), siteUrl: 'https://hivegen.co/' }); // a trailing slash does not double up
    const created = await t.svc.createLead({ name: 'Bob', email: 'bob@example.test', buyerType: 'agent', volume: '6–15', pageVersion: 'agents', turnstileToken: 'ok' }, {});
    if (!created.ok) throw new Error(created.error);
    const { slots } = await t.svc.getSlots();
    const r = await t.svc.book({ leadId: created.value.leadId, start: slots[0].start, visitorTz: 'America/New_York' }, {});
    if (!r.ok) throw new Error(r.error);
    expect(r.value.manageUrl).toMatch(/^https:\/\/hivegen\.co\/booking\/[A-Za-z0-9_-]{43}$/);
    expect(mailer.sent.map((m) => [m.tag, m.to])).toEqual([['booking-confirmed', 'bob@example.test'], ['hassan-new-booking', HASSAN]]);
    expect(mailer.sent[0].text).toContain(r.value.manageUrl);
    expect(mailer.sent[0].text).toContain(r.value.meetUrl as string);
    expect(mailer.sent[1].text).not.toContain(r.value.manageUrl);
  });

  it('manageUrl joins the site address, /booking/ and the token with one slash each', () => {
    expect(manageUrl('https://hivegen.co', 't')).toBe('https://hivegen.co/booking/t');
    expect(manageUrl('https://hivegen.co/', 't')).toBe('https://hivegen.co/booking/t');
    expect(manageUrl('http://localhost:4321', 't')).toBe('http://localhost:4321/booking/t');
  });
});

describe('the outbox mailer', () => {
  const message = { to: 'a@example.test', subject: 'Hello', html: '<p>Hello &amp; welcome</p>', text: 'Hello & welcome', replyTo: 'r@example.test', tag: 'booking-confirmed' };

  it('writes an .html and a .txt file per email, creating its folder', async () => {
    const dir = path.join(tempDir(), 'not', 'yet', 'there');
    const outbox = createOutboxMailer(dir);
    await outbox.send(message);
    await outbox.send({ to: 'b@example.test', subject: 'Second', html: '<p>Two</p>', text: 'Two' });

    const files = fs.readdirSync(dir).sort();
    expect(files).toHaveLength(4);
    const named = files.filter((f) => /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z-booking-confirmed\.(html|txt)$/.test(f));
    expect(named).toHaveLength(2);
    expect(files.filter((f) => /Z-email\.(html|txt)$/.test(f))).toHaveLength(2); // no tag: "email"
    const html = named.find((f) => f.endsWith('.html')) as string;
    const txt = named.find((f) => f.endsWith('.txt')) as string;
    expect(fs.readFileSync(path.join(dir, html), 'utf8')).toBe(message.html);
    expect(fs.readFileSync(path.join(dir, txt), 'utf8')).toBe(message.text);
    expect(outbox.sent).toEqual([
      { to: 'a@example.test', subject: 'Hello', text: 'Hello & welcome', tag: 'booking-confirmed' },
      { to: 'b@example.test', subject: 'Second', text: 'Two' },
    ]);
  });

  it('keeps two emails of one kind sent in the same moment', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-12-01T10:00:00.123Z'));
    const dir = tempDir();
    const outbox = createOutboxMailer(dir);
    await outbox.send({ ...message, text: 'first' });
    await outbox.send({ ...message, text: 'second' });
    expect(fs.readdirSync(dir)).toHaveLength(4);
    expect(fs.readdirSync(dir)).toContain('2026-12-01T10-00-00.123Z-booking-confirmed.html');
    const texts = fs.readdirSync(dir).filter((f) => f.endsWith('.txt')).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).sort();
    expect(texts).toEqual(['first', 'second']);
  });

  it('writes again after its folder was deleted, and never lets a tag name a path', async () => {
    const dir = path.join(tempDir(), 'outbox');
    const outbox = createOutboxMailer(dir);
    await outbox.send(message);
    fs.rmSync(dir, { recursive: true });
    await expect(outbox.send({ ...message, tag: '../../escape' })).resolves.toBeUndefined();
    expect(fs.readdirSync(dir)).toHaveLength(2);
    expect(fs.readdirSync(dir).every((f) => /^[\w.-]+$/.test(f))).toBe(true);
    expect(fs.readdirSync(path.dirname(dir))).toEqual(['outbox']);
  });

  it('its record can be emptied, as the test server does between runs', async () => {
    const outbox = createOutboxMailer(tempDir());
    await outbox.send(message);
    outbox.sent.length = 0;
    expect(outbox.sent).toEqual([]);
  });

  it('writes to .outbox by default, a folder git ignores', async () => {
    expect(fs.readFileSync('.gitignore', 'utf8')).toMatch(/^\.outbox\/$/m);
    const before = fs.existsSync('.outbox') ? fs.readdirSync('.outbox') : null;
    await createOutboxMailer().send({ ...message, tag: 'default-folder-check' });
    const made = fs.readdirSync('.outbox').filter((f) => f.includes('default-folder-check') && !before?.includes(f));
    expect(made).toHaveLength(2);
    for (const f of made) fs.rmSync(path.join('.outbox', f)); // only what this test wrote
    if (before === null && fs.readdirSync('.outbox').length === 0) fs.rmdirSync('.outbox');
  });
});

describe('the SMTP mailer', () => {
  const smtp = { host: 'smtp.example.test', port: 587, user: 'mailer', pass: 'secret-pass', from: 'HiveGen <connect@hivegen.co>' };

  it('uses TLS from the start on port 465 only, and gives up on a stuck server', () => {
    expect(smtpTransportOptions({ ...smtp, port: 465 })).toMatchObject({ host: smtp.host, port: 465, secure: true, auth: { user: 'mailer', pass: 'secret-pass' } });
    expect(smtpTransportOptions(smtp)).toMatchObject({ port: 587, secure: false });
    const o = smtpTransportOptions(smtp);
    for (const t of [o.connectionTimeout, o.greetingTimeout, o.socketTimeout]) expect(t).toBeGreaterThan(0);
    for (const t of [o.connectionTimeout, o.greetingTimeout, o.socketTimeout]) expect(t).toBeLessThanOrEqual(30_000);
  });

  it('hands the message to the transport with From, Reply-To and the kind header', async () => {
    const sendMail = vi.fn(async (_: unknown) => ({}));
    await createSmtpMailer(smtp, { sendMail }).send({ to: 'zoe@example.test', subject: 'Hi', html: '<p>Hi</p>', text: 'Hi', replyTo: 'connect@hivegen.co', tag: 'reminder-1h' });
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledWith({
      from: smtp.from, to: 'zoe@example.test', subject: 'Hi', html: '<p>Hi</p>', text: 'Hi', replyTo: 'connect@hivegen.co', headers: { 'X-HiveGen-Kind': 'reminder-1h' },
    });
  });

  it('sends no kind header without a tag, and no Reply-To without one', async () => {
    const sendMail = vi.fn(async (_: unknown) => ({}));
    await createSmtpMailer(smtp, { sendMail }).send({ to: 'zoe@example.test', subject: 'Hi', html: '<p>Hi</p>', text: 'Hi' });
    const sent = sendMail.mock.calls[0][0] as Record<string, unknown>;
    expect(sent).not.toHaveProperty('headers');
    expect(sent).not.toHaveProperty('replyTo');
  });

  it('builds a real two-part message with its headers (nothing is sent)', async () => {
    const transport = createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
    let raw = '';
    const mailer = createSmtpMailer(smtp, { sendMail: async (message) => {
      const info = await transport.sendMail(message);
      raw = String(info.message);
      return info;
    } });
    await mailer.send({ to: 'zoe@example.test', ...renderEmail('booking-confirmed', allVars, SITE), replyTo: 'connect@hivegen.co', tag: 'booking-confirmed' });
    expect(raw).toMatch(/^From: HiveGen <connect@hivegen\.co>$/m);
    expect(raw).toMatch(/^To: zoe@example\.test$/m);
    expect(raw).toMatch(/^Reply-To: connect@hivegen\.co$/m);
    expect(raw).toMatch(/^X-HiveGen-Kind: booking-confirmed$/im); // nodemailer writes the name as X-Hivegen-Kind; header names ignore case
    expect(raw).toMatch(/^Subject: /m);
    expect(raw).toMatch(/Content-Type: multipart\/alternative/);
    expect(raw).toMatch(/Content-Type: text\/plain/);
    expect(raw).toMatch(/Content-Type: text\/html/);
  });
});
