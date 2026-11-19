import { describe, it, expect, vi, afterEach } from 'vitest';
import { b, mainHtml, mount, renderBooking, type Mounted } from './helpers/booking-dom';
import { initBooking, type BookingOptions } from '../../src/scripts/booking-ui';
import { BotCheckError, FieldsError, NetworkError, RateLimitedError, SlotTakenError, type BookingApi, type Booked } from '../../src/lib/booking/api-client';
import { formatSlotLong } from '../../src/lib/booking/format';
import { captureAttribution } from '../../src/scripts/attribution';
import type { Slot } from '../../src/lib/booking/slots';

const LEAD_ID = 'L'.repeat(22);
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Six slots, 20 minutes apart, in the next fortnight of the tests' made-up calendar. */
const slotsOf = (n = 6): Slot[] => Array.from({ length: n }, (_, i) => {
  const start = Date.UTC(2026, 11, 7, 14, 0) + i * 20 * 60_000;
  return { start: new Date(start).toISOString(), end: new Date(start + 15 * 60_000).toISOString() };
});

const bookedFor = (slot: Slot, over: Partial<Booked> = {}): Booked => ({
  status: 'booked', start: slot.start, end: slot.end, meetUrl: 'https://meet.google.com/abc-defg-hij',
  manageUrl: 'https://hivegen.test/booking/tok', eventId: 'schedule.x', ...over,
});

/** An api whose three calls are spies: they answer as the test says (or like a healthy server) and record what they were asked. */
function fakeApi(over: Partial<BookingApi> = {}) {
  return {
    createLead: vi.fn<BookingApi['createLead']>(over.createLead ?? (async () => ({ leadId: LEAD_ID, eventId: `lead.${LEAD_ID}` }))),
    getSlots: vi.fn<BookingApi['getSlots']>(over.getSlots ?? (async () => ({ slots: slotsOf(), calendarChecked: true }))),
    confirm: vi.fn<BookingApi['confirm']>(over.confirm ?? (async (_id, slot) => bookedFor(slot))),
  };
}

/** A promise that the test settles when it chooses. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function open(api: BookingApi, opts: Partial<BookingOptions> = {}, html?: string): Promise<Mounted> {
  const m = mount(html ?? await mainHtml());
  initBooking(m.root, api, { mode: 'live', ...opts });
  return m;
}

function fill(m: Mounted, v: { name?: string; email?: string; buyer?: string; volume?: string; phone?: string; footage?: string; website?: string }) {
  const set = (name: string, value: string | undefined) => { if (value !== undefined) m.$<HTMLInputElement>(`input[name="${name}"]`).value = value; };
  const pick = (name: string, value: string | undefined) => { if (value !== undefined) m.$<HTMLInputElement>(`input[name="${name}"][value="${value}"]`).checked = true; };
  set('name', v.name); set('email', v.email); set('phone', v.phone); set('footage', v.footage); set('website', v.website);
  pick('buyer', v.buyer); pick('volume', v.volume);
}
const GOOD = { name: 'Zoë O’Brien', email: 'zoe+ads@example.com', buyer: 'agent', volume: '6–15' };
const next = (m: Mounted) => m.$<HTMLButtonElement>('[data-submit]').click();
const shown = (el: HTMLElement) => !el.hidden;
const errorOf = (m: Mounted, field: string) => m.$(`[data-error="${field}"]`);
const timeStepShown = (m: Mounted) => shown(m.$('[data-step="time"]'));

/** Fills the form, goes to step 2 and waits for the times. */
async function toTimeStep(m: Mounted) {
  fill(m, GOOD);
  next(m);
  await vi.waitFor(() => expect(timeStepShown(m)).toBe(true));
}

afterEach(() => { vi.restoreAllMocks(); });

