/** Arrows are only useful when the row is wider than its box (1px tolerance for rounding). */
export function shouldShowArrows(scrollWidth: number, clientWidth: number): boolean {
  return scrollWidth > clientWidth + 1;
}

/** Binds every [data-carousel]: prev/next scroll by two card widths; arrows hide when there is nothing to scroll. */
export function initCarousels(): void {
  document.querySelectorAll<HTMLElement>('[data-carousel]').forEach((root) => {
    if (root.dataset.bound) return;
    root.dataset.bound = '1';
    const track = root.querySelector<HTMLElement>('[data-track]');
    const arrows = root.querySelector<HTMLElement>('[data-arrows]');
    if (!track) return;
    root.querySelectorAll<HTMLButtonElement>('[data-dir]').forEach((b) => {
      b.addEventListener('click', () => {
        const card = track.firstElementChild as HTMLElement | null;
        const gap = parseFloat(getComputedStyle(track).columnGap) || 16;
        const step = card ? card.getBoundingClientRect().width + gap : 300;
        track.scrollBy({ left: step * 2 * Number(b.dataset.dir), behavior: 'smooth' });
      });
    });
    const update = () => { if (arrows) arrows.hidden = !shouldShowArrows(track.scrollWidth, track.clientWidth); };
    update();
    if (typeof ResizeObserver === 'function') new ResizeObserver(update).observe(track);
    else addEventListener('resize', update);
  });
}
