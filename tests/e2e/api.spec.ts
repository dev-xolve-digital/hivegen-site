import { test, expect } from '@playwright/test';
import fs from 'node:fs';

test('the booking server answers in test mode', async ({ request }) => {
  const r = await request.get('/api/booking/config');
  expect(r.status()).toBe(200);
  expect(await r.json()).toEqual({ mode: 'live', turnstileSiteKey: '1x00000000000000000000AA' });
});

test('pages are still prerendered files', () => {
  for (const f of ['index.html', 'agents/index.html', 'privacy/index.html']) expect(fs.existsSync(`dist/client/${f}`), f).toBe(true);
});
