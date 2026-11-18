/** Shows the phone booking bar once the hero's booking button has scrolled out of view above. */
export function initMobileBar(): void {
  const bar = document.querySelector<HTMLElement>('[data-testid="mobile-bar"]');
  if (!bar) return;
  const cta = document.querySelector<HTMLElement>('[data-hero-cta]');
  if (!cta || !('IntersectionObserver' in window)) {
    bar.hidden = false;
    return;
  }
  new IntersectionObserver(([entry]) => {
    bar.hidden = entry.isIntersecting || entry.boundingClientRect.top > 0;
  }).observe(cta);
}
