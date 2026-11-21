import {
  BotCheckError, FieldsError, RateLimitedError,
  type BookingApi, type BuyerType, type InquiryInput,
} from '../lib/booking/api-client';
import { fillPlaceholders } from '../lib/text';
import { browserStorage, readAttribution } from './attribution';
import type { BookingSession } from './booking-ui';
import { cookie } from './cookie';

/** The wording the page hands the script (from booking.yaml, as JSON in the page). Its network, bot-check and rate-limit words are the booking form's own. */
export interface InquiryCopy {
  errors: { email: string; phone: string; footage: string; message: string; network: string; botCheck: string; rateLimited: string };
  done: { heading: string; text: string };
}

export interface InquiryOptions {
  /** live: the real thing; demo: pretend (nothing leaves the browser); off: no form at all. */
  mode: 'live' | 'demo' | 'off';
  /** Gives the bot-check token for one send. Rejects when it cannot. Left out in demo mode. */
  getBotToken?: () => Promise<string>;
  /** The tracking hook, called in live mode, and only when this visitor's Lead has not been reported yet. */
  onLead?(eventId: string): void;
  /** What the call flow and this form both know of the visitor. */
  session: BookingSession;
  /** One id per send (the server treats a repeat of it as the same inquiry). Tests give their own. */
  newRequestId?: () => string;
}

/** In page order. */
type Field = 'email' | 'name' | 'phone' | 'buyer' | 'volume' | 'needs' | 'footage' | 'message';
const FIELDS: Field[] = ['email', 'name', 'phone', 'buyer', 'volume', 'needs', 'footage', 'message'];
/** The server's name for a field, and ours. */
const FIELD_OF_SERVER: Record<string, Field | undefined> = {
  email: 'email', name: 'name', phone: 'phone', buyerType: 'buyer', volume: 'volume', needs: 'needs', footageUrl: 'footage', message: 'message',
};

/** The same rules as the server's (src/server/booking/validate.ts), so the visitor hears of a mistake before the send. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^[0-9 +()-]{6,30}$/;
const isWebLink = (v: string) => {
  if (v.length > 500) return false;
  try { const u = new URL(v); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; }
};
/** A tracking hook must never be able to break the form. */
const safely = (hook: () => void) => { try { hook(); } catch { /* tracking is best effort */ } };

/** A fresh id: a UUID, or (where the browser has none, as on a plain-http page) 16 random bytes as hex. Both are what the server accepts. */
function defaultRequestId(win: Window & typeof globalThis): () => string {
  return () => {
    if (typeof win.crypto.randomUUID === 'function') return win.crypto.randomUUID();
    return Array.from(win.crypto.getRandomValues(new Uint8Array(16)), (n) => n.toString(16).padStart(2, '0')).join('');
  };
}

