import { describe, it, expect } from 'vitest';
import { toManageView } from '../../src/server/booking/manage-view';
import type { Booking, Lead } from '../../src/server/booking/types';

const lead: Lead = {
  id: 1, publicId: 'P'.repeat(22), name: 'Zoë O’Brien', email: 'zoe+ads@example.com', phone: '+1 (555) 010-2000', buyerType: 'agent', volume: '6–15',
  footageUrl: 'https://drive.google.com/x', pageVersion: 'agents', attribution: { utm_source: 'facebook' }, createdAt: new Date('2026-11-20T10:00:00Z'), status: 'booked',
};
const booking: Booking = {
  id: 7, leadId: 1, start: '2026-12-07T14:00:00.000Z', end: '2026-12-07T14:15:00.000Z', visitorTz: 'America/New_York', status: 'booked',
  manageToken: 'T'.repeat(43), meetUrl: 'https://meet.google.com/abc-defg-hij', googleEventId: 'ev1',
  createdAt: new Date('2026-11-20T10:00:00Z'), updatedAt: new Date('2026-11-20T10:00:00Z'),
};
const managed = (over: Partial<Booking> = {}, can = { canCancel: true, canReschedule: true }) => ({ booking: { ...booking, ...over }, lead, ...can });

describe('toManageView', () => {
  it('gives the call time formatted, with its zone, in the zone the visitor booked in', () => {
    expect(toManageView(managed()).when).toBe('Monday, December 7, 9:00 AM EST');
    expect(toManageView(managed({ visitorTz: 'Asia/Tokyo' })).when).toBe('Monday, December 7, 11:00 PM GMT+9');
    expect(toManageView(managed({ visitorTz: 'UTC' })).when).toBe('Monday, December 7, 2:00 PM UTC');
  });

  it('carries what the page needs, and what each action is allowed', () => {
    expect(toManageView(managed({}, { canCancel: true, canReschedule: false }))).toEqual({
      token: 'T'.repeat(43), status: 'booked', start: booking.start, end: booking.end, visitorTz: 'America/New_York',
      when: 'Monday, December 7, 9:00 AM EST', meetUrl: 'https://meet.google.com/abc-defg-hij', canCancel: true, canReschedule: false,
    });
  });

  it('never carries anything about the lead: the page source shows the visitor their own call only', () => {
    const view = toManageView(managed());
    const text = JSON.stringify(view);
    for (const secret of ['Zoë', 'zoe+ads', '555', 'drive.google.com', 'facebook', 'agents', 'ev1', lead.publicId]) expect(text).not.toContain(secret);
  });

  it('a Meet link is passed on only when it is an https address', () => {
    expect(toManageView(managed({ meetUrl: undefined })).meetUrl).toBeUndefined();
    for (const bad of ['javascript:alert(1)', 'http://meet.google.com/x', '//meet.google.com/x', 'meet.google.com/x', '']) {
      expect(toManageView(managed({ meetUrl: bad })).meetUrl, bad).toBeUndefined();
    }
  });
});
