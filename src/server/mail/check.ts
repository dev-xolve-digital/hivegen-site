import type { Booking, EmailData, EmailKind, Lead } from '../booking/types';
import { createNotifier } from './notifier';

const lead: Lead = {
  id: 1, publicId: 'check-lead-0000000000', name: 'Alex Sample', email: 'alex@example.test', phone: '+1 555 010 2000', buyerType: 'agent', volume: '6–15',
  footageUrl: 'https://example.test/footage', pageVersion: 'agents', attribution: { utm_source: 'facebook', utm_campaign: 'spring' },
  createdAt: new Date('2030-01-01T10:00:00Z'), status: 'booked',
};
const booking: Booking = {
  id: 1, leadId: 1, start: '2030-01-02T14:00:00.000Z', end: '2030-01-02T14:15:00.000Z', visitorTz: 'America/New_York', status: 'booked',
  manageToken: 'check-token', googleEventId: 'ev-1', meetUrl: 'https://meet.google.com/abc-defg-hij',
  createdAt: new Date('2030-01-01T10:05:00Z'), updatedAt: new Date('2030-01-01T10:05:00Z'),
};
const { meetUrl: _meet, ...bookingWithoutMeet } = booking;
const requested: Booking = { ...bookingWithoutMeet, status: 'requested', googleEventId: undefined };
const PREVIOUS_START = '2030-01-01T15:00:00.000Z';
/** A "Send details" inquiry with everything the form can hold, and one that is only an email address. */
const inquiry: Lead = {
  ...lead, id: 2, publicId: 'check-inquiry-000000000', status: 'inquiry', needs: ['Listing videos', 'Reels for social'], message: 'Hello,\nPlease tell me more.',
};
const emailOnlyInquiry: Lead = {
  id: 3, publicId: 'check-inquiry-000000001', email: 'sam@example.test', pageVersion: 'main', attribution: {},
  createdAt: new Date('2030-01-01T10:00:00Z'), status: 'inquiry',
};

/**
 * Every email the service sends, with the data it really sends it with, in the cases that differ:
 * Google's Meet link comes late or never, so those emails are tried both ways. The inquiry emails are tried with a full
 * inquiry and with one that is only an email address, so every detail the visitor left out shows as a dash.
 */
const CASES: Array<[EmailKind, EmailData]> = [
  ['booking-confirmed', { lead, booking }],
  ['booking-confirmed', { lead, booking: bookingWithoutMeet }],
  ['booking-requested', { lead, booking: requested }],
  ['reminder-24h', { lead, booking }],
  ['reminder-24h', { lead, booking: bookingWithoutMeet }],
  ['reminder-1h', { lead, booking }],
  ['reminder-1h', { lead, booking: bookingWithoutMeet }],
  ['booking-cancelled', { lead, booking: { ...booking, status: 'cancelled' }, change: 'cancelled' }],
  ['booking-cancelled', { lead, booking: { ...requested, status: 'cancelled' }, change: 'cancelled' }],
  ['booking-rescheduled', { lead, booking, previousStart: PREVIOUS_START }],
  ['booking-rescheduled', { lead, booking: bookingWithoutMeet, previousStart: PREVIOUS_START }],
  ['hassan-new-booking', { lead, booking }],
  ['hassan-new-booking', { lead, booking: bookingWithoutMeet }],
  ['hassan-confirm-by-hand', { lead, booking: requested }],
  ['hassan-new-lead', { lead }],
  ['hassan-booking-changed', { lead, booking: { ...booking, status: 'cancelled' }, change: 'cancelled' }],
  ['hassan-booking-changed', { lead, booking: { ...requested, status: 'cancelled' }, change: 'cancelled' }],
  ['hassan-booking-changed', { lead, booking, previousStart: PREVIOUS_START, change: 'rescheduled' }],
  ['hassan-new-inquiry', { lead: inquiry }],
  ['hassan-new-inquiry', { lead: emailOnlyInquiry }],
  ['inquiry-received', { lead: inquiry }],
  ['inquiry-received', { lead: emailOnlyInquiry }],
];

/**
 * Renders every email file with representative values, through the notifier and an in-memory mailer, so wording that cannot be
 * filled in (a {placeholder} the email has no value for, a missing file or field) stops the build instead of failing on the day
 * a visitor books. The error is a ContentError that names the file.
 */
export async function assertEmailTemplatesRender(): Promise<void> {
  const notifier = createNotifier({ mailer: { send: async () => {} }, hassanEmail: 'hassan@example.test', siteUrl: 'https://example.test', hassanTz: 'Asia/Karachi' });
  for (const [kind, data] of CASES) await notifier.send(kind, data);
}