describe('step 1: the details', () => {
  it('"I am a…" and videos per month are required, each with its own message, and the first invalid field gets focus', async () => {
    const api = fakeApi();
    const m = await open(api);
    fill(m, { name: 'Zoë', email: 'zoe@example.com' });
    next(m);
    expect(errorOf(m, 'buyer').hidden).toBe(false);
    expect(errorOf(m, 'buyer').textContent).toBe(b.errors.buyer);
    expect(errorOf(m, 'volume').textContent).toBe(b.errors.volume);
    expect(errorOf(m, 'name').hidden).toBe(true);
    expect(errorOf(m, 'email').hidden).toBe(true);
    expect(m.document.activeElement).toBe(m.$('input[name="buyer"]'));
    expect(api.createLead).not.toHaveBeenCalled();

    fill(m, { buyer: 'agent' });
    next(m);
    expect(errorOf(m, 'buyer').hidden).toBe(true);
    expect(errorOf(m, 'volume').hidden).toBe(false);
    expect(m.document.activeElement).toBe(m.$('input[name="volume"]'));
  });

  it('name and email are still checked, and the first of them gets focus', async () => {
    const m = await open(fakeApi());
    fill(m, { email: 'nope', buyer: 'agent', volume: '6–15' });
    next(m);
    expect(errorOf(m, 'name').textContent).toBe(b.errors.name);
    expect(errorOf(m, 'email').textContent).toBe(b.errors.email);
    expect(m.document.activeElement).toBe(m.$('input[name="name"]'));
  });

  it('sends what the visitor typed, with the bot token, the honeypot, the ad tags and the Facebook cookies', async () => {
    const api = fakeApi();
    const m = mount(await mainHtml());
    captureAttribution(new URL('https://hivegen.test/?utm_source=facebook&fbclid=abc'), m.window.localStorage, Date.now());
    m.document.cookie = '_fbp=fb.1.111.222';
    m.document.cookie = '_fbc=fb.1.333.abc';
    initBooking(m.root, api, { mode: 'live', getBotToken: async () => 'test-token' });
    fill(m, { ...GOOD, phone: '+1 (555) 010-2000', footage: 'https://drive.google.com/x' });
    next(m);
    await vi.waitFor(() => expect(api.createLead).toHaveBeenCalledTimes(1));
    expect(api.createLead.mock.calls[0][0]).toEqual({
      name: 'Zoë O’Brien', email: 'zoe+ads@example.com', phone: '+1 (555) 010-2000', buyerType: 'agent', volume: '6–15',
      footageUrl: 'https://drive.google.com/x', pageVersion: 'main', attribution: { utm_source: 'facebook', fbclid: 'abc' },
      fbp: 'fb.1.111.222', fbc: 'fb.1.333.abc', turnstileToken: 'test-token', website: '',
    });
  });

  it('a filled honeypot is passed on as "website", for the server to answer', async () => {
    const api = fakeApi();
    const m = await open(api);
    fill(m, { ...GOOD, website: 'http://spam.example' });
    next(m);
    await vi.waitFor(() => expect(api.createLead).toHaveBeenCalled());
    expect(api.createLead.mock.calls[0][0].website).toBe('http://spam.example');
  });

  it('the version page sends its own version, and its preselected buyer type counts as chosen', async () => {
    const api = fakeApi();
    const m = await open(api, {}, await renderBooking('agents'));
    fill(m, { name: 'Zoë', email: 'zoe@example.com', volume: '1–5' });
    next(m);
    await vi.waitFor(() => expect(api.createLead).toHaveBeenCalled());
    expect(api.createLead.mock.calls[0][0]).toMatchObject({ pageVersion: 'agents', buyerType: 'agent' });
  });

  it('the Next button is disabled while the lead is being saved, and a second submit does nothing', async () => {
    const saving = deferred<{ leadId: string; eventId: string }>();
    const api = fakeApi({ createLead: vi.fn(() => saving.promise) });
    const m = await open(api);
    fill(m, GOOD);
    const button = m.$<HTMLButtonElement>('[data-submit]');
    next(m);
    expect(button.disabled).toBe(true);
    next(m); // a click on a disabled button does nothing...
    m.$<HTMLFormElement>('[data-step="details"]').dispatchEvent(new m.window.Event('submit', { cancelable: true, bubbles: true })); // ...and so does a stray submit
    await Promise.resolve();
    expect(api.createLead).toHaveBeenCalledTimes(1);
    saving.resolve({ leadId: LEAD_ID, eventId: 'lead.x' });
    await vi.waitFor(() => expect(timeStepShown(m)).toBe(true));
    expect(api.createLead).toHaveBeenCalledTimes(1);
  });

  it('a network failure keeps the visitor on step 1, with the network message and a working button', async () => {
    const api = fakeApi({ createLead: vi.fn(async () => { throw new NetworkError(); }) });
    const m = await open(api);
    fill(m, GOOD);
    next(m);
    await vi.waitFor(() => expect(m.$('[data-form-error]').hidden).toBe(false));
    expect(m.$('[data-form-error]').textContent).toBe(b.errors.network);
    expect(shown(m.$('[data-step="details"]'))).toBe(true);
    expect(timeStepShown(m)).toBe(false);
    expect(m.$<HTMLButtonElement>('[data-submit]').disabled).toBe(false);
    expect(api.getSlots).not.toHaveBeenCalled();
  });

  it.each([
    ['a failed bot check', new BotCheckError(), b.errors.botCheck],
    ['a rate limit', new RateLimitedError(), b.errors.rateLimited],
    ['a server that answers something unexpected', new FieldsError({ pageVersion: 'invalid' }), b.errors.network],
  ])('%s shows its own message on step 1', async (_name, error, message) => {
    const m = await open(fakeApi({ createLead: vi.fn(async () => { throw error; }) }));
    fill(m, GOOD);
    next(m);
    await vi.waitFor(() => expect(m.$('[data-form-error]').hidden).toBe(false));
    expect(m.$('[data-form-error]').textContent).toBe(message);
    expect(m.$<HTMLButtonElement>('[data-submit]').disabled).toBe(false);
  });

  it('fields the server refuses are marked, with their own messages, and the first gets focus', async () => {
    const api = fakeApi({ createLead: vi.fn(async () => { throw new FieldsError({ footageUrl: 'invalid', phone: 'invalid' }); }) });
    const m = await open(api);
    fill(m, { ...GOOD, phone: '12ab', footage: 'drive.google.com/x' });
    next(m);
    await vi.waitFor(() => expect(errorOf(m, 'phone').hidden).toBe(false));
    expect(errorOf(m, 'phone').textContent).toBe(b.errors.phone);
    expect(errorOf(m, 'footage').textContent).toBe(b.errors.footage);
    expect(m.document.activeElement).toBe(m.$('input[name="phone"]'));
    expect(m.$('input[name="phone"]').getAttribute('aria-invalid')).toBe('true');
    expect(m.$<HTMLButtonElement>('[data-submit]').disabled).toBe(false);
  });

  it('a bot token that never comes is a bot-check error, and no lead is made', async () => {
    const api = fakeApi();
    const m = await open(api, { getBotToken: () => Promise.reject(new Error('turnstile_timeout')) });
    fill(m, GOOD);
    next(m);
    await vi.waitFor(() => expect(m.$('[data-form-error]').textContent).toBe(b.errors.botCheck));
    expect(api.createLead).not.toHaveBeenCalled();
  });

  it('going Back and Next again with the same details does not make a second lead', async () => {
    const api = fakeApi();
    const getBotToken = vi.fn(async () => 'tok');
    const m = await open(api, { getBotToken });
    await toTimeStep(m);
    m.$('[data-back]').click();
    next(m);
    await vi.waitFor(() => expect(timeStepShown(m)).toBe(true));
    expect(api.getSlots).toHaveBeenCalledTimes(2);
    expect(api.createLead).toHaveBeenCalledTimes(1);
    expect(getBotToken).toHaveBeenCalledTimes(1);
    // Changed details are a new lead.
    m.$('[data-back]').click();
    fill(m, { name: 'Another Name' });
    next(m);
    await vi.waitFor(() => expect(api.createLead).toHaveBeenCalledTimes(2));
  });

  it('when the times cannot be loaded after the lead is saved, the visitor is told it is saved and the lead is not made twice', async () => {
    const api = fakeApi();
    api.getSlots.mockRejectedValueOnce(new NetworkError());
    const m = await open(api);
    fill(m, GOOD);
    next(m);
    await vi.waitFor(() => expect(m.$('[data-form-error]').hidden).toBe(false));
    expect(m.$('[data-form-error]').textContent).toBe(b.errors.unreachable);
    expect(timeStepShown(m)).toBe(false);
    next(m);
    await vi.waitFor(() => expect(timeStepShown(m)).toBe(true));
    expect(api.createLead).toHaveBeenCalledTimes(1);
  });
});

