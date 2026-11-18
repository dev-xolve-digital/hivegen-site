import { it, expect, afterEach } from 'vitest';
import { loadSite, loadVideos, loadSection, loadTestimonials } from '../../src/lib/content/load';
import { tempContent, removeTempContent } from '../helpers/temp-content';
afterEach(() => { delete process.env.CONTENT_DIR; removeTempContent(); });

it('a misspelt screenshot file name is named with its field', () => {
  process.env.CONTENT_DIR = tempContent({ 'testimonials.yaml': (s) => s.replace('file: shot-03.jpg', 'file: shot-3.jpg') });
  expect(() => loadTestimonials()).toThrow(/testimonials\.yaml: "shot-3\.jpg" was not found in public\/media\/screenshots\/.*\(field screenshots\.2\.file\)/);
});
it('screenshots come with their image size', () => {
  expect(loadTestimonials().screenshots[0]).toMatchObject({ file: 'shot-01.jpg', width: 360, height: 500 });
});
it('a video without a card image says to run npm run media', () => {
  process.env.CONTENT_DIR = tempContent({ 'videos.yaml': (s) => s.replace('id: v-rooftop-hook', 'id: v-rooftop-hook-2') });
  expect(() => loadVideos()).toThrow(/videos\.yaml: no card image for "v-rooftop-hook-2".*npm run media \(field videos\.\d+\.id\)/);
});
it('a wrong logo path is named', () => {
  process.env.CONTENT_DIR = tempContent({ 'site.yaml': (s) => s.replace('logo: /brand/logo.png', 'logo: /brand/logo-x.png') });
  expect(() => loadSite()).toThrow(/site\.yaml: "\/brand\/logo-x\.png" was not found in public\/.*\(field brand\.logo\)/);
});
it('slider mode without its clips says to run npm run media', () => {
  process.env.CONTENT_DIR = tempContent({
    'sections/before-after.yaml': (s) => s.replace(/^mode: reveal/m, 'mode: slider')
      + '\nslider:\n  before: { source: a.mp4, start: 0, duration: 4 }\n  after: { source: b.mp4, start: 0, duration: 4 }\n',
  });
  expect(() => loadSection('before-after')).toThrow(/before-after\.yaml: public\/media\/clips\/ba-before\.mp4 is missing; run npm run media \(field slider\.before\)/);
});
