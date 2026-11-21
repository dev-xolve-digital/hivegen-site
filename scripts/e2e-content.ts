/**
 * Makes the content the browser tests run on: `.astro/e2e-content/`, a copy of `content/` in which the go-live settings of
 * site.yaml (tracking ids, Turnstile site key, backup link, signed video links) are off. The Playwright server is built and started
 * with CONTENT_DIR pointing there, so filling in the real settings can never make a browser test contact Meta, Google or Cloudflare.
 * Run by the webServer command in playwright.config.ts (which names the same folder).
 */
import { copyNeutralContent } from '../tests/helpers/neutral-content';

const dir = '.astro/e2e-content';
copyNeutralContent('content', dir);
console.log(`e2e content: ${dir}`);
