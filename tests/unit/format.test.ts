import { it, expect } from 'vitest';
import { formatSlotTime, formatSlotLong, groupByLocalDay } from '../../src/lib/booking/format';
const slot = (start: string) => ({ start, end: new Date(Date.parse(start) + 15 * 60_000).toISOString() });
it('9:00 AM in New York in November', () => {
  expect(formatSlotTime(slot('2026-11-23T14:00:00.000Z'), 'America/New_York', 'en-US')).toBe('9:00 AM');
  expect(formatSlotLong(slot('2026-11-23T14:00:00.000Z'), 'America/New_York', 'en-US')).toBe('Monday, November 23, 9:00 AM EST');
});
it('10:00 AM after US daylight saving starts', () => {
  expect(formatSlotTime(slot('2027-03-15T14:00:00.000Z'), 'America/New_York', 'en-US')).toBe('10:00 AM');
});
it('Hawaii sees 4:00 AM', () => {
  expect(formatSlotTime(slot('2026-11-23T14:00:00.000Z'), 'Pacific/Honolulu', 'en-US')).toBe('4:00 AM');
});
it('groups by the visitor\'s local day', () => {
  const g = groupByLocalDay([slot('2026-11-23T14:00:00.000Z'), slot('2026-11-24T14:00:00.000Z')], 'America/New_York', 'en-US');
  expect(g.map((d) => d.label)).toEqual(['Mon, Nov 23', 'Tue, Nov 24']);
});