/** Makes the "Send details" form work: the checks, the send (once per press, the same request again after a failure) and the thank-you. */
export function initInquiry(root: HTMLElement, api: BookingApi, opts: InquiryOptions): void {
  const $ = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const panel = $('[data-inquiry]');
  if (opts.mode === 'off') {
    panel.hidden = true;
    return;
  }

  const copy = JSON.parse($('[data-inquiry-copy]').textContent!) as InquiryCopy;
  const doc = root.ownerDocument;
  const win = doc.defaultView!;
  const form = $<HTMLFormElement>('[data-inquiry-form]');
  const submitBtn = $<HTMLButtonElement>('[data-inq-submit]');
  const done = $('[data-inquiry-done]');
  const formError = $('[data-inq-form-error]');
  const live = opts.mode === 'live';
  const { session } = opts;
  const newRequestId = opts.newRequestId ?? defaultRequestId(win);

  let sending = false;
  /** What the last failed send was made from, and its request id: the same details again are the same send. */
  let failedKey = '';
  let failedId = '';

  /** The input that holds a field's answer (a group of choices is its fieldset). */
  const control = (field: Field) => {
    const wrapper = $(`[data-inq-field="${field}"]`);
    return wrapper.matches('fieldset') ? wrapper : wrapper.querySelector<HTMLElement>('input, textarea')!;
  };
  const setError = (field: Field, on: boolean) => {
    const msg = $(`[data-inq-error="${field}"]`);
    msg.hidden = !on;
    // The page offers only valid choices, so the server can refuse a name, a choice or a need only when the page is out of date: no words of its own then.
    msg.textContent = on ? ((copy.errors as Record<string, string>)[field] ?? copy.errors.network) : '';
    control(field).setAttribute('aria-invalid', String(on));
  };
  /** Marks the fields that are wrong, and puts focus on the first of them (a group of choices gets its first choice). */
  const flagFields = (bad: Field[]) => {
    FIELDS.forEach((f) => setError(f, bad.includes(f)));
    const first = FIELDS.find((f) => bad.includes(f));
    if (!first) return;
    const target = control(first);
    (target.matches('fieldset') ? target.querySelector<HTMLElement>('input') : target)?.focus();
  };
  const value = (name: string) => ((form.elements.namedItem(name) as { value?: string } | null)?.value ?? '').trim();

  /** The message for something that went wrong while sending. */
  function failSend(err: unknown) {
    if (err instanceof FieldsError) {
      const bad = Object.keys(err.fields).map((k) => FIELD_OF_SERVER[k]).filter((f): f is Field => f !== undefined);
      if (bad.length > 0) { flagFields(bad); return; }
    }
    formError.textContent = err instanceof BotCheckError ? copy.errors.botCheck
      : err instanceof RateLimitedError ? copy.errors.rateLimited
        : copy.errors.network;
    formError.hidden = false;
  }

  function showDone(email: string) {
    $('[data-inq-done-heading]').textContent = copy.done.heading;
    $('[data-inq-done-text]').textContent = fillPlaceholders(copy.done.text, { email });
    form.hidden = true;
    done.hidden = false;
    done.focus();
  }

  form.noValidate = true; // our own messages, not the browser's
  submitBtn.disabled = false; // the page's button starts disabled: without this script a submit could only land in the URL
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (sending) return;
    const email = value('email');
    const phone = value('phone');
    const footage = value('footage');
    const bad: Field[] = [];
    if (!EMAIL.test(email)) bad.push('email');
    if (phone && !PHONE.test(phone)) bad.push('phone');
    if (footage && !isWebLink(footage)) bad.push('footage');
    flagFields(bad);
    if (bad.length > 0) return;

    // Only what was given goes along.
    const input: InquiryInput & { leadId?: string } = {
      email,
      pageVersion: root.dataset.page ?? 'main',
      attribution: readAttribution(browserStorage(win), Date.now()),
    };
    const name = value('name');
    const buyer = value('buyer');
    const volume = value('volume');
    const needs = Array.from(form.querySelectorAll<HTMLInputElement>('input[name="needs"]:checked'), (box) => box.value);
    const message = value('message');
    const fbp = cookie(doc, '_fbp');
    const fbc = cookie(doc, '_fbc');
    if (name) input.name = name;
    if (phone) input.phone = phone;
    if (buyer) input.buyerType = buyer as BuyerType;
    if (volume) input.volume = volume;
    if (needs.length > 0) input.needs = needs;
    if (footage) input.footageUrl = footage;
    if (message) input.message = message;
    if (fbp) input.fbp = fbp;
    if (fbc) input.fbc = fbc;
    if (session.leadId) input.leadId = session.leadId;

    const key = JSON.stringify(input);
    formError.hidden = true;
    sending = true;
    submitBtn.disabled = true;
    let requestId: string | undefined;
    try {
      let token = '';
      if (opts.getBotToken) {
        try { token = await opts.getBotToken(); } catch { throw new BotCheckError(); }
      }
      requestId = key === failedKey ? failedId : newRequestId();
      const { eventId } = await api.sendInquiry({ ...input, turnstileToken: token, website: value('website'), requestId });
      // One Lead per visitor: the call flow may have reported it already.
      if (live && !session.leadTracked) {
        session.leadTracked = true;
        safely(() => opts.onLead?.(eventId));
      }
      showDone(email);
    } catch (err) {
      if (requestId !== undefined) { failedKey = key; failedId = requestId; }
      failSend(err);
    } finally {
      sending = false;
      submitBtn.disabled = false;
    }
  });
}
