import { test, expect } from '@playwright/test';
test('home serves a page titled HiveGen', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/HiveGen/);
});
