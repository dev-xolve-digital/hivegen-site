import { describe, it, expect, afterEach } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import BeforeAfter from '../../src/components/BeforeAfter.astro';
import HeroStage from '../../src/components/HeroStage.astro';
import VideoCard from '../../src/components/VideoCard.astro';
import { getVideo, loadSection } from '../../src/lib/content/load';
import { tempContent, removeTempContent } from '../helpers/temp-content';
import { b as bookingWords, mount, renderBooking } from './helpers/booking-dom';
it('before/after renders nothing when disabled', async () => {
  const c = await AstroContainer.create();
  expect((await c.renderToString(BeforeAfter, { props: { enabled: false, section: loadSection('before-after') } })).trim()).toBe('');
});
it('slider mode renders an accessible slider', async () => {
  const c = await AstroContainer.create();
  const section = { ...loadSection('before-after'), mode: 'slider' as const,
    slider: { before: { source: 'a.mp4', start: 0, duration: 4 }, after: { source: 'b.mp4', start: 0, duration: 4 } } };
  expect(await c.renderToString(BeforeAfter, { props: { enabled: true, section } })).toMatch(/role="slider"[^>]*aria-valuenow="50"/);
});
import MessageMarquee from '../../src/components/MessageMarquee.astro';
const shot = (n: number) => ({ file: `shot-${n}.jpg`, alt: `message ${n}`, row: 'front' as const, sample: true, width: 360, height: 500 });
it.each([2, 20])('a marquee with %i shots fills a 2560px screen and announces each shot once', async (n) => {
  const c = await AstroContainer.create();
  const html = await c.renderToString(MessageMarquee, { props: { shots: Array.from({ length: n }, (_, i) => shot(i)), direction: 'right', layer: 'front' } });
  const cards = html.match(/<figure[^>]*data-testid="shot"[^>]*>/g)!;
  expect(cards.filter((f) => !f.includes('aria-hidden')).length).toBe(n);
  expect(cards.length % 2).toBe(0);
  // one copy is half the track; front-row cards are 320px wide on desktop, plus an 18px gap
  expect((cards.length / 2) * (320 + 18)).toBeGreaterThanOrEqual(2560);
  expect(html).toMatch(/<img[^>]*width="360"[^>]*height="500"/);
});

afterEach(() => { delete process.env.CONTENT_DIR; removeTempContent(); });

/** What the pop-up is handed: the data-lightbox JSON of the first element that has one. */
const lightboxOf = (html: string) => JSON.parse(html.match(/data-lightbox="([^"]*)"/)![1].replaceAll('&#34;', '"').replaceAll('&quot;', '"')) as Record<string, unknown>;
const noStreamAddress = (html: string) => {
  expect(html).not.toContain('cloudflarestream.com');
  expect(html).not.toMatch(/eyJ[\w-]{10,}\.[\w-]+\./); // a JWT
};

it.each(['v-portfolio-reel', 't-kenneth'])('the card for %s gives the pop-up the video id, and the page holds no Stream address', async (id) => {
  const html = await (await AstroContainer.create()).renderToString(VideoCard, { props: { video: getVideo(id) } });
  expect(lightboxOf(html)).toEqual({ kind: 'stream', videoId: id, orientation: 'vertical', title: getVideo(id).title });
  noStreamAddress(html);
});

it('a client card shows its own file as the card image, with signing off or on', async () => {
  for (const signed of [false, true]) {
    process.env.CONTENT_DIR = tempContent({ 'site.yaml': (t) => t.replace('streamSignedUrls: false', `streamSignedUrls: ${signed}`) });
    const html = await (await AstroContainer.create()).renderToString(VideoCard, { props: { video: getVideo('t-chris') } });
    expect(html).toMatch(/<img src="\/media\/posters\/t-chris\.jpg"/);
    noStreamAddress(html);
  }
});

