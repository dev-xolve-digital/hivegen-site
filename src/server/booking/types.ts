import type { Interval, Slot } from '../../lib/booking/slots';
export type BuyerType = 'agency' | 'videographer' | 'agent' | 'other';
export type PageVersion = 'main' | 'agencies' | 'videographers' | 'agents';
export type LeadStatus = 'started' | 'booked' | 'requested' | 'cancelled';
export type BookingStatus = 'booked' | 'requested' | 'cancelled';
export interface Attribution { utm_source?: string; utm_medium?: string; utm_campaign?: string; utm_term?: string; utm_content?: string; fbclid?: string; gclid?: string }
export interface NewLead {
  publicId: string; name: string; email: string; phone?: string; buyerType: BuyerType; volume: string;
  footageUrl?: string; pageVersion: PageVersion; attribution: Attribution; fbp?: string; fbc?: string; clientIp?: string; userAgent?: string;
}
export interface Lead extends NewLead { id: number; createdAt: Date; status: LeadStatus; newLeadNotifiedAt?: Date }
export interface NewBooking { leadId: number; start: string; end: string; visitorTz: string; status: BookingStatus; manageToken: string }
export interface Booking extends NewBooking {
  id: number; googleEventId?: string; meetUrl?: string; reminder24hSentAt?: Date; reminder1hSentAt?: Date;
  visitorNotifiedAt?: Date; hassanNotifiedAt?: Date; createdAt: Date; updatedAt: Date;
}
export type BookingPatch = Partial<Pick<Booking, 'start' | 'end' | 'status' | 'visitorTz' | 'googleEventId' | 'meetUrl'
  | 'reminder24hSentAt' | 'reminder1hSentAt' | 'visitorNotifiedAt' | 'hassanNotifiedAt'>>;
export interface TrackingRecord { eventId: string; name: string; leadId?: number; payload: unknown; status: 'pending' | 'sent' | 'failed' | 'skipped'; attempts: number; error?: string }
export class SlotConflictError extends Error { constructor() { super('slot_conflict'); this.name = 'SlotConflictError'; } }
export class CalendarUnavailableError extends Error { constructor(msg = 'calendar_unavailable') { super(msg); this.name = 'CalendarUnavailableError'; } }

/** Active = booked or requested. The store keeps a unique slot key (= start) only for active bookings. */
export interface Store {
  createLead(l: NewLead, now: Date): Promise<Lead>;
  getLead(id: number): Promise<Lead | null>;
  getLeadByPublicId(publicId: string): Promise<Lead | null>;
  updateLead(id: number, patch: { status?: LeadStatus; newLeadNotifiedAt?: Date }, now: Date): Promise<void>;
  insertBooking(b: NewBooking, now: Date): Promise<Booking>;                 // SlotConflictError if an active booking has this start
  updateBooking(id: number, patch: BookingPatch, now: Date): Promise<Booking>; // SlotConflictError when moved/reactivated onto a taken start
  getActiveBookingForLead(leadId: number): Promise<Booking | null>;
  getBookingByToken(token: string): Promise<Booking | null>;
  bookingsStartingBetween(fromIso: string, toIso: string): Promise<Booking[]>; // every status, ordered by start
  bookingsCreatedSince(iso: string): Promise<Booking[]>;
  leadsCreatedBetween(fromIso: string, toIso: string): Promise<Lead[]>;
  recordTrackingEvent(r: TrackingRecord, now: Date): Promise<void>;          // ignores a duplicate eventId
  updateTrackingEvent(eventId: string, patch: Partial<Pick<TrackingRecord, 'status' | 'attempts' | 'error'>>, now: Date): Promise<void>;
  trackingEventsByStatus(status: TrackingRecord['status']): Promise<TrackingRecord[]>;
}
export interface CalendarEventInput { start: string; end: string; summary: string; description: string; attendee: { email: string; name: string }; privateProps: Record<string, string> }
export interface Calendar {
  busy(fromIso: string, toIso: string): Promise<Interval[]>;               // CalendarUnavailableError on any failure
  createEvent(e: CalendarEventInput): Promise<{ eventId: string; meetUrl?: string }>;
  moveEvent(eventId: string, start: string, end: string): Promise<void>;
  cancelEvent(eventId: string): Promise<void>;
}
export type EmailKind = 'booking-confirmed' | 'booking-requested' | 'reminder-24h' | 'reminder-1h' | 'booking-cancelled'
  | 'booking-rescheduled' | 'hassan-new-booking' | 'hassan-confirm-by-hand' | 'hassan-new-lead' | 'hassan-booking-changed';
export interface EmailData { lead: Lead; booking?: Booking; previousStart?: string; change?: 'cancelled' | 'rescheduled' }
export interface Notifier { send(kind: EmailKind, data: EmailData): Promise<void> }  // throws on transport failure
export interface ServerEvent {
  name: 'PageView' | 'Lead' | 'Schedule'; eventId: string; time: Date; sourceUrl: string; leadId?: number;
  user: { email?: string; phone?: string; externalId?: string; ip?: string; userAgent?: string; fbp?: string; fbc?: string };
}
export interface Tracker { send(e: ServerEvent): Promise<void> }                     // never throws
export interface Clock { now(): Date }
export type ErrorCode = 'invalid' | 'rate_limited' | 'bot_check_failed' | 'slot_taken' | 'not_found' | 'too_late' | 'not_connected' | 'server_error';
export type FieldCode = 'required' | 'invalid' | 'too_long';
export type Result<T> = { ok: true; value: T } | { ok: false; error: ErrorCode; fields?: Record<string, FieldCode> };
export type { Interval, Slot };