describe('step 2: the time', () => {
  it('shows the visitor\'s time zone and falls back to UTC when the browser reports none', async () => {
    const m = await open(fakeApi());
    expect(m.$('[data-time-note]').textContent).toBe(b.timeNote.replace('{timezone}', tz.replace(/_/g, ' ')));

    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({} as Intl.ResolvedDateTimeFormatOptions);
    const api = fakeApi();
    const u = await open(api);
    expect(u.$('[data-time-note]').textContent).toBe(b.timeNote.replace('{timezone}', 'UTC'));
    await toTimeStep(u);
    u.$<HTMLButtonElement>('[data-testid="slot"]').click();
    u.$<HTMLButtonElement>('[data-confirm]').click();
    await vi.waitFor(() => expect(api.confirm).toHaveBeenCalled());
    expect(api.confirm.mock.calls[0][2]).toBe('UTC');
  });

  it('lists the days and times; Confirm is off until a time is picked; picking another day clears the choice', async () => {
    const day2 = slotsOf(2).map((s) => ({ start: new Date(Date.parse(s.start) + 86_400_000).toISOString(), end: new Date(Date.parse(s.end) + 86_400_000).toISOString() }));
    const api = fakeApi({ getSlots: vi.fn(async () => ({ slots: [...slotsOf(3), ...day2], calendarChecked: true })) });
    const m = await open(api);
    await toTimeStep(m);
    const confirm = m.$<HTMLButtonElement>('[data-confirm]');
    expect(m.document.querySelectorAll('[data-days] button').length).toBeGreaterThanOrEqual(2);
    expect(confirm.disabled).toBe(true);
    m.document.querySelectorAll<HTMLButtonElement>('[data-testid="slot"]')[1].click();
    expect(confirm.disabled).toBe(false);
    m.document.querySelectorAll<HTMLButtonElement>('[data-days] button')[1].click();
    expect(confirm.disabled).toBe(true);
  });

  it('says so when no times are open', async () => {
    const m = await open(fakeApi({ getSlots: vi.fn(async () => ({ slots: [], calendarChecked: true })) }));
    await toTimeStep(m);
    expect(m.$('[data-slots]').textContent).toBe(b.noSlots);
    expect(m.$<HTMLButtonElement>('[data-confirm]').disabled).toBe(true);
  });

  it('shows the calendar note only when the calendar could not be checked', async () => {
    const unchecked = await open(fakeApi({ getSlots: vi.fn(async () => ({ slots: slotsOf(), calendarChecked: false })) }));
    expect(unchecked.$('[data-calendar-note]').hidden).toBe(true);
    await toTimeStep(unchecked);
    expect(unchecked.$('[data-calendar-note]').hidden).toBe(false);
    expect(unchecked.$('[data-calendar-note]').textContent).toContain(b.calendarNote.split('{backupLink}')[0].trim());

    const checked = await open(fakeApi());
    await toTimeStep(checked);
    expect(checked.$('[data-calendar-note]').hidden).toBe(true);
  });

  it('Confirm is disabled while the booking is made, so a second click cannot book twice; it works again after an error', async () => {
    const booking = deferred<Booked>();
    const api = fakeApi({ confirm: vi.fn(() => booking.promise) });
    const m = await open(api);
    await toTimeStep(m);
    const confirm = m.$<HTMLButtonElement>('[data-confirm]');
    m.$<HTMLButtonElement>('[data-testid="slot"]').click();
    confirm.click();
    expect(confirm.disabled).toBe(true);
    confirm.click();
    await Promise.resolve();
    expect(api.confirm).toHaveBeenCalledTimes(1);

    booking.reject(new NetworkError());
    await vi.waitFor(() => expect(m.$('[data-time-error]').hidden).toBe(false));
    expect(m.$('[data-time-error]').textContent).toBe(b.errors.unreachable);
    expect(confirm.disabled).toBe(false);
    expect(timeStepShown(m)).toBe(true);
  });

  it('a time taken meanwhile says so and offers fresh times', async () => {
    const api = fakeApi();
    api.confirm.mockRejectedValueOnce(new SlotTakenError());
    const m = await open(api);
    await toTimeStep(m);
    m.$<HTMLButtonElement>('[data-testid="slot"]').click();
    m.$<HTMLButtonElement>('[data-confirm]').click();
    await vi.waitFor(() => expect(m.$('[data-time-error]').textContent).toBe(b.errors.slotTaken));
    await vi.waitFor(() => expect(api.getSlots).toHaveBeenCalledTimes(2));
    expect(m.$<HTMLButtonElement>('[data-confirm]').disabled).toBe(true); // pick again
  });

  it('a rate limit on Confirm has its own message', async () => {
    const api = fakeApi({ confirm: vi.fn(async () => { throw new RateLimitedError(); }) });
    const m = await open(api);
    await toTimeStep(m);
    m.$<HTMLButtonElement>('[data-testid="slot"]').click();
    m.$<HTMLButtonElement>('[data-confirm]').click();
    await vi.waitFor(() => expect(m.$('[data-time-error]').textContent).toBe(b.errors.rateLimited));
  });
});