it('the hero card and "Watch the full edit" give the pop-up their video ids too', async () => {
  const c = await AstroContainer.create();
  const hero = await c.renderToString(HeroStage);
  expect(lightboxOf(hero)).toMatchObject({ kind: 'stream', videoId: 'v-portfolio-reel' });
  noStreamAddress(hero);
  const section = { ...loadSection('before-after'), mode: 'slider' as const,
    slider: { before: { source: 'a.mp4', start: 0, duration: 4 }, after: { source: 'b.mp4', start: 0, duration: 4 }, fullVideoId: 'v-before-after-edit', fullVideoLabel: 'Watch the full edit' } };
  const ba = await c.renderToString(BeforeAfter, { props: { enabled: true, section } });
  expect(lightboxOf(ba)).toMatchObject({ kind: 'stream', videoId: 'v-before-after-edit', orientation: 'vertical' });
  noStreamAddress(ba);
});

it('a video hosted locally keeps its file path in the card', async () => {
  const video = { ...getVideo('v-twilight-exterior'), host: 'local' as const };
  const html = await (await AstroContainer.create()).renderToString(VideoCard, { props: { video } });
  expect(lightboxOf(html)).toEqual({ kind: 'file', src: '/media/videos/v-twilight-exterior.mp4', orientation: 'vertical', title: 'Twilight exterior' });
});

