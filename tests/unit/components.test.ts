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
