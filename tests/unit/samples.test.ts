import { it, expect } from 'vitest';
import { collectSamples, assertNoSamplesInProduction } from '../../src/lib/content/samples';
it('lists every sample item', () => {
  const s = collectSamples();
  expect(s).toHaveLength(16); // 3 testimonial videos + 12 screenshots + before/after
  expect(s.some((x) => x.includes('shot-01.jpg'))).toBe(true);
});
it('production mode refuses samples', () => {
  expect(() => assertNoSamplesInProduction('production')).toThrowError(/Sample content found[\s\S]*shot-01\.jpg/);
});
it('draft mode allows samples', () => { expect(() => assertNoSamplesInProduction('draft')).not.toThrow(); });
