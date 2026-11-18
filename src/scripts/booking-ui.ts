import type { BookingApi, BuyerType, LeadInput } from '../lib/booking/api-client';
import { SlotTakenError } from '../lib/booking/api-client';
import { formatSlotLong, formatSlotTime, groupByLocalDay } from '../lib/booking/format';
import type { Slot } from '../lib/booking/slots';

export interface BookingCopy {
  errors: { name: string; email: string; slotTaken: string; unreachable: string };
  timeNote: string; noSlots: string;
  confirmation: { text: string; nextSteps: string[]; calendarTitle: string };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const fill = (s: string, vars: Record<string, string>) => s.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);
const gcalDate = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');

function readUtm(): Record<string, string> {
  const out: Record<string, string> = {};
  new URLSearchParams(location.search).forEach((v, k) => { if (/^(utm_|gclid$|fbclid$)/.test(k)) out[k] = v; });
  return out;
}

export function initBooking(root: HTMLElement, api: BookingApi): void {
  const copy = JSON.parse(root.querySelector('[data-booking-copy]')!.textContent!) as BookingCopy;
  const $ = <T extends Element = HTMLElement>(sel: string) => root.querySelector<T & HTMLElement>(sel)!;
  const form = $<HTMLFormElement>('[data-step="details"]');
  const timeStep = $('[data-step="time"]');
  const done = $('[data-testid="booking-done"]');
  const days = $('[data-days]');
  const slotsBox = $('[data-slots]');
  const confirmBtn = $<HTMLButtonElement>('[data-confirm]');
  const formError = $('[data-form-error]');
  const timeError = $('[data-time-error]');
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const steps = root.querySelectorAll<HTMLElement>('[data-stepper] [data-n]');
  let leadId = '';
  let email = '';
  let chosen: Slot | null = null;

  const showStep = (n: 1 | 2 | 3) => {
    form.hidden = n !== 1; timeStep.hidden = n !== 2; done.hidden = n !== 3;
    steps.forEach((s) => s.classList.toggle('on', Number(s.dataset.n) <= Math.min(n, 2)));
  };
  const setError = (name: 'name' | 'email', on: boolean) => {
    const input = form.elements.namedItem(name) as HTMLInputElement;
    const msg = $(`[data-error="${name}"]`);
    msg.hidden = !on;
    msg.textContent = on ? copy.errors[name] : '';
    input.setAttribute('aria-invalid', String(on));
  };

  async function loadSlots() {
    timeError.hidden = true;
    const groups = groupByLocalDay(await api.getSlots(), tz);
    days.replaceChildren();
    slotsBox.replaceChildren();
    chosen = null;
    confirmBtn.disabled = true;
    if (groups.length === 0) { slotsBox.textContent = copy.noSlots; return; }
    const pickDay = (i: number) => {
      days.querySelectorAll('button').forEach((b, j) => b.setAttribute('aria-pressed', String(i === j)));
      slotsBox.replaceChildren(...groups[i].slots.map((s) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('data-testid', 'slot');
        b.setAttribute('aria-pressed', 'false');
        b.textContent = formatSlotTime(s, tz);
        b.addEventListener('click', () => {
          slotsBox.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
          chosen = s;
          confirmBtn.disabled = false;
        });
        return b;
      }));
      chosen = null;
      confirmBtn.disabled = true;
    };
    groups.forEach((g, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      const [wd, ...rest] = g.label.split(', ');
      b.innerHTML = `<span></span><b></b>`;
      b.querySelector('span')!.textContent = wd;
      b.querySelector('b')!.textContent = rest.join(', ');
      b.setAttribute('aria-label', g.label);
      b.addEventListener('click', () => pickDay(i));
      days.append(b);
    });
    pickDay(0);
  }

  form.noValidate = true;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const name = String(data.get('name') ?? '').trim();
    email = String(data.get('email') ?? '').trim();
    setError('name', !name);
    setError('email', !EMAIL.test(email));
    if (!name || !EMAIL.test(email)) {
      (form.querySelector('[aria-invalid="true"]') as HTMLElement | null)?.focus();
      return;
    }
    const input: LeadInput = {
      name, email,
      phone: String(data.get('phone') ?? '').trim() || undefined,
      buyerType: (String(data.get('buyer') ?? 'other') || 'other') as BuyerType,
      volume: String(data.get('volume') ?? ''),
      footageUrl: String(data.get('footage') ?? '').trim() || undefined,
      pageVersion: root.dataset.page ?? 'main',
      utm: readUtm(),
    };
    formError.hidden = true;
    try {
      leadId = (await api.createLead(input)).leadId;
      await loadSlots();
      showStep(2);
      $('[data-time-heading]').focus();
    } catch {
      formError.textContent = copy.errors.unreachable;
      formError.hidden = false;
    }
  });

  $('[data-back]').addEventListener('click', () => showStep(1));
  confirmBtn.addEventListener('click', async () => {
    if (!chosen) return;
    const slot = chosen;
    try {
      await api.confirm(leadId, slot);
    } catch (err) {
      timeError.textContent = err instanceof SlotTakenError ? copy.errors.slotTaken : copy.errors.unreachable;
      timeError.hidden = false;
      if (err instanceof SlotTakenError) await loadSlots();
      return;
    }
    const when = formatSlotLong(slot, tz);
    $('[data-done-text]').textContent = fill(copy.confirmation.text, { email });
    $('[data-done-steps]').replaceChildren(...copy.confirmation.nextSteps.map((s) => {
      const li = document.createElement('li');
      li.textContent = fill(s, { when });
      return li;
    }));
    const cal = new URL('https://calendar.google.com/calendar/render');
    cal.searchParams.set('action', 'TEMPLATE');
    cal.searchParams.set('text', copy.confirmation.calendarTitle);
    cal.searchParams.set('dates', `${gcalDate(slot.start)}/${gcalDate(slot.end)}`);
    $<HTMLAnchorElement>('[data-calendar]').href = cal.toString();
    showStep(3);
    done.focus();
  });

  $('[data-time-note]').textContent = fill(copy.timeNote, { timezone: tz.replace(/_/g, ' ') });
  showStep(1);
}
