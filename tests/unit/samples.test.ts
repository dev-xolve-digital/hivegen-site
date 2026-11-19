import { it, expect, afterEach } from 'vitest';
import { collectSamples, assertNoSamplesInProduction } from '../../src/lib/content/samples';
import { tempContent, removeTempContent } from '../helpers/temp-content';
afterEach(() => { delete process.env.CONTENT_DIR; removeTempContent(); });

it('the real content has no samples left, so a production build may finish', () => {
  expect(collectSamples()).toEqual([]);
  expect(() => assertNoSamplesInProduction('production')).not.toThrow();
});
it('production mode refuses a sample and names it', () => {
  process.env.CONTENT_DIR = tempContent({ 'testimonials.yaml': (s) => s.replace('sample: false', 'sample: true') });
  expect(collectSamples()).toEqual(['testimonials.yaml › screenshots[0] (kenneth-clary-2.webp)']);
  expect(() => assertNoSamplesInProduction('production')).toThrow(/Sample content found[\s\S]*kenneth-clary-2\.webp/);
});
it('draft mode allows samples', () => {
  process.env.CONTENT_DIR = tempContent({ 'testimonials.yaml': (s) => s.replace('sample: false', 'sample: true') });
  expect(() => assertNoSamplesInProduction('draft')).not.toThrow();
});
