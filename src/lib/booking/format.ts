import type { Slot } from './slots';

const clean = (s: string) => s.replace(/[\u202F\u00A0]/g, ' ');

/** e.g. "9:00 AM" in the visitor's time zone. */
export function formatSlotTime(slot: Slot, timeZone: string, locale = 'en-US'): string {
  return clean(new Intl.DateTimeFormat(locale, { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(slot.start)));
}

/** e.g. "Monday, November 23, 9:00 AM EST". */
export function formatSlotLong(slot: Slot, timeZone: string, locale = 'en-US'): string {
  const d = new Date(slot.start);
  const date = new Intl.DateTimeFormat(locale, { timeZone, weekday: 'long', month: 'long', day: 'numeric' }).format(d);
  const time = new Intl.DateTimeFormat(locale, { timeZone, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(d);
  return clean(`${date}, ${time}`);
}

/** Slots grouped by the visitor's local calendar day, in order. */
export function groupByLocalDay(slots: Slot[], timeZone: string, locale = 'en-US'): Array<{ day: string; label: string; slots: Slot[] }> {
  const key = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const label = new Intl.DateTimeFormat(locale, { timeZone, weekday: 'short', month: 'short', day: 'numeric' });
  const groups: Array<{ day: string; label: string; slots: Slot[] }> = [];
  for (const s of slots) {
    const d = new Date(s.start);
    const day = key.format(d);
    let g = groups[groups.length - 1];
    if (!g || g.day !== day) { g = { day, label: clean(label.format(d)), slots: [] }; groups.push(g); }
    g.slots.push(s);
  }
  return groups;
}
