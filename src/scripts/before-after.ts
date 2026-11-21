const motionOk = () =>
  !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches &&
  (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData !== true;

/** The two slider clips may differ by this much before the raw one is moved. */
const DRIFT_SECONDS = 0.5;
/** HTMLMediaElement.readyState: enough data to play on from the current position. */
const HAVE_FUTURE_DATA = 3;

/** Plays the given videos only while they are on screen (never with reduced motion or data saver). */
function playWhenVisible(root: HTMLElement, videos: HTMLVideoElement[]): void {
  if (videos.length === 0 || !motionOk() || !('IntersectionObserver' in window)) return;
  new IntersectionObserver(([e]) => {
    for (const v of videos) {
      if (e.isIntersecting) v.play().catch(() => {});
      else v.pause();
    }
  }, { threshold: 0.25 }).observe(root);
}

/** Reveal mode: el holds a <video> and [data-label=before|after]; the "on" label switches at data-cut-at seconds. */
export function initReveal(el: HTMLElement): void {
  const video = el.querySelector('video');
  if (!video) return;
  const cut = parseFloat(el.dataset.cutAt ?? '0');
  const before = el.querySelector('[data-label="before"]');
  const after = el.querySelector('[data-label="after"]');
  let raf = 0;
  const update = () => {
    const isAfter = video.currentTime >= cut;
    before?.classList.toggle('on', !isAfter);
    after?.classList.toggle('on', isAfter);
  };
  const loop = () => { update(); raf = video.paused ? 0 : requestAnimationFrame(loop); };
  video.addEventListener('play', () => { if (!raf) raf = requestAnimationFrame(loop); });
  for (const ev of ['seeking', 'seeked', 'timeupdate']) video.addEventListener(ev, update);
  // A video that has not loaded yet fires no seek events, so also check a few times a second.
  window.setInterval(update, 200);
  update();
  playWhenVisible(el, [video]);
}

/** Slider mode: role="slider"; pointer drag plus arrow keys (±5), clamped to 0–100; sets --pos and aria-valuenow. */
export function initSlider(el: HTMLElement): void {
  const set = (n: number) => {
    const v = Math.max(0, Math.min(100, Math.round(n)));
    el.setAttribute('aria-valuenow', String(v));
    el.style.setProperty('--pos', `${v}%`);
  };
  const now = () => Number(el.getAttribute('aria-valuenow') ?? 50);
  set(now());
  el.addEventListener('keydown', (e) => {
    const step: Record<string, number> = { ArrowRight: 5, ArrowUp: 5, ArrowLeft: -5, ArrowDown: -5 };
    if (e.key in step) { e.preventDefault(); set(now() + step[e.key]); }
    else if (e.key === 'Home') { e.preventDefault(); set(0); }
    else if (e.key === 'End') { e.preventDefault(); set(100); }
  });
  const fromPointer = (e: PointerEvent) => {
    const r = el.getBoundingClientRect();
    if (r.width > 0) set(((e.clientX - r.left) / r.width) * 100);
  };
  el.addEventListener('pointerdown', (e) => { el.setPointerCapture?.(e.pointerId); fromPointer(e); });
  el.addEventListener('pointermove', (e) => { if (el.hasPointerCapture?.(e.pointerId)) fromPointer(e); });
  const videos = [...el.querySelectorAll('video')];
  if (videos.length === 2) {
    // The clips are a minute long and their keyframes can be seconds apart, so a slow connection cannot always catch up. Moving the raw
    // clip while either one is still seeking or has too little data would send it back again and again (up to 4 times a second): the
    // correction waits until both are ready to play, and only a real drift counts.
    const [raw, edited] = videos;
    const ready = (v: HTMLVideoElement) => !v.seeking && v.readyState >= HAVE_FUTURE_DATA;
    edited.addEventListener('timeupdate', () => {
      if (!ready(raw) || !ready(edited)) return;
      if (Math.abs(raw.currentTime - edited.currentTime) > DRIFT_SECONDS) raw.currentTime = edited.currentTime;
    });
  }
  playWhenVisible(el, videos);
}

export function initBeforeAfter(): void {
  document.querySelectorAll<HTMLElement>('[data-reveal]').forEach(initReveal);
  document.querySelectorAll<HTMLElement>('[data-ba-slider]').forEach(initSlider);
}
