import { randomUUID } from 'node:crypto';
import { CalendarUnavailableError, type Calendar, type CalendarEventInput, type Interval } from '../booking/types';

/**
 * Google Calendar over plain REST (no Google SDK), and the sign-in helpers the one-time connect script uses.
 * Error messages are short fixed reasons such as `google freeBusy 503`: never tokens, the client secret or event details.
 */
export type GoogleCalendarConfig = { clientId: string; clientSecret: string; refreshToken: string; calendarId: string };
export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const API = 'https://www.googleapis.com/calendar/v3';
/** A token is renewed this long before Google says it expires. */
const REFRESH_MARGIN_MS = 60_000;

export const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.freebusy'] as const;
/** Where Google sends the visitor back to the connect script, which listens on this address only. */
export const CONNECT_REDIRECT_URI = 'http://127.0.0.1:53682/callback';

/** Google's own error word from a failed token answer (e.g. invalid_grant): short and fixed, so safe to show. */
async function errorCode(res: Response): Promise<string | undefined> {
  try {
    const code = ((await res.json()) as { error?: unknown }).error;
    return typeof code === 'string' && /^[a-z_]{1,40}$/.test(code) ? code : undefined;
  } catch {
    return undefined;
  }
}

const form = (fields: Record<string, string>) => ({
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(fields).toString(),
});

/** The address that asks Hassan's Google account for calendar access; `prompt=consent` + offline is what makes Google return a refresh token. */
export function consentUrl(clientId: string, state?: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: CONNECT_REDIRECT_URI,
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
  });
  if (state) params.set('state', state);
  return `${AUTH_URL}?${params}`;
}

