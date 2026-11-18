import { it, expect } from 'vitest';
import { shouldShowArrows } from '../../src/scripts/carousel';
it('shows arrows only when the row overflows', () => {
  expect(shouldShowArrows(360, 390)).toBe(false);
  expect(shouldShowArrows(391, 390)).toBe(false);
  expect(shouldShowArrows(2000, 1128)).toBe(true);
});
