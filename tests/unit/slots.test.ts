import { it, expect } from 'vitest';
import { generateSlots } from '../../src/lib/booking/slots';
const rules = { timeZone: 'Asia/Karachi', days: ['mon', 'tue', 'wed', 'thu', 'fri'] as const, windowStart: '19:00', windowEnd: '02:00',
  slotMinutes: 15, bufferMinutes: 5, minNoticeMinutes: 60, horizonDays: 14 };
const at = (iso: string) => new Date(iso);
const starts = (now: string, busy?: { start: string; end: string }[]) => generateSlots({ ...rules, days: [...rules.days] }, at(now), busy).map((s) => s.start);

it('a Monday window has 21 slots from 7:00 PM to 1:40 AM Pakistan time', () => {
  const mon = starts('2026-11-23T05:00:00Z').filter((s) => s < '2026-11-23T21:00:00.000Z');
  expect(mon).toHaveLength(21);
  expect(mon[0]).toBe('2026-11-23T14:00:00.000Z');
  expect(mon[20]).toBe('2026-11-23T20:40:00.000Z');
});
it('slots are 15 minutes long and 20 minutes apart', () => {
  const s = generateSlots({ ...rules, days: [...rules.days] }, at('2026-11-23T05:00:00Z'));
  expect(Date.parse(s[0].end) - Date.parse(s[0].start)).toBe(15 * 60_000);
  expect(Date.parse(s[1].start) - Date.parse(s[0].start)).toBe(20 * 60_000);
});
it('respects the 60-minute minimum notice', () => {
  expect(starts('2026-11-23T13:30:00Z')[0]).toBe('2026-11-23T14:40:00.000Z');
});
it("Friday's window runs past midnight into Saturday, Pakistan time", () => {
  expect(starts('2026-11-27T10:00:00Z')).toContain('2026-11-27T20:40:00.000Z');
});
it('no windows start on Saturday or Sunday', () => {
  expect(starts('2026-11-28T00:00:00Z')[0]).toBe('2026-11-30T14:00:00.000Z');
});
it('nothing beyond the 14-day horizon', () => {
  const now = '2026-11-23T05:00:00Z';
  expect(starts(now).every((s) => Date.parse(s) < Date.parse(now) + 14 * 86_400_000)).toBe(true);
});
it('busy time removes overlapping slots', () => {
  const s = starts('2026-11-23T05:00:00Z', [{ start: '2026-11-23T14:05:00.000Z', end: '2026-11-23T14:25:00.000Z' }]);
  expect(s).not.toContain('2026-11-23T14:00:00.000Z');
  expect(s).not.toContain('2026-11-23T14:20:00.000Z');
  expect(s).toContain('2026-11-23T14:40:00.000Z');
});
