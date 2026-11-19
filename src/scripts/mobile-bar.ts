/**
 * Shows the phone booking bar once the hero's booking button has scrolled out of view above,
 * and hides it again while the booking section is on screen, so it never covers the form.
 */
export function initMobileBar(): void {
  const bar = document.querySelector<HTMLElement>('[data-testid="mobile-bar"]');
  if (!bar) return;
  const cta = document.querySelector<HTMLElement>('[data-hero-cta]');
  if (!cta || !('IntersectionObserver' in window)) {
    bar.hidden = false;
    return;
  }
  let pastHero = false;
  let bookingOnScreen = false;
  const update = () => { bar.hidden = !pastHero || bookingOnScreen; };
  new IntersectionObserver(([entry]) => {
    pastHero = !entry.isIntersecting && entry.boundingClientRect.top <= 0;
    update();
  }).observe(cta);
  const booking = document.getElementById('book');
  if (booking) {
    new IntersectionObserver(([entry]) => {
      bookingOnScreen = entry.isIntersecting;
      update();
    }).observe(booking);
  }
}
