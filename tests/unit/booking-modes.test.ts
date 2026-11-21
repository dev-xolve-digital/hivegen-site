import { describe, it, expect, afterEach, vi } from 'vitest';
import { b, mainHtml, mount, renderBooking, site } from './helpers/booking-dom';
import { initBooking } from '../../src/scripts/booking-ui';
import type { BookingApi } from '../../src/lib/booking/api-client';
import { removeTempContent, tempContent } from '../helpers/temp-content';

afterEach(() => { delete process.env.CONTENT_DIR; removeTempContent(); });

/** An api that fails the test if the form ever asks it for anything. */
const unusedApi = (): BookingApi => ({
  createLead: vi.fn(() => Promise.reject(new Error('not expected'))),
  getSlots: vi.fn(() => Promise.reject(new Error('not expected'))),
  confirm: vi.fn(() => Promise.reject(new Error('not expected'))),
  sendInquiry: vi.fn(() => Promise.reject(new Error('not expected'))),
});

describe('booking modes', () => {
  it('off mode hides the form and shows the offline card with Instagram', async () => {
    process.env.CONTENT_DIR = tempContent(); // a site.yaml with no backupUrl (the real one gets it when the site goes live)
    const m = mount(await renderBooking(''));
    expect(m.$('[data-offline]').hidden).toBe(true); // until the script knows
    initBooking(m.root, unusedApi(), { mode: 'off' });

    expect(m.$('[data-flow]').hidden).toBe(true);
    const card = m.$('[data-offline]');
    expect(card.hidden).toBe(false);
    expect(card.textContent).toContain(b.offline.heading);
    expect(card.textContent).toContain(b.offline.text);
    expect(card.querySelector(`a[href="${site.contact.instagramUrl}"]`)).not.toBeNull();
    expect(card.querySelector('[data-backup]')).toBeNull(); // no backupUrl
    expect(m.$('[data-demo-note]').hidden).toBe(true);
  });

  it('off mode shows the backup link too when site.yaml has one', async () => {
    process.env.CONTENT_DIR = tempContent({ 'site.yaml': (t) => t.replace('backupUrl: ""', 'backupUrl: https://calendar.example/hassan') });
    const m = mount(await renderBooking(''));
    initBooking(m.root, unusedApi(), { mode: 'off' });
    const link = m.$('[data-offline]').querySelector<HTMLAnchorElement>('a[data-backup]')!;
    expect(link.href).toBe('https://calendar.example/hassan');
    expect(link.textContent).toBe(b.backupLabel);
    // The note about an unchecked calendar carries the same link.
    expect(m.$('[data-calendar-note] a').getAttribute('href')).toBe('https://calendar.example/hassan');
  });

  it('demo mode shows the demo note', async () => {
    const m = mount(await mainHtml());
    expect(m.$('[data-demo-note]').hidden).toBe(true); // rendered hidden
    expect(m.$('[data-demo-note]').textContent).toBe(b.demoNote);
    initBooking(m.root, unusedApi(), { mode: 'demo' });
    expect(m.$('[data-demo-note]').hidden).toBe(false);
    expect(m.$('[data-flow]').hidden).toBe(false);
    expect(m.$('[data-offline]').hidden).toBe(true);
  });

  it('live mode shows the form and neither the demo note nor the offline card', async () => {
    const m = mount(await mainHtml());
    initBooking(m.root, unusedApi(), { mode: 'live' });
    expect(m.$('[data-demo-note]').hidden).toBe(true);
    expect(m.$('[data-offline]').hidden).toBe(true);
    expect(m.$('[data-flow]').hidden).toBe(false);
    expect(m.$<HTMLFormElement>('[data-step="details"]').hidden).toBe(false);
  });
});

describe('what the page ships', () => {
  it('the form cannot submit natively: method post, action #book, and a button that starts disabled', async () => {
    const m = mount(await mainHtml());
    const form = m.$<HTMLFormElement>('[data-step="details"]');
    expect(form.getAttribute('method')).toBe('post');
    expect(form.getAttribute('action')).toBe('#book');
    expect(m.$<HTMLButtonElement>('[data-submit]').disabled).toBe(true);
    initBooking(m.root, unusedApi(), { mode: 'live' });
    expect(m.$<HTMLButtonElement>('[data-submit]').disabled).toBe(false); // only the script enables it
  });

  it('the honeypot is a name="website" input people never see or reach', async () => {
    const m = mount(await mainHtml());
    const input = m.$<HTMLInputElement>('input[name="website"]');
    const wrapper = input.closest('[aria-hidden="true"]') as HTMLElement;
    expect(wrapper).not.toBeNull();
    expect(wrapper.className).toContain('hp'); // positioned off-screen by site.css
    expect(input.getAttribute('tabindex')).toBe('-1');
    expect(input.getAttribute('autocomplete')).toBe('off');
    expect(wrapper.textContent).toContain(b.honeypotLabel);
  });

  it('the JSON blobs escape "<", so wording can never close the script tag', async () => {
    const wording = 'Nothing is open. </script><img src=x onerror=alert(1)>';
    process.env.CONTENT_DIR = tempContent({ 'sections/booking.yaml': (t) => t.replace(/^noSlots: .*$/m, `noSlots: ${JSON.stringify(wording)}`) });
    const html = await renderBooking('');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('\\u003c/script>');
    const m = mount(html);
    expect(JSON.parse(m.$('[data-booking-copy]').textContent!).noSlots).toBe(wording);
  });

  it('each page version tells the script which version it is', async () => {
    expect(mount(await renderBooking('agents')).root.dataset.page).toBe('agents');
    expect(mount(await mainHtml()).root.dataset.page).toBe('main');
  });
});
