import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:4322' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel: 'chrome', viewport: { width: 1440, height: 900 } } },
    { name: 'phone', use: { ...devices['Pixel 7'], channel: 'chrome' } },
  ],
  webServer: {
    // The site is built and run from a copy of content/ with the go-live settings off (no tracking ids, no Turnstile key, no signed video
    // links), so adding the real ones to content/site.yaml later cannot make a test contact Meta, Google or Cloudflare, or fail.
    command: 'tsx scripts/e2e-content.ts && cross-env CONTENT_DIR=.astro/e2e-content npm run build && cross-env CONTENT_DIR=.astro/e2e-content HOST=127.0.0.1 PORT=4322 NODE_ENV=test HIVEGEN_FAKES=1 PUBLIC_SITE_URL=http://127.0.0.1:4322 node dist/server/entry.mjs',
    url: 'http://localhost:4322',
    reuseExistingServer: false, // a leftover server from an older build must never be reused silently
    timeout: 240_000,
  },
});