describe('the booking card: the switch and the "Send details" form', () => {
  it('the switch opens on the call', async () => {
    const m = mount(await renderBooking());
    expect(m.$('[data-switch]').getAttribute('role')).toBe('tablist');
    expect(m.$('[data-switch]').getAttribute('aria-label')).toBe(bookingWords.switch.label);
    expect(m.$('[data-view="call"]').getAttribute('aria-selected')).toBe('true');
    expect(m.$('[data-view="details"]').getAttribute('aria-selected')).toBe('false');
    expect(m.$('[data-view="call"]').textContent!.trim()).toBe(bookingWords.switch.call);
    expect(m.$('[data-view="details"]').textContent!.trim()).toBe(bookingWords.switch.details);
    expect(m.$('[data-view="details"]').classList.contains('nudge')).toBe(true);
    expect(m.$('[data-flow]').hidden).toBe(false);
    expect(m.$('[data-inquiry]').hidden).toBe(true);
    expect(m.$('[data-heading="call"]').hidden).toBe(false);
    expect(m.$('[data-heading="details"]').hidden).toBe(true);
    expect(m.$('[data-subline="call"]').hidden).toBe(false);
    expect(m.$('[data-subline="details"]').hidden).toBe(true);
    expect(m.$('[data-heading="details"]').matches('h2.disp')).toBe(true);
    expect(m.$('[data-heading="details"]').textContent).toBe(bookingWords.inquiry.heading);
    expect(m.$('[data-subline="details"]').textContent).toBe(bookingWords.inquiry.subline);
  });

  it('each tab names the panel it controls, and each panel the tab that labels it', async () => {
    const m = mount(await renderBooking());
    for (const [view, panel] of [['call', '[data-flow]'], ['details', '[data-inquiry]']] as const) {
      const tab = m.$(`[data-view="${view}"]`);
      expect(tab.getAttribute('role')).toBe('tab');
      expect(m.$(panel).getAttribute('role')).toBe('tabpanel');
      expect(m.$(panel).id).toBe(tab.getAttribute('aria-controls'));
      expect(m.$(panel).getAttribute('aria-labelledby')).toBe(tab.id);
    }
    // only the selected tab is in the tab order
    expect(m.$('[data-view="call"]').getAttribute('tabindex')).toBe('0');
    expect(m.$('[data-view="details"]').getAttribute('tabindex')).toBe('-1');
  });

  it('the form lists the needOptions as checkboxes and the volume options as radios', async () => {
    const m = mount(await renderBooking());
    const form = m.$('[data-inquiry-form]');
    const needs = [...form.querySelectorAll<HTMLInputElement>('input[type="checkbox"][name="needs"]')];
    expect(needs.map((i) => i.value)).toEqual(bookingWords.inquiry.needOptions);
    expect(needs.every((i) => !i.checked)).toBe(true);
    const volumes = [...form.querySelectorAll<HTMLInputElement>('input[type="radio"][name="volume"]')];
    expect(volumes.map((i) => i.value)).toEqual(bookingWords.volumeOptions);
    const buyers = [...form.querySelectorAll<HTMLInputElement>('input[type="radio"][name="buyer"]')];
    expect(buyers.map((i) => i.value)).toEqual(bookingWords.buyerOptions.map((o) => o.value));
    // the main page preselects nothing
    expect(form.querySelector('input[name="buyer"]:checked')).toBeNull();
  });

  it('the agents page preselects Agent in the form too', async () => {
    const m = mount(await renderBooking('agents'));
    expect(m.$<HTMLInputElement>('[data-inquiry-form] input[name="buyer"]:checked').value).toBe('agent');
    expect(m.$<HTMLInputElement>('[data-flow] input[name="buyer"]:checked').value).toBe('agent');
  });

  it('the form has the fields, the errors and the hooks the script needs', async () => {
    const m = mount(await renderBooking());
    const form = m.$('[data-inquiry-form]');
    expect(form.closest('[data-inquiry]')).not.toBeNull();
    for (const f of ['email', 'phone', 'footage', 'message', 'needs', 'buyer', 'volume', 'name']) {
      expect(m.$(`[data-inq-field="${f}"]`), f).toBeTruthy();
      const err = m.$(`[data-inq-error="${f}"]`);
      expect(err.hidden, f).toBe(true);
      expect(err.getAttribute('role'), f).toBe('alert');
    }
    expect(form.querySelector('input[name="email"]')!.getAttribute('type')).toBe('email');
    expect(form.querySelector('input[name="footage"]')!.getAttribute('type')).toBe('url');
    expect(form.querySelector('textarea[name="message"]')!.getAttribute('maxlength')).toBe('2000');
    // the honeypot is there, out of the tab order and out of a screen reader's way
    const trap = form.querySelector('.hp[aria-hidden="true"] input[name="website"]')!;
    expect(trap.getAttribute('tabindex')).toBe('-1');
    // the bot check sits right above the button, and the form's own error comes after it
    const button = m.$('button[data-inq-submit]');
    expect(button.getAttribute('type')).toBe('submit');
    expect(button.previousElementSibling).toBe(m.$('[data-inq-turnstile]'));
    expect(button.nextElementSibling).toBe(m.$('p.err[data-inq-form-error]'));
    expect(m.$('[data-inq-form-error]').hidden).toBe(true);
    expect(button.textContent).toContain(bookingWords.inquiry.submitLabel);
    // the words: the note at the top, the optional tags in a <span>, the consent line at the bottom
    expect(form.textContent).toContain(bookingWords.inquiry.note);
    expect(form.textContent).toContain(bookingWords.inquiry.consentLine);
    expect(form.querySelector('label[for="iq-name"] span')!.textContent).toBe(bookingWords.inquiry.optionalTag);
    expect(form.querySelector('[data-inq-field="needs"] legend span')!.textContent).toBe(bookingWords.inquiry.needsTag);
    expect(form.querySelector('label[for="iq-footage"] span')!.textContent).toBe(bookingWords.inquiry.footageTag);
    expect(form.querySelector('label[for="iq-email"] span')).toBeNull();
    expect(form.querySelector<HTMLTextAreaElement>('textarea')!.placeholder).toBe(bookingWords.inquiry.messagePlaceholder);
  });

  it('the thank-you is hidden and focusable, and the script gets the words it needs', async () => {
    const m = mount(await renderBooking());
    const done = m.$('[data-inquiry-done]');
    expect(done.closest('[data-inquiry]')).not.toBeNull();
    expect(done.hidden).toBe(true);
    expect(done.getAttribute('tabindex')).toBe('-1');
    expect(done.querySelector('[data-inq-done-heading]')).toBeTruthy();
    expect(done.querySelector('[data-inq-done-text]')).toBeTruthy();
    expect(done.querySelector('a[href^="http"]')).toBeTruthy();
    const copy = JSON.parse(m.$('[data-inquiry-copy]').textContent!);
    const { errors } = bookingWords;
    expect(copy).toEqual({
      errors: { ...bookingWords.inquiry.errors, network: errors.network, botCheck: errors.botCheck, rateLimited: errors.rateLimited },
      done: { heading: bookingWords.inquiry.done.heading, text: bookingWords.inquiry.done.text },
    });
  });
});
