import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { gzipSync } from 'node:zlib';
import { listPages } from '../../src/lib/content/load';
import { imageUrl } from '../../src/lib/media';

test('phone: initial JavaScript under 50 KB gzipped, poster under 80 KB, fonts under 100 KB', async ({ page, isMobile }) => {
  test.skip(!isMobile);
  const bodies: Promise<{ type: string; url: string; size: number }>[] = [];
  page.on('response', (r) => bodies.push(r.body().then((b) => ({ type: r.request().resourceType(), url: r.url(), size: gzipSync(b).length })).catch(() => ({ type: '', url: '', size: 0 }))));
  await page.goto('/', { waitUntil: 'load' });
  const all = await Promise.all(bodies);
  expect(all.filter((x) => x.type === 'script').reduce((n, x) => n + x.size, 0)).toBeLessThan(50 * 1024);
  expect(all.find((x) => x.url === imageUrl('media/posters/hero-loop.jpg'))!.size).toBeLessThan(80 * 1024);
  expect(all.filter((x) => x.type === 'font').reduce((n, x) => n + x.size, 0)).toBeLessThan(100 * 1024);
});
test('layout shift stays under 0.05', async ({ page }) => {
  await page.goto('/');
  const cls = await page.evaluate(() => new Promise<number>((res) => {
    let s = 0;
    new PerformanceObserver((l) => { for (const e of l.getEntries() as any[]) if (!e.hadRecentInput) s += e.value; })
      .observe({ type: 'layout-shift', buffered: true });
    setTimeout(() => res(s), 1500);
  }));
  expect(cls).toBeLessThan(0.05);
});
for (const p of listPages()) {
  test(`axe: "/${p.slug}" has no serious or critical issues`, async ({ page }) => {
    test.setTimeout(90_000); // a full axe pass with live 3D on desktop can take longer than the default 30 s
    await page.goto('/' + p.slug);
    const r = await new AxeBuilder({ page }).analyze();
    expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
  });
}
