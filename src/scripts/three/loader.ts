/** Tiny entry in the main bundle: loads three.js only where live 3D is wanted (desktop, or phones when switched on). */
export function initThree(): void {
  const canvases = [...document.querySelectorAll<HTMLCanvasElement>('canvas[data-testid="three-canvas"]')];
  if (canvases.length === 0) return;
  const live = window.matchMedia('(min-width: 1061px)').matches || document.documentElement.dataset.live3dMobile === 'true';
  if (!live) return;
  document.documentElement.classList.add('live3d');
  const animate = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  import('./scene')
    .then(({ mountScene }) => mountScene(canvases, { animate }))
    .catch((err) => {
      document.documentElement.classList.remove('live3d');
      console.warn('3D disabled:', err);
    });
}