/** Trades the code Google sent to the callback for the long-lived refresh token. Throws a plain Error with a short reason. */
export async function exchangeAuthCode(client: { clientId: string; clientSecret: string }, code: string, fetchFn: FetchFn = fetch, timeoutMs = 8000): Promise<string> {
  let res: Response;
  try {
    res = await fetchFn(TOKEN_URL, {
      ...form({ client_id: client.clientId, client_secret: client.clientSecret, code, redirect_uri: CONNECT_REDIRECT_URI, grant_type: 'authorization_code' }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new Error('Could not reach Google to finish the sign-in. Check the internet connection and run it again.');
  }
  if (!res.ok) {
    const reason = await errorCode(res);
    throw new Error(`Google refused the sign-in (${res.status}${reason ? ` ${reason}` : ''}). Check GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env, then run it again.`);
  }
  let refreshToken: unknown;
  try {
    refreshToken = ((await res.json()) as { refresh_token?: unknown }).refresh_token;
  } catch { /* handled below like a missing token */ }
  if (typeof refreshToken !== 'string' || !refreshToken) {
    throw new Error('Google sent no refresh token. Remove HiveGen\'s access at https://myaccount.google.com/permissions and run the sign-in again.');
  }
  return refreshToken;
}

type FreeBusyAnswer = { calendars?: Record<string, { busy?: { start: string; end: string }[]; errors?: unknown[] }> };
type EventAnswer = { id?: unknown; hangoutLink?: unknown; conferenceData?: { entryPoints?: { entryPointType?: string; uri?: unknown }[] } };

export function createGoogleCalendar(cfg: GoogleCalendarConfig, fetchFn: FetchFn = fetch, timeoutMs = 8000): Calendar {
  let cached: { value: string; expiresAt: number } | undefined;
  let refreshing: Promise<string> | undefined;

  /** One request with a time limit; a network error or timeout becomes CalendarUnavailableError. */
  async function send(label: string, url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetchFn(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      throw new CalendarUnavailableError(`google ${label} ${error instanceof Error && error.name === 'TimeoutError' ? 'timed out' : 'unreachable'}`);
    }
  }

  async function readJson<T>(res: Response, label: string): Promise<T> {
    try {
      return (await res.json()) as T;
    } catch {
      throw new CalendarUnavailableError(`google ${label} unreadable`);
    }
  }

  async function requestToken(): Promise<string> {
    const res = await send('token', TOKEN_URL, form({ client_id: cfg.clientId, client_secret: cfg.clientSecret, refresh_token: cfg.refreshToken, grant_type: 'refresh_token' }));
    if (!res.ok) {
      const reason = await errorCode(res);
      throw new CalendarUnavailableError(`google token ${res.status}${reason ? ` ${reason}` : ''}`);
    }
    const answer = await readJson<{ access_token?: unknown; expires_in?: unknown }>(res, 'token');
    if (typeof answer.access_token !== 'string' || !answer.access_token) throw new CalendarUnavailableError('google token malformed');
    const seconds = typeof answer.expires_in === 'number' ? answer.expires_in : 3600;
    cached = { value: answer.access_token, expiresAt: Date.now() + seconds * 1000 - REFRESH_MARGIN_MS };
    return cached.value;
  }

  function accessToken(): Promise<string> {
    if (cached && Date.now() < cached.expiresAt) return Promise.resolve(cached.value);
    refreshing ??= requestToken().finally(() => { refreshing = undefined; });
    return refreshing;
  }

  /** An authorised API call. A 401 drops the token and tries once more with a fresh one. */
  async function api(label: string, method: string, path: string, body?: unknown): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const token = await accessToken();
      const res = await send(label, `${API}${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (res.status === 401 && attempt === 0) {
        if (cached?.value === token) cached = undefined;
        continue;
      }
      return res;
    }
  }

  const succeeded = (label: string, res: Response): Response => {
    if (!res.ok) throw new CalendarUnavailableError(`google ${label} ${res.status}`);
    return res;
  };

  const iso = (label: string, value: unknown): string => {
    const time = typeof value === 'string' ? new Date(value) : new Date(NaN);
    if (Number.isNaN(time.getTime())) throw new CalendarUnavailableError(`google ${label} malformed`);
    return time.toISOString();
  };

  const events = `/calendars/${encodeURIComponent(cfg.calendarId)}/events`;
  const eventPath = (eventId: string) => `${events}/${encodeURIComponent(eventId)}?sendUpdates=all`;

  return {
    async busy(fromIso, toIso): Promise<Interval[]> {
      const res = succeeded('freeBusy', await api('freeBusy', 'POST', '/freeBusy', { timeMin: fromIso, timeMax: toIso, items: [{ id: cfg.calendarId }] }));
      const entry = (await readJson<FreeBusyAnswer>(res, 'freeBusy')).calendars?.[cfg.calendarId];
      if (!entry) throw new CalendarUnavailableError('google freeBusy malformed');
      if (entry.errors?.length) throw new CalendarUnavailableError('google freeBusy calendar error');
      return (entry.busy ?? []).map((b) => ({ start: iso('freeBusy', b?.start), end: iso('freeBusy', b?.end) }));
    },

    async createEvent(e: CalendarEventInput) {
      const res = succeeded('create', await api('create', 'POST', `${events}?conferenceDataVersion=1&sendUpdates=all`, {
        summary: e.summary,
        description: e.description,
        start: { dateTime: e.start },
        end: { dateTime: e.end },
        attendees: [{ email: e.attendee.email, displayName: e.attendee.name }],
        conferenceData: { createRequest: { requestId: randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } } },
        extendedProperties: { private: e.privateProps },
      }));
      const made = await readJson<EventAnswer>(res, 'create');
      if (typeof made.id !== 'string' || !made.id) throw new CalendarUnavailableError('google create malformed');
      const video = made.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video')?.uri;
      const meetUrl = [made.hangoutLink, video].find((u): u is string => typeof u === 'string' && u !== '');
      return { eventId: made.id, meetUrl };
    },

    async moveEvent(eventId, start, end) {
      succeeded('move', await api('move', 'PATCH', eventPath(eventId), { start: { dateTime: start }, end: { dateTime: end } }));
    },

    async cancelEvent(eventId) {
      const res = await api('cancel', 'DELETE', eventPath(eventId));
      if (res.status === 404 || res.status === 410) return; // already gone (e.g. deleted by hand in Google Calendar)
      succeeded('cancel', res);
    },
  };
}
