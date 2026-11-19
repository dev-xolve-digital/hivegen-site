import { formatSlotTime, groupByLocalDay } from '../lib/booking/format';
import type { Slot } from '../lib/booking/slots';

/**
 * Shows the offered times as a row of days (in the visitor's time zone) and the times of the chosen day under it.
 * `onPick` gets the time the visitor clicks, and null whenever the choice is cleared (new times, or another day).
 * With no times at all it shows `noSlotsText` instead.
 */
export function renderSlotPicker(
  days: HTMLElement, slotsBox: HTMLElement, slots: Slot[], tz: string, onPick: (s: Slot | null) => void, noSlotsText: string,
): void {
  const doc = days.ownerDocument;
  const groups = groupByLocalDay(slots, tz);
  days.replaceChildren();
  slotsBox.replaceChildren();
  onPick(null);
  if (groups.length === 0) { slotsBox.textContent = noSlotsText; return; }

  const pickDay = (i: number) => {
    days.querySelectorAll('button').forEach((b, j) => b.setAttribute('aria-pressed', String(i === j)));
    slotsBox.replaceChildren(...groups[i].slots.map((s) => {
      const b = doc.createElement('button');
      b.type = 'button';
      b.setAttribute('data-testid', 'slot');
      b.setAttribute('aria-pressed', 'false');
      b.textContent = formatSlotTime(s, tz);
      b.addEventListener('click', () => {
        slotsBox.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        onPick(s);
      });
      return b;
    }));
    onPick(null);
  };

  groups.forEach((g, i) => {
    const b = doc.createElement('button');
    b.type = 'button';
    const [weekday, ...rest] = g.label.split(', ');
    b.innerHTML = '<span></span> <b></b>'; // the space keeps the shown words apart for assistive technology
    b.querySelector('span')!.textContent = weekday;
    b.querySelector('b')!.textContent = rest.join(', ');
    b.setAttribute('aria-label', g.label);
    b.addEventListener('click', () => pickDay(i));
    days.append(b);
  });
  pickDay(0);
}
