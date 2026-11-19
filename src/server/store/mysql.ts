import { createPool as createMysqlPool, type Pool, type ResultSetHeader, type RowDataPacket } from 'mysql2/promise';
import { applyBookingPatch } from '../booking/patch';
import { isActive } from '../booking/status';
import {
  SlotConflictError,
  type Booking, type BookingPatch, type Lead, type NewBooking, type NewLead, type Store, type TrackingRecord,
} from '../booking/types';

/**
 * The booking store on MySQL. It behaves exactly like the memory store: tests/contract/store.contract.ts runs against both.
 * Times are passed in by the caller and kept as UTC (the pool is created with timezone 'Z'); the database clock is never used.
 */

/** A pool for `mysql://user:password@host:port/database`. Few connections: a shared host allows each user only a handful. */
export function createPool(url: string): Pool {
  return createMysqlPool({ uri: url, timezone: 'Z', charset: 'utf8mb4', connectionLimit: 5 });
}

interface LeadRow extends RowDataPacket {
  id: number; public_id: string; name: string; email: string; phone: string | null; buyer_type: Lead['buyerType']; volume: string;
  footage_url: string | null; page_version: Lead['pageVersion']; attribution: string; fbp: string | null; fbc: string | null;
  client_ip: string | null; user_agent: string | null; status: Lead['status']; new_lead_notified_at: Date | null; created_at: Date;
}
interface BookingRow extends RowDataPacket {
  id: number; lead_id: number; start_utc: Date; end_utc: Date; visitor_tz: string; status: Booking['status']; manage_token: string;
  google_event_id: string | null; meet_url: string | null; reminder_24h_sent_at: Date | null; reminder_1h_sent_at: Date | null;
  visitor_notified_at: Date | null; hassan_notified_at: Date | null; created_at: Date; updated_at: Date;
}
interface TrackingRow extends RowDataPacket {
  event_id: string; name: string; lead_id: number | null; payload: string | null; status: TrackingRecord['status']; attempts: number; error: string | null;
}

/** A column that is NULL comes back as an absent field, never as null. */
const present = <T>(value: T | null): T | undefined => value ?? undefined;
/** The object without its `undefined` values, so an optional field is absent rather than set to undefined (as in the memory store). */
const defined = <T extends object>(value: T): T => Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;

const leadOf = (row: LeadRow): Lead => defined({
  id: row.id, publicId: row.public_id, name: row.name, email: row.email, phone: present(row.phone), buyerType: row.buyer_type, volume: row.volume,
  footageUrl: present(row.footage_url), pageVersion: row.page_version, attribution: JSON.parse(row.attribution) as Lead['attribution'],
  fbp: present(row.fbp), fbc: present(row.fbc), clientIp: present(row.client_ip), userAgent: present(row.user_agent),
  createdAt: row.created_at, status: row.status, newLeadNotifiedAt: present(row.new_lead_notified_at),
});

const bookingOf = (row: BookingRow): Booking => defined({
  id: row.id, leadId: row.lead_id, start: row.start_utc.toISOString(), end: row.end_utc.toISOString(), visitorTz: row.visitor_tz,
  status: row.status, manageToken: row.manage_token, googleEventId: present(row.google_event_id), meetUrl: present(row.meet_url),
  reminder24hSentAt: present(row.reminder_24h_sent_at), reminder1hSentAt: present(row.reminder_1h_sent_at),
  visitorNotifiedAt: present(row.visitor_notified_at), hassanNotifiedAt: present(row.hassan_notified_at),
  createdAt: row.created_at, updatedAt: row.updated_at,
});

const trackingOf = (row: TrackingRow): TrackingRecord => defined({
  eventId: row.event_id, name: row.name, leadId: present(row.lead_id), payload: row.payload === null ? undefined : (JSON.parse(row.payload) as unknown),
  status: row.status, attempts: row.attempts, error: present(row.error),
});

/**
 * What an active booking holds: its start (as the text of its DATETIME(3), 'YYYY-MM-DD HH:MM:SS.mmm') and its lead.
 * Both go in unique columns, so the database itself refuses a second active booking for the same start or the same lead.
 * A cancelled booking holds neither (NULL), so any number of them can share a start or a lead.
 */
