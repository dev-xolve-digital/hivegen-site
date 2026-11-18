/** Pauses the message rows while they are off screen, so they cost nothing until the visitor reaches them. */
export function initMarquees(): void {
  const rows = document.querySelectorAll<HTMLElement>('.mq');
  if (!rows.length || !('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) e.target.classList.toggle('off', !e.isIntersecting);
  });
  rows.forEach((row) => {
    row.classList.add('off');
    io.observe(row);
  });
}
