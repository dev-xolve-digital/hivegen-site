import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { TurnstileAction } from '../../src/lib/booking/api-client';
import type { EmailData, EmailKind, ServerEvent } from '../../src/server/booking/types';
import { NOW, addLead, setup } from './helpers/booking';

const NEEDS = ['Editing', 'Virtual staging', 'Voiceover'];
const valid = { email: 'v@example.com', pageVersion: 'main', turnstileToken: 'ok', requestId: 'req-00000001', website: '' };
const PUBLIC_ID = /^[A-Za-z0-9_-]{22}$/;

let warn: MockInstance;
beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });

/** A service whose bot check is a spy that passes the token "ok" (and records the action it was asked for). */
function inquirySetup(overrides: Parameters<typeof setup>[0] = {}) {
  const verifyBot = vi.fn(async (token: string, _ip: string | undefined, _action: TurnstileAction) => token === 'ok');
  const t = setup({ needOptions: NEEDS, verifyBot, ...overrides });
  /** Every lead in the store. */
  const leads = () => t.store.leadsCreatedBetween('2000-01-01T00:00:00Z', '2100-01-01T00:00:00Z');
  const byRequest = async (requestId = valid.requestId) => (await t.store.getLeadByRequestId(requestId))!;
  return { ...t, verifyBot, leads, byRequest };
}

