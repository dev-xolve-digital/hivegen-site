import {
  BotCheckError, FieldsError, RateLimitedError, SlotTakenError,
  type Booked, type BookingApi, type BuyerType, type LeadInput,
} from '../lib/booking/api-client';
import { formatSlotLong } from '../lib/booking/format';
import { fillPlaceholders } from '../lib/text';
import type { Slot } from '../lib/booking/slots';
import { browserStorage, readAttribution } from './attribution';
import { cookie } from './cookie';
import { renderSlotPicker } from './slot-picker';

/** The wording the page hands the script (from booking.yaml, as JSON in the page). */
export interface BookingCopy {
  errors: {
    name: string; email: string; buyer: string; volume: string; phone: string; footage: string;
    slotTaken: string; unreachable: string; network: string; confirm: string; botCheck: string; rateLimited: string;
  };
  timeNote: string; noSlots: string;
  confirmation: { heading: string; text: string; nextSteps: string[]; calendarTitle: string };
  requested: { heading: string; text: string };
}

export interface BookingOptions {
  /** live: the real booking; demo: pretend (with its note); off: no booking, the offline card instead. */
  mode: 'live' | 'demo' | 'off';
  /** Gives the bot-check token for a lead. Rejects when it cannot. Left out in demo mode. */
  getBotToken?: () => Promise<string>;
  /** Tracking hooks, called in live mode only. */
  onLead?(eventId: string): void;
  onSchedule?(eventId: string, email: string): void;
}

