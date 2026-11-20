import { fetchVideoSrc } from '../lib/booking/api-client';
import { trackViewContent } from './tracking';

/** What a card hands the pop-up (its data-lightbox): a Stream video by its id (the server gives its link), or a local file. */
export type LightboxItem =
  | { kind: 'stream'; videoId: string; orientation: 'vertical' | 'horizontal'; title: string }
  | { kind: 'file'; src: string; orientation: 'vertical' | 'horizontal'; title: string };

let opener: HTMLElement | null = null;
// The pop-up adds one history step, so the phone's Back button (or swipe-back) closes it
// instead of leaving the site.
let ownsHistoryStep = false;
// Which opening is on screen. A link that arrives after the pop-up was closed, or after another video was opened, is dropped.
let opening = 0;
const root = () => document.querySelector<HTMLElement>('[data-testid="lightbox"]');

/** The player, once the server has given its address. */
function playStream(media: HTMLElement, src: string, title: string): void {
  const f = document.createElement('iframe');
  f.src = src;
  f.title = title;
  f.allow = 'autoplay; encrypted-media; fullscreen';
  f.allowFullscreen = true;
  media.replaceChildren(f);
}

/** The pop-up's own words for a video whose link could not be had (they come from content/sections/hero.yaml, in data-error). */
function showError(lb: HTMLElement, media: HTMLElement): void {
  const message = document.createElement('p');
  message.className = 'hglb-msg';
  message.setAttribute('role', 'alert');
  message.textContent = lb.dataset.error ?? '';
  media.replaceChildren(message);
}

export function openLightbox(item: LightboxItem): void {
  const lb = root();
  if (!lb) return;
  const box = lb.querySelector<HTMLElement>('.hglb-in')!;
  const media = lb.querySelector<HTMLElement>('[data-media]')!;
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const mine = ++opening;
  box.classList.toggle('wide', item.orientation === 'horizontal');
  lb.setAttribute('aria-label', item.title);
  if (item.kind === 'stream') {
    media.replaceChildren(); // the pop-up opens at once; the player comes when the server has given its link
    fetchVideoSrc(item.videoId).then(
      (src) => { if (mine === opening) playStream(media, src, item.title); },
      () => { if (mine === opening) showError(lb, media); },
    );
  } else {
    const v = document.createElement('video');
    v.src = item.src;
    v.controls = true;
    v.autoplay = true;
    v.playsInline = true;
    v.setAttribute('controlslist', 'nodownload noplaybackrate');
    v.setAttribute('disablepictureinpicture', '');
    media.replaceChildren(v);
    v.play().catch(() => {});
  }
  lb.hidden = false;
  if (!ownsHistoryStep) {
    history.pushState({ hglb: 1 }, '');
    ownsHistoryStep = true;
  }
  document.documentElement.style.overflow = 'hidden';
  const page = document.querySelector<HTMLElement>('.page');
  if (page) page.inert = true; // keeps keyboard focus inside the pop-up
  lb.querySelector<HTMLElement>('.hglb-x')?.focus();
  trackViewContent(item.title);
}

export function closeLightbox(): void {
  const lb = root();
  if (!lb || lb.hidden) return;
  opening += 1; // a link still on its way is not wanted any more
  const media = lb.querySelector<HTMLElement>('[data-media]')!;
  media.querySelector('video')?.pause();
  media.replaceChildren();
  lb.hidden = true;
  document.documentElement.style.overflow = '';
  const page = document.querySelector<HTMLElement>('.page');
  if (page) page.inert = false;
  opener?.focus();
  opener = null;
  if (ownsHistoryStep) {
    ownsHistoryStep = false;
    history.back(); // closed with X, Escape or the backdrop: remove the step we added
  }
}

function bind(): void {
  const lb = root();
  if (!lb || lb.dataset.bound) return;
  lb.dataset.bound = '1';
  lb.querySelector('.hglb-x')?.addEventListener('click', closeLightbox);
  lb.addEventListener('click', (e) => { if (e.target === lb) closeLightbox(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeLightbox();
  });
  window.addEventListener('popstate', () => {
    if (!ownsHistoryStep) return;
    ownsHistoryStep = false; // Back already removed our step
    closeLightbox();
  });
  document.addEventListener('click', (e) => {
    const el = (e.target as Element | null)?.closest?.<HTMLElement>('[data-lightbox]');
    if (!el) return;
    e.preventDefault();
    el.focus();
    openLightbox(JSON.parse(el.dataset.lightbox!) as LightboxItem);
  });
}

bind();
