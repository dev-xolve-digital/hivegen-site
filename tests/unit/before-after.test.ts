// @vitest-environment jsdom
import { it, expect } from 'vitest';
import { initSlider } from '../../src/scripts/before-after';
it('arrow keys move the slider by 5 and clamp', () => {
  document.body.innerHTML = '<div role="slider" aria-valuenow="50" tabindex="0"></div>';
  const el = document.querySelector<HTMLElement>('[role=slider]')!;
  initSlider(el);
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
  expect(el.getAttribute('aria-valuenow')).toBe('55');
  expect(el.style.getPropertyValue('--pos')).toBe('55%');
  for (let i = 0; i < 30; i++) el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
  expect(el.getAttribute('aria-valuenow')).toBe('0');
});