function holds(b: { status: Booking['status']; start: string; leadId: number }): { slotKey: string | null; activeLeadId: number | null } {
  return isActive(b.status)
    ? { slotKey: new Date(b.start).toISOString().slice(0, 23).replace('T', ' '), activeLeadId: b.leadId }
    : { slotKey: null, activeLeadId: null };
}

/** MySQL 8 names the key 'bookings.slot_key', MySQL 5.7 and MariaDB just 'slot_key'. */
const HOLD_KEY = /for key '(?:\w+\.)?(?:slot_key|active_lead_id)'/;
/** A duplicate on one of the two unique "holds" keys is a SlotConflictError; any other error is passed on as it is. */
function conflictOr(error: unknown): unknown {
  const e = error as { errno?: number; sqlMessage?: string } | null;
  return e?.errno === 1062 && HOLD_KEY.test(e.sqlMessage ?? '') ? new SlotConflictError() : error;
}

export function createMysqlStore(pool: Pool): Store {
  const rows = async <R extends RowDataPacket>(sql: string, params: unknown[] = []): Promise<R[]> => (await pool.query<R[]>(sql, params))[0];
  const leadById = async (id: number): Promise<Lead | null> => {
    const [row] = await rows<LeadRow>('SELECT * FROM leads WHERE id = ?', [id]);
    return row ? leadOf(row) : null;
  };
  const bookingById = async (id: number): Promise<Booking> => {
    const [row] = await rows<BookingRow>('SELECT * FROM bookings WHERE id = ?', [id]);
    if (!row) throw new Error(`booking ${id} not found`);
    return bookingOf(row);
  };

  return {
    async createLead(l: NewLead, now: Date) {
      const [result] = await pool.query<ResultSetHeader>(
        `INSERT INTO leads (public_id, name, email, phone, buyer_type, volume, footage_url, page_version, attribution, fbp, fbc, client_ip, user_agent, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'started', ?)`,
        [l.publicId, l.name, l.email, l.phone ?? null, l.buyerType, l.volume, l.footageUrl ?? null, l.pageVersion, JSON.stringify(l.attribution ?? {}),
          l.fbp ?? null, l.fbc ?? null, l.clientIp ?? null, l.userAgent ?? null, now],
      );
      return (await leadById(result.insertId))!;
    },
    getLead: leadById,
    async getLeadByPublicId(publicId) {
      const [row] = await rows<LeadRow>('SELECT * FROM leads WHERE public_id = ?', [publicId]);
      return row ? leadOf(row) : null;
    },
    async updateLead(id, patch) {
      // An unknown id changes nothing. `undefined` keeps the stored value.
      const sets: string[] = [];
      const params: unknown[] = [];
      if (patch.status !== undefined) { sets.push('status = ?'); params.push(patch.status); }
      if (patch.newLeadNotifiedAt !== undefined) { sets.push('new_lead_notified_at = ?'); params.push(patch.newLeadNotifiedAt); }
      if (sets.length) await pool.query(`UPDATE leads SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
    },

    async insertBooking(b: NewBooking, now: Date) {
      const { slotKey, activeLeadId } = holds(b);
      try {
        const [result] = await pool.query<ResultSetHeader>(
          `INSERT INTO bookings (lead_id, start_utc, end_utc, visitor_tz, status, manage_token, slot_key, active_lead_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [b.leadId, new Date(b.start), new Date(b.end), b.visitorTz, b.status, b.manageToken, slotKey, activeLeadId, now, now],
        );
        return await bookingById(result.insertId);
      } catch (error) {
        throw conflictOr(error);
      }
    },
    async updateBooking(id, patch: BookingPatch, now: Date) {
      // Read, apply the patch in code (the same function as the memory store) and write back, in one transaction that holds the row.
      // A move onto a start (or a second active booking for a lead) is refused by the unique keys, which also settles simultaneous requests.
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [current] = (await connection.query<BookingRow[]>('SELECT * FROM bookings WHERE id = ? FOR UPDATE', [id]))[0];
        if (!current) throw new Error(`booking ${id} not found`);
        const next = applyBookingPatch(bookingOf(current), patch, now);
        const { slotKey, activeLeadId } = holds(next);
        await connection.query(
          `UPDATE bookings SET start_utc = ?, end_utc = ?, visitor_tz = ?, status = ?, google_event_id = ?, meet_url = ?,
             reminder_24h_sent_at = ?, reminder_1h_sent_at = ?, visitor_notified_at = ?, hassan_notified_at = ?,
             slot_key = ?, active_lead_id = ?, updated_at = ? WHERE id = ?`,
          [new Date(next.start), new Date(next.end), next.visitorTz, next.status, next.googleEventId ?? null, next.meetUrl ?? null,
            next.reminder24hSentAt ?? null, next.reminder1hSentAt ?? null, next.visitorNotifiedAt ?? null, next.hassanNotifiedAt ?? null,
            slotKey, activeLeadId, next.updatedAt, id],
        );
        const [saved] = (await connection.query<BookingRow[]>('SELECT * FROM bookings WHERE id = ?', [id]))[0];
        await connection.commit();
        return bookingOf(saved);
      } catch (error) {
        await connection.rollback().catch(() => {}); // nothing was written: a refused move leaves the booking as it was
        throw conflictOr(error);
      } finally {
        connection.release();
      }
    },
    async getActiveBookingForLead(leadId) {
      const [row] = await rows<BookingRow>("SELECT * FROM bookings WHERE lead_id = ? AND status IN ('booked', 'requested') ORDER BY id DESC LIMIT 1", [leadId]);
      return row ? bookingOf(row) : null;
    },
    async getBookingByToken(token) {
      const [row] = await rows<BookingRow>('SELECT * FROM bookings WHERE manage_token = ?', [token]);
      return row ? bookingOf(row) : null;
    },
    async bookingsStartingBetween(fromIso, toIso) {
      return (await rows<BookingRow>('SELECT * FROM bookings WHERE start_utc >= ? AND start_utc < ? ORDER BY start_utc, id', [new Date(fromIso), new Date(toIso)])).map(bookingOf);
    },
    async bookingsCreatedSince(iso) {
      return (await rows<BookingRow>('SELECT * FROM bookings WHERE created_at >= ? ORDER BY created_at, id', [new Date(iso)])).map(bookingOf);
    },
    async leadsCreatedBetween(fromIso, toIso) {
      return (await rows<LeadRow>('SELECT * FROM leads WHERE created_at >= ? AND created_at < ? ORDER BY created_at, id', [new Date(fromIso), new Date(toIso)])).map(leadOf);
    },

    async recordTrackingEvent(r, now) {
      // The no-op update on a duplicate keeps the first record, and (unlike INSERT IGNORE) still reports every other kind of error.
      await pool.query(
        `INSERT INTO tracking_events (event_id, name, lead_id, payload, status, attempts, error, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE event_id = event_id`,
        [r.eventId, r.name, r.leadId ?? null, r.payload === undefined ? null : JSON.stringify(r.payload), r.status, r.attempts, r.error ?? null, now, now],
      );
    },
    async updateTrackingEvent(eventId, patch, now) {
      // An unknown eventId changes nothing. `undefined` keeps the stored value.
      const sets = ['updated_at = ?'];
      const params: unknown[] = [now];
      if (patch.status !== undefined) { sets.push('status = ?'); params.push(patch.status); }
      if (patch.attempts !== undefined) { sets.push('attempts = ?'); params.push(patch.attempts); }
      if (patch.error !== undefined) { sets.push('error = ?'); params.push(patch.error); }
      await pool.query(`UPDATE tracking_events SET ${sets.join(', ')} WHERE event_id = ?`, [...params, eventId]);
    },
    async trackingEventsByStatus(status) {
      return (await rows<TrackingRow>('SELECT * FROM tracking_events WHERE status = ? ORDER BY id', [status])).map(trackingOf);
    },
  };
}