describe('step 3: the answer', () => {
  async function bookWith(result: (slot: Slot) => Booked, html?: string) {
    const api = fakeApi({ confirm: vi.fn(async (_id, slot) => result(slot)) });
    const m = await open(api, {}, html);
    await toTimeStep(m);
    m.$<HTMLButtonElement>('[data-testid="slot"]').click();
    m.$<HTMLButtonElement>('[data-confirm]').click();
    await vi.waitFor(() => expect(shown(m.$('[data-testid="booking-done"]'))).toBe(true));
    return { m, api };
  }

  it('booked: the confirmation, the time, "Add to calendar" and the manage link', async () => {
    const { m, api } = await bookWith((s) => bookedFor(s));
    const slot = slotsOf()[0];
    expect(api.confirm).toHaveBeenCalledWith(LEAD_ID, slot, tz);
    const done = m.$('[data-testid="booking-done"]');
    expect(done.querySelector('h3')!.textContent).toBe(b.confirmation.heading);
    expect(m.$('[data-done-text]').textContent).toBe(b.confirmation.text.replace('{email}', GOOD.email));
    expect(m.$('[data-done-steps]').textContent).toContain(formatSlotLong(slot, tz));
    const calendar = m.$<HTMLAnchorElement>('[data-calendar]');
    expect(calendar.hidden).toBe(false);
    expect(calendar.textContent).toBe(b.confirmation.addToCalendar);
    expect(calendar.href).toContain('calendar.google.com');
    const manage = m.$<HTMLAnchorElement>('[data-manage]');
    expect(manage.textContent).toBe(b.confirmation.manageLabel);
    expect(manage.href).toBe('https://hivegen.test/booking/tok');
    expect(done.textContent).not.toContain(b.requested.heading);
  });

  it('requested: the requested wording instead of "You\'re booked.", the manage link, no calendar button', async () => {
    const { m } = await bookWith((s) => bookedFor(s, { status: 'requested', meetUrl: undefined }));
    const slot = slotsOf()[0];
    const done = m.$('[data-testid="booking-done"]');
    expect(done.querySelector('h3')!.textContent).toBe(b.requested.heading);
    expect(m.$('[data-done-text]').textContent).toBe(b.requested.text.replace('{email}', GOOD.email).replace('{when}', formatSlotLong(slot, tz)));
    expect(done.textContent).not.toContain(b.confirmation.heading);
    expect(m.$<HTMLAnchorElement>('[data-manage]').href).toBe('https://hivegen.test/booking/tok');
    expect(m.$('[data-calendar]').hidden).toBe(true);
    expect(m.$('[data-done-next]').hidden).toBe(true); // "Join the call on…" would promise too much
  });

  it('only a web link or the page itself is used as the manage link', async () => {
    const { m } = await bookWith((s) => bookedFor(s, { manageUrl: 'javascript:alert(1)' }));
    expect(m.$('[data-manage]').getAttribute('href')).toBe('#book');
  });

  it('shows the time the server booked, even when it is not the one clicked', async () => {
    const other = slotsOf()[4];
    const { m } = await bookWith(() => bookedFor(other));
    expect(m.$('[data-done-steps]').textContent).toContain(formatSlotLong(other, tz));
  });
});

