import type { BookingRules } from '../content/schemas';

export interface Slot { start: string; end: string }      // ISO 8601 UTC
export interface Interval { start: string; end: string }

const MIN = 60_000;
const DAY = 86_400_000;
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/** Offset of `timeZone` from UTC at the given instant, in minutes (e.g. +300 for Asia/Karachi). */
function offsetMinutes(instant: number, timeZone: string): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(new Date(instant))
    .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const m = name.match(/GMT([+-])(\d{2}):?(\d{2})?/);
  if (!m) return 0; // "GMT" alone means UTC
  const mins = Number(m[2]) * 60 + Number(m[3] ?? 0);
  return m[1] === '-' ? -mins : mins;
}

/** UTC milliseconds for a wall-clock time in `timeZone`. */
function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, timeZone: string): number {
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  let utc = asUtc - offsetMinutes(asUtc, timeZone) * MIN;
  const again = asUtc - offsetMinutes(utc, timeZone) * MIN; // settle across a DST change
  if (again !== utc) utc = again;
  return utc;
}

/** Today's calendar date in `timeZone` as [year, month, day]. */
function localDate(instant: number, timeZone: string): [number, number, number] {
  const s = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(instant));
  const [y, m, d] = s.split('-').map(Number);
  return [y, m, d];
}

const hm = (s: string) => s.split(':').map(Number) as [number, number];

export function generateSlots(rules: BookingRules, now: Date, busy: Interval[] = []): Slot[] {
  const nowMs = now.getTime();
  const earliest = nowMs + rules.minNoticeMinutes * MIN;
  const latest = nowMs + rules.horizonDays * DAY;
  const [sh, sm] = hm(rules.windowStart);
  const [eh, em] = hm(rules.windowEnd);
  const crossesMidnight = eh * 60 + em <= sh * 60 + sm;
  const step = (rules.slotMinutes + rules.bufferMinutes) * MIN;
  const length = rules.slotMinutes * MIN;
  const busyMs = busy.map((b) => [Date.parse(b.start), Date.parse(b.end)] as const);
  const [ty, tm, td] = localDate(nowMs, rules.timeZone);
  const out: Slot[] = [];

  for (let i = -1; i <= rules.horizonDays; i++) {
    const day = new Date(Date.UTC(ty, tm - 1, td + i));
    const [y, mo, d] = [day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate()];
    if (!rules.days.includes(WEEKDAYS[day.getUTCDay()])) continue;
    const winStart = zonedToUtc(y, mo, d, sh, sm, rules.timeZone);
    const endDay = crossesMidnight ? new Date(Date.UTC(y, mo - 1, d + 1)) : day;
    const winEnd = zonedToUtc(endDay.getUTCFullYear(), endDay.getUTCMonth() + 1, endDay.getUTCDate(), eh, em, rules.timeZone);
    for (let t = winStart; t + length <= winEnd; t += step) {
      if (t < earliest || t >= latest) continue;
      if (busyMs.some(([bs, be]) => t < be && t + length > bs)) continue;
      out.push({ start: new Date(t).toISOString(), end: new Date(t + length).toISOString() });
    }
  }
  return out;
}
