import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { it, expect, afterEach } from 'vitest';
import { resolveVideo, heroLoopSrc, imageUrl, lightboxJson } from '../../src/lib/media';
import { streamIframeUrl, streamThumbnailUrl } from '../../src/lib/stream-urls';
import { ContentError } from '../../src/lib/content/errors';
import { getVideo, loadSite, loadVideos, loadTestimonials } from '../../src/lib/content/load';
import { tempContent, removeTempContent } from '../helpers/temp-content';
const publicDirs: string[] = [];
/** A public/ folder holding just these files, which the content loaders and resolveVideo look in while PUBLIC_DIR points at it. */
function useTempPublic(...files: string[]): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hg-public-'));
  publicDirs.push(dir);
  for (const f of files) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), 'x');
  }
  process.env.PUBLIC_DIR = dir;
}
afterEach(() => {
  delete process.env.CONTENT_DIR;
  delete process.env.PUBLIC_DIR;
  removeTempContent();
  for (const dir of publicDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
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
it('a client video uses its local card image once the file exists', () => {
  const client = { ...getVideo('t-kenneth'), id: 't-x' }; // read before PUBLIC_DIR moves
  useTempPublic('media/posters/t-x.jpg');
  expect(resolveVideo(client, stream).poster).toBe('/media/posters/t-x.jpg');
  expect(resolveVideo(client, { ...stream, streamSignedUrls: true }).poster).toBe('/media/posters/t-x.jpg'); // and signing changes nothing for it
  // listed in images.yaml, it comes from Cloudflare Images like every other card image
  process.env.CONTENT_DIR = tempContent({ 'images.yaml': (t) => t.replace(/^images:.*$/m, (m) => `${m}\n  media/posters/t-x.jpg: abc-123`) });
  expect(resolveVideo(client, stream).poster).toBe(`${CF}/abc-123/public`);
});
it('with signing on, a Stream-only video without a card image is a content error', () => {
  const client = { ...getVideo('t-kenneth'), id: 't-missing' };
  useTempPublic(); // no card image anywhere
  const signed = { ...stream, streamSignedUrls: true };
  expect(() => resolveVideo(client, signed)).toThrow(ContentError);
  expect(() => resolveVideo(client, signed)).toThrow(/t-missing.*npm run media/);
  // with signing off the same video still falls back to Stream's own thumbnail
  expect(resolveVideo(client, stream).poster).toMatch(/^https:\/\/customer-abc123\.cloudflarestream\.com\/2278dc6d5001c0013aa412070d0270a2\/thumbnails\/thumbnail\.jpg\?time=7\.5s&height=640$/);
});
it('every client video has its committed card image, so no page loads a Stream thumbnail, signed or not', () => {
  for (const tv of loadTestimonials().videos) {
    const v = getVideo(tv.videoId);
    expect(fs.existsSync(`public/media/posters/${v.id}.jpg`), `public/media/posters/${v.id}.jpg`).toBe(true);
    for (const settings of [base, { ...base, streamSignedUrls: true }]) {
      expect(resolveVideo(v, settings).poster, tv.videoId).toBe(imageUrl(`media/posters/${v.id}.jpg`));
    }
  }
});
it('Stream addresses take the video ID or a signed token in the same place', () => {
  expect(streamIframeUrl('abc123', 'uid1')).toBe('https://customer-abc123.cloudflarestream.com/uid1/iframe?autoplay=true&primaryColor=%231C45F5');
  expect(streamIframeUrl('abc123', 'a.b.c')).toBe('https://customer-abc123.cloudflarestream.com/a.b.c/iframe?autoplay=true&primaryColor=%231C45F5');
  expect(streamThumbnailUrl('abc123', 'uid1', 7.5)).toBe('https://customer-abc123.cloudflarestream.com/uid1/thumbnails/thumbnail.jpg?time=7.5s&height=640');
});
it('a Stream card hands the pop-up the video id and never an address; a local video hands it its file', () => {
  const stream1 = JSON.parse(lightboxJson(getVideo('v-portfolio-reel'), resolveVideo(getVideo('v-portfolio-reel'), base).play));
  expect(stream1).toEqual({ kind: 'stream', videoId: 'v-portfolio-reel', orientation: 'vertical', title: 'Portfolio reel' });
  const local = JSON.parse(lightboxJson(getVideo('v-twilight-exterior'), resolveVideo(getVideo('v-twilight-exterior'), { ...base, videoSource: 'local' }).play));
  expect(local).toEqual({ kind: 'file', src: '/media/videos/v-twilight-exterior.mp4', orientation: 'vertical', title: 'Twilight exterior' });
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
