import { it, expect, afterEach } from 'vitest';
import { loadSite, loadVideos, loadSection, loadTestimonials } from '../../src/lib/content/load';
import { tempContent, removeTempContent } from '../helpers/temp-content';
afterEach(() => { delete process.env.CONTENT_DIR; removeTempContent(); });

it('a misspelt screenshot file name is named with its field', () => {
  process.env.CONTENT_DIR = tempContent({ 'testimonials.yaml': (s) => s.replace('file: img-4001.webp', 'file: img-401.webp') });
  expect(() => loadTestimonials()).toThrow(/testimonials\.yaml: "img-401\.webp" was not found in public\/media\/screenshots\/.*\(field screenshots\.1\.file\)/);
});
it('screenshots come with their image size', () => {
  expect(loadTestimonials().screenshots[0]).toMatchObject({ file: 'kenneth-clary-2.webp', width: 1294, height: 1114 });
});
it('a video without a card image says to run npm run media', () => {
  process.env.CONTENT_DIR = tempContent({ 'videos.yaml': (s) => s.replace('id: v-rooftop-hook', 'id: v-rooftop-hook-2') });
  expect(() => loadVideos()).toThrow(/videos\.yaml: no card image for "v-rooftop-hook-2".*npm run media \(field videos\.\d+\.id\)/);
});
it('a wrong logo path is named', () => {
  process.env.CONTENT_DIR = tempContent({ 'site.yaml': (s) => s.replace('logo: /brand/logo.png', 'logo: /brand/logo-x.png') });
  expect(() => loadSite()).toThrow(/site\.yaml: "\/brand\/logo-x\.png" was not found in public\/.*\(field brand\.logo\)/);
});
it('a section 05 mode without its clips says to run npm run media', () => {
  // The slider clips exist; the old reveal clip was removed when the section switched to the slider.
  process.env.CONTENT_DIR = tempContent({
    'sections/before-after.yaml': (s) => s.replace(/^mode: slider/m, 'mode: reveal')
      + '\nreveal: { source: a.mp4, start: 0, duration: 3, slowdown: 1, cutAt: 1 }\n',
  });
  expect(() => loadSection('before-after')).toThrow(/before-after\.yaml: public\/media\/clips\/ba-reveal\.mp4 is missing; run npm run media \(field reveal\)/);
});
it('the manage-booking words: the rescheduled text must keep {when}, and a missing word is named with its field', () => {
  process.env.CONTENT_DIR = tempContent({ 'sections/manage-booking.yaml': (s) => s.replace(/^(rescheduledText:.*)\{when\}/m, '$1then') });
  expect(() => loadSection('manage-booking')).toThrow(/manage-booking\.yaml: "rescheduledText" must keep the \{when\} placeholder \(field rescheduledText\)/);
  process.env.CONTENT_DIR = tempContent({ 'sections/manage-booking.yaml': (s) => s.replace(/^tooLateText:.*\n/m, '') });
  expect(() => loadSection('manage-booking')).toThrow(/manage-booking\.yaml: "tooLateText" is missing \(field tooLateText\)/);
});
it('the inquiry words: done.text must keep {email}, and needOptions cannot be empty', () => {
  process.env.CONTENT_DIR = tempContent({ 'sections/booking.yaml': (s) => s.replace(/^(    text: We'll reply to )\{email\}/m, '$1you') });
  expect(() => loadSection('booking')).toThrow(/booking\.yaml: "inquiry\.done\.text" must keep the \{email\} placeholder \(field inquiry\.done\.text\)/);
  process.env.CONTENT_DIR = tempContent({ 'sections/booking.yaml': (s) => s.replace(/^(  needOptions:).*$/m, '$1 []') });
  expect(() => loadSection('booking')).toThrow(/booking\.yaml: .*inquiry\.needOptions/);
  // a word left out is named with its field, as everywhere else
  process.env.CONTENT_DIR = tempContent({ 'sections/booking.yaml': (s) => s.replace(/^  submitLabel:.*\n/m, '') });
  expect(() => loadSection('booking')).toThrow(/booking\.yaml: "inquiry\.submitLabel" is missing \(field inquiry\.submitLabel\)/);
});
