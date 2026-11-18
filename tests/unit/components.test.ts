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
const shot = (n: number) => ({ file: `shot-${n}.jpg`, alt: 'x', row: 'front' as const, sample: true });
it.each([2, 20])('a marquee with %i shots renders a doubled track', async (n) => {
  const c = await AstroContainer.create();
  const html = await c.renderToString(MessageMarquee, { props: { shots: Array.from({ length: n }, (_, i) => shot(i)), direction: 'right', layer: 'front' } });
  expect(html.match(/data-testid="shot"/g)).toHaveLength(n * 2);
});
