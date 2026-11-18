/** Video protection, page side: no save/open menu on anything marked data-protect. */
export function initProtection(): void {
  const block = (e: Event) => {
    if ((e.target as Element | null)?.closest?.('[data-protect]')) e.preventDefault();
  };
  document.addEventListener('contextmenu', block);
  document.addEventListener('dragstart', block);
}
