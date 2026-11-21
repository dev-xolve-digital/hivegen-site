import { CalendarUnavailableError, type Calendar, type CalendarEventInput, type Interval } from '../booking/types';

export type FakeCalendar = Calendar & {
  /** While down, every method throws CalendarUnavailableError, as the real calendar does when Google cannot be reached. */
  setDown(down: boolean): void;
  /** What `busy` reports, for the part that overlaps the window asked about. */
  setBusy(busy: Interval[]): void;
  /** Every event made, by id (ev-1, ev-2, ...), kept after a cancel so tests can look at it. */
  events: Map<string, CalendarEventInput & { cancelled?: boolean }>;
};

/** A calendar kept in memory, for the test server's fake mode and for unit tests. */
export function createFakeCalendar(): FakeCalendar {
  let down = false;
  let busyTimes: Interval[] = [];
  let made = 0;
  const events: FakeCalendar['events'] = new Map();

  const available = () => { if (down) throw new CalendarUnavailableError(); };
  const find = (eventId: string) => {
    const e = events.get(eventId);
    if (!e) throw new Error(`event ${eventId} not found`);
    return e;
  };

  return {
    events,
    setDown(value) { down = value; },
    setBusy(busy) { busyTimes = busy.map((b) => ({ ...b })); },
    async busy(fromIso, toIso) {
      available();
      const from = Date.parse(fromIso), to = Date.parse(toIso);
      return busyTimes.filter((b) => Date.parse(b.start) < to && Date.parse(b.end) > from).map((b) => ({ ...b }));
    },
    async createEvent(e) {
      available();
      made += 1;
      const eventId = `ev-${made}`;
      events.set(eventId, structuredClone(e));
      return { eventId, meetUrl: `https://meet.google.com/fake-${made}` };
    },
    async moveEvent(eventId, start, end) {
      available();
      Object.assign(find(eventId), { start, end });
    },
    async cancelEvent(eventId) {
      available();
      find(eventId).cancelled = true;
    },
  };
}
