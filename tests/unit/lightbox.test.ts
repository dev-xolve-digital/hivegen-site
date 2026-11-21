// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const trackViewContent = vi.hoisted(() => vi.fn());
vi.mock('../../src/scripts/tracking', () => ({ trackViewContent }));

import { closeLightbox, openLightbox, type LightboxItem } from '../../src/scripts/lightbox';

const ERROR_TEXT = 'This video could not be loaded. Please try again.';
const stream = (videoId: string, title = `Title of ${videoId}`): LightboxItem => ({ kind: 'stream', videoId, orientation: 'vertical', title });
const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const lb = () => document.querySelector<HTMLElement>('[data-testid="lightbox"]')!;
const media = () => lb().querySelector<HTMLElement>('[data-media]')!;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A fetch whose answers are given by hand, one call at a time. */
function pendingFetch() {
  const calls: Array<{ url: string; resolve: (r: Response) => void; reject: (e: unknown) => void }> = [];
  const fetchFn = vi.fn((url: string) => new Promise<Response>((resolve, reject) => { calls.push({ url, resolve, reject }); }));
  vi.stubGlobal('fetch', fetchFn);
  return { calls, fetchFn };
}

beforeEach(() => {
  document.body.innerHTML = `<div class="page"></div>
    <div class="hglb" data-testid="lightbox" data-error="${ERROR_TEXT}" hidden>
      <div class="hglb-in"><button type="button" class="hglb-x">x</button><div data-media></div></div>
    </div>`;
  trackViewContent.mockClear();
  // jsdom does not play media
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});
afterEach(async () => {
  closeLightbox();
  await flush(); // closing sends the browser Back; let that settle before the next test opens a pop-up
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('opening a Stream video', () => {
  it('asks the server for the link, then plays what it answers with', async () => {
    const { calls } = pendingFetch();
    openLightbox(stream('v-portfolio-reel', 'Portfolio reel'));
    expect(lb().hidden).toBe(false); // open at once, empty until the link comes
    expect(media().querySelector('iframe')).toBeNull();
    expect(calls.map((c) => c.url)).toEqual(['/api/video/v-portfolio-reel']);

    calls[0].resolve(answer({ src: 'https://customer-abc.cloudflarestream.com/TOKEN/iframe?autoplay=true' }));
    await flush();
    const frame = media().querySelector('iframe')!;
    expect(frame.getAttribute('src')).toBe('https://customer-abc.cloudflarestream.com/TOKEN/iframe?autoplay=true');
    expect(frame.title).toBe('Portfolio reel');
    expect(frame.allowFullscreen).toBe(true);
    expect(lb().getAttribute('aria-label')).toBe('Portfolio reel');
  });

  it('keeps the history step, the focus on the close button and the tracking call, whatever the server says', async () => {
    const { calls } = pendingFetch();
    const push = vi.spyOn(history, 'pushState');
    openLightbox(stream('v-x', 'The X video'));
    expect(push).toHaveBeenCalledExactlyOnceWith({ hglb: 1 }, '');
    expect(history.state).toEqual({ hglb: 1 });
    expect(document.activeElement).toBe(lb().querySelector('.hglb-x'));
    expect((document.querySelector('.page') as HTMLElement & { inert: boolean }).inert).toBe(true);
    expect(trackViewContent).toHaveBeenCalledExactlyOnceWith('The X video'); // not held back for the answer
    calls[0].resolve(answer({ error: 'not_connected' }, 503));
    await flush();
    expect(trackViewContent).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['the server says 503', () => answer({ error: 'not_connected' }, 503)],
    ['the video is unknown', () => answer({ error: 'not_found' }, 404)],
    ['the visitor is over the limit', () => answer({ error: 'rate_limited' }, 429)],
    ['the answer has no link', () => answer({ nope: true })],
  ])('shows the error text inside the pop-up when %s', async (_why, reply) => {
    const { calls } = pendingFetch();
    openLightbox(stream('v-x'));
    calls[0].resolve(reply());
    await flush();
    expect(media().querySelector('iframe')).toBeNull();
    expect(media().textContent).toBe(ERROR_TEXT);
    expect(media().querySelector('[role="alert"]')).not.toBeNull();
    expect(lb().hidden).toBe(false);
  });

  it('shows the error text when the connection fails', async () => {
    const { calls } = pendingFetch();
    openLightbox(stream('v-x'));
    calls[0].reject(new TypeError('Failed to fetch'));
    await flush();
    expect(media().textContent).toBe(ERROR_TEXT);
  });

  it('can still be closed after an error, and opens normally the next time', async () => {
    const { calls } = pendingFetch();
    openLightbox(stream('v-x'));
    calls[0].resolve(answer({ error: 'not_connected' }, 503));
    await flush();
    closeLightbox();
    expect(lb().hidden).toBe(true);
    expect(media().childElementCount).toBe(0);
    openLightbox(stream('v-y'));
    calls[1].resolve(answer({ src: 'https://example.test/y' }));
    await flush();
    expect(media().querySelector('iframe')!.getAttribute('src')).toBe('https://example.test/y');
    expect(media().textContent).toBe('');
  });

  it('an answer that comes after the pop-up was closed does not play and does not show an error', async () => {
    const { calls } = pendingFetch();
    openLightbox(stream('v-x'));
    closeLightbox();
    calls[0].resolve(answer({ src: 'https://example.test/late' }));
    await flush();
    expect(lb().hidden).toBe(true);
    expect(media().childElementCount).toBe(0);
    openLightbox(stream('v-y'));
    closeLightbox();
    calls[1].reject(new TypeError('Failed to fetch'));
    await flush();
    expect(media().childElementCount).toBe(0);
  });

  it('an old answer never replaces the video that was opened after it', async () => {
    const { calls } = pendingFetch();
    openLightbox(stream('v-slow'));
    closeLightbox();
    openLightbox(stream('v-fast'));
    calls[1].resolve(answer({ src: 'https://example.test/fast' }));
    await flush();
    calls[0].resolve(answer({ src: 'https://example.test/slow' }));
    await flush();
    expect(media().querySelectorAll('iframe')).toHaveLength(1);
    expect(media().querySelector('iframe')!.getAttribute('src')).toBe('https://example.test/fast');
  });
});

describe('opening a local video', () => {
  it('plays the file at once and asks the server for nothing', () => {
    const { fetchFn } = pendingFetch();
    openLightbox({ kind: 'file', src: '/media/videos/v-x.mp4', orientation: 'horizontal', title: 'Local one' });
    const video = media().querySelector('video')!;
    expect(video.getAttribute('src')).toBe('/media/videos/v-x.mp4');
    expect(video.controls).toBe(true);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(lb().querySelector('.hglb-in')!.classList.contains('wide')).toBe(true);
    expect(trackViewContent).toHaveBeenCalledExactlyOnceWith('Local one');
  });
});

describe('closing', () => {
  it('Escape, the close button and the backdrop close it, and the page is usable again', async () => {
    const { calls } = pendingFetch();
    const closers: Array<() => void> = [
      () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })),
      () => lb().querySelector<HTMLElement>('.hglb-x')!.click(),
      () => lb().click(),
    ];
    // the script binds its listeners when the pop-up is on the page; this page was built after the import, so bind by importing again
    vi.resetModules();
    const fresh = await import('../../src/scripts/lightbox');
    for (const close of closers) {
      fresh.openLightbox(stream('v-x'));
      calls.at(-1)!.resolve(answer({ src: 'https://example.test/x' }));
      await flush();
      expect(lb().hidden).toBe(false);
      close();
      expect(lb().hidden).toBe(true);
      expect(media().childElementCount).toBe(0);
      expect(document.documentElement.style.overflow).toBe('');
      expect((document.querySelector('.page') as HTMLElement & { inert: boolean }).inert).toBe(false);
      await flush();
    }
  });
});
