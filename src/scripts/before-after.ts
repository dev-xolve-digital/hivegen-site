const motionOk = () =>
  !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches &&
  (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData !== true;

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
    videos[1].addEventListener('timeupdate', () => {
      if (Math.abs(videos[0].currentTime - videos[1].currentTime) > 0.2) videos[0].currentTime = videos[1].currentTime;
    });
  }
  playWhenVisible(el, videos);
}

export function initBeforeAfter(): void {
  document.querySelectorAll<HTMLElement>('[data-reveal]').forEach(initReveal);
  document.querySelectorAll<HTMLElement>('[data-ba-slider]').forEach(initSlider);
}