type Field = 'name' | 'email' | 'phone' | 'buyer' | 'volume' | 'footage';
const FIELDS: Field[] = ['name', 'email', 'phone', 'buyer', 'volume', 'footage'];
/** The server's name for a field, and ours. */
const FIELD_OF_SERVER: Record<string, Field | undefined> = { name: 'name', email: 'email', phone: 'phone', buyerType: 'buyer', volume: 'volume', footageUrl: 'footage' };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const gcalDate = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
/** A link from the server is used only when it is a web address (or this page's own #book). */
const safeLink = (url: string) => (url.startsWith('#') || /^https?:\/\//i.test(url) ? url : '#book');
/** A tracking hook must never be able to break booking. */
const safely = (hook: () => void) => { try { hook(); } catch { /* tracking is best effort */ } };

export function initBooking(root: HTMLElement, api: BookingApi, opts: BookingOptions): void {
  const $ = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const flow = $('[data-flow]');
  if (opts.mode === 'off') {
    flow.hidden = true;
    $('[data-offline]').hidden = false;
    return;
  }
  if (opts.mode === 'demo') $('[data-demo-note]').hidden = false;

  const copy = JSON.parse($('[data-booking-copy]').textContent!) as BookingCopy;
  const doc = root.ownerDocument;
  const win = doc.defaultView!;
  const form = $<HTMLFormElement>('[data-step="details"]');
  const submitBtn = $<HTMLButtonElement>('[data-submit]');
  const timeStep = $('[data-step="time"]');
  const done = $('[data-testid="booking-done"]');
  const days = $('[data-days]');
  const slotsBox = $('[data-slots]');
  const confirmBtn = $<HTMLButtonElement>('[data-confirm]');
  const formError = $('[data-form-error]');
  const timeError = $('[data-time-error]');
  const calendarNote = $('[data-calendar-note]');
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const steps = root.querySelectorAll<HTMLElement>('[data-stepper] [data-n]');
  const live = opts.mode === 'live';

  let leadId = '';
  /** What the saved lead was made from: the same details again are the same lead. */
  let leadKey = '';
  let email = '';
  let chosen: Slot | null = null;
  let saving = false;
  let confirming = false;

  const showStep = (n: 1 | 2 | 3) => {
    form.hidden = n !== 1; timeStep.hidden = n !== 2; done.hidden = n !== 3;
    steps.forEach((s) => s.classList.toggle('on', Number(s.dataset.n) <= Math.min(n, 2)));
  };

  const control = (field: Field) => $(`[data-field="${field}"]`);
  const setError = (field: Field, on: boolean) => {
    const msg = $(`[data-error="${field}"]`);
    msg.hidden = !on;
    msg.textContent = on ? copy.errors[field] : '';
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

  async function loadSlots() {
    timeError.hidden = true;
    const { slots, calendarChecked } = await api.getSlots();
    calendarNote.hidden = calendarChecked;
    renderSlotPicker(days, slotsBox, slots, tz, (s) => { chosen = s; confirmBtn.disabled = !s; }, copy.noSlots);
  }

  /** The message for something that went wrong on step 1. `leadSaved`: the details are stored even though loading the times failed. */
  function failStep1(err: unknown, leadSaved: boolean) {
    if (err instanceof FieldsError) {
      const bad = Object.keys(err.fields).map((k) => FIELD_OF_SERVER[k]).filter((f): f is Field => f !== undefined);
      if (bad.length > 0) { flagFields(bad); return; }
    }
    formError.textContent = err instanceof BotCheckError ? copy.errors.botCheck
      : err instanceof RateLimitedError ? copy.errors.rateLimited
        : leadSaved ? copy.errors.unreachable : copy.errors.network;
    formError.hidden = false;
  }

  form.noValidate = true;
  submitBtn.disabled = false; // the page's button starts disabled: without this script a submit could only land in the URL
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (saving) return;
    email = value('email');
    const name = value('name');
    const buyer = value('buyer');
    const volume = value('volume');
    const bad: Field[] = [];
    if (!name) bad.push('name');
    if (!EMAIL.test(email)) bad.push('email');
    if (!buyer) bad.push('buyer');
    if (!volume) bad.push('volume');
    flagFields(bad);
    if (bad.length > 0) return;

    const input: LeadInput = {
      name, email,
      phone: value('phone') || undefined,
      buyerType: buyer as BuyerType,
      volume,
      footageUrl: value('footage') || undefined,
      pageVersion: root.dataset.page ?? 'main',
      attribution: readAttribution(browserStorage(win), Date.now()),
      fbp: cookie(doc, '_fbp'),
      fbc: cookie(doc, '_fbc'),
    };
    const key = JSON.stringify(input);
    formError.hidden = true;
    saving = true;
    submitBtn.disabled = true;
    let leadSaved = leadId !== '' && key === leadKey;
    try {
      if (!leadSaved) {
        let token = '';
        if (opts.getBotToken) {
          try { token = await opts.getBotToken(); } catch { throw new BotCheckError(); }
        }
        const lead = await api.createLead({ ...input, turnstileToken: token, website: value('website') });
        leadId = lead.leadId;
        leadKey = key;
        leadSaved = true;
        if (live) safely(() => opts.onLead?.(lead.eventId));
      }
      await loadSlots();
      showStep(2);
      $('[data-time-heading]').focus();
    } catch (err) {
      failStep1(err, leadSaved);
    } finally {
      saving = false;
      submitBtn.disabled = false;
    }
  });

  $('[data-back]').addEventListener('click', () => showStep(1));

  function showDone(booked: Booked) {
    const when = formatSlotLong(booked, tz);
    const requested = booked.status === 'requested';
    // A request is not a booking: its wording never promises one, and the calendar button and next steps wait for the confirmation.
    $('[data-done-heading]').textContent = requested ? copy.requested.heading : copy.confirmation.heading;
    $('[data-done-text]').textContent = fillPlaceholders(requested ? copy.requested.text : copy.confirmation.text, { email, when });
    $('[data-done-next]').hidden = requested;
    $('[data-done-steps]').replaceChildren(...copy.confirmation.nextSteps.map((s) => {
      const li = doc.createElement('li');
      li.textContent = fillPlaceholders(s, { when });
      return li;
    }));
    const calendar = $<HTMLAnchorElement>('[data-calendar]');
    calendar.hidden = requested;
    const cal = new URL('https://calendar.google.com/calendar/render');
    cal.searchParams.set('action', 'TEMPLATE');
    cal.searchParams.set('text', copy.confirmation.calendarTitle);
    cal.searchParams.set('dates', `${gcalDate(booked.start)}/${gcalDate(booked.end)}`);
    calendar.href = cal.toString();
    $<HTMLAnchorElement>('[data-manage]').href = safeLink(booked.manageUrl);
    showStep(3);
    done.focus();
  }

  confirmBtn.addEventListener('click', async () => {
    if (!chosen || confirming) return;
    const slot = chosen;
    confirming = true;
    confirmBtn.disabled = true;
    timeError.hidden = true;
    let booked: Booked;
    try {
      booked = await api.confirm(leadId, slot, tz);
    } catch (err) {
      confirming = false;
      const taken = err instanceof SlotTakenError;
      // A taken time means fresh times (and nothing picked); any other failure leaves the same time ready to try again.
      if (taken) await loadSlots().catch(() => {});
      else confirmBtn.disabled = false;
      timeError.textContent = taken ? copy.errors.slotTaken : err instanceof RateLimitedError ? copy.errors.rateLimited : copy.errors.confirm;
      timeError.hidden = false;
      return;
    }
    confirming = false;
    if (live) safely(() => opts.onSchedule?.(booked.eventId, email));
    showDone(booked);
  });

  $('[data-time-note]').textContent = fillPlaceholders(copy.timeNote, { timezone: tz.replace(/_/g, ' ') });
  showStep(1);
}
