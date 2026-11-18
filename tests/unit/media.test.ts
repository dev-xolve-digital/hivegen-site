import { it, expect } from 'vitest';
import { resolveVideo, heroLoopSrc } from '../../src/lib/media';
import { getVideo, loadSite } from '../../src/lib/content/load';
const base = loadSite().settings;
const stream = { ...base, videoSource: 'stream' as const, streamCustomerCode: 'abc123' };

it('local mode serves prepared files', () => {
  expect(resolveVideo(getVideo('v-twilight-exterior'), { ...base, videoSource: 'local' })).toEqual({
    poster: '/media/posters/v-twilight-exterior.jpg',
    play: { kind: 'file', src: '/media/videos/v-twilight-exterior.mp4' } });
});
it('stream mode plays from Cloudflare; the poster stays on the site', () => {
  expect(resolveVideo({ ...getVideo('v-twilight-exterior'), streamUid: 'uid1' }, stream)).toEqual({
    poster: '/media/posters/v-twilight-exterior.jpg',
    play: { kind: 'stream', src: 'https://customer-abc123.cloudflarestream.com/uid1/iframe?autoplay=true&primaryColor=%231C45F5' } });
});
it('stream mode without a Stream ID names the video', () => {
  expect(() => resolveVideo({ ...getVideo('v-street-hook'), streamUid: undefined }, stream)).toThrowError(/v-street-hook/);
});
it('a video with host: local plays its file even in stream mode', () => {
  expect(resolveVideo(getVideo('t-creator'), stream).play).toEqual({ kind: 'file', src: '/media/videos/t-creator.mp4' });
});
it('the real content plays every portfolio video from Stream', () => {
  expect(base.videoSource).toBe('stream');
  expect(base.streamCustomerCode).toBe('yph9uum1du6x869b');
  expect(resolveVideo(getVideo('v-portfolio-reel'), base).play.src).toContain('/69f417a2079e8572ca2ec41802f03bc2/iframe');
});
it('the hero loop is always served by the site', () => {
  expect(heroLoopSrc()).toBe('/media/clips/hero-loop.mp4');
});
