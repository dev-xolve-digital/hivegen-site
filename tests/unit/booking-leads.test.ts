import { describe, it, expect } from 'vitest';
import { generateSlots } from '../../src/lib/booking/slots';
import { bookingInputSchema, parseInput } from '../../src/server/booking/validate';
import { NOW, booking, good, rules, setup } from './helpers/booking';

describe('createLead', () => {
  it('saves the lead and returns an unguessable id and the Lead event id', async () => {
    const { svc, store, tracked } = setup();
    const r = await svc.createLead(good, { ip: '203.0.113.9', userAgent: 'UA' });
    if (!r.ok) throw new Error(r.error);
    expect(r.value.leadId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(r.value.eventId).toBe(`lead.${r.value.leadId}`);
    expect(await store.getLeadByPublicId(r.value.leadId)).toMatchObject({ name: 'Zoë O’Brien', status: 'started', clientIp: '203.0.113.9', attribution: { utm_source: 'facebook', fbclid: 'abc' } });
    expect(tracked).toEqual([expect.objectContaining({ name: 'Lead', eventId: r.value.eventId, user: expect.objectContaining({ email: 'zoe+ads@example.com' }) })]);
  });

  it('names each invalid field', async () => {
    expect(await setup().svc.createLead({ ...good, name: '', email: 'nope', buyerType: '', volume: '7' }, {}))
      .toEqual({ ok: false, error: 'invalid', fields: { name: 'required', email: 'invalid', buyerType: 'required', volume: 'invalid' } });
  });

  it('a body with nothing in it (or not an object) lists every required field', async () => {
    const required = { name: 'required', email: 'required', buyerType: 'required', volume: 'required', pageVersion: 'required', turnstileToken: 'required' };
    expect(await setup().svc.createLead({}, {})).toEqual({ ok: false, error: 'invalid', fields: required });
    expect(await setup().svc.createLead(null, {})).toEqual({ ok: false, error: 'invalid', fields: required });
  });

  it('too long, wrong format and not-allowed values each get their code', async () => {
    const r = await setup().svc.createLead({
      ...good, name: 'n'.repeat(101), email: `${'a'.repeat(250)}@example.com`, phone: 'call me', footageUrl: 'javascript:alert(1)',
      pageVersion: 'other-page', fbp: 'x'.repeat(201), fbc: 'x'.repeat(201), turnstileToken: 't'.repeat(2049),
      attribution: { utm_campaign: 'c'.repeat(201) },
    }, {});
    expect(r).toEqual({ ok: false, error: 'invalid', fields: {
      name: 'too_long', email: 'too_long', phone: 'invalid', footageUrl: 'invalid', pageVersion: 'invalid',
      fbp: 'too_long', fbc: 'too_long', turnstileToken: 'too_long', attribution: 'too_long',
    } });
    expect(await setup().svc.createLead({ ...good, phone: '1'.repeat(31), footageUrl: `https://x.test/${'a'.repeat(500)}` }, {}))
      .toEqual({ ok: false, error: 'invalid', fields: { phone: 'too_long', footageUrl: 'too_long' } });
    expect(await setup().svc.createLead({ ...good, phone: '12345' }, {})).toMatchObject({ ok: false, fields: { phone: 'invalid' } });
  });

  it('a name with a control character (CR, LF, tab, NUL, DEL) is invalid, because it later reaches the invite title and email subjects', async () => {
    const { svc, store } = setup();
    for (const name of ['Zoë\r\nBcc: evil@example.com', 'Zo\në', 'Zo\të', 'Zo\u0000ë', 'Zo\u007fë', '\u0001']) {
      expect(await svc.createLead({ ...good, name }, {})).toEqual({ ok: false, error: 'invalid', fields: { name: 'invalid' } });
    }
    expect(await store.leadsCreatedBetween('2000-01-01T00:00:00Z', '2100-01-01T00:00:00Z')).toEqual([]);
    // Whitespace around the name is trimmed, as before.
    expect(await svc.createLead({ ...good, name: '\n Zoë \t' }, {})).toMatchObject({ ok: true });
  });

  it('blank optional fields are left out; text is trimmed; only the seven attribution keys are kept', async () => {
    const { svc, store } = setup();
    const r = await svc.createLead({
      ...good, name: '  Zoë  ', email: ' zoe@example.com ', phone: '  ', footageUrl: '', fbp: '', fbc: '',
      attribution: { utm_source: 'facebook', gclid: 'g1', unknown_key: 'dropped' },
    }, {});
    if (!r.ok) throw new Error(r.error);
    const lead = await store.getLeadByPublicId(r.value.leadId);
    expect(lead).toMatchObject({ name: 'Zoë', email: 'zoe@example.com', attribution: { utm_source: 'facebook', gclid: 'g1' } });
    expect(lead?.attribution).not.toHaveProperty('unknown_key');
    expect(lead?.phone).toBeUndefined();
    expect(lead?.footageUrl).toBeUndefined();
    expect(lead?.fbp).toBeUndefined();
  });

  it('a lead without attribution is stored with an empty one', async () => {
    const { svc, store } = setup();
    const { attribution, ...rest } = good;
    const r = await svc.createLead(rest, {});
    if (!r.ok) throw new Error(r.error);
    expect((await store.getLeadByPublicId(r.value.leadId))?.attribution).toEqual({});
  });

  it('a filled honeypot pretends success and stores nothing', async () => {
    const { svc, store, tracked, botChecks } = setup();
    const r = await svc.createLead({ ...good, website: 'http://spam.example' }, { ip: '203.0.113.9' });
    if (!r.ok) throw new Error(r.error);
    expect(r.value.leadId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(r.value.eventId).toBe(`lead.${r.value.leadId}`);
    expect(await store.leadsCreatedBetween('2000-01-01T00:00:00Z', '2100-01-01T00:00:00Z')).toEqual([]);
    expect(await store.getLeadByPublicId(r.value.leadId)).toBeNull();
    expect(tracked).toEqual([]);
    expect(botChecks).toEqual([]);
  });

  it('a failed bot check stores nothing', async () => {
    const { svc, store, tracked } = setup();
    expect(await svc.createLead({ ...good, turnstileToken: 'fail' }, {})).toEqual({ ok: false, error: 'bot_check_failed' });
    expect(await store.leadsCreatedBetween('2000-01-01T00:00:00Z', '2100-01-01T00:00:00Z')).toEqual([]);
    expect(tracked).toEqual([]);
  });

  it('the bot check gets the token and the visitor IP, and only runs for valid input', async () => {
    const { svc, botChecks } = setup();
    await svc.createLead(good, { ip: '203.0.113.9' });
    await svc.createLead({ ...good, name: '' }, { ip: '203.0.113.10' });
    expect(botChecks).toEqual([{ token: 'ok', ip: '203.0.113.9' }]);
  });

  it('builds fbc from fbclid when the visitor sent none, and keeps one they did send', async () => {
    const { svc, store, tracked } = setup();
    const made = await svc.createLead({ ...good, fbp: 'fb.1.111.222' }, {});
    if (!made.ok) throw new Error(made.error);
    const fbc = `fb.1.${NOW.getTime()}.abc`;
    expect(await store.getLeadByPublicId(made.value.leadId)).toMatchObject({ fbp: 'fb.1.111.222', fbc });
    expect(tracked[0].user).toMatchObject({ fbp: 'fb.1.111.222', fbc });

    const sent = await svc.createLead({ ...good, fbc: 'fb.1.333.mine' }, {});
    if (!sent.ok) throw new Error(sent.error);
    expect((await store.getLeadByPublicId(sent.value.leadId))?.fbc).toBe('fb.1.333.mine');

    const none = await svc.createLead({ ...good, attribution: { utm_source: 'facebook' } }, {});
    if (!none.ok) throw new Error(none.error);
    expect((await store.getLeadByPublicId(none.value.leadId))?.fbc).toBeUndefined();
  });

  it('the Lead event carries the visitor, the lead and the page the form was on', async () => {
    const { svc, store, tracked } = setup();
    const r = await svc.createLead(good, { ip: '203.0.113.9', userAgent: 'UA', sourceUrl: 'https://hivegen.co/agents' });
    if (!r.ok) throw new Error(r.error);
    const lead = await store.getLeadByPublicId(r.value.leadId);
    expect(tracked).toEqual([{
      name: 'Lead', eventId: `lead.${r.value.leadId}`, time: NOW, sourceUrl: 'https://hivegen.co/agents', leadId: lead?.id,
      user: { email: 'zoe+ads@example.com', phone: '+1 (555) 010-2000', externalId: r.value.leadId, ip: '203.0.113.9', userAgent: 'UA',
        fbp: undefined, fbc: `fb.1.${NOW.getTime()}.abc` },
    }]);
    const bare = setup();
    await bare.svc.createLead(good, {});
    expect(bare.tracked[0].sourceUrl).toBe('');
  });

  it('two leads get two different ids', async () => {
    const { svc } = setup();
    const a = await svc.createLead(good, {});
    const b = await svc.createLead(good, {});
    if (!a.ok || !b.ok) throw new Error('lead not saved');
    expect(a.value.leadId).not.toBe(b.value.leadId);
  });
});

describe('getSlots', () => {
  const insertAt = async (store: ReturnType<typeof setup>['store'], slot: { start: string; end: string }, status: 'booked' | 'requested' | 'cancelled', n: number) => {
    const lead = await store.createLead({ publicId: `lead-${n}`, name: 'A', email: 'a@example.com', buyerType: 'agent', volume: '1–5', pageVersion: 'main', attribution: {} }, NOW);
    await store.insertBooking({ leadId: lead.id, ...slot, visitorTz: 'UTC', status, manageToken: `token-${n}` }, NOW);
  };

  it('with nothing busy, offers the slots the rules allow, and asks Google about the next 14 days', async () => {
    const { svc, calendar } = setup();
    const asked: Array<[string, string]> = [];
    const busy = calendar.busy;
    calendar.busy = async (from, to) => { asked.push([from, to]); return busy(from, to); };
    expect(await svc.getSlots()).toEqual({ slots: generateSlots(rules, NOW), calendarChecked: true });
    expect(asked).toEqual([[NOW.toISOString(), new Date(NOW.getTime() + 14 * 86_400_000).toISOString()]]);
  });

  it('slots leave out Google busy times and active bookings', async () => {
    const { svc, store, calendar } = setup();
    const all = (await svc.getSlots()).slots;
    expect(all[0].start).toBe('2026-12-01T14:00:00.000Z'); // 19:00 in Pakistan
    calendar.setBusy([all[0]]);
    await insertAt(store, all[1], 'booked', 1);
    await insertAt(store, all[2], 'cancelled', 2); // a cancelled booking holds nothing
    await insertAt(store, all[3], 'requested', 3);
    const r = await svc.getSlots();
    expect(r.calendarChecked).toBe(true);
    expect(r.slots).toEqual([all[2], ...all.slice(4)]);
  });

  it('when Google is unreachable, slots still come from the rules minus the database', async () => {
    const { svc, store, calendar } = setup();
    const all = (await svc.getSlots()).slots;
    await insertAt(store, all[1], 'booked', 1);
    calendar.setDown(true);
    const r = await svc.getSlots();
    expect(r.calendarChecked).toBe(false);
    expect(r.slots.length).toBeGreaterThan(0);
    expect(r.slots).toEqual([all[0], ...all.slice(2)]);
  });
});

describe('bookingInputSchema', () => {
  const ok = { leadId: 'A'.repeat(22), start: '2026-12-02T14:00:00.000Z', visitorTz: 'America/New_York' };

  it('accepts a lead id, a start time and a time zone', () => {
    expect(parseInput(bookingInputSchema, ok)).toEqual({ ok: true, value: ok });
  });
  it('writes the start in UTC, whatever offset it came with', () => {
    expect(parseInput(bookingInputSchema, { ...ok, start: '2026-12-02T19:00:00+05:00' })).toMatchObject({ ok: true, value: { start: '2026-12-02T14:00:00.000Z' } });
  });
  it('an unknown or missing time zone becomes UTC', () => {
    for (const visitorTz of ['Mars/Olympus', '', undefined, 42]) {
      expect(parseInput(bookingInputSchema, { ...ok, visitorTz })).toMatchObject({ ok: true, value: { visitorTz: 'UTC' } });
    }
    const { visitorTz: _left, ...withoutTz } = ok;
    expect(parseInput(bookingInputSchema, withoutTz)).toMatchObject({ ok: true, value: { visitorTz: 'UTC' } });
  });
  it('names each invalid field', () => {
    expect(parseInput(bookingInputSchema, { leadId: 'short', start: 'tomorrow' }))
      .toEqual({ ok: false, fields: { leadId: 'invalid', start: 'invalid' } });
    expect(parseInput(bookingInputSchema, {})).toEqual({ ok: false, fields: { leadId: 'required', start: 'required' } });
  });
  it('a start without Z or an offset is invalid (it would be read as server-local time)', () => {
    for (const start of ['2026-12-02T14:00:00', '2026-12-02T14:00', '2026-12-02T14:00:00.000', '2026-12-02 14:00:00Z', '2026-12-02']) {
      expect(parseInput(bookingInputSchema, { ...ok, start })).toEqual({ ok: false, fields: { start: 'invalid' } });
    }
    for (const start of ['2026-12-02T14:00:00Z', '2026-12-02T14:00Z', '2026-12-02T14:00:00.5Z', '2026-12-02T09:00:00-05:00']) {
      expect(parseInput(bookingInputSchema, { ...ok, start })).toMatchObject({ ok: true, value: { start: expect.stringMatching(/Z$/) } });
    }
    expect(parseInput(bookingInputSchema, { ...ok, start: '2026-12-02T14:00Z' })).toMatchObject({ value: { start: '2026-12-02T14:00:00.000Z' } });
  });
  it('an empty or blank leadId or start is required, as for the lead fields', () => {
    for (const blank of ['', '   ']) {
      expect(parseInput(bookingInputSchema, { leadId: blank, start: blank })).toEqual({ ok: false, fields: { leadId: 'required', start: 'required' } });
    }
    expect(parseInput(bookingInputSchema, { leadId: null, start: undefined })).toEqual({ ok: false, fields: { leadId: 'required', start: 'required' } });
    expect(parseInput(bookingInputSchema, { leadId: 42, start: 42 })).toEqual({ ok: false, fields: { leadId: 'invalid', start: 'invalid' } });
  });
});

describe('the calendar invite copy', () => {
  it('has the visitor name and the manage link, and nothing personal', () => {
    expect(booking.calendarEvent.title).toBe('HiveGen call · {name}');
    expect(booking.calendarEvent.description).toContain('{manageUrl}');
    expect(booking.calendarEvent.description).not.toMatch(/\{(phone|volume|email|utm|fbclid|attribution)/);
  });
});
