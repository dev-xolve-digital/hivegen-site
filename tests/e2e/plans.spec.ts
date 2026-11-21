import { test, expect } from './fixtures';
import { listPages, loadSection } from '../../src/lib/content/load';
import { fillTerms } from '../../src/lib/text';
test('plans show prices and terms from content', async ({ page }) => {
  await page.goto('/');
  const cards = page.getByTestId('plan-card'), { plans, termsLine } = loadSection('plans');
  await expect(cards).toHaveCount(plans.length);
  for (const [i, p] of plans.entries()) {
    await expect(cards.nth(i)).toContainText(`$${p.price}`);
    await expect(cards.nth(i)).toContainText(fillTerms(termsLine, p.minimumPerMonth, p.revisions));
  }
});
test('pricing order follows each version', async ({ page }) => {
  for (const p of listPages()) {
    await page.goto('/' + p.slug);
    const singleFirst = await page.getByTestId('single-bar').evaluate((s) =>
      !!(s.compareDocumentPosition(document.querySelector('[data-testid="plan-card"]')!) & Node.DOCUMENT_POSITION_FOLLOWING));
    expect(singleFirst).toBe(p.pricingOrder === 'single-first');
  }
});
test('phone: plans are stacked in full, no sideways scrolling', async ({ page, isMobile }) => {
  test.skip(!isMobile);
  await page.goto('/');
  const vw = page.viewportSize()!.width;
  for (const w of await page.getByTestId('plan-card').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width))) expect(w).toBeGreaterThan(vw * 0.8);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
test('FAQ opens an answer', async ({ page }) => {
  await page.goto('/');
  const first = loadSection('faq').items[0];
  await page.getByText(first.q).click();
  await expect(page.getByText(first.a)).toBeVisible();
});
