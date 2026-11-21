import { loadSection, loadSite } from '../../../src/lib/content/load';
import { createBookingService, type ServiceDeps } from '../../../src/server/booking/service';
import type { EmailData, EmailKind, ServerEvent } from '../../../src/server/booking/types';
import { createFakeCalendar } from '../../../src/server/calendar/fake';
import { createMemoryStore } from '../../../src/server/store/memory';

/** The booking tests' shared set-up: a service on a memory store and a fake calendar, with everything it sends recorded. */

export const NOW = new Date('2026-12-01T10:00:00Z'); // Tuesday 15:00 in Pakistan
export const booking = loadSection('booking');
export const rules = loadSite().booking;

/** A valid lead form. */
export const good = { name: 'Zoë O’Brien', email: 'zoe+ads@example.com', phone: '+1 (555) 010-2000', buyerType: 'agent', volume: '6–15',
  footageUrl: 'https://drive.google.com/x', pageVersion: 'agents', attribution: { utm_source: 'facebook', fbclid: 'abc' }, turnstileToken: 'ok', website: '' };

/** `overrides` replace any of the service's dependencies (for example `siteUrl`, or a `notifier` that fails). */
export function setup(overrides: Partial<ServiceDeps> = {}) {
  const store = createMemoryStore();
  const calendar = createFakeCalendar();
  /** The kinds of email sent, in order. */
  const sent: EmailKind[] = [];
  /** The same emails with the data each was sent with. */
  const mails: Array<{ kind: EmailKind; data: EmailData }> = [];
  const tracked: ServerEvent[] = [];
  const botChecks: Array<{ token: string; ip?: string }> = [];
  let current = NOW;
  const clock = { now: () => current, set: (at: Date) => { current = at; } };
  const deps: ServiceDeps = {
    store, calendar, clock, rules, siteUrl: 'https://hivegen.co',
    calendarCopy: booking.calendarEvent, volumeOptions: booking.volumeOptions, needOptions: [],
    notifier: { send: async (kind, data) => { sent.push(kind); mails.push({ kind, data }); } },
    tracker: { send: async (e) => { tracked.push(e); } },
    verifyBot: async (token, ip) => { botChecks.push({ token, ip }); return token === 'ok'; },
    ...overrides,
  };
  const svc = createBookingService(deps);
  return { svc, deps, store, calendar, sent, mails, tracked, botChecks, clock };
}

/** Saves a lead through the service and gives back its public id. */
export async function addLead(svc: ReturnType<typeof setup>['svc'], over: Record<string, unknown> = {}): Promise<string> {
  const r = await svc.createLead({ ...good, ...over }, {});
  if (!r.ok) throw new Error(`lead not saved: ${r.error}`);
  return r.value.leadId;
}

/** A service with one saved lead and the slots on offer (`slot` is the first). Nothing has been sent yet. */
export async function withLead(overrides: Partial<ServiceDeps> = {}) {
  const t = setup(overrides);
  const leadId = await addLead(t.svc);
  const { slots } = await t.svc.getSlots();
  return { ...t, leadId, slots, slot: slots[0] };
}
