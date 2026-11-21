import { describe, it, expect, vi, afterEach } from 'vitest';
import { b, mainHtml, mount, renderBooking, type Mounted } from './helpers/booking-dom';
import { initInquiry, type InquiryOptions } from '../../src/scripts/inquiry-ui';
import type { BookingSession } from '../../src/scripts/booking-ui';
import { BotCheckError, FieldsError, NetworkError, RateLimitedError, type BookingApi } from '../../src/lib/booking/api-client';
import { captureAttribution } from '../../src/scripts/attribution';

const LEAD_ID = 'L'.repeat(22);
const inq = b.inquiry;

/** An api whose calls are spies; only the inquiry is ever called by this form. */
function fakeApi(send: BookingApi['sendInquiry'] = async () => ({ eventId: 'lead.x' })) {
  return {
    createLead: vi.fn<BookingApi['createLead']>(async () => { throw new Error('the inquiry form never makes a lead'); }),
    getSlots: vi.fn<BookingApi['getSlots']>(async () => { throw new Error('the inquiry form never asks for times'); }),
    confirm: vi.fn<BookingApi['confirm']>(async () => { throw new Error('the inquiry form never books'); }),
    sendInquiry: vi.fn<BookingApi['sendInquiry']>(send),
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** Request ids as a test wants them: req-1, req-2, … */
function requestIds() {
  let n = 0;
  return vi.fn(() => { n += 1; return `req-${n}`; });
}

const session = (over: Partial<BookingSession> = {}): BookingSession => ({ leadId: null, leadTracked: false, ...over });

async function open(api: BookingApi, opts: Partial<InquiryOptions> = {}, html?: string): Promise<Mounted & { session: BookingSession; newRequestId: ReturnType<typeof requestIds> }> {
  const m = mount(html ?? await mainHtml());
  const s = opts.session ?? session();
  const newRequestId = requestIds();
  m.$('[data-inquiry]').hidden = false; // as the switch shows it: a hidden panel cannot take focus
  initInquiry(m.root, api, { mode: 'live', newRequestId, ...opts, session: s });
  return Object.assign(m, { session: s, newRequestId });
}

const field = (m: Mounted, name: string) => m.$<HTMLInputElement>(`[data-inquiry-form] [name="${name}"]`);
interface Typed { email?: string; name?: string; phone?: string; footage?: string; message?: string; website?: string; buyer?: string; volume?: string; needs?: string[] }
function fill(m: Mounted, v: Typed) {
  for (const key of ['email', 'name', 'phone', 'footage', 'message', 'website'] as const) {
    if (v[key] !== undefined) field(m, key).value = v[key]!;
  }
  if (v.buyer !== undefined) m.$<HTMLInputElement>(`[data-inquiry-form] input[name="buyer"][value="${v.buyer}"]`).checked = true;
  if (v.volume !== undefined) m.$<HTMLInputElement>(`[data-inquiry-form] input[name="volume"][value="${v.volume}"]`).checked = true;
  for (const need of v.needs ?? []) m.$<HTMLInputElement>(`[data-inquiry-form] input[name="needs"][value="${need}"]`).checked = true;
}
const send = (m: Mounted) => m.$<HTMLButtonElement>('[data-inq-submit]').click();
const errorOf = (m: Mounted, f: string) => m.$(`[data-inq-error="${f}"]`);
const wrapperOf = (m: Mounted, f: string) => m.$(`[data-inq-field="${f}"]`);
const formError = (m: Mounted) => m.$('[data-inq-form-error]');
const isDone = (m: Mounted) => !m.$('[data-inquiry-done]').hidden;

afterEach(() => { vi.restoreAllMocks(); });

describe('the Send details form: what is checked', () => {
  it.each([['empty', ''], ['not an address', 'nope']])('only the email is required (%s): it is the one error, with its own words, and nothing is sent', async (_name, email) => {
    const api = fakeApi();
    const m = await open(api);
    fill(m, { email });
    send(m);
    expect(errorOf(m, 'email').hidden).toBe(false);
    expect(errorOf(m, 'email').textContent).toBe(inq.errors.email);
    expect(field(m, 'email').getAttribute('aria-invalid')).toBe('true');
    expect(m.document.activeElement).toBe(field(m, 'email'));
    for (const other of ['name', 'phone', 'buyer', 'volume', 'needs', 'footage', 'message']) expect(errorOf(m, other).hidden).toBe(true);
    expect(api.sendInquiry).not.toHaveBeenCalled();
  });

  it('the optional fields are checked when they are filled: a phone number and a footage link', async () => {
    const api = fakeApi();
    const m = await open(api);
    fill(m, { email: 'v@example.com', phone: 'abc', footage: 'ftp://x' });
    send(m);
    expect(errorOf(m, 'phone').textContent).toBe(inq.errors.phone);
    expect(errorOf(m, 'footage').textContent).toBe(inq.errors.footage);
    expect(errorOf(m, 'email').hidden).toBe(true);
    expect(m.document.activeElement).toBe(field(m, 'phone'));
    expect(api.sendInquiry).not.toHaveBeenCalled();

    // Fixing them clears the messages and sends.
    fill(m, { phone: '+1 (555) 010-2000', footage: 'https://drive.google.com/x' });
    send(m);
    await vi.waitFor(() => expect(api.sendInquiry).toHaveBeenCalledTimes(1));
    expect(errorOf(m, 'phone').hidden).toBe(true);
    expect(errorOf(m, 'footage').hidden).toBe(true);
  });

  it('a message that is too long cannot be typed (the box has a limit); the server\'s "too_long" is the message error', async () => {
    expect(field(await open(fakeApi()), 'message').maxLength).toBe(2000);
    const api = fakeApi(async () => { throw new FieldsError({ message: 'too_long' }); });
    const m = await open(api);
    fill(m, { email: 'v@example.com', message: 'hello' });
    send(m);
    await vi.waitFor(() => expect(errorOf(m, 'message').hidden).toBe(false));
    expect(errorOf(m, 'message').textContent).toBe(inq.errors.message);
    expect(m.document.activeElement).toBe(field(m, 'message'));
  });
});

describe('the Send details form: free text is cleaned, and a refusal gets words that fit the field', () => {
  it('a name has a limit the box enforces, like the message', async () => {
    expect(field(await open(fakeApi()), 'name').maxLength).toBe(100);
  });

  it('a pasted tab (or any control character) in the name becomes one space, and the name is sent cleaned', async () => {
    const api = fakeApi();
    const m = await open(api);
    fill(m, { email: 'v@example.com', name: 'Zoë\tO’Brien' });
    send(m);
    await vi.waitFor(() => expect(api.sendInquiry).toHaveBeenCalledTimes(1));
    expect(api.sendInquiry.mock.calls[0][0].name).toBe('Zoë O’Brien');
    await vi.waitFor(() => expect(isDone(m)).toBe(true));

    // A run of controls is one space; at the ends they only go.
    const run = fakeApi();
    const n = await open(run);
    fill(n, { email: 'v@example.com', name: '\u0001Zoë\t\u0002\u0007O’Brien\u007f' });
    send(n);
    await vi.waitFor(() => expect(run.sendInquiry).toHaveBeenCalledTimes(1));
    expect(run.sendInquiry.mock.calls[0][0].name).toBe('Zoë O’Brien');

    // A name that was only controls is not given at all.
    const none = fakeApi();
    const o = await open(none);
    fill(o, { email: 'v@example.com', name: '\u0001\u0002' });
    send(o);
    await vi.waitFor(() => expect(none.sendInquiry).toHaveBeenCalledTimes(1));
    expect(none.sendInquiry.mock.calls[0][0]).not.toHaveProperty('name');
  });

  it('a soft line break (a PowerPoint paste) or form feed in the message becomes a line break, other control characters go, and it is sent cleaned', async () => {
    const api = fakeApi();
    const m = await open(api);
    fill(m, { email: 'v@example.com', message: 'Line one\u000bLine two\fLine three\u0001\u0008 ends\u007f\nand a real break\ttab kept' });
    send(m);
    await vi.waitFor(() => expect(api.sendInquiry).toHaveBeenCalledTimes(1));
    expect(api.sendInquiry.mock.calls[0][0].message).toBe('Line one\nLine two\nLine three ends\nand a real break\ttab kept');
    await vi.waitFor(() => expect(isDone(m)).toBe(true));

    // A message that was only controls is not given at all.
    const none = fakeApi();
    const o = await open(none);
    fill(o, { email: 'v@example.com', message: '\u0001\u0002' });
    send(o);
    await vi.waitFor(() => expect(none.sendInquiry).toHaveBeenCalledTimes(1));
    expect(none.sendInquiry.mock.calls[0][0]).not.toHaveProperty('message');
  });

  it.each([['invalid'], ['too_long']] as const)('a name the server still refuses (%s) says so under the Name field, not the connection words', async (code) => {
    const m = await open(fakeApi(async () => { throw new FieldsError({ name: code }); }));
    fill(m, { email: 'v@example.com', name: 'Zoë' });
    send(m);
    await vi.waitFor(() => expect(errorOf(m, 'name').hidden).toBe(false));
    expect(errorOf(m, 'name').textContent).toBe(inq.errors.name);
    expect(errorOf(m, 'name').textContent).not.toBe(b.errors.network);
    expect(m.document.activeElement).toBe(field(m, 'name'));
    expect(formError(m).hidden).toBe(true);
  });

  it('a message the server still refuses for a control character keeps the message wording', async () => {
    const m = await open(fakeApi(async () => { throw new FieldsError({ message: 'invalid' }); }));
    fill(m, { email: 'v@example.com', message: 'hello' });
    send(m);
    await vi.waitFor(() => expect(errorOf(m, 'message').hidden).toBe(false));
    expect(errorOf(m, 'message').textContent).toBe(inq.errors.message);
  });
});

describe('the Send details form: what is sent', () => {
  it('sends what was given and nothing else: the trimmed name, the needs in page order, the page, the ad tags, the cookies, the honeypot, the token and the request id', async () => {
    const api = fakeApi();
    const m = mount(await mainHtml());
    m.$('[data-inquiry]').hidden = false;
    captureAttribution(new URL('https://hivegen.test/?utm_source=facebook&fbclid=abc'), m.window.localStorage, Date.now());
    m.document.cookie = '_fbp=fb.1.111.222';
    m.document.cookie = '_fbc=fb.1.333.abc';
    initInquiry(m.root, api, { mode: 'live', getBotToken: async () => 'test-token', session: session(), newRequestId: requestIds() });
    // "Reels for social" is picked first, but "Listing videos" comes first on the page.
    fill(m, {
      email: ' v@example.com ', name: '  Zoë O’Brien  ', phone: '+1 (555) 010-2000', buyer: 'agent', volume: '6–15',
      needs: [inq.needOptions[1], inq.needOptions[0]], footage: 'https://drive.google.com/x', message: 'Line one\nLine two', website: 'http://spam.example',
    });
    send(m);
    await vi.waitFor(() => expect(api.sendInquiry).toHaveBeenCalledTimes(1));
    expect(api.sendInquiry.mock.calls[0][0]).toStrictEqual({
      email: 'v@example.com', name: 'Zoë O’Brien', phone: '+1 (555) 010-2000', buyerType: 'agent', volume: '6–15',
      needs: [inq.needOptions[0], inq.needOptions[1]], footageUrl: 'https://drive.google.com/x', message: 'Line one\nLine two',
      pageVersion: 'main', attribution: { utm_source: 'facebook', fbclid: 'abc' }, fbp: 'fb.1.111.222', fbc: 'fb.1.333.abc',
      website: 'http://spam.example', turnstileToken: 'test-token', requestId: 'req-1',
    });
  });

  it('leaves out every optional field that was not filled, and has no leadId when there is no call-flow lead', async () => {
    const api = fakeApi();
    const m = await open(api);
    fill(m, { email: 'v@example.com', name: '   ' });
    send(m);
    await vi.waitFor(() => expect(api.sendInquiry).toHaveBeenCalledTimes(1));
    expect(api.sendInquiry.mock.calls[0][0]).toStrictEqual({
      email: 'v@example.com', pageVersion: 'main', attribution: {}, website: '', turnstileToken: '', requestId: 'req-1',
    });
  });

  it('the version page sends its own version, and its preselected buyer type counts as chosen', async () => {
    const api = fakeApi();
    const m = await open(api, {}, await renderBooking('agents'));
    fill(m, { email: 'v@example.com' });
    send(m);
    await vi.waitFor(() => expect(api.sendInquiry).toHaveBeenCalled());
    expect(api.sendInquiry.mock.calls[0][0]).toMatchObject({ pageVersion: 'agents', buyerType: 'agent' });
  });

  it('sends the call flow\'s lead id when there is one', async () => {
    const api = fakeApi();
    const m = await open(api, { session: session({ leadId: LEAD_ID }) });
    fill(m, { email: 'v@example.com' });
    send(m);
    await vi.waitFor(() => expect(api.sendInquiry).toHaveBeenCalledTimes(1));
    expect(api.sendInquiry.mock.calls[0][0].leadId).toBe(LEAD_ID);
  });

  it('the bot check\'s token comes from getBotToken, and a token that never comes is a bot-check error with nothing sent', async () => {
    const api = fakeApi();
    const m = await open(api, { getBotToken: () => Promise.reject(new Error('turnstile_timeout')) });
    fill(m, { email: 'v@example.com' });
    send(m);
    await vi.waitFor(() => expect(formError(m).hidden).toBe(false));
    expect(formError(m).textContent).toBe(b.errors.botCheck);
    expect(api.sendInquiry).not.toHaveBeenCalled();
    expect(m.$<HTMLButtonElement>('[data-inq-submit]').disabled).toBe(false);
  });
});

describe('the Send details form: pressing the button', () => {
  it('takes the form over: no browser bubbles, and the button (disabled in the page) works', async () => {
    const m = await open(fakeApi());
    expect(m.$('[data-inq-submit]').hasAttribute('disabled')).toBe(false);
    expect(m.$<HTMLFormElement>('[data-inquiry-form]').noValidate).toBe(true);
  });

  it('a second press while sending does nothing', async () => {
    const sending = deferred<{ eventId: string }>();
    const api = fakeApi(() => sending.promise);
    const m = await open(api);
    fill(m, { email: 'v@example.com' });
    const button = m.$<HTMLButtonElement>('[data-inq-submit]');
    send(m);
    expect(button.disabled).toBe(true);
    send(m); // a click on a disabled button does nothing...
    m.$<HTMLFormElement>('[data-inquiry-form]').dispatchEvent(new m.window.Event('submit', { cancelable: true, bubbles: true })); // ...and so does a stray submit
    await Promise.resolve();
    expect(api.sendInquiry).toHaveBeenCalledTimes(1);
    sending.resolve({ eventId: 'lead.x' });
    await vi.waitFor(() => expect(isDone(m)).toBe(true));
    expect(api.sendInquiry).toHaveBeenCalledTimes(1);
  });

  it('a failed send keeps everything, and sending again is the same request; changed details are a new one', async () => {
    let fail = true;
    const api = fakeApi(async () => { if (fail) throw new NetworkError(); return { eventId: 'lead.x' }; });
    const m = await open(api);
    fill(m, { email: 'v@example.com', name: 'Zoë', buyer: 'agent', needs: [inq.needOptions[2]], message: 'Hello' });
    send(m);
    await vi.waitFor(() => expect(formError(m).hidden).toBe(false));
    expect(formError(m).textContent).toBe(b.errors.network);
    expect(isDone(m)).toBe(false);
    expect(m.$<HTMLFormElement>('[data-inquiry-form]').hidden).toBe(false);
    expect(field(m, 'email').value).toBe('v@example.com');
    expect(field(m, 'message').value).toBe('Hello');
    expect(m.$<HTMLInputElement>('[data-inquiry-form] input[name="buyer"][value="agent"]').checked).toBe(true);
    expect(m.$<HTMLInputElement>(`[data-inquiry-form] input[name="needs"][value="${inq.needOptions[2]}"]`).checked).toBe(true);
    expect(m.$<HTMLButtonElement>('[data-inq-submit]').disabled).toBe(false);

    const button = m.$<HTMLButtonElement>('[data-inq-submit]');
    send(m); // the same details again
    await vi.waitFor(() => expect(api.sendInquiry).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(button.disabled).toBe(false)); // the second failure has been handled
    expect(api.sendInquiry.mock.calls.map(([i]) => i.requestId)).toEqual(['req-1', 'req-1']);

    fill(m, { email: 'w@example.com' }); // other details are another send
    send(m);
    await vi.waitFor(() => expect(api.sendInquiry).toHaveBeenCalledTimes(3));
    await vi.waitFor(() => expect(button.disabled).toBe(false));
    expect(api.sendInquiry.mock.calls[2][0].requestId).toBe('req-2');
    expect(m.newRequestId).toHaveBeenCalledTimes(2);

    fail = false;
    send(m); // and that one, retried, keeps its own id and goes through
    await vi.waitFor(() => expect(isDone(m)).toBe(true));
    expect(api.sendInquiry.mock.calls[3][0].requestId).toBe('req-2');
  });

  it('a request id is made when none is given: a uuid, or 16 random bytes as hex where the browser has no randomUUID', async () => {
    const api = fakeApi();
    const m = mount(await mainHtml());
    initInquiry(m.root, api, { mode: 'live', session: session() });
    fill(m, { email: 'v@example.com' });
    send(m);
    await vi.waitFor(() => expect(api.sendInquiry).toHaveBeenCalledTimes(1));
    expect(api.sendInquiry.mock.calls[0][0].requestId).toMatch(/^[A-Za-z0-9-]{8,64}$/); // what the server accepts

    const older = mount(await mainHtml());
    const getRandomValues = vi.fn(<T extends ArrayBufferView | null>(bytes: T) => { (bytes as unknown as Uint8Array).fill(0xab); return bytes; });
    Object.defineProperty(older.window, 'crypto', { value: { getRandomValues }, configurable: true });
    const olderApi = fakeApi();
    initInquiry(older.root, olderApi, { mode: 'live', session: session() });
    fill(older, { email: 'v@example.com' });
    send(older);
    await vi.waitFor(() => expect(olderApi.sendInquiry).toHaveBeenCalledTimes(1));
    expect(olderApi.sendInquiry.mock.calls[0][0].requestId).toBe('ab'.repeat(16));
    expect(getRandomValues).toHaveBeenCalledTimes(1);
  });
});

describe('the Send details form: what the server answers', () => {
  it('fields it refuses land on the right fields, the first of them gets focus, and the button works again', async () => {
    const api = fakeApi(async () => { throw new FieldsError({ footageUrl: 'invalid', buyerType: 'invalid', needs: 'invalid' }); });
    const m = await open(api);
    fill(m, { email: 'v@example.com', footage: 'https://drive.google.com/x' });
    send(m);
    await vi.waitFor(() => expect(errorOf(m, 'footage').hidden).toBe(false));
    expect(errorOf(m, 'footage').textContent).toBe(inq.errors.footage);
    // The page only offers valid choices, so there are no words for these: the form's own failure message stands in.
    for (const f of ['buyer', 'needs']) {
      expect(errorOf(m, f).hidden).toBe(false);
      expect(errorOf(m, f).textContent).toBe(b.errors.network);
      expect(wrapperOf(m, f).getAttribute('aria-invalid')).toBe('true');
    }
    expect(field(m, 'footage').getAttribute('aria-invalid')).toBe('true');
    for (const f of ['email', 'name', 'phone', 'volume', 'message']) expect(errorOf(m, f).hidden).toBe(true);
    expect(m.document.activeElement).toBe(m.$('[data-inquiry-form] input[name="buyer"]'));
    expect(m.$<HTMLButtonElement>('[data-inq-submit]').disabled).toBe(false);
  });

  it.each([
    ['a failed bot check', new BotCheckError(), b.errors.botCheck],
    ['a rate limit', new RateLimitedError(), b.errors.rateLimited],
    ['a server that cannot be reached', new NetworkError(), b.errors.network],
    ['a server that answers something unexpected', new FieldsError({ pageVersion: 'invalid' }), b.errors.network],
  ])('%s shows its own message under the button', async (_name, error, message) => {
    const m = await open(fakeApi(async () => { throw error; }));
    fill(m, { email: 'v@example.com' });
    send(m);
    await vi.waitFor(() => expect(formError(m).hidden).toBe(false));
    expect(formError(m).textContent).toBe(message);
    expect(m.$<HTMLButtonElement>('[data-inq-submit]').disabled).toBe(false);
  });

  it('success shows the thank-you, with the address the visitor typed, and the form goes', async () => {
    const m = await open(fakeApi());
    fill(m, { email: ' v@example.com ' });
    send(m);
    await vi.waitFor(() => expect(isDone(m)).toBe(true));
    expect(m.$<HTMLFormElement>('[data-inquiry-form]').hidden).toBe(true);
    expect(m.document.activeElement).toBe(m.$('[data-inquiry-done]'));
    expect(m.$('[data-inq-done-heading]').textContent).toBe(inq.done.heading);
    expect(m.$('[data-inq-done-text]').textContent).toBe("We'll reply to v@example.com, usually within a day.");
  });

  it('an address that looks like a placeholder is shown as typed, not filled in again', async () => {
    const m = await open(fakeApi());
    fill(m, { email: '{email}@example.com' });
    send(m);
    await vi.waitFor(() => expect(isDone(m)).toBe(true));
    expect(m.$('[data-inq-done-text]').textContent).toContain('{email}@example.com');
  });
});

describe('the Send details form: the Lead', () => {
  it('is reported once per page, in live mode only', async () => {
    const onLead = vi.fn();
    const fresh = session();
    const m = await open(fakeApi(async () => ({ eventId: 'lead.x' })), { onLead, session: fresh });
    fill(m, { email: 'v@example.com' });
    send(m);
    await vi.waitFor(() => expect(isDone(m)).toBe(true));
    expect(onLead).toHaveBeenCalledTimes(1);
    expect(onLead).toHaveBeenCalledWith('lead.x');
    expect(fresh.leadTracked).toBe(true);

    // The call flow already reported this visitor's Lead: the form does not report a second one.
    const again = vi.fn();
    const tracked = await open(fakeApi(), { onLead: again, session: session({ leadId: LEAD_ID, leadTracked: true }) });
    fill(tracked, { email: 'v@example.com' });
    send(tracked);
    await vi.waitFor(() => expect(isDone(tracked)).toBe(true));
    expect(again).not.toHaveBeenCalled();
  });

  it('a hook that throws breaks nothing', async () => {
    const m = await open(fakeApi(), { onLead: () => { throw new Error('tracker down'); } });
    fill(m, { email: 'v@example.com' });
    send(m);
    await vi.waitFor(() => expect(isDone(m)).toBe(true));
  });

  it('a pretend send is never reported', async () => {
    const onLead = vi.fn();
    const fresh = session();
    const m = await open(fakeApi(), { mode: 'demo', onLead, session: fresh });
    fill(m, { email: 'v@example.com' });
    send(m);
    await vi.waitFor(() => expect(isDone(m)).toBe(true));
    expect(onLead).not.toHaveBeenCalled();
    expect(fresh.leadTracked).toBe(false);
  });
});

describe('the Send details form: off mode', () => {
  it('nothing starts: the panel is hidden and a press sends nothing', async () => {
    const api = fakeApi();
    const m = await open(api, { mode: 'off' });
    expect(m.$('[data-inquiry]').hidden).toBe(true);
    expect(m.$<HTMLButtonElement>('[data-inq-submit]').disabled).toBe(true); // as the page left it
    fill(m, { email: 'v@example.com' });
    m.$<HTMLFormElement>('[data-inquiry-form]').dispatchEvent(new m.window.Event('submit', { cancelable: true, bubbles: true }));
    await Promise.resolve();
    expect(api.sendInquiry).not.toHaveBeenCalled();
  });
});
