import { describe, it, expect } from 'vitest';
import { createFakeCalendar } from '../../src/server/calendar/fake';
import { CalendarUnavailableError, type CalendarEventInput } from '../../src/server/booking/types';

const event: CalendarEventInput = {
  start: '2026-12-02T14:00:00.000Z', end: '2026-12-02T14:15:00.000Z', summary: 'HiveGen call · Zoë', description: 'Your call',
  attendee: { email: 'zoe@example.com', name: 'Zoë' }, privateProps: { leadId: 'abc' },
};

describe('fake calendar', () => {
  it('creates events with ids ev-1, ev-2 and Meet links fake-1, fake-2', async () => {
    const cal = createFakeCalendar();
    expect(await cal.createEvent(event)).toEqual({ eventId: 'ev-1', meetUrl: 'https://meet.google.com/fake-1' });
    expect(await cal.createEvent(event)).toEqual({ eventId: 'ev-2', meetUrl: 'https://meet.google.com/fake-2' });
    expect([...cal.events.keys()]).toEqual(['ev-1', 'ev-2']);
    expect(cal.events.get('ev-1')).toEqual(event);
  });

  it('moves and cancels events, which stay in the map for tests to look at', async () => {
    const cal = createFakeCalendar();
    await cal.createEvent(event);
    await cal.moveEvent('ev-1', '2026-12-02T14:20:00.000Z', '2026-12-02T14:35:00.000Z');
    expect(cal.events.get('ev-1')).toMatchObject({ start: '2026-12-02T14:20:00.000Z', end: '2026-12-02T14:35:00.000Z' });
    await cal.cancelEvent('ev-1');
    expect(cal.events.get('ev-1')?.cancelled).toBe(true);
    await expect(cal.moveEvent('ev-9', event.start, event.end)).rejects.toThrow(/not found/);
    await expect(cal.cancelEvent('ev-9')).rejects.toThrow(/not found/);
  });

  it('busy returns what setBusy gave, for the part that overlaps the window', async () => {
    const cal = createFakeCalendar();
    cal.setBusy([
      { start: '2026-12-02T14:00:00.000Z', end: '2026-12-02T14:15:00.000Z' },
      { start: '2026-12-20T14:00:00.000Z', end: '2026-12-20T14:15:00.000Z' },
    ]);
    expect(await cal.busy('2026-12-01T00:00:00.000Z', '2026-12-15T00:00:00.000Z')).toEqual([{ start: '2026-12-02T14:00:00.000Z', end: '2026-12-02T14:15:00.000Z' }]);
    expect(await cal.busy('2026-12-02T14:10:00.000Z', '2026-12-02T14:30:00.000Z')).toHaveLength(1);
    expect(await cal.busy('2026-12-02T14:15:00.000Z', '2026-12-02T14:30:00.000Z')).toEqual([]);
  });

  it('setDown(true) makes every method throw CalendarUnavailableError; setDown(false) brings it back', async () => {
    const cal = createFakeCalendar();
    await cal.createEvent(event);
    cal.setDown(true);
    for (const call of [
      () => cal.busy(event.start, event.end), () => cal.createEvent(event),
      () => cal.moveEvent('ev-1', event.start, event.end), () => cal.cancelEvent('ev-1'),
    ]) await expect(call()).rejects.toBeInstanceOf(CalendarUnavailableError);
    cal.setDown(false);
    expect(await cal.busy(event.start, event.end)).toEqual([]);
  });
});
