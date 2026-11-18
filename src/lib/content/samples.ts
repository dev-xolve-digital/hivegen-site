import { loadVideos, loadSection, loadTestimonials } from './load';
import { ContentError } from './errors';

/** Every placeholder still marked `sample: true`, as human-readable locations. */
export function collectSamples(): string[] {
  const out: string[] = [];
  for (const v of loadVideos()) if (v.sample) out.push(`videos.yaml › ${v.id}`);
  loadTestimonials().screenshots.forEach((s, i) => {
    if (s.sample) out.push(`testimonials.yaml › screenshots[${i}] (${s.file})`);
  });
  if (loadSection('before-after').sample) out.push('sections/before-after.yaml');
  return out;
}

export function assertNoSamplesInProduction(mode: string | undefined = process.env.SITE_MODE): void {
  if (mode !== 'production') return;
  const samples = collectSamples();
  if (samples.length === 0) return;
  throw new ContentError(
    `Sample content found (${samples.length} items). Replace each one with real content and set sample: false:\n` +
      samples.map((s) => `  - ${s}`).join('\n'),
    'content',
  );
}
