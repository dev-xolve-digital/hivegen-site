import { it, expect, afterEach } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import BeforeAfter from '../../src/components/BeforeAfter.astro';
import HeroStage from '../../src/components/HeroStage.astro';
import VideoCard from '../../src/components/VideoCard.astro';
import { getVideo, loadSection } from '../../src/lib/content/load';
import { tempContent, removeTempContent } from '../helpers/temp-content';
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
