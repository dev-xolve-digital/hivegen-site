import { describe, it, expect, vi, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import ManageBooking from '../../src/components/ManageBooking.astro';
import { initManage } from '../../src/scripts/manage-booking';
import { NetworkError, RateLimitedError, SlotTakenError, TooLateError, httpManageApi, type ManageApi } from '../../src/lib/booking/api-client';
import { formatSlotLong } from '../../src/lib/booking/format';
import { loadSection, loadSite } from '../../src/lib/content/load';
import { fillPlaceholders } from '../../src/lib/text';
import type { Slot } from '../../src/lib/booking/slots';
import { toManageView, type ManageState } from '../../src/server/booking/manage-view';
import type { Booking, Lead } from '../../src/server/booking/types';

const mg = loadSection('manage-booking');
const b = loadSection('booking');
const site = loadSite();
const TZ = 'America/New_York';
const TOKEN = 'T'.repeat(43);

const lead = { id: 1, publicId: 'P'.repeat(22), name: 'Zoë', email: 'zoe@example.com', buyerType: 'agent', volume: '6–15', pageVersion: 'main', attribution: {}, createdAt: new Date(), status: 'booked' } as Lead;
const booking: Booking = {
  id: 7, leadId: 1, start: '2026-12-07T14:00:00.000Z', end: '2026-12-07T14:15:00.000Z', visitorTz: TZ, status: 'booked', manageToken: TOKEN,
  meetUrl: 'https://meet.google.com/abc-defg-hij', createdAt: new Date(), updatedAt: new Date(),
};
const found = (over: Partial<Booking> = {}, can: { canCancel?: boolean; canReschedule?: boolean } = {}): ManageState => ({
  kind: 'found', view: toManageView({ booking: { ...booking, ...over }, lead, canCancel: true, canReschedule: true, ...can }),
});

/** Six slots, 20 minutes apart, in the tests' made-up calendar. */
const slotsOf = (n = 6, from = Date.UTC(2026, 11, 8, 14, 0)): Slot[] => Array.from({ length: n }, (_, i) => {
  const start = from + i * 20 * 60_000;
  return { start: new Date(start).toISOString(), end: new Date(start + 15 * 60_000).toISOString() };
});
const timeText = (slot: Slot) => formatSlotLong(slot, TZ);

async function render(state: ManageState) {
  return (await AstroContainer.create()).renderToString(ManageBooking, { props: { state } });
}

function fakeApi(over: Partial<ManageApi> = {}) {
  return {
    getSlots: vi.fn<ManageApi['getSlots']>(over.getSlots ?? (async () => ({ slots: slotsOf(), calendarChecked: true }))),
    cancel: vi.fn<ManageApi['cancel']>(over.cancel ?? (async () => {})),
    reschedule: vi.fn<ManageApi['reschedule']>(over.reschedule ?? (async (slot) => ({ status: 'booked', start: slot.start, end: slot.end }))),
  };
}

/** A promise the test settles when it chooses. */
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

type Page = { document: Document; $: <T extends HTMLElement = HTMLElement>(sel: string) => T; has: (sel: string) => boolean; click: (sel: string) => void };

/** The page's HTML in jsdom, with the script started on it. */
async function open(state: ManageState, api: ManageApi): Promise<Page> {
  const { window } = new JSDOM(`<!doctype html><html><body>${await render(state)}</body></html>`, { url: `https://hivegen.test/booking/${TOKEN}` });
  const doc = window.document;
  const root = doc.querySelector<HTMLElement>('[data-manage]');
  if (root) initManage(root, api);
  const $ = <T extends HTMLElement = HTMLElement>(sel: string) => doc.querySelector<T>(sel)!;
  return { document: doc, $, has: (sel) => doc.querySelector(sel) !== null, click: (sel) => $(sel).click() };
}

const shown = (el: HTMLElement) => !el.hidden;
afterEach(() => { vi.restoreAllMocks(); });

describe('what the server renders', () => {
  it('shows the call time, its label, the Meet link and both actions for a booked call', async () => {
    const p = await open(found(), fakeApi());
    expect(p.$('h1').textContent).toBe(mg.heading);
    expect(p.$('[data-when]').textContent).toBe('Monday, December 7, 9:00 AM EST');
    expect(p.$('[data-when]').getAttribute('datetime')).toBe(booking.start);
    expect(p.$('[data-details]').textContent).toContain(mg.whenLabel);
    expect(p.$('[data-details]').textContent).toContain(mg.meetLabel);
    const meet = p.$<HTMLAnchorElement>('[data-details] a');
    expect(meet.href).toBe('https://meet.google.com/abc-defg-hij');
    expect(meet.textContent).toBe('meet.google.com/abc-defg-hij');
    expect(meet.rel).toContain('noopener');
    expect(p.$('[data-reschedule-open]').textContent).toBe(mg.rescheduleLabel);
    expect(p.$('[data-cancel-open]').textContent).toBe(mg.cancelLabel);
    expect(shown(p.$('[data-notice]'))).toBe(false);
    expect(shown(p.$('[data-reschedule-panel]'))).toBe(false);
    expect(shown(p.$('[data-cancel-panel]'))).toBe(false);
  });

  it('a call that cannot be rescheduled (requested, or less than an hour away) has Cancel only; with no Meet link there is no Meet row', async () => {
    const p = await open(found({ status: 'requested', meetUrl: undefined }, { canReschedule: false }), fakeApi());
    expect(p.has('[data-reschedule-open]')).toBe(false);
    expect(p.has('[data-reschedule-panel]')).toBe(false);
    expect(p.has('[data-cancel-open]')).toBe(true);
    expect(p.$('[data-details]').textContent).not.toContain(mg.meetLabel);
    expect(shown(p.$('[data-notice]'))).toBe(false);
  });

  it('a cancelled booking says so, with no time, no Meet link and no actions', async () => {
    const p = await open(found({ status: 'cancelled' }, { canCancel: false, canReschedule: false }), fakeApi());
    expect(shown(p.$('[data-notice]'))).toBe(true);
    expect(p.$('[data-notice]').textContent).toBe(fillPlaceholders(mg.cancelledText, { when: 'Monday, December 7, 9:00 AM EST' }));
    expect(p.has('[data-actions]')).toBe(false);
    expect(p.has('[data-details]')).toBe(false);
    expect(p.document.querySelectorAll('button')).toHaveLength(0);
  });

  it('a call that has started (nothing can be changed) says it is too late, with no actions', async () => {
    const p = await open(found({}, { canCancel: false, canReschedule: false }), fakeApi());
    expect(p.$('[data-notice]').textContent).toBe(mg.tooLateText);
    expect(shown(p.$('[data-notice]'))).toBe(true);
    expect(p.document.querySelectorAll('button')).toHaveLength(0);
    expect(p.has('[data-details]')).toBe(true); // the time stays, for reference
  });

  it('not found and error show their text and the Instagram link, and no time, buttons or booking data', async () => {
    for (const [kind, text] of [['not_found', mg.notFoundText], ['error', mg.errorText]] as const) {
      const p = await open({ kind }, fakeApi());
      expect(p.$('main').textContent).toContain(text);
      expect(p.$<HTMLAnchorElement>('a[href^="https://"]').href).toBe(site.contact.instagramUrl);
      expect(p.$('a[href^="https://"]').textContent).toContain(b.confirmation.instagramLabel);
      expect(p.has('[data-manage]')).toBe(false);
      expect(p.document.querySelectorAll('button, time')).toHaveLength(0);
    }
  });

  it('the page source holds only the visitor\'s own call: their token and time, never the lead\'s details', async () => {
    const html = await render(found());
    for (const secret of ['Zoë', 'zoe@example.com', lead.publicId]) expect(html).not.toContain(secret);
    expect(html).toContain(TOKEN);
  });

  it('every external link keeps the private address to itself', async () => {
    for (const state of [found(), { kind: 'not_found' } as const]) {
      const p = await open(state, fakeApi());
      const external = [...p.document.querySelectorAll<HTMLAnchorElement>('a[target="_blank"]')];
      expect(external.length).toBeGreaterThan(0);
      for (const a of external) expect(a.rel.split(' ').sort()).toEqual(['noopener', 'noreferrer']);
    }
  });
});

describe('cancelling', () => {
  it('asks first: the first press shows the question and nothing is sent; Keep takes it back', async () => {
    const api = fakeApi();
    const p = await open(found(), api);
    p.click('[data-cancel-open]');
    expect(shown(p.$('[data-cancel-panel]'))).toBe(true);
    expect(p.$('[data-cancel-panel]').textContent).toContain(mg.cancelConfirmText);
    expect(p.$('[data-cancel-confirm]').textContent).toBe(mg.cancelConfirmLabel);
    expect(p.$('[data-cancel-keep]').textContent).toBe(mg.keepLabel);
    expect(p.$('[data-cancel-open]').getAttribute('aria-expanded')).toBe('true');
    expect(api.cancel).not.toHaveBeenCalled();

    p.click('[data-cancel-keep]');
    expect(shown(p.$('[data-cancel-panel]'))).toBe(false);
    expect(p.$('[data-cancel-open]').getAttribute('aria-expanded')).toBe('false');
    expect(p.document.activeElement).toBe(p.$('[data-cancel-open]'));
    expect(api.cancel).not.toHaveBeenCalled();
  });

  it('confirming cancels once, shows the cancelled text with the call time, and takes the actions away', async () => {
    const api = fakeApi();
    const p = await open(found(), api);
    p.click('[data-cancel-open]');
    p.click('[data-cancel-confirm]');
    await vi.waitFor(() => expect(shown(p.$('[data-notice]'))).toBe(true));
    expect(api.cancel).toHaveBeenCalledTimes(1);
    expect(p.$('[data-notice]').textContent).toBe(fillPlaceholders(mg.cancelledText, { when: 'Monday, December 7, 9:00 AM EST' }));
    expect(shown(p.$('[data-actions]'))).toBe(false);
    expect(shown(p.$('[data-details]'))).toBe(false);
    expect(p.document.activeElement).toBe(p.$('[data-notice]'));
  });

  it('while the request is in flight Cancel and Confirm cancel are disabled and a second press does nothing; an error re-enables them', async () => {
    const sending = deferred();
    const api = fakeApi({ cancel: vi.fn(() => sending.promise) });
    const p = await open(found(), api);
    p.click('[data-cancel-open]');
    const confirm = p.$<HTMLButtonElement>('[data-cancel-confirm]');
    confirm.click();
    confirm.click();
    p.click('[data-cancel-open]');
    expect(api.cancel).toHaveBeenCalledTimes(1);
    for (const sel of ['[data-cancel-open]', '[data-cancel-confirm]', '[data-cancel-keep]', '[data-reschedule-open]']) {
      expect(p.$<HTMLButtonElement>(sel).disabled, sel).toBe(true);
    }

    sending.reject(new NetworkError());
    await vi.waitFor(() => expect(shown(p.$('[data-cancel-error]'))).toBe(true));
    expect(p.$('[data-cancel-error]').textContent).toBe(mg.errorText);
    for (const sel of ['[data-cancel-open]', '[data-cancel-confirm]', '[data-cancel-keep]', '[data-reschedule-open]']) {
      expect(p.$<HTMLButtonElement>(sel).disabled, sel).toBe(false);
    }
    expect(shown(p.$('[data-notice]'))).toBe(false); // nothing was cancelled
  });

  it('a failure then another try works, and the error goes away', async () => {
    const cancel = vi.fn<ManageApi['cancel']>().mockRejectedValueOnce(new NetworkError()).mockResolvedValueOnce();
    const p = await open(found(), fakeApi({ cancel }));
    p.click('[data-cancel-open]');
    p.click('[data-cancel-confirm]');
    await vi.waitFor(() => expect(shown(p.$('[data-cancel-error]'))).toBe(true));
    p.click('[data-cancel-confirm]');
    await vi.waitFor(() => expect(shown(p.$('[data-notice]'))).toBe(true));
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(shown(p.$('[data-cancel-error]'))).toBe(false);
  });

  it('"too late" shows its text and takes both actions away (rescheduling closes before cancelling does)', async () => {
    const p = await open(found(), fakeApi({ cancel: vi.fn(() => Promise.reject(new TooLateError())) }));
    p.click('[data-cancel-open]');
    p.click('[data-cancel-confirm]');
    await vi.waitFor(() => expect(shown(p.$('[data-notice]'))).toBe(true));
    expect(p.$('[data-notice]').textContent).toBe(mg.tooLateText);
    expect(shown(p.$('[data-actions]'))).toBe(false);
  });

  it('a request that stalls past the timeout ends in the error text, through the real client', async () => {
    const stalled = vi.fn<typeof fetch>((_input, init) => new Promise<Response>((_res, rej) => {
      init?.signal?.addEventListener('abort', () => rej(new DOMException('The operation was aborted.', 'TimeoutError')));
    }));
    const p = await open(found(), httpManageApi(TOKEN, stalled, 30));
    p.click('[data-cancel-open]');
    p.click('[data-cancel-confirm]');
    await vi.waitFor(() => expect(shown(p.$('[data-cancel-error]'))).toBe(true));
    expect(p.$('[data-cancel-error]').textContent).toBe(mg.errorText);
    expect(p.$<HTMLButtonElement>('[data-cancel-confirm]').disabled).toBe(false);
  });

  it('too many tries shows the rate-limit message from the booking words', async () => {
    const p = await open(found(), fakeApi({ cancel: vi.fn(() => Promise.reject(new RateLimitedError())) }));
    p.click('[data-cancel-open]');
    p.click('[data-cancel-confirm]');
    await vi.waitFor(() => expect(shown(p.$('[data-cancel-error]'))).toBe(true));
    expect(p.$('[data-cancel-error]').textContent).toBe(b.errors.rateLimited);
  });
});

describe('rescheduling', () => {
  /** Opens the picker and waits for the times. */
  async function toPicker(api: ManageApi) {
    const p = await open(found(), api);
    p.click('[data-reschedule-open]');
    await vi.waitFor(() => expect(p.document.querySelectorAll('[data-testid="slot"]').length).toBeGreaterThan(0));
    return p;
  }

  it('opens the picker with the times (in the booking\'s zone, with its note), and Confirm waits for a pick', async () => {
    const api = fakeApi();
    const p = await toPicker(api);
    expect(api.getSlots).toHaveBeenCalledTimes(1);
    expect(shown(p.$('[data-reschedule-panel]'))).toBe(true);
    expect(p.$('[data-reschedule-open]').getAttribute('aria-expanded')).toBe('true');
    expect(p.$('[data-reschedule-heading]').textContent).toBe(mg.rescheduleHeading);
    expect(p.$('[data-time-note]').textContent).toBe(fillPlaceholders(b.timeNote, { timezone: 'America/New York' }));
    expect(p.$('[data-reschedule-confirm]').textContent).toBe(mg.confirmRescheduleLabel);
    expect(p.$<HTMLButtonElement>('[data-reschedule-confirm]').disabled).toBe(true);
    expect(p.document.activeElement).toBe(p.$('[data-reschedule-heading]'));
    p.$<HTMLElement>('[data-testid="slot"]').click();
    expect(p.$<HTMLButtonElement>('[data-reschedule-confirm]').disabled).toBe(false);
  });

  it('the first slot is 9:00 AM in the booking\'s zone: the picker shows the times of that zone', async () => {
    const p = await toPicker(fakeApi());
    expect(p.$('[data-testid="slot"]').textContent).toBe('9:00 AM');
  });

  it('a second press on Reschedule closes the picker', async () => {
    const p = await toPicker(fakeApi());
    p.click('[data-reschedule-open]');
    expect(shown(p.$('[data-reschedule-panel]'))).toBe(false);
    expect(p.$('[data-reschedule-open]').getAttribute('aria-expanded')).toBe('false');
  });

  it('Confirm moves the call once: the new time (as the server confirms it) in the zone of the booking, the notice, the picker closed', async () => {
    const slots = slotsOf();
    const api = fakeApi();
    const p = await toPicker(api);
    p.$<HTMLElement>('[data-testid="slot"]:nth-child(3)').click();
    const confirm = p.$<HTMLButtonElement>('[data-reschedule-confirm]');
    confirm.click();
    confirm.click(); // a double click: the second does nothing
    await vi.waitFor(() => expect(shown(p.$('[data-notice]'))).toBe(true));
    expect(api.reschedule).toHaveBeenCalledTimes(1);
    expect(api.reschedule.mock.calls[0][0]).toEqual(slots[2]);
    expect(p.$('[data-notice]').textContent).toBe(fillPlaceholders(mg.rescheduledText, { when: timeText(slots[2]) }));
    expect(p.$('[data-when]').textContent).toBe(timeText(slots[2]));
    expect(p.$('[data-when]').getAttribute('datetime')).toBe(slots[2].start);
    expect(shown(p.$('[data-reschedule-panel]'))).toBe(false);
    expect(p.$<HTMLButtonElement>('[data-reschedule-open]').disabled).toBe(false);
    expect(shown(p.$('[data-actions]'))).toBe(true); // it can be moved again, or cancelled
    expect(p.document.activeElement).toBe(p.$('[data-notice]'));

    p.click('[data-reschedule-open]'); // moving it again: the old "Done." is not left standing over the new picker
    expect(shown(p.$('[data-notice]'))).toBe(false);
    await vi.waitFor(() => expect(p.$<HTMLButtonElement>('[data-reschedule-open]').disabled).toBe(false));
  });

  it('while the request is in flight everything is disabled, and an error re-enables it with the error text and the picked time kept', async () => {
    const sending = deferred<{ status: 'booked'; start: string; end: string }>();
    const api = fakeApi({ reschedule: vi.fn(() => sending.promise) });
    const p = await toPicker(api);
    p.$<HTMLElement>('[data-testid="slot"]').click();
    p.click('[data-reschedule-confirm]');
    for (const sel of ['[data-reschedule-confirm]', '[data-reschedule-open]', '[data-cancel-open]']) expect(p.$<HTMLButtonElement>(sel).disabled, sel).toBe(true);
    p.$<HTMLElement>('[data-testid="slot"]:nth-child(2)').click(); // picking another time meanwhile must not re-enable Confirm
    expect(p.$<HTMLButtonElement>('[data-reschedule-confirm]').disabled).toBe(true);

    sending.reject(new NetworkError());
    await vi.waitFor(() => expect(shown(p.$('[data-reschedule-error]'))).toBe(true));
    expect(p.$('[data-reschedule-error]').textContent).toBe(mg.errorText);
    for (const sel of ['[data-reschedule-confirm]', '[data-reschedule-open]', '[data-cancel-open]']) expect(p.$<HTMLButtonElement>(sel).disabled, sel).toBe(false);
    expect(shown(p.$('[data-notice]'))).toBe(false);
    expect(p.$('[data-when]').textContent).toBe('Monday, December 7, 9:00 AM EST'); // nothing moved
  });

  it('a time taken meanwhile loads fresh times, says so with the booking words, and waits for a new pick', async () => {
    const taken = fakeApi({
      reschedule: vi.fn(() => Promise.reject(new SlotTakenError())),
      getSlots: vi.fn<ManageApi['getSlots']>()
        .mockResolvedValueOnce({ slots: slotsOf(), calendarChecked: true })
        .mockResolvedValueOnce({ slots: slotsOf().slice(1), calendarChecked: true }),
    });
    const p = await toPicker(taken);
    p.$<HTMLElement>('[data-testid="slot"]').click();
    p.click('[data-reschedule-confirm]');
    await vi.waitFor(() => expect(shown(p.$('[data-reschedule-error]'))).toBe(true));
    expect(p.$('[data-reschedule-error]').textContent).toBe(b.errors.slotTaken);
    expect(taken.getSlots).toHaveBeenCalledTimes(2);
    expect(p.document.querySelectorAll('[data-testid="slot"]')).toHaveLength(5);
    expect(p.$<HTMLButtonElement>('[data-reschedule-confirm]').disabled).toBe(true);
    expect(p.$<HTMLButtonElement>('[data-reschedule-open]').disabled).toBe(false);
  });

  it('"too late" shows its text and takes the reschedule action away, while Cancel stays', async () => {
    const p = await toPicker(fakeApi({ reschedule: vi.fn(() => Promise.reject(new TooLateError())) }));
    p.$<HTMLElement>('[data-testid="slot"]').click();
    p.click('[data-reschedule-confirm]');
    await vi.waitFor(() => expect(shown(p.$('[data-notice]'))).toBe(true));
    expect(p.$('[data-notice]').textContent).toBe(mg.tooLateText);
    expect(shown(p.$('[data-reschedule-open]'))).toBe(false);
    expect(shown(p.$('[data-reschedule-panel]'))).toBe(false);
    expect(shown(p.$('[data-cancel-open]'))).toBe(true);
    expect(shown(p.$('[data-actions]'))).toBe(true);
  });

  it('times that cannot be loaded show the error text; opening again tries again', async () => {
    const getSlots = vi.fn<ManageApi['getSlots']>().mockRejectedValueOnce(new NetworkError()).mockResolvedValueOnce({ slots: slotsOf(), calendarChecked: true });
    const p = await open(found(), fakeApi({ getSlots }));
    p.click('[data-reschedule-open]');
    await vi.waitFor(() => expect(shown(p.$('[data-reschedule-error]'))).toBe(true));
    expect(p.$('[data-reschedule-error]').textContent).toBe(mg.errorText);
    expect(p.$<HTMLButtonElement>('[data-reschedule-open]').disabled).toBe(false);
    p.click('[data-reschedule-open]'); // close
    p.click('[data-reschedule-open]'); // open again
    await vi.waitFor(() => expect(p.document.querySelectorAll('[data-testid="slot"]').length).toBeGreaterThan(0));
    expect(shown(p.$('[data-reschedule-error]'))).toBe(false);
  });

  it('no times at all show the booking form\'s own "no times" text', async () => {
    const p = await open(found(), fakeApi({ getSlots: async () => ({ slots: [], calendarChecked: true }) }));
    p.click('[data-reschedule-open]');
    await vi.waitFor(() => expect(p.$('[data-slots]').textContent).toBe(b.noSlots));
  });
});
