import { describe, it, expect, vi, afterEach } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import Page from '../../src/pages/booking/[token].astro';
import { getContext } from '../../src/server/context';
import type { ServerContext } from '../../src/server/context';
import type { BookingService } from '../../src/server/booking/service';
import type { Booking, Lead } from '../../src/server/booking/types';
import { loadSection, loadSite } from '../../src/lib/content/load';

// The page answers with the right status and headers in every state the server can be in. The server's context is replaced by a stand-in.
vi.mock('../../src/server/context', () => ({ getContext: vi.fn() }));

const mg = loadSection('manage-booking');
const site = loadSite();
const TOKEN = 'T'.repeat(43);
const lead = { id: 1, publicId: 'P'.repeat(22), name: 'Zoë O’Brien', email: 'zoe+ads@example.com', buyerType: 'agent', volume: '6–15', pageVersion: 'main', attribution: {}, createdAt: new Date(), status: 'booked' } as Lead;
const booking: Booking = {
  id: 7, leadId: 1, start: '2026-12-07T14:00:00.000Z', end: '2026-12-07T14:15:00.000Z', visitorTz: 'America/New_York', status: 'booked', manageToken: TOKEN,
  meetUrl: 'https://meet.google.com/abc-defg-hij', createdAt: new Date(), updatedAt: new Date(),
};

const withService = (getManaged: BookingService['getManaged'] | null) => {
  const ctx = { service: getManaged ? { getManaged } : null } as unknown as ServerContext;
  vi.mocked(getContext).mockResolvedValue(ctx);
};

async function visit(token = TOKEN) {
  const container = await AstroContainer.create();
  const res = await container.renderToResponse(Page, { params: { token }, request: new Request(`https://hivegen.test/booking/${token}`) });
  return { res, html: (await res.text()).replace(/&#39;/g, "'") }; // the page escapes an apostrophe; the words are compared as written
}

afterEach(() => { vi.restoreAllMocks(); vi.mocked(getContext).mockReset(); });

describe('the manage page on the server', () => {
  it('a known token: 200 with the call time, never indexed, never cached', async () => {
    const getManaged = vi.fn<BookingService['getManaged']>(async () => ({ booking, lead, canCancel: true, canReschedule: true }));
    withService(getManaged);
    const { res, html } = await visit();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(html).toContain('Monday, December 7, 9:00 AM EST');
    expect(html).toContain(`<title>${mg.title}</title>`);
    expect(html).not.toContain('Zoë');
    expect(html).not.toContain('zoe+ads');
    expect(getManaged).toHaveBeenCalledWith(TOKEN);
  });

  it('an unknown token: 404 with the not-found text, never indexed, never cached', async () => {
    withService(async () => null);
    const { res, html } = await visit('nope');
    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(html).toContain('noindex');
    expect(html).toContain(mg.notFoundText);
    expect(html).not.toContain('data-manage');
  });

  it('booking not connected: 503 with the error text and the Instagram link, never indexed, never cached', async () => {
    withService(null);
    const { res, html } = await visit();
    expect(res.status).toBe(503);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(html).toContain('noindex');
    expect(html).toContain(mg.errorText);
    expect(html).toContain(`href="${site.contact.instagramUrl}"`);
  });

  it('the server context failing to load is the same 503', async () => {
    vi.mocked(getContext).mockRejectedValue(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { res, html } = await visit();
    expect(res.status).toBe(503);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(html).toContain(mg.errorText);
  });

  it('a lookup that fails (the database is down) is a 500 with the error text; the log has the kind of error and nothing from the data', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    withService(async () => { throw Object.assign(new Error(`select * from bookings where manage_token = '${TOKEN}'`), { code: 'ECONNREFUSED' }); });
    const { res, html } = await visit();
    expect(res.status).toBe(500);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(html).toContain(mg.errorText);
    expect(html).not.toContain('select *');
    const logged = error.mock.calls.flat().join(' ');
    expect(logged).toContain('Error ECONNREFUSED');
    expect(logged).not.toContain(TOKEN);
  });
});