describe('sendInquiry', () => {
  it('stores an inquiry and emails Hassan and the visitor', async () => {
    const t = inquirySetup();
    const raw = { ...valid, name: 'Vic', phone: '+1 555 010 2000', needs: ['Editing', 'Voiceover'], message: 'Two listings a week.\nCan you do both?', fbp: 'fb.1.111.222', attribution: { utm_source: 'facebook' } };
    const r = await t.svc.sendInquiry(raw, { ip: '203.0.113.9', userAgent: 'UA', sourceUrl: 'https://hivegen.co/agents' });

    const lead = await t.byRequest();
    expect(r).toEqual({ ok: true, value: { status: 'received', eventId: `lead.${lead.publicId}` } });
    expect(lead.publicId).toMatch(PUBLIC_ID);
    expect(lead).toMatchObject({
      status: 'inquiry', email: 'v@example.com', name: 'Vic', phone: '+1 555 010 2000', needs: ['Editing', 'Voiceover'],
      message: 'Two listings a week.\nCan you do both?', requestId: 'req-00000001', pageVersion: 'main', clientIp: '203.0.113.9', userAgent: 'UA',
      attribution: { utm_source: 'facebook' },
    });
    expect(await t.leads()).toHaveLength(1);

    expect(t.sent).toEqual(['hassan-new-inquiry', 'inquiry-received']);
    for (const m of t.mails) {
      expect(m.data.lead).toMatchObject({ publicId: lead.publicId, email: 'v@example.com', status: 'inquiry' });
      expect(m.data.booking).toBeUndefined();
    }
    expect(lead.hassanNotifiedAt).toEqual(NOW);
    expect(lead.visitorNotifiedAt).toEqual(NOW);

    expect(t.tracked).toEqual([{
      name: 'Lead', eventId: `lead.${lead.publicId}`, time: NOW, sourceUrl: 'https://hivegen.co/agents', leadId: lead.id,
      user: { email: 'v@example.com', phone: '+1 555 010 2000', externalId: lead.publicId, ip: '203.0.113.9', userAgent: 'UA', fbp: 'fb.1.111.222', fbc: undefined },
    }]);
  });

  it('builds fbc from fbclid, as the call flow does', async () => {
    const t = inquirySetup();
    await t.svc.sendInquiry({ ...valid, attribution: { fbclid: 'abc' } }, {});
    const fbc = `fb.1.${NOW.getTime()}.abc`;
    expect((await t.byRequest()).fbc).toBe(fbc);
    expect(t.tracked[0].user.fbc).toBe(fbc);
  });

  it('the bot check is asked with the inquiry action', async () => {
    const t = inquirySetup();
    await t.svc.sendInquiry(valid, { ip: '203.0.113.9' });
    expect(t.verifyBot).toHaveBeenCalledTimes(1);
    expect(t.verifyBot).toHaveBeenCalledWith('ok', '203.0.113.9', 'inquiry');

    const refused = await t.svc.sendInquiry({ ...valid, turnstileToken: 'fail', requestId: 'req-00000002' }, { ip: '203.0.113.9' });
    expect(refused).toEqual({ ok: false, error: 'bot_check_failed' });
    expect(await t.store.getLeadByRequestId('req-00000002')).toBeNull();
    expect(await t.leads()).toHaveLength(1); // only the first
    expect(t.sent).toEqual(['hassan-new-inquiry', 'inquiry-received']); // nothing for the refused one
    expect(t.tracked).toHaveLength(1);
  });

  it('the call flow keeps asking with the booking action', async () => {
    const t = inquirySetup();
    await addLead(t.svc, { turnstileToken: 'ok' });
    expect(t.verifyBot).toHaveBeenCalledWith('ok', undefined, 'booking');
  });

  it('a filled honeypot says received and keeps nothing', async () => {
    const t = inquirySetup();
    const r = await t.svc.sendInquiry({ ...valid, website: 'http://spam.example' }, { ip: '203.0.113.9' });
    if (!r.ok) throw new Error(r.error);
    expect(r.value.status).toBe('received');
    expect(r.value.eventId).toMatch(/^lead\.[A-Za-z0-9_-]{22}$/);
    expect(await t.leads()).toEqual([]);
    expect(await t.store.getLeadByRequestId(valid.requestId)).toBeNull();
    expect(t.verifyBot).not.toHaveBeenCalled();
    expect(t.sent).toEqual([]);
    expect(t.tracked).toEqual([]);
  });

  it('invalid input names the fields', async () => {
    const t = inquirySetup();
    expect(await t.svc.sendInquiry({ ...valid, email: 'nope', pageVersion: 'elsewhere', requestId: 'short', needs: ['Plumbing'] }, {}))
      .toEqual({ ok: false, error: 'invalid', fields: { email: 'invalid', pageVersion: 'invalid', requestId: 'invalid', needs: 'invalid' } });
    expect(await t.svc.sendInquiry({}, {})).toEqual({ ok: false, error: 'invalid', fields: { email: 'required', pageVersion: 'required', turnstileToken: 'required', requestId: 'required' } });
    expect(t.verifyBot).not.toHaveBeenCalled(); // only valid input is checked for a bot
    expect(await t.leads()).toEqual([]);
    expect(t.sent).toEqual([]);
  });

  it('the same requestId again answers the same event id and sends nothing new', async () => {
    const t = inquirySetup();
    const first = await t.svc.sendInquiry(valid, {});
    // The repeat is answered before the bot check: this one would fail it.
    const again = await t.svc.sendInquiry({ ...valid, turnstileToken: 'fail' }, {});
    expect(again).toEqual(first);
    expect(first).toMatchObject({ ok: true, value: { status: 'received', eventId: `lead.${(await t.byRequest()).publicId}` } });
    expect(await t.leads()).toHaveLength(1);
    expect(t.sent).toEqual(['hassan-new-inquiry', 'inquiry-received']);
    expect(t.tracked).toHaveLength(1);
    expect(t.verifyBot).toHaveBeenCalledTimes(1);
  });

  it('two simultaneous sends with one requestId store one inquiry', async () => {
    const t = inquirySetup();
    const createLead = vi.spyOn(t.store, 'createLead');
    const [a, b] = await Promise.all([t.svc.sendInquiry(valid, {}), t.svc.sendInquiry(valid, {})]);
    expect(createLead).toHaveBeenCalledTimes(2); // both got past the repeat check: the store's refusal is what decides
    expect(a).toEqual(b);
    expect(a).toMatchObject({ ok: true, value: { status: 'received', eventId: `lead.${(await t.byRequest()).publicId}` } });
    expect(await t.leads()).toHaveLength(1);
    expect(t.sent).toEqual(['hassan-new-inquiry', 'inquiry-received']); // only the winner sends
    expect(t.tracked).toHaveLength(1);
  });

  it('a failed email leaves its mark unset and the inquiry still counts', async () => {
    const mails: EmailKind[] = [];
    const notifier = { send: async (kind: EmailKind, _data: EmailData) => {
      if (kind === 'hassan-new-inquiry') throw new Error('550 mailbox v@example.com refused');
      mails.push(kind);
    } };
    const t = inquirySetup({ notifier });
    const r = await t.svc.sendInquiry(valid, {});
    expect(r).toMatchObject({ ok: true, value: { status: 'received' } });
    expect(mails).toEqual(['inquiry-received']); // the second email is still tried
    const lead = await t.byRequest();
    expect(lead.hassanNotifiedAt).toBeUndefined();
    expect(lead.visitorNotifiedAt).toEqual(NOW);
    expect(t.tracked).toHaveLength(1);
    expect(warn.mock.calls.flat()).toEqual(['booking: email hassan-new-inquiry not sent (Error)']); // nothing about the visitor
  });

  it('a failed visitor email leaves only its own mark unset', async () => {
    const notifier = { send: async (kind: EmailKind, _data: EmailData) => { if (kind === 'inquiry-received') throw new Error('boom'); } };
    const t = inquirySetup({ notifier });
    expect(await t.svc.sendInquiry(valid, {})).toMatchObject({ ok: true });
    const lead = await t.byRequest();
    expect(lead.hassanNotifiedAt).toEqual(NOW);
    expect(lead.visitorNotifiedAt).toBeUndefined();
  });

  it('an earlier call-flow lead from this visit is told and not counted twice', async () => {
    const t = inquirySetup();
    const earlierId = await addLead(t.svc);
    expect((await t.store.getLeadByPublicId(earlierId))!.newLeadNotifiedAt).toBeUndefined();

    const r = await t.svc.sendInquiry({ ...valid, leadId: earlierId }, {});
    expect(r).toMatchObject({ ok: true, value: { status: 'received' } });

    const earlier = (await t.store.getLeadByPublicId(earlierId))!;
    expect(earlier).toMatchObject({ status: 'started', newLeadNotifiedAt: NOW }); // Hassan has heard of it: no 30-minute email
    expect(t.tracked.map((e) => [e.name, e.eventId])).toEqual([['Lead', `lead.${earlierId}`]]); // the inquiry sent no Lead of its own
    expect(t.sent).toEqual(['hassan-new-inquiry', 'inquiry-received']);
    expect((await t.byRequest()).status).toBe('inquiry');
  });

  describe('a leadId that is booked, unknown or itself an inquiry changes nothing', () => {
    /** The Lead events the tracker got, in order, by lead event id. */
    const leadEvents = (tracked: ServerEvent[]) => tracked.filter((e) => e.name === 'Lead').map((e) => e.eventId);

    it('booked', async () => {
      const t = inquirySetup();
      const earlierId = await addLead(t.svc);
      const { slots } = await t.svc.getSlots();
      expect(await t.svc.book({ leadId: earlierId, start: slots[0].start, visitorTz: 'UTC' }, {})).toMatchObject({ ok: true });
      const before = await t.store.getLeadByPublicId(earlierId);

      expect(await t.svc.sendInquiry({ ...valid, leadId: earlierId }, {})).toMatchObject({ ok: true });
      expect(await t.store.getLeadByPublicId(earlierId)).toEqual(before);
      expect(leadEvents(t.tracked)).toEqual([`lead.${earlierId}`, `lead.${(await t.byRequest()).publicId}`]);
    });

    it('booked, in the moment inside book() when the booking is saved and the lead row still says started', async () => {
      const t = inquirySetup();
      const earlierId = await addLead(t.svc);
      const earlier = (await t.store.getLeadByPublicId(earlierId))!;
      const { slots } = await t.svc.getSlots();
      await t.store.insertBooking({ leadId: earlier.id, start: slots[0].start, end: slots[0].end, visitorTz: 'UTC', status: 'requested', manageToken: 'tok' }, NOW);

      expect(await t.svc.sendInquiry({ ...valid, leadId: earlierId }, {})).toMatchObject({ ok: true });
      expect((await t.store.getLeadByPublicId(earlierId))!.newLeadNotifiedAt).toBeUndefined();
      expect(leadEvents(t.tracked)).toEqual([`lead.${earlierId}`, `lead.${(await t.byRequest()).publicId}`]);
    });

    it('unknown', async () => {
      const t = inquirySetup();
      expect(await t.svc.sendInquiry({ ...valid, leadId: 'A'.repeat(22) }, {})).toMatchObject({ ok: true });
      expect(await t.leads()).toHaveLength(1);
      expect(leadEvents(t.tracked)).toEqual([`lead.${(await t.byRequest()).publicId}`]);
    });

    it('itself an inquiry', async () => {
      const t = inquirySetup();
      await t.svc.sendInquiry(valid, {});
      const first = await t.byRequest();
      expect(await t.svc.sendInquiry({ ...valid, requestId: 'req-00000002', leadId: first.publicId }, {})).toMatchObject({ ok: true });
      expect(await t.store.getLeadByPublicId(first.publicId)).toEqual(first);
      expect(leadEvents(t.tracked)).toEqual([`lead.${first.publicId}`, `lead.${(await t.byRequest('req-00000002')).publicId}`]);
    });
  });
});
