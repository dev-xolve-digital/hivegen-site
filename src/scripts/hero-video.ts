/** Starts the silent hero loop after the page has loaded, unless the visitor prefers less motion or saves data. */
export function initHeroVideo(): void {
  const v = document.querySelector<HTMLVideoElement>('[data-testid="hero-video"]');
  if (!v) return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
  if (reduced || saveData) return;
  const start = () => {
    v.src = v.dataset.src!;
    v.play().catch(() => {});
  };
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
}
