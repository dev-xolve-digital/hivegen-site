import { it, expect, afterEach } from 'vitest';
import { resolveVideo, heroLoopSrc, imageUrl } from '../../src/lib/media';
import { getVideo, loadSite, loadVideos, loadTestimonials } from '../../src/lib/content/load';
import { tempContent, removeTempContent } from '../helpers/temp-content';
afterEach(() => { delete process.env.CONTENT_DIR; removeTempContent(); });
const base = loadSite().settings;
const stream = { ...base, videoSource: 'stream' as const, streamCustomerCode: 'abc123' };
const CF = 'https://imagedelivery.net/VqmzJppFb-FqShL8TBqhpw';

it('a listed image is served from Cloudflare Images; an unlisted one by the site', () => {
  expect(imageUrl('/media/posters/v-rooftop-hook.jpg')).toBe(`${CF}/e1ba4a9f-89c6-417d-aae2-2cf10e6e8300/public`);
  expect(imageUrl('media/3d/hero-play.webp')).toBe(`${CF}/307a23e3-3b41-4f94-c055-1d846a1d8a00/public`);
  expect(imageUrl('/media/posters/not-uploaded.jpg')).toBe('/media/posters/not-uploaded.jpg');
});
it('local mode serves prepared files; the card image still comes from Cloudflare Images', () => {
  expect(resolveVideo(getVideo('v-twilight-exterior'), { ...base, videoSource: 'local' })).toEqual({
    poster: `${CF}/8f5b4d55-381c-4acb-6b43-3aa90c58af00/public`,
    play: { kind: 'file', src: '/media/videos/v-twilight-exterior.mp4' } });
});
it('stream mode plays from Cloudflare Stream', () => {
  expect(resolveVideo({ ...getVideo('v-twilight-exterior'), streamUid: 'uid1' }, stream).play).toEqual(
    { kind: 'stream', src: 'https://customer-abc123.cloudflarestream.com/uid1/iframe?autoplay=true&primaryColor=%231C45F5' });
});
it('a Stream video without a source file takes its card image from Stream', () => {
  const v = { ...getVideo('v-twilight-exterior'), id: 't-x', source: undefined, posterTime: 7.5, streamUid: 'uid1' };
  expect(resolveVideo(v, stream).poster).toBe('https://customer-abc123.cloudflarestream.com/uid1/thumbnails/thumbnail.jpg?time=7.5s&height=640');
});
it('stream mode without a Stream ID names the video', () => {
  expect(() => resolveVideo({ ...getVideo('v-street-hook'), streamUid: undefined }, stream)).toThrow(/v-street-hook/);
});
it('a video with host: local plays its file even in stream mode', () => {
  expect(resolveVideo({ ...getVideo('v-twilight-exterior'), host: 'local' }, stream).play).toEqual({ kind: 'file', src: '/media/videos/v-twilight-exterior.mp4' });
});
it('the real content plays every portfolio video from Stream', () => {
  expect(base.videoSource).toBe('stream');
  expect(base.streamCustomerCode).toBe('yph9uum1du6x869b');
  expect(resolveVideo(getVideo('v-portfolio-reel'), base).play.src).toContain('/69f417a2079e8572ca2ec41802f03bc2/iframe');
});
it('every client video plays from Stream and none is a sample', () => {
  for (const tv of loadTestimonials().videos) {
    const v = getVideo(tv.videoId);
    expect(resolveVideo(v, base).play.kind, tv.videoId).toBe('stream');
    expect(v.sample, tv.videoId).toBeFalsy();
  }
});
it('a video needs a source file or a Stream ID', () => {
  process.env.CONTENT_DIR = tempContent({ 'videos.yaml': (s) => s.replace(/    streamUid: 2278dc6d5001c0013aa412070d0270a2\r?\n/, "") });
  expect(() => loadVideos()).toThrow(/videos\.yaml: "t-kenneth" needs a source file .* or a streamUid .*\(field videos\.\d+\)/);
});
it('the hero loop is always served by the site', () => {
  expect(heroLoopSrc()).toBe('/media/clips/hero-loop.mp4');
});
