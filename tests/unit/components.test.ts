import { it, expect } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import BeforeAfter from '../../src/components/BeforeAfter.astro';
import { loadSection } from '../../src/lib/content/load';
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
  // one copy is half the track; at the desktop front-row height (270px) a 360x500 card is 194px wide, plus an 18px gap
  expect((cards.length / 2) * (360 * 270 / 500 + 18)).toBeGreaterThanOrEqual(2560);
  expect(html).toMatch(/<img[^>]*width="360"[^>]*height="500"/);
});