describe('tracking hooks', () => {
  it('live: onLead gets the lead event id and onSchedule the schedule event id and the email; a hook that throws breaks nothing', async () => {
    const onLead = vi.fn(() => { throw new Error('tracker down'); });
    const onSchedule = vi.fn();
    const m = await open(fakeApi(), { onLead, onSchedule });
    await toTimeStep(m);
    expect(onLead).toHaveBeenCalledWith(`lead.${LEAD_ID}`);
    m.$<HTMLButtonElement>('[data-testid="slot"]').click();
    m.$<HTMLButtonElement>('[data-confirm]').click();
    await vi.waitFor(() => expect(shown(m.$('[data-testid="booking-done"]'))).toBe(true));
    expect(onSchedule).toHaveBeenCalledWith('schedule.x', GOOD.email);
  });

  it('demo: a pretend booking is never tracked', async () => {
    const onLead = vi.fn();
    const onSchedule = vi.fn();
    const m = await open(fakeApi(), { mode: 'demo', onLead, onSchedule });
    await toTimeStep(m);
    m.$<HTMLButtonElement>('[data-testid="slot"]').click();
    m.$<HTMLButtonElement>('[data-confirm]').click();
    await vi.waitFor(() => expect(shown(m.$('[data-testid="booking-done"]'))).toBe(true));
    expect(onLead).not.toHaveBeenCalled();
    expect(onSchedule).not.toHaveBeenCalled();
  });
});
